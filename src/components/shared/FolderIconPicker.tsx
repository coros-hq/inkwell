import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { ALL_ICONS, FOLDER_ICONS, FolderIcon } from './FolderIcon'
import { cn } from '../../lib/utils'

interface Props {
  current?: string
  onSelect: (icon: string | null) => void
  onClose: () => void
}

const MAX_RESULTS = 240

export function FolderIconPicker({ current, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const names = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s-_]/g, '')
    if (!q) return Object.keys(FOLDER_ICONS)
    return Object.keys(ALL_ICONS).filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [query])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (icon: string | null) => { onSelect(icon); onClose() }
  const cell = (selected: boolean) => cn(
    'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
    selected ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-foreground hover:bg-surface',
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        className="w-[360px] bg-panel border border-border rounded-lg p-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">Folder icon</span>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${Object.keys(ALL_ICONS).length} icons…`}
            className="w-full text-sm bg-card border border-border rounded-md pl-7 pr-2 py-1 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent/60"
          />
        </div>

        <div className="grid grid-cols-9 gap-0.5 mb-3 h-[216px] overflow-y-auto content-start">
          {names.map((name) => (
            <button key={name} title={name} className={cell(current === `lucide:${name}`)} onClick={() => pick(`lucide:${name}`)}>
              <FolderIcon icon={`lucide:${name}`} className="w-4 h-4" />
            </button>
          ))}
          {names.length === 0 && (
            <p className="col-span-9 text-xs text-muted-foreground py-4 text-center">No icons match “{query}”</p>
          )}
        </div>

        <button
          onClick={() => pick(null)}
          className="w-full text-xs text-muted-foreground border border-border rounded-md py-1.5 hover:text-foreground hover:bg-surface transition-colors"
        >
          Reset to default
        </button>
      </div>
    </div>,
    document.body,
  )
}
