import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Lightbulb, ChevronRight, ChevronDown, GripVertical, List, Network, Undo2, Redo2 } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import { MindMap } from './MindMap'
import type { BrainstormNode } from '../../types'
import {
  addAfter,
  countNodes,
  findNode,
  flattenVisible,
  indent,
  move,
  moveRelative,
  newNode,
  outdent,
  parentIdOf,
  pathTo,
  removeNode,
  setText,
  toggleCollapsed,
} from '../../lib/brainstorm'

// Personal outliner: nested, collapsible points with keyboard-first editing.
// Stored locally in .inkwell/brainstorms.json and never synced to a team vault.

interface FocusRequest { id: string; caret: 'start' | 'end'; nonce: number }

export function BrainstormView() {
  const brainstorms = useAppStore(s => s.brainstorms)
  const activeId = useAppStore(s => s.activeBrainstormId)
  const setActiveId = useAppStore(s => s.setActiveBrainstormId)
  const createBrainstorm = useAppStore(s => s.createBrainstorm)
  const deleteBrainstorm = useAppStore(s => s.deleteBrainstorm)
  const openConfirm = useAppStore(s => s.openConfirm)

  const active = brainstorms.find(b => b.id === activeId) ?? null

  const handleDelete = () => {
    if (!active) return
    openConfirm({
      title: `Delete "${active.title}"?`,
      description: 'This permanently deletes the brainstorm and all its points.',
      confirmLabel: 'Delete brainstorm',
      destructive: true,
      onConfirm: () => deleteBrainstorm(active.id),
    })
  }

  return (
    <div className="flex-1 flex min-w-0 bg-background">
      <aside className="w-[220px] shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="uppercase text-[10.5px] font-semibold tracking-wider text-tertiary">Brainstorms</span>
          <button
            onClick={() => createBrainstorm()}
            title="New brainstorm"
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {brainstorms.map(b => (
            <button
              key={b.id}
              onClick={() => setActiveId(b.id)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 text-[13px] hover:bg-surface',
                b.id === activeId ? 'bg-active text-accent font-medium' : 'text-foreground',
              )}
            >
              <Lightbulb className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{b.title || 'Untitled'}</span>
              <span className="text-[11px] text-tertiary">{countNodes(b.root)}</span>
            </button>
          ))}
          {brainstorms.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">No brainstorms yet.</p>
          )}
        </div>
      </aside>

      {active ? (
        <Outline key={active.id} brainstormId={active.id} onDelete={handleDelete} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Lightbulb className="w-8 h-8 opacity-50" />
          <p className="text-sm">A private place to think in points.</p>
          <button
            onClick={() => createBrainstorm()}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90"
          >
            New brainstorm
          </button>
        </div>
      )}
    </div>
  )
}

type Mode = 'list' | 'map'
const MODE_KEY = 'inkwell-brainstorm-mode'
function readMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'map' ? 'map' : 'list' } catch { return 'list' }
}

