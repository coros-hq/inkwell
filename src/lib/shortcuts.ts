// Customizable keyboard shortcuts. "mod" means Cmd on macOS / Ctrl on Windows &
// Linux, matching the (e.metaKey || e.ctrlKey) convention used everywhere else
// in this codebase. Only shortcuts bound to a printable key (letters, etc.) are
// listed here — a combo with no modifier would fire while typing, so every
// default requires at least one.

export interface ShortcutDef {
  id: string
  label: string
  description: string
  defaultCombo: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'search', label: 'Search', description: 'Open the search overlay', defaultCombo: 'mod+k' },
  { id: 'toggleSidebar', label: 'Toggle Sidebar', description: 'Show or hide the sidebar', defaultCombo: 'mod+\\' },
  { id: 'openFile', label: 'Open File', description: 'Open a standalone .md file into this vault', defaultCombo: 'mod+o' },
  { id: 'findInNote', label: 'Find in Note', description: 'Search within the current note', defaultCombo: 'mod+f' },
  // Not "mod+n" — that combo is already claimed globally (even when the app is
  // unfocused) for the quick-note capture popup, see src-tauri/src/lib.rs.
  { id: 'newNote', label: 'New Note', description: 'Create a note at the library root', defaultCombo: 'mod+shift+n' },
  { id: 'newFolder', label: 'New Folder', description: 'Create a folder inside the selected folder', defaultCombo: 'mod+shift+f' },
]

export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  SHORTCUT_DEFS.map(d => [d.id, d.defaultCombo]),
)

const STORAGE_KEY = 'inkwell-shortcuts'

export function loadShortcuts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return { ...DEFAULT_SHORTCUTS, ...saved }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

export function saveShortcuts(shortcuts: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
}

/** Normalizes a KeyboardEvent into a canonical combo string, e.g. "mod+shift+b". */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(e.key.toLowerCase())
  return parts.join('+')
}

export function comboMatches(e: KeyboardEvent, combo: string | undefined): boolean {
  if (!combo) return false
  return eventToCombo(e) === combo
}

/** A combo bound to a printable key must include a modifier, or it'd fire while typing. */
export function hasModifier(combo: string): boolean {
  return combo.includes('+')
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent ?? '')

const MOD_SYMBOLS: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥' }
const MOD_LABELS: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }

/** Human-readable form for display, e.g. "mod+shift+b" → "⌘⇧B" (mac) or "Ctrl+Shift+B". */
export function formatCombo(combo: string): string {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const keyLabel = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
  if (isMac) return mods.map(m => MOD_SYMBOLS[m] ?? m).join('') + keyLabel
  return [...mods.map(m => MOD_LABELS[m] ?? m), keyLabel].join('+')
}
