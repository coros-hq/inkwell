import { useEffect, useRef, useState } from 'react'
import { FileImage, PanelLeft, Plus, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useDrawingsStore } from '../../store/useDrawingsStore'
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu'
import { cn } from '../../lib/utils'
import { isWindowsApp } from '../../lib/platform'

interface Props {
  onExport: (id: string) => void
  /** Switch back to the sidebar list. */
  onSidebar: () => void
  /** Hide the drawings list entirely. */
  onHide: () => void
}

/** Compact drawings switcher that sits along the top edge of the canvas instead of taking a column. */
export function DrawingsTabs({ onExport, onSidebar, onHide }: Props) {
  const drawings = useDrawingsStore(s => s.drawings)
  const activeId = useDrawingsStore(s => s.activeId)
  const { setActive, create, rename, remove, duplicate } = useDrawingsStore.getState()
  const openConfirm = useAppStore(s => s.openConfirm)
  // With the app sidebar collapsed the canvas reaches the window's left edge, under the
  // macOS traffic lights — start the strip past them (same as NoteList / EditorPane).
  const sidebarOpen = useAppStore(s => s.sidebarOpen)
  const clearTrafficLights = !sidebarOpen && !isWindowsApp

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the open drawing's tab in view.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, drawings.length])

  const menuDrawing = menu ? drawings.find(d => d.id === menu.id) : undefined
  const items = (id: string): ContextMenuItem[] => {
    const d = drawings.find(x => x.id === id)!
    return [
      { label: 'Rename', onClick: () => setRenamingId(id) },
      { label: 'Export…', onClick: () => { setActive(id); onExport(id) } },
      { label: 'Duplicate', onClick: () => void duplicate(id) },
      {
        label: 'Delete', destructive: true, separator: true,
        onClick: () => openConfirm({
          title: `Delete “${d.title}”?`,
          description: 'This drawing and its notes will be permanently removed.',
          confirmLabel: 'Delete', destructive: true, onConfirm: () => remove(id),
        }),
      },
    ]
  }

  const btn = 'w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'

  return (
    <div className={cn('absolute top-2 right-28 z-20 flex items-center pointer-events-none', clearTrafficLights ? 'left-20' : 'left-3')}>
      <div className="flex items-center gap-0.5 max-w-full bg-surface/95 border border-border rounded-xl px-1 py-1 shadow-sm pointer-events-auto select-none">
        <button type="button" title="Show drawings as sidebar" onClick={onSidebar} className={btn}>
          <PanelLeft className="w-3.5 h-3.5" />
        </button>
        <div ref={stripRef} className="flex items-center gap-0.5 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {drawings.map(d => {
            const active = d.id === activeId
            return (
              <div
                key={d.id}
                data-active={active}
                title={d.title}
                onClick={() => !active && setActive(d.id)}
                onDoubleClick={() => setRenamingId(d.id)}
                onContextMenu={e => { e.preventDefault(); setMenu({ id: d.id, x: e.clientX, y: e.clientY }) }}
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-lg cursor-pointer text-xs whitespace-nowrap transition-colors',
                  active ? 'bg-active text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                <FileImage className={cn('w-3 h-3 shrink-0', active && 'text-accent')} />
                {renamingId === d.id ? (
                  <input
                    defaultValue={d.title}
                    autoFocus
                    onFocus={e => e.target.select()}
                    onClick={e => e.stopPropagation()}
                    onBlur={e => { rename(d.id, e.target.value); setRenamingId(null) }}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="w-28 h-5 px-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                ) : (
                  <span className="max-w-[160px] truncate">{d.title}</span>
                )}
              </div>
            )
          })}
        </div>
        <button type="button" title="New drawing" onClick={() => setRenamingId(create('Untitled drawing'))} className={btn}>
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Hide drawings" onClick={onHide} className={btn}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {menu && menuDrawing && (
        <ContextMenu x={menu.x} y={menu.y} items={items(menu.id)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