function Outline({ brainstormId, onDelete }: { brainstormId: string; onDelete: () => void }) {
  const brainstorm = useAppStore(s => s.brainstorms.find(b => b.id === brainstormId))
  const setRoot = useAppStore(s => s.setBrainstormRoot)
  const renameBrainstorm = useAppStore(s => s.renameBrainstorm)

  const [mode, setMode] = useState<Mode>(readMode)
  const changeMode = (m: Mode) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ok */ }
  }
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null)
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const root = brainstorm?.root ?? []
  const zoomNode = zoomId ? findNode(root, zoomId) : null
  // If the zoomed node was deleted, fall back to the top level.
  const effectiveZoom = zoomNode ? zoomId : null
  const shown = zoomNode ? zoomNode.children : root
  const crumbs = useMemo(() => (effectiveZoom ? pathTo(root, effectiveZoom) : []), [root, effectiveZoom])

  const requestFocus = useCallback((id: string, caret: 'start' | 'end' = 'end') => {
    setFocusReq({ id, caret, nonce: Date.now() + Math.random() })
  }, [])

  useEffect(() => {
    if (!focusReq) return
    const el = inputs.current.get(focusReq.id)
    if (!el) return
    el.focus()
    const pos = focusReq.caret === 'start' ? 0 : el.value.length
    el.setSelectionRange(pos, pos)
  }, [focusReq])

  // Always at least one editable row, so a fresh brainstorm is ready to type into.
  useEffect(() => {
    if (!brainstorm) return
    if (zoomNode && zoomNode.children.length === 0) {
      const child = newNode()
      setRoot(brainstormId, addChild(root, zoomNode.id, child))
      requestFocus(child.id)
    } else if (!zoomNode && root.length === 0) {
      const first = newNode()
      setRoot(brainstormId, [first])
      requestFocus(first.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainstormId, zoomNode?.id, zoomNode?.children.length, root.length])

  if (!brainstorm) return null

  const currentRoot = () => useAppStore.getState().brainstorms.find(b => b.id === brainstormId)?.root ?? []

  // Undo/redo: snapshots of the whole tree (cheap, trees are small). Consecutive
  // edits sharing a `key` (typing in one point) within a second merge into one step.
  const past = useRef<BrainstormNode[][]>([])
  const future = useRef<BrainstormNode[][]>([])
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: 0 })
  const [, bump] = useState(0)

  const commit = (next: BrainstormNode[], key?: string) => {
    const now = Date.now()
    const merge = key && last.current.key === key && now - last.current.at < 1000
    if (!merge) {
      past.current.push(currentRoot())
      if (past.current.length > 200) past.current.shift()
    }
    last.current = { key: key ?? null, at: now }
    future.current = []
    setRoot(brainstormId, next)
    bump(n => n + 1)
  }
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(currentRoot())
    last.current = { key: null, at: 0 }
    setRoot(brainstormId, prev)
    bump(n => n + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(currentRoot())
    last.current = { key: null, at: 0 }
    setRoot(brainstormId, next)
    bump(n => n + 1)
  }

  const undoRef = useRef({ undo, redo })
  undoRef.current = { undo, redo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      // Leave the title field to its native undo.
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' && !(e.target as HTMLElement).closest('[data-node]')) return
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRef.current.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, node: BrainstormNode) => {
    const el = e.currentTarget
    const mod = e.metaKey || e.ctrlKey

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const caret = el.selectionStart
      const before = el.value.slice(0, caret)
      const after = el.value.slice(el.selectionEnd)
      const base = setText(root, node.id, before)
      const { root: next, newId } = addAfter(base, node.id, after)
      commit(next)
      requestFocus(newId, 'start')
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        // Don't climb out of the zoomed branch.
        if (parentIdOf(root, node.id) === effectiveZoom) return
        commit(outdent(root, node.id))
      } else {
        commit(indent(root, node.id))
      }
      requestFocus(node.id, el.selectionStart === 0 ? 'start' : 'end')
      return
    }
    if (e.key === 'Backspace' && node.text === '' && node.children.length === 0) {
      const order = flattenVisible(shown)
      if (order.length <= 1) return
      e.preventDefault()
      const prev = order[order.indexOf(node.id) - 1] ?? order[1]
      commit(removeNode(root, node.id))
      requestFocus(prev, 'end')
      return
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      commit(move(root, node.id, e.key === 'ArrowUp' ? -1 : 1))
      requestFocus(node.id)
      return
    }
    if (mod && e.key === '.') {
      e.preventDefault()
      if (node.children.length) commit(toggleCollapsed(root, node.id))
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const before = el.value.slice(0, el.selectionStart)
      const after = el.value.slice(el.selectionEnd)
      const atEdge = e.key === 'ArrowUp' ? !before.includes('\n') : !after.includes('\n')
      if (!atEdge) return
      const order = flattenVisible(shown)
      const target = order[order.indexOf(node.id) + (e.key === 'ArrowUp' ? -1 : 1)]
      if (target) {
        e.preventDefault()
        requestFocus(target, 'end')
      }
    }
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const translated = active.rect.current.translated
    const after = translated ? translated.top > over.rect.top : false
    commit(moveRelative(root, String(active.id), String(over.id), after))
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-8 pt-6 pb-2">
        <input
          value={brainstorm.title}
          onChange={e => renameBrainstorm(brainstormId, e.target.value)}
          placeholder="Untitled brainstorm"
          className="flex-1 bg-transparent outline-none text-2xl font-semibold text-foreground placeholder:text-muted-foreground/40"
        />
        <div className="flex items-center">
          <button
            onClick={undo}
            disabled={past.current.length === 0}
            title="Undo (⌘Z)"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-30 disabled:pointer-events-none"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={future.current.length === 0}
            title="Redo (⌘⇧Z)"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-30 disabled:pointer-events-none"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {([['list', List, 'Outline'], ['map', Network, 'Mind map']] as const).map(([m, Icon, label]) => (
            <button
              key={m}
              onClick={() => changeMode(m)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px]',
                mode === m ? 'bg-active text-accent font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        <button
          onClick={onDelete}
          title="Delete brainstorm"
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-surface"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {mode === 'map' && (
        <MindMap title={brainstorm.title} root={root} commit={commit} />
      )}

      {mode === 'list' && crumbs.length > 0 && (
        <div className="flex items-center gap-1 px-8 pb-1 text-[12px] text-muted-foreground flex-wrap">
          <button onClick={() => setZoomId(null)} className="hover:text-accent">{brainstorm.title || 'Untitled'}</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 opacity-60" />
              <button
                onClick={() => setZoomId(c.id)}
                className={cn('hover:text-accent truncate max-w-[200px]', i === crumbs.length - 1 && 'text-foreground')}
              >
                {c.text || 'Untitled point'}
              </button>
            </span>
          ))}
        </div>
      )}

      {mode === 'list' && (
      <div className="flex-1 overflow-y-auto px-8 pb-24 pt-2">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="max-w-[760px]">
            {shown.map(n => (
              <OutlineRow
                key={n.id}
                node={n}
                depth={0}
                registerInput={(id, el) => { if (el) inputs.current.set(id, el); else inputs.current.delete(id) }}
                onChangeText={(id, text) => commit(setText(root, id, text), `text:${id}`)}
                onToggle={id => commit(toggleCollapsed(root, id))}
                onZoom={setZoomId}
                onKeyDown={handleKeyDown}
              />
            ))}
          </div>
        </DndContext>
        <p className="mt-8 text-[11.5px] text-tertiary">
          Enter new point · Tab / Shift+Tab nest · Alt+↑↓ reorder · ⌘. collapse · click a bullet to zoom in
        </p>
      </div>
      )}
    </div>
  )
}

