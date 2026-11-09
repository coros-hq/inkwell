/**
 * Portable mode (Windows zip build): everything lives in a `data` folder next to
 * the executable instead of the OS user profile. The Rust side decides (see
 * `data_root` in src-tauri/src/lib.rs); this module is how the frontend finds out and
 * keeps its own file locations in step.
 */
import { invoke } from '@tauri-apps/api/core'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const slashes = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

let cached: Promise<string | null> | null = null

/** The portable `data` folder (forward slashes), or null for a normal installed run. */
export function portableRoot(): Promise<string | null> {
  if (!inTauri) return Promise.resolve(null)
  cached ??= invoke<string | null>('data_root_path').then(p => (p ? slashes(p) : null)).catch(() => null)
  return cached
}

/** inkwell's own small global files (canvas, drawings, active vault…): `<data>/config`, else `~/.inkwell`. */
export async function configDir(): Promise<string> {
  const root = await portableRoot()
  if (root) return `${root}/config`
  const { homeDir, join } = await import('@tauri-apps/api/path')
  return join(await homeDir(), '.inkwell')
}

/** Where calendar.json lives: `<data>/config` when portable, else the OS app-data folder. */
export async function calendarDir(): Promise<string> {
  const root = await portableRoot()
  if (root) return `${root}/config`
  const { appDataDir } = await import('@tauri-apps/api/path')
  return (await appDataDir()).replace(/\/$/, '')
}

// ── Moving a portable folder ─────────────────────────────────────────────────
// The web profile travels with the folder, but it remembers vaults by absolute path
// ("D:\Apps\inkwell\data\Vault"). After a move to another drive or PC those paths are
// stale, so rewrite any that pointed inside the old folder to the new one.

const ROOT_KEY = 'inkwell-portable-root'
const PATH_KEYS = ['inkwell-last-vault', 'inkwell-backup-dir', 'inkwell-canvas-linked-vault']
const RECENT_KEY = 'inkwell-recent-vaults'
const PATH_KEY_PREFIXES = ['inkwell-boards:', 'inkwell-backup-last:']

const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0))

export async function rebasePortablePaths(): Promise<void> {
  const root = await portableRoot()
  if (!root) return
  try {
    const was = localStorage.getItem(ROOT_KEY)
    if (was === root) return
    localStorage.setItem(ROOT_KEY, root)
    if (!was) return // first run from this folder: nothing to fix

    // Rebase against the app folder (the parent of `data`), so a vault kept beside it moves too.
    const from = parentOf(slashes(was))
    const to = parentOf(root)
    const rebase = (p: string): string => {
      const n = slashes(p)
      return n.toLowerCase() === from.toLowerCase() || n.toLowerCase().startsWith(from.toLowerCase() + '/')
        ? to + n.slice(from.length)
        : p
    }

    for (const key of PATH_KEYS) {
      const v = localStorage.getItem(key)
      if (v) localStorage.setItem(key, rebase(v))
    }

    const recents = localStorage.getItem(RECENT_KEY)
    if (recents) {
      const list = JSON.parse(recents) as { path: string }[]
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.map(v => ({ ...v, path: rebase(v.path) }))))
    }

    // Per-vault entries are keyed by path, so they need re-keying rather than rewriting.
    for (const key of Object.keys(localStorage)) {
      const prefix = PATH_KEY_PREFIXES.find(p => key.startsWith(p))
      if (!prefix) continue
      const moved = prefix + rebase(key.slice(prefix.length))
      if (moved === key) continue
      localStorage.setItem(moved, localStorage.getItem(key)!)
      localStorage.removeItem(key)
    }
  } catch (e) {
    console.error('[inkwell] could not update paths after moving the portable folder:', e)
  }
}
