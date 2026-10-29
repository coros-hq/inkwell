import { useEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { TAG_COLORS } from './TagDialog'
import { cn } from '../../lib/utils'

interface PickerProps {
  /** Whether every target already carries this tag. */
  isOn: (tag: string) => boolean
  onToggle: (tag: string, on: boolean) => void
  autoFocus?: boolean
}

/**
 * Find-or-create tag list: type to filter the vault's tags, press Enter (or click
 * "Create") to make a new one and apply it in the same step.
 */
export function TagPicker({ isOn, onToggle, autoFocus = true }: PickerProps) {
  const tagDefs = useAppStore((s) => s.tagDefs)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const q = query.trim()
  const matches = tagDefs.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
  const exact = tagDefs.some((t) => t.name.toLowerCase() === q.toLowerCase())
  const canCreate = q.length > 0 && !exact
  const rows = canCreate ? [...matches.map((t) => ({ kind: 'tag' as const, t })), { kind: 'create' as const }] : matches.map((t) => ({ kind: 'tag' as const, t }))

  const create = () => {
    const { createTag, tagDefs: defs } = useAppStore.getState()
    createTag(q, TAG_COLORS[defs.length % TAG_COLORS.length])
    onToggle(q, true)
    setQuery('')
    setCursor(0)
  }

  const activate = (i: number) => {
    const row = rows[i]
    if (!row) return
    if (row.kind === 'create') create()
    else onToggle(row.t.name, !isOn(row.t.name))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      // With text typed, Enter prefers the exact match or creates; otherwise it takes the highlighted row.
      if (canCreate && matches.length === 0) create()
      else activate(cursor)
    }
    e.stopPropagation()
  }

  return (
    <div className="flex flex-col">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
        onKeyDown={onKeyDown}
        placeholder="Find or create a tag…"
        className="h-8 mx-1 mt-1 mb-1 px-2 text-[12.5px] bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="max-h-56 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-muted-foreground">Type a name to create your first tag.</p>
        )}
        {rows.map((row, i) =>
          row.kind === 'create' ? (
            <button
              key="__create"
              onClick={create}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                'w-full flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-foreground transition-colors',
                cursor === i ? 'bg-active' : 'hover:bg-active',
              )}
            >
              <Plus className="w-3 h-3 text-accent shrink-0" />
              <span className="truncate text-left">Create “{q}”</span>
            </button>
          ) : (
            <button
              key={row.t.name}
              onClick={() => onToggle(row.t.name, !isOn(row.t.name))}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                'w-full flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-foreground transition-colors',
                cursor === i ? 'bg-active' : 'hover:bg-active',
              )}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.t.color }} />
              <span className="flex-1 truncate text-left">{row.t.name}</span>
              {isOn(row.t.name) && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

interface PopoverProps extends PickerProps {
  x: number
  y: number
  onClose: () => void
}

/** A TagPicker floating at a fixed screen position (used from sidebar rows, which scroll/clip). */
export function TagPopover({ x, y, onClose, ...picker }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the popover inside the window.
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 p-1 rounded-lg border border-border-strong bg-panel shadow-lg"
      style={pos}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <TagPicker {...picker} />
    </div>
  )
}
