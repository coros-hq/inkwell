# Git Sync & External-Change Tolerance — Feature Design

## Overview

Two related, non-server sync mechanisms that let a vault move between devices and be shared with a team without breaking inkwell's local-first principle ("notes are plain `.md` files in a vault folder you own — no cloud, no accounts, no lock-in," `README.md:16`):

1. **External-change tolerance** (foundation) — the app currently has *no* way to notice when vault files change on disk while it's open (no `watch`, no polling, no focus-refresh). This makes it unsafe to combine inkwell with *any* external sync mechanism — a `git pull`, an iCloud Drive/Dropbox/Syncthing sync, or a manual edit in another editor — while the app is running.
2. **Git Sync** — opt-in, per-vault, whole-vault sync via the system `git` binary (init/status/commit/pull/push from Settings). Auth is whatever the user's system git/SSH already uses; inkwell stores no token or credential for this feature. Works with any git host — GitHub, self-hosted, a bare repo on a NAS.

Both are additive: plain folder sync (iCloud/Dropbox/Syncthing) needs nothing beyond (1). Git-based team collaboration needs (1) + (2).

**Not in scope / explicitly different from existing features:**
- `'github'` settings tab (`SettingsDialog.tsx:1176`, `src/lib/github.ts`) already exists — it's a **per-note, manual, GitHub REST API push/pull** using a PAT in `localStorage`. Single-file, GitHub-only, no local git repo involved. This doc's Git Sync is a separate, broader mechanism (whole vault, any git host, CLI-based, no stored token). The two are not consolidated in this pass — flagged as an open question, not silently merged.
- `'team'` settings tab + `sharedVault`/`syncStatus` (`useAppStore.ts:338-339`, `src/lib/sync/yjsSync.ts`) is a real-time CRDT cloud sync for boards. Already a departure from "no cloud" when enabled; out of scope here, not touched by this design.

---

## Functional Requirements

