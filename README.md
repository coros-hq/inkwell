<div align="center">
  <img src="src/assets/inkwell-icon.svg" width="100" height="100" alt="inkwell logo" />

  <h1>inkwell</h1>
  <p>A focused, beautiful markdown note-taking app.</p>

  ![Version](https://img.shields.io/badge/version-2.1.1-orange?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-black?style=flat-square)
  ![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square&color=c47d2e)
</div>

---

## Overview

inkwell is a local-first markdown editor built as a native desktop app for macOS, Windows, and Linux. Notes are stored as plain `.md` files in a vault folder you own — no lock-in, and everything works offline with no account. Signing in is optional and only needed to share a vault with teammates.

It pairs a distraction-free writing environment with a rich live preview, charts, a Kanban board, a calendar, an optional canvas and brainstorm outliner, 15 themes, and deep integrations: a native MCP server so Claude can read and write your notes, and built-in GitHub sync to push your docs to any repository.

---

## Features

**Writing**
- Distraction-free CodeMirror 6 editor with markdown syntax decoration
- Live split-view preview with full GFM rendering (tables, task lists, strikethrough)
- Syntax-highlighted code blocks that adapt to the active theme
- LaTeX math via KaTeX *(new in v0.7.8)* — inline `$…$`, display `$$…$$`, and fenced ` ```math ` / ` ```latex ` blocks, rendered live in the editor and preview
- GFM tables rendered as styled tables right in the editor *(new in v0.8.5)*
- Charts *(new in v0.8.2)* — bar, line, area, pie, and donut charts from a ` ```chart ` JSON block, rendered live in the editor and preview; build them visually with the chart builder or edit the source directly
- `/` command menu — headings, lists, todos, tables, tabs, charts, video embeds (YouTube, Vimeo, Loom), board and task embeds, and more; type `@` to link another note
- Notion-style data tables and tab groups with their own content
- Optional Vim mode (Settings → Editor)
- Find inside the current note (⌘F) and open a standalone `.md` file (⌘O)
- Inline code, blockquotes, ==highlights==, and embedded images
- Attach files to any note — images, PDFs, and documents stored alongside your vault
- Embed attachments inline with `![[filename]]` syntax

**Organisation**
- Vault-based storage — notes live as real `.md` files on disk (Obsidian-compatible)
- Nested folders that map 1:1 to real filesystem directories
- Create a folder anywhere — the New Folder dialog lets you pick its parent (or the library root)
- Inline rename of notes and folders directly in the sidebar (double-click or right-click → Rename)
- Drag-and-drop to reorder, nest, and un-nest notes and folders — the drop target follows the cursor, and moving a folder relocates its whole subtree on disk
- YAML frontmatter on every note (`id`, `created`, `updated`, `pinned`, `tags`)
- Automatic migration from legacy JSON storage on first open
- Kanban board view with columns, cards, due dates, subtasks, and comments
- Note links panel — link notes to each other and track references
- Full-text search across all notes (⌘K)
- Two ways to browse notes *(new in v0.8.3)*: the classic note list column, or open notes as tabs across the top of the editor
- Live vault watcher picks up changes made on disk by iCloud/Dropbox/Syncthing, git, or an external editor
- Conflict banner when the open note changed outside inkwell — choose "Keep mine" or "Reload from disk" without losing work
- Pinned notes
- Trash with restore — deleted notes and folders land in `{vault}/.inkwell/trash/` and can be put back or erased for good
- Safer file writes — atomic saves and data backup so a crash mid-write doesn't corrupt a note

**Folder tags** *(new in v2.0)*
- Create colored tags and assign them to folders (⌘/Ctrl-click to select several)
- Click a tag in the sidebar to filter, or group a folder's contents by tag
- Search `#tagname` in ⌘K to jump to tagged folders
- Reorganized sidebar: Quick links, Folders, Tags, Open Files

**Calendar** *(new in v2.1)*
- Calendar view for color-coded events, with drag-and-drop to move them between days

**Quick capture**
- A global ⌘N / Ctrl+N popup captures a note even when inkwell isn't focused

**Collaboration** *(optional)*
- Sign in to share a vault with teammates by email invite or invite link
- Roles: owner, can edit, can view — with live presence avatars
- Backed by Supabase; vaults you don't share never leave your disk

**Canvas** *(optional, new in v0.4)*
- Custom HTML5 canvas drawing engine — no third-party drawing libraries
- Tools: select, pen, rectangle, ellipse, line, arrow, text
- Shape styling: 12-colour palette, fill toggle, three stroke widths, corner radius, font family/size/bold/italic
- Multi-selection with rubber-band lasso, shift-click toggle, ⌘A select all
- Resize handles on selected shapes, drag-move single and multi-selection
- Duplicate (⌘D), undo/redo (⌘Z / ⌘⇧Z), zoom and pan (scroll or pinch)
- Diagram notes — a slide-in half-panel with a full CodeMirror markdown editor and Edit/Preview tabs, saved to `{vault}/.inkwell/canvas-notes.md`
- Optional **Brainstorm** outline / mind-map view — off by default, enable it in Settings → Features
- Diagram templates — Flowchart and Mind Map starters with one click
- Paste images and Excalidraw drawings straight onto the canvas
- Hand-written font by default; adapts to light and dark themes
- Canvas state auto-saved to `{vault}/.inkwell/canvas.json`

**Themes & Typography**
- 15 built-in themes: Midnight, Solarized Osaka, Noir Ember, Ivory Ember, Parchment, Ink, Dusk, Forest, Gruvbox, Catppuccin Mocha, Catppuccin Latte, Sepia, Fog, Graphite, Onyx
- Custom theme builder with live preview
- Syntax highlight colours automatically follow the active theme
- Use any font installed on your computer as the editor font *(new in v0.8.5)* — searchable picker in Settings → Editor

**Export & Share**
- Export notes as Markdown, standalone HTML, or PDF
- Rendered math and code highlighting carried into HTML/PDF exports
- Live preview before exporting
- One-click copy to clipboard

**GitHub Sync** *(new in v0.3)*
- Connect your GitHub account once in Settings → GitHub
- Push any note directly to a repository as a `.md` file
- Pull the latest version of a file back into inkwell with one click
- Works with any repo — great for keeping project READMEs and docs in sync

**Claude MCP Integration** *(new in v0.3)*
- A native Rust MCP server ships inside the app and registers itself with Claude Desktop (Settings → Claude)
- Exposes `list_notes`, `read_note`, `create_note`, `update_note`, `search_notes`, `get_vault_info` tools for notes, and `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event` for the calendar (changes appear live in the app)
- Claude can manage Kanban boards and tickets: `list_boards`, `create_board`, `rename_board`, `delete_board`, `list_board_tasks`, `read_board_task`, `create_board_task`, `update_board_task` (edit fields, tick subtasks, move between columns), `comment_on_board_task`, `delete_board_task` — also live in the app
- Claude can read, write, and search your vault directly — no copy-paste
- Notes written by Claude land as proper `.md` files with YAML frontmatter

**macOS**
- Native window with overlay title bar
- Optional frosted-glass sidebar (Settings → Appearance → Glass sidebar), tuned for contrast on light themes
- Smooth scrolling, native vibrancy, system font stack

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri v2](https://tauri.app) (Rust) |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v3 |
| Editor | CodeMirror 6 |
| Canvas | HTML5 Canvas 2D API (custom engine) |
| State | Zustand |
| Markdown | react-markdown + remark-gfm + rehype-highlight + remark-math / rehype-katex (KaTeX) |
| Drag & drop | @dnd-kit/core |
| Backend (optional collab) | Supabase (auth + Postgres with RLS) |
| MCP server | Rust (stdio JSON-RPC 2.0) |
| Build | Vite |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (stable toolchain)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
- Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and WebView2 (preinstalled on Windows 11)

### Development

```bash
# Clone and install dependencies
git clone https://github.com/your-username/inkwell.git
cd inkwell
pnpm install

# Start the dev server (hot-reload on frontend changes, recompile on Rust changes)
pnpm tauri dev
```

### Build for production

```bash
pnpm tauri build
```

Pushing a `v*` tag runs the GitHub Actions release workflow, which builds macOS (universal), Windows (installer + portable zip) and Linux (`.deb`, AppImage) bundles and attaches them to a draft release. It needs the `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets, plus an optional `RELEASE_TOKEN` PAT (Contents: read & write) if the org restricts the built-in token. Installed apps check for updates through the Tauri updater.

The output bundles are written to `src-tauri/target/release/bundle/` (`.app`/`.dmg` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux, `.exe`/`.msi` on Windows).

On macOS, to update an existing installation, drag the new `.app` onto the old one in `/Applications` and click **Replace**.

### Claude Desktop (MCP)

The MCP server is built into the app: Claude Desktop launches `inkwell --mcp` on demand and talks to it over stdio. On launch, release builds add an `inkwell` entry to Claude Desktop's config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\` on Windows) pointing at the installed app, and refresh it if the app moves. Restart Claude Desktop once to pick it up. Turn it off any time in **Settings → Claude**.

The server reads the active vault from `~/.inkwell/active-vault`, which inkwell writes whenever you open a vault. Dev builds (`pnpm tauri dev`) never touch the config; use the Settings toggle to register one deliberately.

A standalone binary is still available for other MCP clients: `cargo build --release -p inkwell-mcp`.

---

## Project Structure

```
inkwell/
├── src/
│   ├── components/
│   │   ├── editor/       # MarkdownEditor, RichPreview, MarkdownChart, ChartInsertDialog, AttachmentsBar, MediaPanel, ShareDialog, ConflictBanner
│   │   ├── layout/       # AppShell, Sidebar, NoteList, EditorPane
│   │   ├── calendar/     # CalendarView
│   │   ├── brainstorm/   # BrainstormView, MindMap
│   │   ├── collab/       # ShareVaultDialog, PresenceAvatars
│   │   ├── trash/        # TrashView
│   │   ├── quicknote/    # QuickNoteCapture, QuickNoteEditor
│   │   ├── board/        # Kanban BoardView, KanbanColumn, TaskCard, TaskDrawer
│   │   ├── canvas/       # CanvasView, CanvasToolbar, CanvasNotesSheet, canvasTypes, canvasTemplates
│   │   ├── settings/     # SettingsDialog, ThemeEditor, FontPicker
│   │   └── shared/       # Search, ContextMenu, DatePicker, GitHubSyncDialog, VaultPicker
│   ├── store/            # Zustand store (useAppStore)
│   ├── lib/              # vault.ts, safeFs.ts, calendar.ts, auth.ts, team.ts, sync/, updateCheck.ts, vaultWatcher.ts, github.ts, export.ts, editorExtensions, systemFonts, themes, attachments, utils
│   ├── styles/           # globals.css — CSS variables & theme definitions
│   └── types/            # TypeScript interfaces
└── src-tauri/
    ├── src/lib.rs         # Tauri commands (vibrancy, system font list, etc.)
    ├── mcp-server/        # inkwell-mcp — Rust MCP server for Claude
    └── tauri.conf.json    # Window config, permissions
```

---

## License

MIT
