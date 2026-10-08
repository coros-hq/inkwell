import type { BrainstormNode } from '../types'
import { genId } from './id'

// Pure, immutable tree operations for the Brainstorm outliner.

export function newNode(text = ''): BrainstormNode {
  return { id: genId('bn'), text, children: [] }
}

interface Located {
  parentId: string | null
  list: BrainstormNode[]
  index: number
}

function locate(root: BrainstormNode[], id: string, parentId: string | null = null): Located | null {
  for (let i = 0; i < root.length; i++) {
    if (root[i].id === id) return { parentId, list: root, index: i }
    const hit = locate(root[i].children, id, root[i].id)
    if (hit) return hit
  }
  return null
}

function withList(
  root: BrainstormNode[],
  parentId: string | null,
  fn: (list: BrainstormNode[]) => BrainstormNode[],
): BrainstormNode[] {
  if (parentId === null) return fn(root)
  return root.map((n) =>
    n.id === parentId
      ? { ...n, children: fn(n.children) }
      : n.children.length
        ? { ...n, children: withList(n.children, parentId, fn) }
        : n,
  )
}

export function findNode(root: BrainstormNode[], id: string): BrainstormNode | null {
  const hit = locate(root, id)
  return hit ? hit.list[hit.index] : null
}

export function parentIdOf(root: BrainstormNode[], id: string): string | null {
  return locate(root, id)?.parentId ?? null
}

/** Path of nodes from the top down to (and including) `id`. */
export function pathTo(root: BrainstormNode[], id: string): BrainstormNode[] {
  for (const n of root) {
    if (n.id === id) return [n]
    const sub = pathTo(n.children, id)
    if (sub.length) return [n, ...sub]
  }
  return []
}

/** Ids in on-screen order, skipping the children of collapsed nodes. */
export function flattenVisible(list: BrainstormNode[]): string[] {
  const out: string[] = []
  for (const n of list) {
    out.push(n.id)
    if (!n.collapsed) out.push(...flattenVisible(n.children))
  }
  return out
}

export function countNodes(list: BrainstormNode[]): number {
  return list.reduce((sum, n) => sum + 1 + countNodes(n.children), 0)
}

export function setText(root: BrainstormNode[], id: string, text: string): BrainstormNode[] {
  return root.map((n) =>
    n.id === id ? { ...n, text } : n.children.length ? { ...n, children: setText(n.children, id, text) } : n,
  )
}

export function toggleCollapsed(root: BrainstormNode[], id: string, collapsed?: boolean): BrainstormNode[] {
  return root.map((n) =>
    n.id === id
      ? { ...n, collapsed: collapsed ?? !n.collapsed }
      : n.children.length
        ? { ...n, children: toggleCollapsed(n.children, id, collapsed) }
        : n,
  )
}

/** Enter: a new empty point below `id` (as its first child when it has visible children). */
export function addAfter(root: BrainstormNode[], id: string, text = ''): { root: BrainstormNode[]; newId: string } {
  const created = newNode(text)
  const hit = locate(root, id)
  if (!hit) return { root: [...root, created], newId: created.id }
  const target = hit.list[hit.index]
  if (target.children.length && !target.collapsed) {
    return {
      root: withList(root, id, (list) => [created, ...list]),
      newId: created.id,
    }
  }
  return {
    root: withList(root, hit.parentId, (list) => {
      const next = list.slice()
      next.splice(hit.index + 1, 0, created)
      return next
    }),
    newId: created.id,
  }
}

/** Tab: become the last child of the previous sibling. */
export function indent(root: BrainstormNode[], id: string): BrainstormNode[] {
  const hit = locate(root, id)
  if (!hit || hit.index === 0) return root
  const node = hit.list[hit.index]
  const prev = hit.list[hit.index - 1]
  return withList(root, hit.parentId, (list) => {
    const next = list.slice()
    next.splice(hit.index, 1)
    next[hit.index - 1] = { ...prev, collapsed: false, children: [...prev.children, node] }
    return next
  })
}

/** Shift+Tab: become the next sibling of the current parent. */
export function outdent(root: BrainstormNode[], id: string): BrainstormNode[] {
  const hit = locate(root, id)
  if (!hit || hit.parentId === null) return root
  const parentHit = locate(root, hit.parentId)
  if (!parentHit) return root
  const node = hit.list[hit.index]
  // Remove from the parent first, then insert after the parent in the grandparent list.
  const without = withList(root, hit.parentId, (list) => list.filter((n) => n.id !== id))
  return withList(without, parentHit.parentId, (list) => {
    const at = list.findIndex((n) => n.id === hit.parentId)
    const next = list.slice()
    next.splice(at + 1, 0, node)
    return next
  })
}