function addChild(root: BrainstormNode[], parentId: string, child: BrainstormNode): BrainstormNode[] {
  return root.map(n =>
    n.id === parentId
      ? { ...n, collapsed: false, children: [...n.children, child] }
      : n.children.length ? { ...n, children: addChild(n.children, parentId, child) } : n,
  )
}

interface RowProps {
  node: BrainstormNode
  depth: number
  registerInput: (id: string, el: HTMLTextAreaElement | null) => void
  onChangeText: (id: string, text: string) => void
  onToggle: (id: string) => void
  onZoom: (id: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, node: BrainstormNode) => void
}

function OutlineRow({ node, depth, registerInput, onChangeText, onToggle, onZoom, onKeyDown }: RowProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: node.id })
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({ id: node.id })
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hasChildren = node.children.length > 0

  // Auto-grow the textarea to its content.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [node.text])

  return (
    <div>
      <div
        ref={setDropRef}
        className={cn('group/row flex items-start gap-1 rounded-md -ml-6 pl-0', isOver && !isDragging && 'bg-accent/10', isDragging && 'opacity-40')}
      >
        <button
          ref={setDragRef}
          {...attributes}
          {...listeners}
          title="Drag to move"
          className="w-5 h-7 flex items-center justify-center text-muted-foreground opacity-0 group-hover/row:opacity-60 hover:!opacity-100 cursor-grab"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn('w-4 h-7 flex items-center justify-center text-muted-foreground', !hasChildren && 'invisible')}
          title={node.collapsed ? 'Expand' : 'Collapse'}
        >
          {node.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onZoom(node.id)}
          title="Zoom into this point"
          className="w-5 h-7 flex items-center justify-center shrink-0"
        >
          <span className={cn('w-[7px] h-[7px] rounded-full bg-foreground/70', node.collapsed && hasChildren && 'ring-4 ring-foreground/15')} />
        </button>
        <textarea
          ref={el => { taRef.current = el; registerInput(node.id, el) }}
          value={node.text}
          rows={1}
          spellCheck
          onChange={e => onChangeText(node.id, e.target.value)}
          onKeyDown={e => onKeyDown(e, node)}
          className="flex-1 resize-none overflow-hidden bg-transparent outline-none py-1 text-[15px] leading-6 text-foreground"
        />
      </div>
      {hasChildren && !node.collapsed && (
        <div className="ml-[22px] pl-3 border-l border-border/60">
          {node.children.map(c => (
            <OutlineRow
              key={c.id}
              node={c}
              depth={depth + 1}
              registerInput={registerInput}
              onChangeText={onChangeText}
              onToggle={onToggle}
              onZoom={onZoom}
              onKeyDown={onKeyDown}
            />
          ))}
        </div>
      )}
    </div>
  )
}
