import { useState, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, Moon, Sun, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { type CustomTheme } from '../../lib/themes'
import { deriveThemeVars, applyCustomThemeVars, hslStringToHex } from '../../lib/themeUtils'

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DARK_DEFAULTS = {
  background: '#1a1714',
  foreground: '#f5f4f2',
  sidebar:    '#161412',
  accent:     '#c07840',
  border:     '#2e2a26',
}

const LIGHT_DEFAULTS = {
  background: '#f8f5f0',
  foreground: '#1e1b17',
  sidebar:    '#ede9e0',
  accent:     '#b86e2a',
  border:     '#e0d8cc',
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHex(raw: string): string | null {
  const v = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`
  if (!HEX_RE.test(v)) return null
  if (v.length === 4) {
    // expand shorthand #abc -> #aabbcc
    const [, r, g, b] = v
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return v.toLowerCase()
}

// ─── Color row ────────────────────────────────────────────────────────────────

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Local text buffer so the user can type/paste freely without every
  // keystroke needing to be a valid hex color.
  const [text, setText] = useState(value)

  // Keep the text buffer in sync when the value changes from elsewhere
  // (e.g. the native color picker, or switching dark/light defaults).
  useEffect(() => {
    setText(value)
  }, [value])

  const commitText = (raw: string) => {
    const normalized = normalizeHex(raw)
    if (normalized) {
      onChange(normalized)
    } else {
      // Invalid input — revert the buffer to the last known-good value.
      setText(value)
    }
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-8 h-8 rounded-md border-2 border-border hover:border-accent transition-colors shrink-0 cursor-pointer"
        style={{ backgroundColor: value }}
        title="Pick color"
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
      />
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={e => commitText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitText(e.currentTarget.value)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setText(value)
            e.currentTarget.blur()
          }
        }}
        onPaste={e => {
          // Let the paste land in the input, then normalize on the next tick
          // so hex values copied with surrounding text/whitespace still work.
          const pasted = e.clipboardData.getData('text')
          const normalized = normalizeHex(pasted)
          if (normalized) {
            e.preventDefault()
            setText(normalized)
            onChange(normalized)
          }
        }}
        spellCheck={false}
        className={cn(
          'w-20 text-xs font-mono uppercase bg-transparent border border-border rounded-md px-2 py-1',
          'text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
        )}
      />
    </div>
  )
}

// ─── Mini preview ─────────────────────────────────────────────────────────────

function MiniPreview({ colors }: { colors: CustomTheme['colors'] }) {
  const { background, foreground, sidebar, accent, border } = colors
  return (
    <div
      className="w-full rounded-lg overflow-hidden border"
      style={{ backgroundColor: background, borderColor: border }}
    >
      <div className="flex" style={{ height: '120px' }}>
        {/* Sidebar */}
        <div
          className="w-12 shrink-0 flex flex-col gap-1.5 p-2 pt-3"
          style={{ backgroundColor: sidebar, borderRight: `1px solid ${border}` }}
        >
          {[90, 65, 80, 55].map((w, i) => (
            <div
              key={i}
              className="rounded-sm"
              style={{
                height: '5px',
                width: `${w}%`,
                backgroundColor: foreground,
                opacity: i === 0 ? 0.7 : 0.2,
              }}
            />
          ))}
          {/* Active item */}
          <div
            className="rounded-sm mt-1"
            style={{ height: '5px', width: '80%', backgroundColor: accent, opacity: 0.7 }}
          />
        </div>
        {/* Editor body */}
        <div className="flex-1 p-4 flex flex-col gap-2 justify-center">
          {/* Heading */}
          <div style={{ height: '7px', width: '55%', backgroundColor: foreground, opacity: 0.85, borderRadius: 2 }} />
          {/* Body lines */}
          {[88, 70, 94, 62].map((w, i) => (
            <div
              key={i}
              style={{ height: '4px', width: `${w}%`, backgroundColor: foreground, opacity: 0.22, borderRadius: 2 }}
            />
          ))}
          {/* Accent cursor */}
          <div style={{ height: '4px', width: 2, backgroundColor: accent, opacity: 0.9 }} />
        </div>
      </div>
      {/* Bottom bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ backgroundColor: sidebar, borderTop: `1px solid ${border}` }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: accent }} />
        <div style={{ height: 3, width: 60, backgroundColor: foreground, opacity: 0.3, borderRadius: 2 }} />
      </div>
    </div>
  )
}

// ─── ThemeEditor ──────────────────────────────────────────────────────────────

interface ThemeEditorProps {
  initial?: CustomTheme
  onSave: (theme: CustomTheme) => void
  onCancel: () => void
}

export function ThemeEditor({ initial, onSave, onCancel }: ThemeEditorProps) {
  const isNew = !initial
  const [label, setLabel] = useState(initial?.label ?? '')
  const [dark, setDark] = useState(initial?.dark ?? true)
  const [colors, setColors] = useState<CustomTheme['colors']>(
    initial?.colors ?? DARK_DEFAULTS
  )

  // When mode changes, offer sensible defaults if colors look like the opposite-mode defaults
  const handleModeChange = (nextDark: boolean) => {
    setDark(nextDark)
    // If user hasn't diverged from default palette, switch to the other default
    const currentDefault = dark ? DARK_DEFAULTS : LIGHT_DEFAULTS
    const isDefault = Object.entries(colors).every(
      ([k, v]) => v.toLowerCase() === (currentDefault as Record<string, string>)[k]?.toLowerCase()
    )
    if (isDefault) setColors(nextDark ? DARK_DEFAULTS : LIGHT_DEFAULTS)
  }

  const setColor = (key: keyof CustomTheme['colors']) => (hex: string) =>
    setColors(c => ({ ...c, [key]: hex }))

  // The derived vars always reflect the current colors (including any
  // explicit overrides), so we can read the effective hex straight back out
  // of them — that's what the picker/swatch should show when the user
  // hasn't set an override yet.
  const derivedVars = useMemo(() => deriveThemeVars(colors, dark), [colors, dark])
  const effectiveMutedForeground = colors.mutedForeground ?? hslStringToHex(derivedVars['--muted-foreground'])
  const effectiveBorderStrong = colors.borderStrong ?? hslStringToHex(derivedVars['--border-strong'])

  // Live-preview: apply derived vars while editing
  useEffect(() => {
    applyCustomThemeVars(derivedVars)
    document.documentElement.classList.toggle('dark', dark)
    delete document.documentElement.dataset.theme
    return () => {
      // Cleanup handled by parent (it will call setTheme on save/cancel)
    }
  }, [derivedVars, dark])

  const handleSave = () => {
    if (!label.trim()) return
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      label: label.trim(),
      dark,
      colors,
    })
  }

  const colorRows: Array<{ key: keyof CustomTheme['colors']; label: string; value: string }> = [
    { key: 'background', label: 'Background', value: colors.background },
    { key: 'foreground', label: 'Text', value: colors.foreground },
    { key: 'sidebar', label: 'Sidebar', value: colors.sidebar },
    { key: 'accent', label: 'Accent', value: colors.accent },
    { key: 'border', label: 'Border', value: colors.border },
    { key: 'mutedForeground', label: 'Icons & links', value: effectiveMutedForeground },
    { key: 'borderStrong', label: 'Separators', value: effectiveBorderStrong },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Back + title */}
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <span className="text-xs text-border">·</span>
        <span className="text-xs text-muted-foreground">
          {isNew ? 'New theme' : `Editing "${initial.label}"`}
        </span>
      </div>

      {/* Live preview */}
      <MiniPreview colors={colors} />

      {/* Name + mode */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Theme name…"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className={cn(
            'flex-1 text-xs bg-surface border border-border rounded-md px-3 py-2',
            'text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-accent',
          )}
          autoFocus={isNew}
        />
        <div className="flex items-center gap-0.5 border border-border rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => handleModeChange(true)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors',
              dark ? 'bg-active text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Moon className="w-3 h-3" />
            Dark
          </button>
          <button
            onClick={() => handleModeChange(false)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors',
              !dark ? 'bg-active text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Sun className="w-3 h-3" />
            Light
          </button>
        </div>
      </div>

      {/* Color pickers */}
      <div className="rounded-lg border border-border bg-surface/40 px-3 divide-y divide-border">
        {colorRows.map(({ key, label: rowLabel, value }) => (
          <ColorRow
            key={key}
            label={rowLabel}
            value={value}
            onChange={setColor(key)}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!label.trim()}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-opacity',
            'bg-accent text-accent-foreground',
            !label.trim() ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90',
          )}
        >
          <Check className="w-3.5 h-3.5" />
          Save theme
        </button>
      </div>
    </div>
  )
}