export function move(root: BrainstormNode[], id: string, dir: -1 | 1): BrainstormNode[] {
  const hit = locate(root, id)
  if (!hit) return root
  const to = hit.index + dir
  if (to < 0 || to >= hit.list.length) return root
  return withList(root, hit.parentId, (list) => {
    const next = list.slice()
    ;[next[hit.index], next[to]] = [next[to], next[hit.index]]
    return next
  })
}

/** Drag-and-drop: put `id` right before (or after) `overId`, within the same parent or a different one. */
export function moveRelative(root: BrainstormNode[], id: string, overId: string, after: boolean): BrainstormNode[] {
  if (id === overId) return root
  const node = findNode(root, id)
  if (!node || findNode(node.children, overId)) return root // can't drop into own subtree
  const without = removeNode(root, id)
  const over = locate(without, overId)
  if (!over) return root
  return withList(without, over.parentId, (list) => {
    const at = list.findIndex((n) => n.id === overId)
    const next = list.slice()
    next.splice(at + (after ? 1 : 0), 0, node)
    return next
  })
}

export function removeNode(root: BrainstormNode[], id: string): BrainstormNode[] {
  return root
    .filter((n) => n.id !== id)
    .map((n) => (n.children.length ? { ...n, children: removeNode(n.children, id) } : n))
}

/** Append `child` as the last child of `parentId` (expanding the parent). */
export function addChildTo(root: BrainstormNode[], parentId: string, child: BrainstormNode): BrainstormNode[] {
  return root.map((n) =>
    n.id === parentId
      ? { ...n, collapsed: false, children: [...n.children, child] }
      : n.children.length ? { ...n, children: addChildTo(n.children, parentId, child) } : n,
  )
}

// ── Mind-map layout ───────────────────────────────────────────────────────────

export const MAP_ROOT_ID = '__root__'
export const MAP_NODE_H = 34
const GAP_Y = 12
const GAP_X = 56

export interface MapBox {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  depth: number
  parentId: string | null
  hasChildren: boolean
  childCount: number
  collapsed: boolean
}

const CHAR_W = 7.6
const LINE_H = 20
const PAD_X = 22
const MAX_W = 260

/** Greedy word-wrap estimate of how many lines `text` needs in a card of width `w`. */
function wrapLines(text: string, w: number): number {
  const perLine = Math.max(4, Math.floor((w - PAD_X) / CHAR_W))
  let lines = 0
  for (const para of (text || ' ').split('\n')) {
    let cur = 0
    lines++
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let len = word.length
      if (cur === 0) cur = Math.min(len, perLine)
      else if (cur + 1 + len <= perLine) cur += 1 + len
      else { lines++; cur = Math.min(len, perLine) }
      while (len > perLine) { lines++; len -= perLine }
    }
  }
  return lines
}

export function mapNodeHeight(text: string, depth: number): number {
  return Math.max(MAP_NODE_H, wrapLines(text, mapNodeWidth(text, depth)) * LINE_H + 14)
}

export function mapNodeWidth(text: string, depth: number): number {
  const base = depth === 0 ? 120 : 72
  return Math.max(base, Math.min(MAX_W, 36 + text.length * 7.4))
}

/** Left-to-right tidy tree. The brainstorm title is a virtual root joining the top-level points. */
export function layoutMap(title: string, top: BrainstormNode[]): { boxes: MapBox[]; width: number; height: number } {
  const rootNode: BrainstormNode = { id: MAP_ROOT_ID, text: title || 'Untitled', children: top }
  const boxes: MapBox[] = []
  const nodeH = (n: BrainstormNode, depth: number) => mapNodeHeight(n.text, depth) + GAP_Y

  const height = (n: BrainstormNode, depth: number): number =>
    n.collapsed || n.children.length === 0
      ? nodeH(n, depth)
      : Math.max(nodeH(n, depth), n.children.reduce((s, c) => s + height(c, depth + 1), 0))

  const place = (n: BrainstormNode, depth: number, x: number, top: number, parentId: string | null) => {
    const span = height(n, depth)
    const w = mapNodeWidth(n.text, depth)
    const h = mapNodeHeight(n.text, depth)
    boxes.push({
      id: n.id, text: n.text, x, y: top + span / 2 - h / 2 - GAP_Y / 2, w, h, depth, parentId,
      hasChildren: n.children.length > 0, childCount: countNodes(n.children), collapsed: !!n.collapsed && depth > 0,
    })
    if (n.collapsed && depth > 0) return
    let cy = top
    for (const c of n.children) {
      place(c, depth + 1, x + w + GAP_X, cy, n.id)
      cy += height(c, depth + 1)
    }
  }
  place(rootNode, 0, 0, 0, null)
  return {
    boxes,
    width: Math.max(...boxes.map((b) => b.x + b.w)),
    height: height(rootNode, 0),
  }
}