- Off by default; opt-in **per vault** (same pattern as `canvasEnabled`).
- Settings → new **Sync** section:
  - Enable toggle
  - Remote URL field (only shown/needed when `.git` doesn't exist yet in the vault)
  - "Sync Now" button
  - Status row: idle / syncing / dirty / conflict / error, plus "last synced Xm ago"
- While the app is open, external changes to vault `.md` files and `.inkwell/*.json` (from `git pull`, folder-sync tools, or manual edits) are detected and folded into the UI **without** a full vault reload — current selection and open editor stay put.
- If the note currently open in the editor changed on disk **and** has unsaved in-app edits, the app must not silently pick a winner — it surfaces a conflict choice.
- Merge conflicts produced by `git pull` are surfaced, not auto-resolved, in v1. The user resolves them with their own tools (a "Reveal in Finder" link is enough).
- No new credential storage: git auth is delegated entirely to the user's system git config / SSH agent / credential helper.

---

## Architecture

### A. File Watcher

- Use `@tauri-apps/plugin-fs`'s `watch`/`watchImmediate` on the vault root. The package is already a dependency (`package.json:35-41`) — no new package needed.
- Requires a new fs-watch permission in `src-tauri/capabilities/default.json`. Today that file grants only `fs:allow-read-dir`, `fs:allow-read-text-file`, `fs:allow-rename`, `fs:allow-write-text-file`, `fs:allow-read-file`, `fs:allow-write-file`, `fs:allow-exists`, `fs:allow-mkdir`, `fs:allow-stat`, `fs:allow-remove`, scoped to `$HOME/**` — no watch permission exists.
- Events are debounced (~500ms) and diffed by path against the in-memory `notes`/`folders` in `useAppStore.ts`, so a burst of writes (e.g. `git pull` touching many files) produces one UI update, not N.

### B. Non-Destructive Refresh

- `readVaultFS(vaultPath)` (`src/lib/vault.ts:277`) already returns a full `VaultData` and can be reused as-is for reading the new on-disk state.
- Add a new store action, **`refreshVaultFromDisk`**, distinct from `openVault` (`useAppStore.ts:672`). `openVault` resets `selectedNoteIds`, `activeView`, and `selectedFolderId` — correct when switching vaults, wrong when "something changed underneath the currently-open vault." `refreshVaultFromDisk` diffs incoming `notes`/`folders`/`tasks`/`boards` against current state by id/path and patches only what changed, leaving selection and editor state alone.
- The existing `applyRemoteNoteUpdate` action (already used by the Yjs team-sync path) is precedent for "apply an externally-sourced note update into the store safely" — same category of problem, different trigger (CRDT sync vs. filesystem watch).

### C. Conflict Handling

- Watcher detects a disk change to the currently-open note **and** `saveStatus` shows unsaved local edits → don't overwrite either side. Show an in-editor banner: "This note changed on disk." Actions: **Keep mine** (proceed with in-app save, overwrites disk) or **Reload from disk** (discards local edits).
- No unsaved edits → reload silently. This is the common case (`git pull`, iCloud/Dropbox/Syncthing sync, no concurrent typing).

### D. Git Operations

- New `src/lib/gitSync.ts`, wrapping `@tauri-apps/plugin-shell`'s `Command.create('git', args, { cwd: vaultPath })`. The plugin is already a dependency and registered in Rust (`src-tauri/src/lib.rs:100-104`), but **no `shell:*` permission is currently granted** in any capabilities file — this is new surface, not just a config tweak.
- Functions:
  - `isGitRepo(vaultPath)`
  - `gitInit(vaultPath)`
  - `gitStatus(vaultPath)` → porcelain output, used for the dirty-state indicator
  - `gitAddAll(vaultPath)`
  - `gitCommit(vaultPath, message)`
  - `gitPull(vaultPath)`
  - `gitPush(vaultPath)`
  - `gitRemoteUrl(vaultPath)` → detect an existing remote vs. prompting the user for one
- This is the **first** place inkwell shells out to an external process (the only existing Rust command, `set_vibrancy` at `src-tauri/src/lib.rs:20-45`, does no process spawning). Treat error handling as first-class: git not installed, non-zero exit codes, stderr surfaced to the status/error state — not swallowed.

### E. Sync Orchestration

`syncNow(vaultPath)`:
1. `gitStatus` — if dirty: `gitAddAll` + `gitCommit` with an auto message (e.g. `inkwell: 3 notes updated — 2026-09-14 10:32`).
2. `gitPull`.
3. If pull produces conflict markers, **stop** — set `gitSyncStatus: 'conflict'`, do not push.
4. Otherwise `gitPush`.

Triggers:
- Manual "Sync Now" button (primary path for v1).
- On vault open, if git sync is enabled for that vault.
- On window focus regain (Tauri focus-changed event) — no continuous polling loop; nothing else in the app polls today either, so this stays consistent.
- Optional "Auto-commit on save" toggle: debounced `gitAddAll` + `gitCommit` (commit only, not push) a few seconds after edits settle, reusing the existing note-save debounce pattern already present for `saveStatus`.

---

## Storage Model

No new vault files. Git's own `.git/` directory lives at the vault root.

```
{vaultPath}/
  .git/                  ← standard git repo (created by gitInit, or pre-existing)
  .gitignore             ← written on gitInit (OS cruft only, e.g. .DS_Store)
  .inkwell/
    app.json             ← gains gitSyncEnabled / gitAutoCommit fields; tracked by git
  some-note.md
  ...
```

`.inkwell/app.json` should be **tracked**, not ignored — it holds boards/tasks the user wants synced alongside notes.

Per-vault settings live in the existing `AppData` shape (`vault.ts:6-8, 418-434`), not `localStorage` — sync is an opt-in property of a specific vault, same scoping as `canvasLinkedVaultPath`.

---

## Data Flow

```
Watcher path:
  fs watch event(s) on vaultPath
    → debounce 500ms
    → readVaultFS(vaultPath)
    → diff vs current store notes/folders/tasks/boards
    → refreshVaultFromDisk(diff)   [preserves selection/activeView]
    → if currently-open note changed AND has unsaved edits → conflict banner

Sync path (manual or triggered):
  syncNow(vaultPath)
    → gitStatus
    → [if dirty] gitAddAll → gitCommit(auto message)
    → gitPull
    → [conflict markers present?] → gitSyncStatus = 'conflict', stop
    → else → gitPush → gitSyncStatus = 'idle', lastSyncedAt = now
    → (pull changed files on disk → picked up by the watcher path above)
```

---

## State Changes

### `src/store/useAppStore.ts`

```ts
// State
gitSyncEnabled: boolean            // per-vault, persisted to app.json
gitSyncStatus: 'idle' | 'syncing' | 'dirty' | 'conflict' | 'error'
lastSyncedAt: Date | null
gitSyncError: string | null

// Actions
setGitSyncEnabled: (enabled: boolean) => void
syncNow: () => Promise<void>
refreshVaultFromDisk: (data: VaultData) => void
```

`setGitSyncEnabled` follows the same on/off pattern as `canvasEnabled`, but writes into `app.json` via `writeAppData` (`vault.ts:428`) instead of `localStorage`, since it's vault-scoped.

### `AppData` type + `vault.ts`

Add `gitSyncEnabled?: boolean` and `gitAutoCommit?: boolean` to the `AppData` shape read/written by `readAppData`/`writeAppData` (`vault.ts:418-434`).

---

## Settings UI

- Add `'sync'` to the `Section` union (`SettingsDialog.tsx:28`) and a corresponding `NAV_ITEMS` entry.
- New `SyncSection()` function, structurally similar to the existing `GitBranchSection()` (`SettingsDialog.tsx:1176`), but built from the app's actual toggle primitive: `ToggleSwitch` + `SettingRow` (`SettingsDialog.tsx:1670, 1691`) — the same components used for the Canvas toggle in the `'features'` section.
- Content: enable toggle, remote URL input (conditional), "Sync Now" button, status row (colored dot + label + relative last-synced time).
- Doc-level callout distinguishing this tab from the existing `'github'` tab so future readers don't conflate a whole-vault git sync with the existing per-note GitHub PAT push/pull.

---

## Tauri Permissions

`src-tauri/capabilities/default.json` needs two additions:

1. **fs watch** on the existing vault scope (`$HOME/**` is already granted for read/write; watch needs its own permission identifier added alongside the existing `fs:allow-*` entries).
2. **Scoped shell execute for `git` only** — not a blanket `shell:allow-execute`. Tauri v2's shell plugin supports scoping by program name, so the capability should allow exactly one command (`git`) rather than arbitrary process execution. This keeps the new attack surface minimal: even if arguments were ever attacker-influenced, only `git` can be invoked, never an arbitrary binary.

Both are net-new — nothing today grants shell execution or fs watching.

---

## Implementation Task Breakdown

| # | Task | File |
|---|------|------|
| 1 | Add fs-watch + scoped shell(`git`) permissions | `src-tauri/capabilities/default.json` |
| 2 | File watcher hook + debounce | `src/lib/vaultWatcher.ts` (new) |
| 3 | `refreshVaultFromDisk` store action (non-destructive diff/patch) | `src/store/useAppStore.ts` |
| 4 | Conflict banner in editor ("changed on disk") | `src/components/editor/*` (exact component TBD) |
| 5 | `gitSync.ts` — git CLI wrapper via plugin-shell | `src/lib/gitSync.ts` (new) |
| 6 | Git sync store slice + `syncNow` orchestration | `src/store/useAppStore.ts` |
| 7 | `gitSyncEnabled` / `gitAutoCommit` fields | `AppData` type + `src/lib/vault.ts` |
| 8 | `SyncSection` + `'sync'` nav entry | `src/components/settings/SettingsDialog.tsx` |
| 9 | Default `.gitignore` writer on `gitInit` | `src/lib/gitSync.ts` |

No automated test suite exists in this repo today (`src/`, no `*.test.*` files, no test script in `package.json`) — this design doesn't introduce one as a side effect; if `gitSync.ts`'s pure argument-building helpers warrant tests later, that's a separate call.

---

## Trade-offs

**No 3-way merge UI in v1.** Conflicts from `git pull` stop the sync and hand the problem back to the user's own tools (terminal, GitHub Desktop, etc.), with a "Reveal in Finder" shortcut. A real merge UI is the natural v2 once usage patterns are understood.

**Requires system `git`.** No bundled/vendored git binary. `gitInit`/`syncNow` should detect a missing `git` and surface a clear, actionable error rather than a raw spawn failure.

**New capability surface.** This is the first time inkwell shells out to an external process. Mitigated by: shell permission scoped to the `git` program only (never a general shell-execute grant), all git invocations use array-form args (never shell string interpolation), `cwd` is always the vault path.

**Relationship to existing sync features.** The `'github'` PAT tab (`src/lib/github.ts`) and `'team'` Yjs cloud tab (`src/lib/sync/yjsSync.ts`) remain untouched and un-consolidated by this design. That's a deliberate scope cut, not an oversight — worth revisiting once Git Sync has real usage, since three sync mechanisms in one app is a lot for users to reason about.

**Folder-sync (iCloud/Dropbox/Syncthing) support needs no dedicated code.** Once the file watcher (A) and non-destructive refresh (B) land, those tools work automatically — they're just another source of external file changes indistinguishable from a `git pull` at the filesystem level.
