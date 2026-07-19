import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Settings, X, Palette, Sun, Moon, Type, Folder, FolderOpen, Info, ChevronRight, Check, Plus, Pencil, Trash2, GitBranch, Eye, EyeOff, ExternalLink, Sparkles, Keyboard, RotateCcw, AlertTriangle, List, PencilIcon, Cloud } from 'lucide-react'
import { useAppStore, type Abbreviation } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import { THEMES, DARK_THEMES, LIGHT_THEMES, type CustomTheme } from '../../lib/themes'
import { ThemeEditor } from './ThemeEditor'
import {
  pickVaultDirectory, readVaultFS, addRecentVault,
  getRecentVaults, removeRecentVault, writeBoardsFile, type RecentVault,
} from '../../lib/vault'
import {
  getGithubToken, setGithubToken, getGithubOwner, setGithubOwner, listRepos, type GhRepo,
} from '../../lib/github'
import { CloudBackupSection } from './CloudBackupSection'
import { SHORTCUT_DEFS, formatCombo, hasModifier, eventToCombo } from '../../lib/shortcuts'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'themes' | 'appearance' | 'editor' | 'features' | 'shortcuts' | 'abbreviations' | 'vault' | 'github' | 'cloud' | 'about'

// ─── Font options ─────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { label: 'Inter', value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { label: 'System UI', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Merriweather', value: "'Merriweather', Georgia, serif" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" },
]

const FONT_SIZE_OPTIONS = [
  { label: 'Small', value: '13px' },
  { label: 'Default', value: '15px' },
  { label: 'Medium', value: '17px' },
  { label: 'Large', value: '19px' },
]

const LINE_HEIGHT_OPTIONS = [
  { label: 'Compact', value: '1.4' },
  { label: 'Default', value: '1.7' },
  { label: 'Relaxed', value: '2.0' },
  { label: 'Double', value: '2.4' },
]

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS: Array<{ id: Section; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'editor', label: 'Editor', icon: Type },
  { id: 'features', label: 'Features', icon: Sparkles },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'abbreviations', label: 'Abbreviations', icon: List },
  { id: 'vault', label: 'Vaults', icon: Folder },
  { id: 'github', label: 'GitHub', icon: GitBranch },
  { id: 'cloud', label: 'Cloud Backup', icon: Cloud },
  { id: 'about', label: 'About', icon: Info },
]

