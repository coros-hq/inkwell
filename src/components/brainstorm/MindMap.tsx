import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Maximize2, CornerDownRight, ArrowDownToLine, Link2, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { genId } from '../../lib/id'
import type { BrainstormNode, BrainstormRelation } from '../../types'
import {
  MAP_ROOT_ID, addAfter, addChildTo, addSiblingAfter, findNode, layoutMap, moveRelative, newNode,
  parentMap, removeNode, reparent, setText, toggleCollapsed, type MapBox,
} from '../../lib/brainstorm'

// Mind-map view of the same tree the outliner edits: pan with drag, zoom with
// ⌘/ctrl + wheel, click to select, double-click or Enter to edit. Drag a node
// onto another to re-parent it (edges of a node drop = before/after as sibling).
// Cross-links ("relationships") connect any two nodes and carry an optional label.

interface Props {
  title: string
  root: BrainstormNode[]
  relations: BrainstormRelation[]
  commit: (root: BrainstormNode[], key?: string, relations?: BrainstormRelation[]) => void
}

interface View { x: number; y: number; k: number }
type DropPos = 'child' | 'before' | 'after'
interface DragState { id: string; dx: number; dy: number; over: { id: string; pos: DropPos } | null }

const DRAG_THRESHOLD = 5

/** Curve between two boxes, leaving from the sides that face each other. */
function relationGeometry(a: MapBox, b: MapBox) {
  let p1: [number, number], p2: [number, number], c1: [number, number], c2: [number, number]
  if (b.x >= a.x + a.w) {
    p1 = [a.x + a.w, a.y + a.h / 2]; p2 = [b.x, b.y + b.h / 2]
    const d = Math.max(40, (p2[0] - p1[0]) / 2)
    c1 = [p1[0] + d, p1[1]]; c2 = [p2[0] - d, p2[1]]
  } else if (b.x + b.w <= a.x) {
    p1 = [a.x, a.y + a.h / 2]; p2 = [b.x + b.w, b.y + b.h / 2]
    const d = Math.max(40, (p1[0] - p2[0]) / 2)
    c1 = [p1[0] - d, p1[1]]; c2 = [p2[0] + d, p2[1]]
  } else {
    // Overlapping columns: connect top/bottom and bow out sideways so it doesn't run through the boxes.
    const down = b.y >= a.y
    p1 = [a.x + a.w / 2, down ? a.y + a.h : a.y]
    p2 = [b.x + b.w / 2, down ? b.y : b.y + b.h]
    const bow = Math.max(a.w, b.w) / 2 + 40
    c1 = [p1[0] + bow, p1[1]]; c2 = [p2[0] + bow, p2[1]]
  }
  return {
    d: `M${p1[0]},${p1[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`,
    mx: (p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8,
    my: (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8,
  }
}

const iconBtn =
  'h-7 px-2 flex items-center gap-1.5 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-30 disabled:pointer-events-none'

export function MindMap({ title, root, relations, commit }: Props) {
  const { boxes, width, height } = useMemo(() => layoutMap(title, root), [title, root])
  const byId = useMemo(() => new Map(boxes.map(b => [b.id, b])), [boxes])
  const parents = useMemo(() => parentMap(root), [root])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 40, y: 0, k: 1 })
  const [selected, setSelected] = useState<string>(MAP_ROOT_ID)
  const [selRel, setSelRel] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingRel, setEditingRel] = useState<string | null>(null)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)

  // Handlers registered on window while dragging read the latest props through this.
  const live = useRef({ root, view, boxes, commit })
  live.current = { root, view, boxes, commit }

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
  const selRelation = selRel ? relations.find(r => r.id === selRel) ?? null : null
  const isRoot = sel === MAP_ROOT_ID

  const selectNode = (id: string) => { setSelected(id); setSelRel(null) }
  const startEdit = (id: string) => { selectNode(id); setEditing(id) }

  const addChild = (parentId: string) => {
    const child = newNode()
    // The virtual root's children are the top-level points.
    commit(parentId === MAP_ROOT_ID ? [...root, child] : addChildTo(root, parentId, child))
    startEdit(child.id)
  }
  const addSibling = (id: string) => {
    if (id === MAP_ROOT_ID) { addChild(MAP_ROOT_ID); return }
    const { root: next, newId } = addSiblingAfter(root, id)
    commit(next)
    startEdit(newId)
  }
  const deleteNode = (id: string) => {
    if (id === MAP_ROOT_ID) return
    commit(removeNode(root, id))
    setSelected(byId.get(id)?.parentId ?? MAP_ROOT_ID)
  }
  const deleteRelation = (id: string) => {
    commit(root, undefined, relations.filter(r => r.id !== id))
    setSelRel(null)
  }
  const startLink = () => { if (!isRoot) { setLinkFrom(sel); setEditing(null) } }
  const finishLink = (to: string) => {
    const from = linkFrom
    setLinkFrom(null)
    if (!from || from === to || to === MAP_ROOT_ID) return
    const existing = relations.find(r => (r.from === from && r.to === to) || (r.from === to && r.to === from))
    if (existing) { setSelRel(existing.id); return }
    const rel: BrainstormRelation = { id: genId('br'), from, to }
    commit(root, undefined, [...relations, rel])
    setSelRel(rel.id)
    setEditingRel(rel.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || editingRel) return
    const mod = e.metaKey || e.ctrlKey

    if (e.key === 'Escape') { setLinkFrom(null); setSelRel(null); return }

    if (selRelation) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteRelation(selRelation.id) }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditingRel(selRelation.id) }
      return
    }

    const box = byId.get(sel)
    if (!box) return
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
    } else if ((e.key === 'l' || e.key === 'L') && !mod) {
      e.preventDefault()
      startLink()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel !== MAP_ROOT_ID) {
      e.preventDefault()
      deleteNode(sel)
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

  // ── Panning ──
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = pan.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }
  const onPointerUp = () => { pan.current = null }

  // ── Dragging a node onto another to re-parent / reorder it ──
  const startNodeDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || id === MAP_ROOT_ID || editing === id || linkFrom) return
    const sx = e.clientX, sy = e.clientY
    let active = false

    const hitTest = (cx: number, cy: number): DragState['over'] => {
      const el = (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]')
      const overId = el?.dataset.nodeId
      if (!el || !overId || overId === id) return null
      const dragged = findNode(live.current.root, id)
      if (!dragged || findNode(dragged.children, overId)) return null // not into its own subtree
      if (overId === MAP_ROOT_ID) return { id: overId, pos: 'child' }
      const r = el.getBoundingClientRect()
      const rel = (cy - r.top) / r.height
      return { id: overId, pos: rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'child' }
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (!active && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      active = true
      setDrag({ id, dx, dy, over: hitTest(ev.clientX, ev.clientY) })
    }
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!active) return
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
      if (cancelled) return
      const over = hitTest(ev.clientX, ev.clientY)
      if (!over) return
      const { root: cur, commit: doCommit } = live.current
      const next = over.pos === 'child'
        ? reparent(cur, id, over.id === MAP_ROOT_ID ? null : over.id)
        : moveRelative(cur, id, over.id, over.pos === 'after')
      if (next !== cur) doCommit(next)
    }
    const onUp = (ev: PointerEvent) => finish(ev, false)
    const onCancel = (ev: PointerEvent) => finish(ev, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const edges = boxes.filter(b => b.parentId).map(b => {
    const p = byId.get(b.parentId!)!
    const x1 = p.x + p.w, y1 = p.y + p.h / 2
    const x2 = b.x, y2 = b.y + b.h / 2
    const mx = (x1 + x2) / 2
    return { id: b.id, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }
  })

  // A link to a node hidden inside a collapsed branch attaches to its nearest visible ancestor.
  const visibleBox = (id: string): MapBox | null => {
    let cur: string | null = id
    while (cur && !byId.has(cur)) cur = parents.get(cur) ?? null
    return cur ? byId.get(cur) ?? null : null
  }
  const links = relations.flatMap(r => {
    const a = visibleBox(r.from), b = visibleBox(r.to)
    if (!a || !b || a.id === b.id) return []
    return [{ rel: r, ...relationGeometry(a, b) }]
  })

  const canAddSibling = !selRelation
  const hint = linkFrom
    ? 'Click the point to link to · Esc to cancel'
    : 'Tab child · Enter sibling · L link · drag a point onto another to move it · double-click or Space edit · ⌘. collapse · Delete remove · ⌘+scroll zoom'

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={e => {
        if ((e.target as HTMLElement).closest('[data-node]')) return
        wrapRef.current?.focus()
        setEditing(null)
        setEditingRel(null)
        setSelRel(null)
        setLinkFrom(null)
      }}
      className={cn(
        'relative flex-1 overflow-hidden outline-none select-none',
        linkFrom ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: width + 2, height }}
      >
        <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width={width} height={height}>
          <defs>
            <marker id="bs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--accent))" />
            </marker>
          </defs>
          {edges.map(e => (
            <path key={e.id} d={e.d} fill="none" stroke="hsl(var(--border))" strokeWidth={1.6} />
          ))}
          {links.map(({ rel, d }) => {
            const isSel = rel.id === selRel
            return (
              <g key={rel.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="hsl(var(--accent))"
                  strokeWidth={isSel ? 2.4 : 1.6}
                  strokeDasharray="6 4"
                  opacity={isSel ? 1 : 0.7}
                  markerEnd="url(#bs-arrow)"
                />
                {/* Wide invisible stroke so thin dashed lines are easy to click. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); setSelRel(rel.id); wrapRef.current?.focus() }}
                  onDoubleClick={e => { e.stopPropagation(); setSelRel(rel.id); setEditingRel(rel.id) }}
                />
              </g>
            )
          })}
        </svg>

        {boxes.map(b => {
          const isRootBox = b.id === MAP_ROOT_ID
          const isSel = b.id === sel && !selRelation
          const isEditing = editing === b.id
          const isDragged = drag?.id === b.id
          const dropPos = drag?.over?.id === b.id ? drag.over.pos : null
          return (
            <div
              key={b.id}
              data-node
              data-node-id={b.id}
              onPointerDown={e => startNodeDrag(e, b.id)}
              onClick={e => {
                e.stopPropagation()
                if (justDragged.current) return
                if (linkFrom) { finishLink(b.id); wrapRef.current?.focus(); return }
                selectNode(b.id)
                wrapRef.current?.focus()
              }}
              onDoubleClick={e => { e.stopPropagation(); if (!isRootBox) startEdit(b.id) }}
              className={cn(
                'absolute flex items-center rounded-lg border px-2.5 py-1 text-[13.5px] leading-5 cursor-pointer transition-colors',
                isRootBox
                  ? 'bg-accent text-white border-accent font-semibold'
                  : 'bg-card text-foreground border-border hover:border-accent/50',
                isSel && !isRootBox && 'border-accent ring-2 ring-accent/30',
                isSel && isRootBox && 'ring-2 ring-accent/40',
                linkFrom === b.id && 'ring-2 ring-accent border-accent',
                linkFrom && linkFrom !== b.id && !isRootBox && 'hover:ring-2 hover:ring-accent/60',
                isDragged && 'opacity-70 z-30 pointer-events-none shadow-lg',
                dropPos === 'child' && 'ring-2 ring-accent bg-accent/10',
              )}
              style={{
                left: b.x, top: b.y, width: b.w, minHeight: b.h,
                ...(isDragged && drag ? { transform: `translate(${drag.dx / view.k}px, ${drag.dy / view.k}px)` } : null),
              }}
            >
              {dropPos === 'before' && <span className="absolute left-0 right-0 -top-[7px] h-[3px] rounded bg-accent pointer-events-none" />}
              {dropPos === 'after' && <span className="absolute left-0 right-0 -bottom-[7px] h-[3px] rounded bg-accent pointer-events-none" />}
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
                <span className={cn('whitespace-pre-wrap break-words min-w-0', !b.text && 'opacity-40', isRootBox && !b.text && 'opacity-100')}>{b.text || 'Point'}</span>
              )}
              {!isRootBox && b.hasChildren && (
                <button
                  type="button"
                  onPointerDown={e => e.stopPropagation()}
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
              {isSel && !isEditing && !drag && !linkFrom && (
                <>
                  <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); addChild(b.id) }}
                    onDoubleClick={e => e.stopPropagation()}
                    title="Add child (Tab)"
                    className="absolute top-1/2 -right-9 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center shadow hover:opacity-90"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  {!isRootBox && (
                    <button
                      type="button"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); addSibling(b.id) }}
                      onDoubleClick={e => e.stopPropagation()}
                      title="Add sibling (Enter)"
                      className="absolute left-1/2 -bottom-3 -translate-x-1/2 z-10 w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center shadow hover:opacity-90"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}

        {links.map(({ rel, mx, my }) => {
          const isSel = rel.id === selRel
          const isEditingRel = editingRel === rel.id
          if (!rel.label && !isSel && !isEditingRel) return null
          return (
            <div
              key={rel.id}
              data-node
              className="absolute z-20"
              style={{ left: mx, top: my, transform: 'translate(-50%, -50%)' }}
              onClick={e => { e.stopPropagation(); setSelRel(rel.id); wrapRef.current?.focus() }}
              onDoubleClick={e => { e.stopPropagation(); setSelRel(rel.id); setEditingRel(rel.id) }}
            >
              {isEditingRel ? (
                <input
                  autoFocus
                  value={rel.label ?? ''}
                  placeholder="Label"
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => commit(root, `rel:${rel.id}`, relations.map(r => (r.id === rel.id ? { ...r, label: e.target.value } : r)))}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault()
                      setEditingRel(null)
                      wrapRef.current?.focus()
                    }
                  }}
                  onBlur={() => setEditingRel(cur => (cur === rel.id ? null : cur))}
                  className="w-28 rounded-full border border-accent bg-background px-2.5 py-0.5 text-center text-[12px] outline-none"
                />
              ) : (
                <span
                  className={cn(
                    'block max-w-[180px] truncate rounded-full border px-2.5 py-0.5 text-[12px] cursor-pointer bg-background',
                    isSel ? 'border-accent text-accent' : 'border-border text-muted-foreground',
                    !rel.label && 'italic opacity-70',
                  )}
                >
                  {rel.label || 'Add label'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="absolute left-4 top-3 flex items-center gap-0.5 rounded-lg border border-border bg-panel p-1 shadow-md" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <button className={iconBtn} disabled={!!selRelation} onClick={() => addChild(sel)} title="Add child (Tab)">
          <CornerDownRight className="w-3.5 h-3.5" />Child
        </button>
        <button className={iconBtn} disabled={!canAddSibling || isRoot} onClick={() => addSibling(sel)} title="Add sibling (Enter)">
          <ArrowDownToLine className="w-3.5 h-3.5" />Sibling
        </button>
        <button
          className={cn(iconBtn, linkFrom && 'text-accent bg-active')}
          disabled={!!selRelation || isRoot}
          onClick={() => (linkFrom ? setLinkFrom(null) : startLink())}
          title="Link to another point (L)"
        >
          <Link2 className="w-3.5 h-3.5" />Link
        </button>
        <button
          className={cn(iconBtn, 'hover:!text-destructive')}
          disabled={!selRelation && isRoot}
          onClick={() => (selRelation ? deleteRelation(selRelation.id) : deleteNode(sel))}
          title={selRelation ? 'Delete link' : 'Delete point (Delete)'}
        >
          <Trash2 className="w-3.5 h-3.5" />{selRelation ? 'Unlink' : 'Delete'}
        </button>
      </div>

      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border border-border bg-panel p-1 shadow-md" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Minus className="w-3.5 h-3.5" /></button>
        <span className="w-10 text-center text-[11px] text-muted-foreground tabular-nums">{Math.round(view.k * 100)}%</span>
        <button onClick={() => zoomBy(1.2)} title="Zoom in" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Plus className="w-3.5 h-3.5" /></button>
        <button onClick={fit} title="Fit to screen" className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"><Maximize2 className="w-3.5 h-3.5" /></button>
      </div>

      <p className={cn('absolute left-8 bottom-4 text-[11.5px] pointer-events-none', linkFrom ? 'text-accent font-medium' : 'text-tertiary')}>
        {hint}
      </p>
    </div>
  )
}
