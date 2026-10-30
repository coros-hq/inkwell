import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface ContextMenuItem {
  label: string
  destructive?: boolean
  /** Tag-style row: coloured dot before the label. */
  dotColor?: string
  /** Shows a check mark on the right. */
  checked?: boolean
  /** Draws a divider above this row. */
  separator?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the window; it would otherwise open off-screen near an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    })
  }, [x, y, items])

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      className={cn(
        'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors',
        item.separator && 'border-t border-border mt-1 pt-2',
        item.destructive
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-foreground hover:bg-surface',
      )}
      onClick={() => {
        item.onClick()
        onClose()
      }}
    >
      {item.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.dotColor }} />}
      <span className="flex-1">{item.label}</span>
      {item.checked && <span className="text-accent">✓</span>}
    </button>
  )

  // Tag rows can be arbitrarily many; scroll them so the actions around them
  // (rename, delete…) always stay reachable.
  const rows: ReactNode[] = []
  for (let i = 0; i < items.length; ) {
    if (!items[i].dotColor) {
      rows.push(renderItem(items[i++]))
      continue
    }
    const start = i
    while (i < items.length && items[i].dotColor) i++
    rows.push(
      <div key={`tags-${start}`} className="max-h-[220px] overflow-y-auto overscroll-contain">
        {items.slice(start, i).map(renderItem)}
      </div>,
    )
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] max-h-[calc(100vh-16px)] overflow-y-auto py-1 bg-panel border border-border rounded-md shadow-lg"
      style={pos}
    >
      {rows}
    </div>
  )
}
