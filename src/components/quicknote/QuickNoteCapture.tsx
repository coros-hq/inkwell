import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Clock, Check, X, ChevronDown } from 'lucide-react'
import {
  getRecentVaults,
  getLastVaultPath,
  pickVaultDirectory,
  addRecentVault,
  saveQuickNote,
  type RecentVault,
} from '../../lib/vault'
import { isDarkTheme, loadCustomThemes } from '../../lib/themes'
import { deriveThemeVars, applyCustomThemeVars, clearCustomThemeVars } from '../../lib/themeUtils'
import { cn } from '../../lib/utils'
import { isWindowsApp } from '../../lib/platform'
import { QuickNoteEditor, type QuickNoteEditorHandle } from './QuickNoteEditor'

async function closeThisWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch {
    /* not running inside Tauri — no-op */
  }
}

/**
 * QuickNoteCapture — the popup shown by the global Cmd+N shortcut / tray
 * menu. Loaded as its own window (label "quick-note") pointed at the same
 * SPA entry with a `?quicknote=1` query param, so it's a separate, much
 * lighter render tree from the main AppShell.
 */
export function QuickNoteCapture() {
  const [hasText, setHasText] = useState(false)
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([])
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef('')
  const editorRef = useRef<QuickNoteEditorHandle>(null)

  // Match the theme the user has set in the main window — this popup is a
  // separate document, so it doesn't inherit those CSS vars automatically.
  useEffect(() => {
    const savedTheme = localStorage.getItem('inkwell-theme')
    const resolvedId: string = savedTheme === 'dark' ? 'midnight'
      : savedTheme === 'light' ? 'parchment'
      : savedTheme ?? 'midnight'

    const customThemes = loadCustomThemes()
    const custom = customThemes.find(t => t.id === resolvedId)
    const dark = custom ? custom.dark : isDarkTheme(resolvedId)

    document.documentElement.classList.toggle('dark', dark)
    if (custom) {
      delete document.documentElement.dataset.theme
      applyCustomThemeVars(deriveThemeVars(custom.colors, dark))
    } else {
      clearCustomThemeVars()
      document.documentElement.dataset.theme = resolvedId
    }
  }, [])

  useEffect(() => {
    const recents = getRecentVaults()
    setRecentVaults(recents)
    setVaultPath(getLastVaultPath() ?? recents[0]?.path ?? null)
  }, [])

  const handleSave = async () => {
    const value = contentRef.current
    if (!value.trim() || saving) return
    if (!vaultPath) {
      setPickerOpen(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveQuickNote(vaultPath, value)
      addRecentVault(vaultPath)
      setSaved(true)
      setTimeout(closeThisWindow, 550)
    } catch (e) {
      console.error('[inkwell] quick note save failed:', e)
      setError('Could not save — try a different vault folder.')
      setSaving(false)
    }
  }

  const handleChooseFolder = async () => {
    const path = await pickVaultDirectory()
    if (!path) return
    setVaultPath(path)
    addRecentVault(path)
    setRecentVaults(getRecentVaults())
    setPickerOpen(false)
    editorRef.current?.focus()
  }

  const vaultName = vaultPath?.split('/').pop() ?? 'Choose a vault…'

  return (
    <div className={cn('flex h-screen w-screen flex-col overflow-hidden border border-border bg-background text-foreground', !isWindowsApp && 'rounded-xl')}>
      {/* Header / drag region — left padding clears the macOS traffic lights */}
      <div
        data-tauri-drag-region
        className={cn('flex shrink-0 items-center justify-between gap-2 border-b border-border py-2.5 pr-3', isWindowsApp ? 'pl-3' : 'pl-20')}
      >
        <div className="relative">
          <button
            onClick={() => setPickerOpen(o => !o)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground',
              'transition-colors hover:bg-surface hover:text-foreground',
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="max-w-[180px] truncate">{vaultName}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {recentVaults.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  {recentVaults.map(v => (
                    <button
                      key={v.path}
                      onClick={() => {
                        setVaultPath(v.path)
                        setPickerOpen(false)
                        editorRef.current?.focus()
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-background/60',
                        v.path === vaultPath && 'text-accent',
                      )}
                    >
                      <Clock className="h-3 w-3 shrink-0 text-tertiary" />
                      <span className="truncate">{v.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={handleChooseFolder}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-background/60"
              >
                <FolderOpen className="h-3 w-3 shrink-0 text-tertiary" />
                Choose another folder…
              </button>
            </div>
          )}
        </div>

        <button
          onClick={closeThisWindow}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body — full CodeMirror markdown editor, same syntax highlighting as
          the main app, minus the vault/store coupling. */}
      <div className={cn('flex-1 overflow-hidden', saving && 'pointer-events-none opacity-70')}>
        <QuickNoteEditor
          ref={editorRef}
          onChange={value => {
            contentRef.current = value
            setHasText(!!value.trim())
          }}
          onSave={handleSave}
          onCancel={closeThisWindow}
        />
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span className="truncate text-[11px] text-tertiary">
          {error ?? '⌘Enter to save · Esc to cancel · Markdown supported'}
        </span>
        <button
          onClick={handleSave}
          disabled={!hasText || saving}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            saved ? 'bg-green-500/20 text-green-500' : 'bg-accent text-white hover:bg-accent/90',
            (!hasText || saving) && !saved && 'pointer-events-none opacity-50',
          )}
        >
          {saved && <Check className="h-3.5 w-3.5" />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
