import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { listSystemFonts, localFontStack, primaryFamily } from '../../lib/systemFonts'

interface FontPickerProps {
  value: string
  onChange: (value: string) => void
  presets: Array<{ label: string; value: string }>
}

/** Searchable font picker: built-in presets plus every font installed locally. */
export function FontPicker({ value, onChange, presets }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    listSystemFonts().then(setSystemFonts)
    inputRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const currentLabel = presets.find(p => p.value === value)?.label ?? primaryFamily(value)

  const q = query.trim().toLowerCase()
  const filteredPresets = presets.filter(p => p.label.toLowerCase().includes(q))
  const filteredSystem = useMemo(
    () => (systemFonts ?? []).filter(f => f.toLowerCase().includes(q)),
    [systemFonts, q],
  )

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  const item = (key: string, label: string, stack: string) => (
    <button
      key={key}
      onClick={() => select(stack)}
      style={{ fontFamily: stack }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 rounded-md text-xs text-left',
        'text-foreground hover:bg-surface',
        stack === value && 'text-accent',
      )}
    >
      <span className="truncate flex-1">{label}</span>
      {stack === value && <Check className="w-3 h-3 text-accent shrink-0" />}
    </button>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center justify-between gap-2 w-44 text-xs bg-surface border border-border rounded-md px-2.5 py-1.5',
          'text-foreground focus:outline-none focus:ring-1 focus:ring-accent',
        )}
      >
        <span className="truncate" style={{ fontFamily: value }}>{currentLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-[200] w-64 rounded-lg border border-border bg-panel shadow-xl">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
                if (e.key === 'Enter') {
                  const first = filteredPresets[0]?.value ?? (filteredSystem[0] && localFontStack(filteredSystem[0]))
                  if (first) select(first)
                }
              }}
              placeholder="Search fonts…"
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-tertiary focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filteredPresets.length > 0 && (
              <>
                <p className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-tertiary">Built-in</p>
                {filteredPresets.map(p => item(p.label, p.label, p.value))}
              </>
            )}
            <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-tertiary">Installed fonts</p>
            {systemFonts === null ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</p>
            ) : filteredSystem.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">No matching fonts</p>
            ) : (
              filteredSystem.map(f => item(f, f, localFontStack(f)))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