// ─── SettingsDialog ───────────────────────────────────────────────────────────

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('themes')
  // null = grid, undefined = new, CustomTheme = edit existing
  const [editingTheme, setEditingTheme] = useState<CustomTheme | null | undefined>(null)

  const {
    theme, toggleTheme, themeName, setTheme,
    customThemes, saveCustomTheme, deleteCustomTheme,
    editorFontSize, editorFontFamily, editorLineHeight,
    setEditorSettings,
    sidebarGlass, setSidebarGlass,
    bodyGlass, setBodyGlass,
    glassOpacity, setGlassOpacity,
    canvasEnabled, setCanvasEnabled,
    canvasLinkedVaultPath, setCanvasLinkedVaultPath,
    plannerEnabled, setPlannerEnabled,
  } = useAppStore()

  const handleLinkCanvasVault = async () => {
    const path = await pickVaultDirectory()
    if (path) setCanvasLinkedVaultPath(path)
  }

  const handleSaveCustomTheme = (t: CustomTheme) => {
    saveCustomTheme(t)
    setTheme(t.id)
    setEditingTheme(null)
  }

  const handleCancelEditor = () => {
    // Restore whatever theme was active before opening the editor
    setTheme(themeName)
    setEditingTheme(null)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs',
            'text-muted-foreground hover:text-foreground hover:bg-surface transition-colors',
          )}
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5 shrink-0" />
          <span>Settings</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[720px] min-h-[480px] max-h-[80vh] bg-panel border border-border rounded-xl shadow-2xl',
            'flex overflow-hidden focus:outline-none',
          )}
        >
          {/* Left nav */}
          <div className="w-48 shrink-0 bg-sidebar border-r border-border flex flex-col py-3 px-2 gap-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary px-2 pb-2">Settings</p>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors text-left',
                  section === id
                    ? 'bg-active text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                {NAV_ITEMS.find(n => n.id === section)?.label}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* ── Themes ── */}
              {section === 'themes' && (
                editingTheme !== null ? (
                  <ThemeEditor
                    initial={editingTheme}
                    onSave={handleSaveCustomTheme}
                    onCancel={handleCancelEditor}
                  />
                ) : (
                  <div className="space-y-5">
                    {/* Dark themes */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-3">Dark</p>
                      <div className="grid grid-cols-4 gap-2">
                        {DARK_THEMES.map(t => (
                          <ThemeCard
                            key={t.id}
                            theme={t}
                            selected={themeName === t.id}
                            onSelect={() => setTheme(t.id)}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Light themes */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-3">Light</p>
                      <div className="grid grid-cols-4 gap-2">
                        {LIGHT_THEMES.map(t => (
                          <ThemeCard
                            key={t.id}
                            theme={t}
                            selected={themeName === t.id}
                            onSelect={() => setTheme(t.id)}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Custom themes */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Custom</p>
                        <button
                          onClick={() => setEditingTheme(undefined)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:opacity-80 transition-opacity font-medium"
                        >
                          <Plus className="w-3 h-3" />
                          New theme
                        </button>
                      </div>
                      {customThemes.length === 0 ? (
                        <button
                          onClick={() => setEditingTheme(undefined)}
                          className={cn(
                            'w-full flex items-center justify-center gap-2 py-6 rounded-lg border-2 border-dashed border-border',
                            'text-xs text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors',
                          )}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create your first theme
                        </button>
                      ) : (
                        <div className="grid grid-cols-4 gap-2">
                          {customThemes.map(t => (
                            <CustomThemeCard
                              key={t.id}
                              theme={t}
                              selected={themeName === t.id}
                              onSelect={() => setTheme(t.id)}
                              onEdit={() => setEditingTheme(t)}
                              onDelete={() => deleteCustomTheme(t.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Active theme label */}
                    {(() => {
                      const builtIn = THEMES.find(t => t.id === themeName)
                      const custom = customThemes.find(t => t.id === themeName)
                      const active = builtIn ?? custom
                      return active ? (
                        <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                          <span className="text-foreground font-medium">{active.label}</span>
                          {builtIn && <><span>·</span><span>{builtIn.description}</span></>}
                          {custom && <><span>·</span><span>Custom theme</span></>}
                        </div>
                      ) : null
                    })()}
                  </div>
                ))}

              {/* ── Appearance ── */}
              {section === 'appearance' && (
                <>
                  <SettingRow label="Mode" description="Choose between dark and light">
                    <div className="flex items-center gap-1 border border-border rounded-lg p-1">
                      <button
                        onClick={() => theme === 'light' && toggleTheme()}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors',
                          theme === 'dark'
                            ? 'bg-active text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Moon className="w-3 h-3" />
                        Dark
                      </button>
                      <button
                        onClick={() => theme === 'dark' && toggleTheme()}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors',
                          theme === 'light'
                            ? 'bg-active text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Sun className="w-3 h-3" />
                        Light
                      </button>
                    </div>
                  </SettingRow>

                  <SettingRow
                    label="Glass sidebar"
                    description="Show the desktop through the sidebar"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-tertiary border border-border/60 rounded px-1.5 py-0.5 leading-none">
                        macOS
                      </span>
                      <ToggleSwitch checked={sidebarGlass} onChange={setSidebarGlass} />
                    </div>
                  </SettingRow>

                  <SettingRow
                    label="Glass body"
                    description="Show the desktop through the note list and editor"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-tertiary border border-border/60 rounded px-1.5 py-0.5 leading-none">
                        macOS
                      </span>
                      <ToggleSwitch checked={bodyGlass} onChange={setBodyGlass} />
                    </div>
                  </SettingRow>

                  {(sidebarGlass || bodyGlass) && (
                    <SettingRow
                      label="Glass intensity"
                      description="How see-through the glass effect is"
                    >
                      <div className="flex items-center gap-2 w-40">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={glassOpacity}
                          onChange={e => setGlassOpacity(Number(e.target.value))}
                          className="flex-1 accent-accent"
                        />
                        <span className="text-[10px] text-tertiary w-8 text-right tabular-nums">
                          {glassOpacity}%
                        </span>
                      </div>
                    </SettingRow>
                  )}
                </>
              )}

              {/* ── Editor ── */}
              {section === 'editor' && (
                <>
                  <SettingRow label="Font family" description="The typeface used in the editor">
                    <select
                      value={editorFontFamily}
                      onChange={e => setEditorSettings({ editorFontFamily: e.target.value })}
                      className={cn(
                        'text-xs bg-surface border border-border rounded-md px-2.5 py-1.5',
                        'text-foreground focus:outline-none focus:ring-1 focus:ring-accent',
                      )}
                    >
                      {FONT_OPTIONS.map(o => (
                        <option key={o.label} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </SettingRow>

                  <SettingRow label="Font size" description="Base size for editor text">
                    <div className="flex items-center gap-1">
                      {FONT_SIZE_OPTIONS.map(o => (
                        <button
                          key={o.value}
                          onClick={() => setEditorSettings({ editorFontSize: o.value })}
                          className={cn(
                            'px-2.5 py-1 rounded-md text-xs border transition-colors',
                            editorFontSize === o.value
                              ? 'bg-accent text-accent-foreground border-accent'
                              : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </SettingRow>

                  <SettingRow label="Line height" description="Spacing between lines of text">
                    <div className="flex items-center gap-1">
                      {LINE_HEIGHT_OPTIONS.map(o => (
                        <button
                          key={o.value}
                          onClick={() => setEditorSettings({ editorLineHeight: o.value })}
                          className={cn(
                            'px-2.5 py-1 rounded-md text-xs border transition-colors',
                            editorLineHeight === o.value
                              ? 'bg-accent text-accent-foreground border-accent'
                              : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </SettingRow>

                  {/* Preview */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <p className="text-[10px] uppercase tracking-wider text-tertiary mb-3">Preview</p>
                    <p
                      style={{
                        fontFamily: editorFontFamily,
                        fontSize: editorFontSize,
                        lineHeight: editorLineHeight,
                      }}
                      className="text-foreground"
                    >
                      The quick brown fox jumps over the lazy dog.{' '}
                      <span className="text-muted-foreground">Writing feels effortless when the editor feels right.</span>
                    </p>
                  </div>
                </>
              )}

              {/* ── Features ── */}
              {section === 'features' && (
                <>
                  <SettingRow
                    label="Canvas"
                    description="Freehand drawing and diagramming — add a Draw page to the sidebar"
                  >
                    <ToggleSwitch checked={canvasEnabled} onChange={setCanvasEnabled} />
                  </SettingRow>

                  {canvasEnabled && (
                    <SettingRow
                      label="Canvas storage"
                      description={
                        canvasLinkedVaultPath
                          ? `Linked to ${canvasLinkedVaultPath.split('/').pop()} — drawings are stored in that vault`
                          : 'Not linked to a vault — drawings are stored globally and stay the same across every vault'
                      }
                    >
                      {canvasLinkedVaultPath ? (
                        <button
                          onClick={() => setCanvasLinkedVaultPath(null)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                        >
                          Unlink
                        </button>
                      ) : (
                        <button
                          onClick={handleLinkCanvasVault}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                        >
                          Link to a vault…
                        </button>
                      )}
                    </SettingRow>
                  )}

                  <SettingRow
                    label="Planner"
                    description="Daily task planner with week navigation — add a Planner page to the sidebar"
                  >
                    <ToggleSwitch checked={plannerEnabled} onChange={setPlannerEnabled} />
                  </SettingRow>
                </>
              )}

              {/* ── Shortcuts ── */}
              {section === 'shortcuts' && <ShortcutsSection />}

              {/* ── Abbreviations ── */}
              {section === 'abbreviations' && <AbbreviationsSection />}

              {/* ── Vaults ── */}
              {section === 'vault' && (
                <VaultSection onClose={() => setOpen(false)} />
              )}

              {/* ── GitHub ── */}
              {section === 'github' && (
                <GitBranchSection />
              )}

              {/* ── Cloud Backup ── */}
              {section === 'cloud' && (
                <CloudBackupSection />
              )}

              {/* ── About ── */}
              {section === 'about' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <img
                      src="/inkwell-icon.svg"
                      alt="inkwell"
                      className="w-14 h-14 rounded-2xl shadow-md"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">inkwell</p>
                      <p className="text-xs text-muted-foreground">Version 0.7.0</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p>A calm, focused writing environment built on Tauri and CodeMirror.</p>
                    <p>Your notes live as plain Markdown files in a folder you own — no cloud sync, no lock-in.</p>
                  </div>

                  <AboutLink label="Built with Tauri v2" href="https://tauri.app" />
                  <AboutLink label="Editor powered by CodeMirror 6" href="https://codemirror.net" />
                </div>
              )}

            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── ThemeCard ────────────────────────────────────────────────────────────────

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: (typeof THEMES)[number]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative rounded-lg overflow-hidden border-2 transition-all group',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'border-accent shadow-md' : 'border-transparent hover:border-border',
      )}
      title={theme.label}
    >
      {/* Mini editor mockup */}
      <div
        className="w-full aspect-[4/3] flex flex-col"
        style={{ backgroundColor: theme.preview.bg }}
      >
        {/* Sidebar stripe */}
        <div className="flex h-full">
          <div
            className="w-5 h-full shrink-0 flex flex-col gap-1 p-1 pt-2"
            style={{ backgroundColor: theme.preview.sidebar }}
          >
            {[100, 70, 90].map((w, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  height: '3px',
                  width: `${w}%`,
                  backgroundColor: theme.preview.text,
                  opacity: 0.2 + i * 0.05,
                }}
              />
            ))}
          </div>
          {/* Editor body */}
          <div className="flex-1 p-2 flex flex-col gap-1 justify-center">
            {/* Heading line */}
            <div
              className="rounded-sm"
              style={{ height: '4px', width: '65%', backgroundColor: theme.preview.text, opacity: 0.8 }}
            />
            {/* Text lines */}
            {[85, 70, 90, 60].map((w, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{ height: '2px', width: `${w}%`, backgroundColor: theme.preview.text, opacity: 0.25 }}
              />
            ))}
            {/* Accent line (cursor) */}
            <div
              className="rounded-sm"
              style={{ height: '2px', width: '1.5px', backgroundColor: theme.preview.accent, opacity: 0.9 }}
            />
          </div>
        </div>

        {/* Accent dot in bottom-right */}
        <div className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: theme.preview.accent }} />
      </div>

      {/* Label */}
      <div
        className="px-2 py-1"
        style={{ backgroundColor: theme.preview.sidebar, borderTop: `1px solid ${theme.preview.border}` }}
      >
        <p className="text-[10px] font-medium truncate" style={{ color: theme.preview.text }}>
          {theme.label}
        </p>
      </div>

      {/* Selected checkmark */}
      {selected && (
        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center shadow-sm">
          <Check className="w-2.5 h-2.5" style={{ color: theme.preview.bg }} />
        </div>
      )}
    </button>
  )
}

// ─── ShortcutsSection ─────────────────────────────────────────────────────────

function ShortcutsSection() {
  const { shortcuts, setShortcut, resetShortcuts } = useAppStore()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The app-level shortcut handlers (AppShell, EditorPane, Sidebar) are separate
  // `window` keydown listeners — capture phase + stopImmediatePropagation alone
  // isn't reliable against them (listeners on the same target that share a node
  // fire in registration order, not strictly capture-before-bubble, so an
  // earlier-registered bubble listener can still run first). The `recordingShortcut`
  // store flag is the real guard: every other handler checks it and bails out.
  useEffect(() => {
    if (!recordingId) {
      useAppStore.setState({ recordingShortcut: false })
      return
    }
    useAppStore.setState({ recordingShortcut: true })
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { setRecordingId(null); return }
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return // wait for the real key

      const combo = eventToCombo(e)
      if (!hasModifier(combo)) {
        setError("Shortcut must include ⌘/Ctrl, Shift, or Alt so it doesn't fire while typing.")
        return
      }
      const conflict = Object.entries(shortcuts).find(([id, c]) => id !== recordingId && c === combo)
      if (conflict) {
        const label = SHORTCUT_DEFS.find(d => d.id === conflict[0])?.label ?? conflict[0]
        setError(`${formatCombo(combo)} is already used by "${label}".`)
        return
      }
      setShortcut(recordingId, combo)
      setRecordingId(null)
      setError(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      useAppStore.setState({ recordingShortcut: false })
    }
  }, [recordingId, shortcuts, setShortcut])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">In-app shortcuts</p>
        <button
          onClick={() => { resetShortcuts(); setRecordingId(null); setError(null) }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset to defaults
        </button>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {SHORTCUT_DEFS.map(def => {
          const combo = shortcuts[def.id] ?? def.defaultCombo
          const recording = recordingId === def.id
          return (
            <div key={def.id} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{def.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{def.description}</p>
              </div>
              <button
                onClick={() => { setRecordingId(def.id); setError(null) }}
                className={cn(
                  'shrink-0 min-w-[92px] px-2.5 py-1.5 rounded-md text-xs font-mono text-center border transition-colors',
                  recording
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-border text-foreground hover:border-accent/50',
                )}
              >
                {recording ? 'Press keys…' : formatCombo(combo)}
              </button>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-400 pt-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}

      {recordingId && !error && (
        <p className="text-[10px] text-tertiary pt-1">Press a key combination, or Escape to cancel.</p>
      )}
    </div>
  )
}

// ─── AbbreviationsSection ────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [':', '!', ';', '#', '$', '%', '^', '~', '|']

function AbbreviationsSection() {
  const { abbreviationTrigger, setAbbreviationTrigger, abbreviations, setAbbreviations } = useAppStore()
  const [triggerDraft, setTriggerDraft] = useState(abbreviationTrigger)
  const [items, setItems] = useState<Abbreviation[]>(abbreviations)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const triggerDirty = triggerDraft !== abbreviationTrigger
  const itemsDirty = JSON.stringify(items) !== JSON.stringify(abbreviations)
  const dirty = triggerDirty || itemsDirty

  const add = () => {
    const k = newKey.trim().toLowerCase()
    if (!k || items.some(i => i.key === k)) return
    setItems([...items, { key: k, value: newValue.trim() }])
    setNewKey('')
    setNewValue('')
    setEditingKey(null)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setNewKey('')
    setNewValue('')
    setShowAdd(false)
  }

  const remove = (key: string) => {
    setItems(items.filter(i => i.key !== key))
    if (editingKey === key) setEditingKey(null)
    setShowAdd(false)
  }

  const edit = (key: string) => {
    const item = items.find(i => i.key === key)
    if (!item) return
    setEditingKey(key)
    setNewKey(item.key)
    setNewValue(item.value)
    setShowAdd(true)
  }

  const submitEdit = () => {
    if (!editingKey) return
    const k = newKey.trim().toLowerCase()
    if (!k) return
    setItems(items.map(i => i.key === editingKey ? { key: k, value: newValue.trim() } : i))
    setEditingKey(null)
    setNewKey('')
    setNewValue('')
  }

  const save = () => {
    setAbbreviationTrigger(triggerDraft)
    setAbbreviations(items)
  }

  const resetLocal = () => {
    setTriggerDraft(abbreviationTrigger)
    setItems(abbreviations)
  }

  return (
    <div className="space-y-5">
      <SettingRow
        label="Trigger character"
        description="The prefix that activates abbreviation completion"
      >
        <select
          value={triggerDraft}
          onChange={e => setTriggerDraft(e.target.value)}
          className="text-xs bg-surface border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {TRIGGER_OPTIONS.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </SettingRow>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">Built-in</p>
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden text-xs">
          {['today', 'tomorrow', 'nextweek', 'nextmonth', 'now'].map(k => (
            <div key={k} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-foreground">{abbreviationTrigger}{k}</span>
              <span className="text-tertiary">→</span>
              <span className="text-muted-foreground">{k === 'now' ? 'HH:MM' : 'YYYY-MM-DD'}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Custom</p>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No custom abbreviations yet.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden text-xs mb-3">
            {items.map(i => (
              <div key={i.key} className="flex items-center gap-2 px-3 py-2 group">
                <span className="font-mono text-foreground min-w-[60px]">{abbreviationTrigger}{i.key}</span>
                <span className="text-tertiary">→</span>
                <span className="text-muted-foreground flex-1 truncate">{i.value}</span>
                <button onClick={() => edit(i.key)} className="text-muted-foreground hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded">
                  <PencilIcon className="w-3 h-3" />
                </button>

                <button onClick={() => remove(i.key)} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showAdd && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') editingKey ? submitEdit() : add()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="e.g. eod"
              className="flex-1 max-w-[120px] px-2.5 py-1.5 rounded-md text-xs bg-surface border border-border text-foreground placeholder:text-tertiary focus:outline-none focus:border-accent/50 transition-colors font-mono"
            />
            <input
              type="text"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') editingKey ? submitEdit() : add()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="end of day"
              className="flex-1 px-2.5 py-1.5 rounded-md text-xs bg-surface border border-border text-foreground placeholder:text-tertiary focus:outline-none focus:border-accent/50 transition-colors"
              autoFocus
            />
            <button
              onClick={editingKey ? submitEdit : add}
              disabled={!editingKey && !newKey.trim()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-accent hover:opacity-80 transition-opacity disabled:opacity-30 disabled:pointer-events-none"
            >
              {editingKey ? 'Update' : <><Plus className="w-3 h-3" /> Add</>}
            </button>
            <button
              onClick={cancelEdit}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" /> Add abbreviation
          </button>
        )}
      </div>

      {dirty && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 transition-opacity">
            Save
          </button>
          <button onClick={resetLocal} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

// ─── VaultSection ────────────────────────────────────────────────────────────

function formatVaultDate(iso: string | Date): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function VaultSection({ onClose }: { onClose: () => void }) {
  const { vaultPath, openVault } = useAppStore()
  const [recents, setRecents] = useState<RecentVault[]>([])
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reload recents whenever vaultPath changes, filtering out the active vault
  useEffect(() => {
    setRecents(getRecentVaults().filter(v => v.path !== vaultPath))
  }, [vaultPath])

  const switchTo = async (path: string, empty = false) => {
    setError(null)
    setSwitching(path)
    try {
      // Flush current vault's boards to disk BEFORE reading the new vault
      const { vaultPath: currentPath, boards, boardColumns, boardTasks } = useAppStore.getState()
      if (currentPath && currentPath !== path) {
        await writeBoardsFile(currentPath, { version: 1, boards, boardColumns, boardTasks })
      }
      const data = empty ? null : await readVaultFS(path)
      addRecentVault(path)
      openVault(path, data)
      onClose()
    } catch {
      setError("Couldn't open this vault. The folder may have moved or been deleted.")
    } finally {
      setSwitching(null)
    }
  }

  const handleOpenFolder = async () => {
    setError(null)
    const path = await pickVaultDirectory()
    if (path) await switchTo(path, false)
  }

  const handleNewVault = async () => {
    setError(null)
    const path = await pickVaultDirectory()
    if (path) await switchTo(path, true)
  }

  const handleRemove = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    removeRecentVault(path)
    setRecents(getRecentVaults().filter(v => v.path !== vaultPath))
  }

  const vaultName = vaultPath?.split('/').pop() ?? 'Unknown'

  return (
    <div className="space-y-5">

      {/* Active vault */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">Active</p>
        <div className={cn(
          'flex items-center gap-3 px-3 py-3 rounded-lg',
          'bg-accent/8 border border-accent/20',
        )}>
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Folder className="w-4 h-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{vaultName}</p>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{vaultPath}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-muted-foreground">Open</span>
          </div>
        </div>
      </div>

      {/* Other vaults */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Other vaults</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewVault}
              className="flex items-center gap-1 text-[10px] font-medium text-accent hover:opacity-75 transition-opacity"
            >
              <Plus className="w-3 h-3" />
              New vault
            </button>
            <span className="text-border text-xs">·</span>
            <button
              onClick={handleOpenFolder}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Open folder
            </button>
          </div>
        </div>

        {recents.length === 0 ? (
          <button
            onClick={handleNewVault}
            className={cn(
              'w-full flex flex-col items-center gap-2 py-8 rounded-lg',
              'border-2 border-dashed border-border',
              'text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors',
            )}
          >
            <FolderOpen className="w-6 h-6" />
            <span className="text-xs font-medium">No other vaults yet</span>
            <span className="text-[11px] text-tertiary">
              Create a new vault or open a folder you already use
            </span>
          </button>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {recents.map((vault, i) => (
              <div
                key={vault.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 group hover:bg-surface transition-colors',
                  i > 0 && 'border-t border-border',
                  switching === vault.path && 'opacity-60 pointer-events-none',
                )}
              >
                <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{vault.name}</p>
                  <p className="text-[10px] text-tertiary truncate">{vault.path}</p>
                </div>
                <span className="text-[10px] text-tertiary shrink-0 mr-1">
                  {formatVaultDate(vault.lastOpenedAt)}
                </span>
                <button
                  onClick={() => switchTo(vault.path)}
                  disabled={!!switching}
                  className={cn(
                    'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-all',
                    'opacity-0 group-hover:opacity-100',
                    'border-border hover:border-accent hover:text-accent text-muted-foreground',
                  )}
                >
                  {switching === vault.path ? 'Switching…' : 'Switch'}
                </button>
                <button
                  onClick={e => handleRemove(e, vault.path)}
                  className="shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded"
                  title="Remove from list"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─── GitBranchSection ───────────────────────────────────────────────────────────

function GitBranchSection() {
  const [token, setToken] = useState(() => getGithubToken())
  const [owner, setOwner] = useState(() => getGithubOwner())
  const [showToken, setShowToken] = useState(false)
  const [repos, setRepos] = useState<GhRepo[]>([])
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSave = () => {
    setGithubToken(token.trim())
    setGithubOwner(owner.trim())
    setStatus({ ok: true, msg: 'Saved.' })
    setTimeout(() => setStatus(null), 2000)
  }

  const handleTest = async () => {
    setTesting(true)
    setStatus(null)
    setRepos([])
    try {
      setGithubToken(token.trim())
      setGithubOwner(owner.trim())
      const result = await listRepos(10)
      setRepos(result)
      setStatus({ ok: true, msg: `Connected — ${result.length} repos found.` })
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : 'Connection failed.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* Token */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary flex items-center gap-1.5">
          Personal Access Token
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=inkwell"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline flex items-center gap-0.5"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Classic PAT (recommended)
          </a>
          <span className="text-border">·</span>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-0.5"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Fine-grained
          </a>
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className={cn(
              'w-full px-3 py-2 pr-9 rounded-lg text-xs bg-surface border border-border',
              'text-foreground placeholder:text-tertiary',
              'focus:outline-none focus:border-accent/50 transition-colors font-mono',
            )}
          />
          <button
            type="button"
            onClick={() => setShowToken(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[10px] text-tertiary">
          Classic PAT: enable <code className="bg-surface px-1 py-0.5 rounded">repo</code> scope.{' '}
          Fine-grained PAT: set <code className="bg-surface px-1 py-0.5 rounded">Contents → Read and write</code> under Repository permissions.
          Stored locally, never synced.
        </p>
      </div>

      {/* Default owner */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">
          Default Owner / Username
        </label>
        <input
          type="text"
          value={owner}
          onChange={e => setOwner(e.target.value)}
          placeholder="your-github-username"
          className={cn(
            'w-full px-3 py-2 rounded-lg text-xs bg-surface border border-border',
            'text-foreground placeholder:text-tertiary',
            'focus:outline-none focus:border-accent/50 transition-colors',
          )}
        />
        <p className="text-[10px] text-tertiary">Used when no owner is specified during sync.</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            'bg-accent text-white hover:opacity-90',
          )}
        >
          Save
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !token.trim()}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            'border-border text-muted-foreground hover:text-foreground hover:border-accent/50',
            (testing || !token.trim()) && 'opacity-40 pointer-events-none',
          )}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {status && (
          <span className={cn('text-xs', status.ok ? 'text-green-400' : 'text-red-400')}>
            {status.msg}
          </span>
        )}
      </div>

      {/* Repo list preview */}
      {repos.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">Your repositories</p>
          <div className="rounded-lg border border-border overflow-hidden">
            {repos.map((repo, i) => (
              <div
                key={repo.full_name}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 text-xs',
                  i > 0 && 'border-t border-border',
                )}
              >
                <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-foreground font-medium truncate">{repo.full_name}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  repo.private
                    ? 'text-tertiary border-border'
                    : 'text-accent/70 border-accent/20',
                )}>
                  {repo.private ? 'private' : 'public'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CustomThemeCard ──────────────────────────────────────────────────────────

function CustomThemeCard({
  theme,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  theme: CustomTheme
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { background, sidebar, accent, foreground, border } = theme.colors
  return (
    <div className="relative group">
      <button
        onClick={onSelect}
        className={cn(
          'w-full rounded-lg overflow-hidden border-2 transition-all focus:outline-none',
          selected ? 'border-accent shadow-md' : 'border-transparent hover:border-border',
        )}
      >
        {/* Mini mockup */}
        <div className="w-full aspect-[4/3] flex" style={{ backgroundColor: background }}>
          <div
            className="w-5 h-full shrink-0 flex flex-col gap-1 p-1 pt-2"
            style={{ backgroundColor: sidebar }}
          >
            {[100, 70, 90].map((w, i) => (
              <div key={i} className="rounded-sm" style={{ height: '3px', width: `${w}%`, backgroundColor: foreground, opacity: 0.2 + i * 0.05 }} />
            ))}
          </div>
          <div className="flex-1 p-2 flex flex-col gap-1 justify-center">
            <div className="rounded-sm" style={{ height: '4px', width: '65%', backgroundColor: foreground, opacity: 0.8 }} />
            {[85, 70, 90, 60].map((w, i) => (
              <div key={i} className="rounded-sm" style={{ height: '2px', width: `${w}%`, backgroundColor: foreground, opacity: 0.25 }} />
            ))}
          </div>
          <div className="absolute bottom-6 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
        </div>
        <div className="px-2 py-1" style={{ backgroundColor: sidebar, borderTop: `1px solid ${border}` }}>
          <p className="text-[10px] font-medium truncate text-left" style={{ color: foreground }}>{theme.label}</p>
        </div>
        {selected && (
          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center shadow-sm">
            <Check className="w-2.5 h-2.5" style={{ color: background }} />
          </div>
        )}
      </button>

      {/* Edit / delete on hover */}
      <div className="absolute top-1 left-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="w-5 h-5 rounded flex items-center justify-center bg-black/50 text-white hover:bg-black/70 transition-colors"
          title="Edit"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="w-5 h-5 rounded flex items-center justify-center bg-black/50 text-white hover:bg-red-600 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Helper components ────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors shrink-0',
        checked ? 'bg-accent' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

function SettingRow({ label, description, children }: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function AboutLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors group"
    >
      <span>{label}</span>
      <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}
