import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Maximize2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { BrainstormNode } from '../../types'
import {
  MAP_ROOT_ID, addAfter, addChildTo, layoutMap, newNode,
  removeNode, setText, toggleCollapsed,
} from '../../lib/brainstorm'

// Mind-map view of the same tree the outliner edits: pan with drag, zoom with
// ⌘/ctrl + wheel, click to select, double-click or Enter to edit.

interface Props {
  title: string
  root: BrainstormNode[]
  commit: (root: BrainstormNode[], key?: string) => void
}

interface View { x: number; y: number; k: number }

export function MindMap({ title, root, commit }: Props) {
  const { boxes, width, height } = useMemo(() => layoutMap(title, root), [title, root])
  const byId = useMemo(() => new Map(boxes.map(b => [b.id, b])), [boxes])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 40, y: 0, k: 1 })
  const [selected, setSelected] = useState<string>(MAP_ROOT_ID)
  const [editing, setEditing] = useState<string | null>(null)
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)

  const fit = () => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = Math.min(1, (r.width - 80) / (width + 20), (r.height - 80) / (height + 20))
    setView({ k, x: 40, y: (r.height - height * k) / 2 })
  }
  // Fit once on mount.
  useEffect(() => { fit(); wrapRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel must be non-passive to preventDefault page zoom.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left, py = e.clientY - r.top
        setView(v => {
          const k = Math.min(2, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.01)))
          const f = k / v.k
          return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
        })
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (f: number) => setView(v => {
    const el = wrapRef.current
    const r = el?.getBoundingClientRect()
    const px = (r?.width ?? 0) / 2, py = (r?.height ?? 0) / 2
    const k = Math.min(2, Math.max(0.25, v.k * f))
    return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }
  })

  // If the selected node vanished (deleted elsewhere), fall back to the root.
  const sel = byId.has(selected) ? selected : MAP_ROOT_ID

  const startEdit = (id: string) => { setSelected(id); setEditing(id) }

  const addChild = (parentId: string) => {
    const child = newNode()
    // The virtual root's children are the top-level points.
    commit(parentId === MAP_ROOT_ID ? [...root, child] : addChildTo(root, parentId, child))
    startEdit(child.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    const box = byId.get(sel)
    if (!box) return
    const mod = e.metaKey || e.ctrlKey
    const siblings = boxes.filter(b => b.parentId === box.parentId)
    const idx = siblings.findIndex(b => b.id === sel)

    if (e.key === 'Tab') {
      e.preventDefault()
      addChild(sel)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sel === MAP_ROOT_ID) { addChild(MAP_ROOT_ID); return }
      const { root: next, newId } = addAfter(root, sel)
      commit(next)
      startEdit(newId)
    } else if (e.key === 'F2' || (e.key === ' ' && !mod && sel !== MAP_ROOT_ID)) {
      e.preventDefault()
      if (sel !== MAP_ROOT_ID) setEditing(sel)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel !== MAP_ROOT_ID) {
      e.preventDefault()
      commit(removeNode(root, sel))
      setSelected(box.parentId ?? MAP_ROOT_ID)
    } else if (mod && e.key === '.') {
      e.preventDefault()
      if (box.hasChildren && sel !== MAP_ROOT_ID) commit(toggleCollapsed(root, sel))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (box.parentId) setSelected(box.parentId)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (!box.hasChildren) return
      if (box.collapsed) { commit(toggleCollapsed(root, sel, false)); return }
      const child = boxes.find(b => b.parentId === sel)
      if (child) setSelected(child.id)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = siblings[idx + (e.key === 'ArrowUp' ? -1 : 1)]
      if (next) setSelected(next.id)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }
  const onPointerUp = () => { drag.current = null }

  const edges = boxes.filter(b => b.parentId).map(b => {
    const p = byId.get(b.parentId!)!
    const x1 = p.x + p.w, y1 = p.y + p.h / 2
    const x2 = b.x, y2 = b.y + b.h / 2
    const mx = (x1 + x2) / 2
    return { id: b.id, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }
  })

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={e => { if (!(e.target as HTMLElement).closest('[data-node]')) { wrapRef.current?.focus(); setEditing(null) } }}
      className="relative flex-1 overflow-hidden outline-none cursor-grab active:cursor-grabbing select-none"
      style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: width + 2, height }}
      >
        <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width={width} height={height}>
          {edges.map(e => (
            <path key={e.id} d={e.d} fill="none" stroke="hsl(var(--border))" strokeWidth={1.6} />
          ))}
        </svg>

        {boxes.map(b => {
          const isRoot = b.id === MAP_ROOT_ID
          const isSel = b.id === sel
          const isEditing = editing === b.id
          return (
            <div
              key={b.id}
              data-node
              onClick={e => { e.stopPropagation(); setSelected(b.id); wrapRef.current?.focus() }}
              onDoubleClick={e => { e.stopPropagation(); if (!isRoot) startEdit(b.id) }}
              className={cn(
                'absolute flex items-center rounded-lg border px-2.5 py-1 text-[13.5px] leading-5 cursor-pointer transition-colors',
                isRoot
                  ? 'bg-accent text-white border-accent font-semibold'
                  : 'bg-card text-foreground border-border hover:border-accent/50',
                isSel && !isRoot && 'border-accent ring-2 ring-accent/30',
                isSel && isRoot && 'ring-2 ring-accent/40',
              )}
              style={{ left: b.x, top: b.y, width: b.w, minHeight: b.h }}
            >
              {isEditing ? (
                <textarea
                  autoFocus
                  rows={1}
                  value={b.text}
                  placeholder="Point"
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => commit(setText(root, b.id, e.target.value), `text:${b.id}`)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault()
                      setEditing(null)
                      wrapRef.current?.focus()
                    } else if (e.key === 'Tab') {
                      e.preventDefault()
                      setEditing(null)
                      addChild(b.id)
                    }
                  }}
                  onBlur={() => setEditing(cur => (cur === b.id ? null : cur))}
                  className="w-full resize-none overflow-hidden bg-transparent outline-none leading-5"
                  style={{ height: b.h - 14 }}
                />
              ) : (
                <span className={cn('whitespace-pre-wrap break-words min-w-0', !b.text && 'opacity-40')}>{b.text || 'Point'}</span>
              )}
              {!isRoot && b.hasChildren && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); commit(toggleCollapsed(root, b.id)) }}
                  onDoubleClick={e => e.stopPropagation()}
                  title={b.collapsed ? `Expand (${b.childCount} hidden)` : 'Collapse'}
                  className={cn(
                    'absolute top-1/2 -right-3 -translate-y-1/2 z-10 h-5 min-w-5 px-1 rounded-full border text-[10.5px] leading-none flex items-center justify-center tabular-nums',
                    b.collapsed
                      ? 'bg-accent text-white border-accent'
                      : 'bg-panel text-muted-foreground border-border hover:text-foreground hover:border-accent/50',
                  )}
                >
                  {b.collapsed ? b.childCount : <Minus className="w-2.5 h-2.5" />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border border-border bg-panel p-1 shadow-md" onPointerDown={e => e.stopPropagation()}>
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Minus className="w-3.5 h-3.5" /></button>
        <span className="w-10 text-center text-[11px] text-muted-foreground tabular-nums">{Math.round(view.k * 100)}%</span>
        <button onClick={() => zoomBy(1.2)} title="Zoom in" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Plus className="w-3.5 h-3.5" /></button>
        <button onClick={fit} title="Fit to screen" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Maximize2 className="w-3.5 h-3.5" /></button>
      </div>

      <p className="absolute left-8 bottom-4 text-[11.5px] text-tertiary pointer-events-none">
        Tab child · Enter sibling · double-click or Space edit · ←↑↓→ move · ⌘. collapse · Delete remove · ⌘+scroll zoom
      </p>
    </div>
  )
}
