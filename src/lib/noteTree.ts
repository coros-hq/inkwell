import type { Note } from '../types'

type TreeNote = Pick<Note, 'id' | 'parentId'>

/** Every note nested (at any depth) under `id`, excluding `id` itself. Cycle-safe. */
export function collectDescendantIds(notes: TreeNote[], id: string): string[] {
  const byParent = new Map<string, string[]>()
  for (const n of notes) {
    if (!n.parentId) continue
    const siblings = byParent.get(n.parentId)
    if (siblings) siblings.push(n.id)
    else byParent.set(n.parentId, [n.id])
  }
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** Parents of `id`, nearest first. Cycle-safe. */
export function collectAncestors<T extends TreeNote>(notes: T[], id: string): T[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const out: T[] = []
  const seen = new Set<string>([id])
  let parentId = byId.get(id)?.parentId
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    seen.add(parentId)
    out.push(parent)
    parentId = parent.parentId
  }
  return out
}

/** Whether `noteId` can be nested under `parentId` without making a note its own ancestor. */
export function canNestUnder(notes: TreeNote[], noteId: string, parentId: string): boolean {
  return noteId !== parentId && !collectDescendantIds(notes, noteId).includes(parentId)
}

export interface TreeRow<T> {
  note: T
  depth: number
  childCount: number
}

/**
 * Flattens `notes` (already sorted) into depth-first rows. A note whose parent
 * isn't in `notes` is shown as a root. Children of ids in `collapsed` are skipped.
 */
export function flattenNoteTree<T extends TreeNote>(notes: T[], collapsed: ReadonlySet<string>): TreeRow<T>[] {
  const ids = new Set(notes.map((n) => n.id))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const n of notes) {
    if (n.parentId && ids.has(n.parentId) && n.parentId !== n.id) {
      const siblings = children.get(n.parentId)
      if (siblings) siblings.push(n)
      else children.set(n.parentId, [n])
    } else {
      roots.push(n)
    }
  }

  const rows: TreeRow<T>[] = []
  const visited = new Set<string>()
  const walk = (n: T, depth: number) => {
    if (visited.has(n.id)) return
    visited.add(n.id)
    const kids = children.get(n.id) ?? []
    rows.push({ note: n, depth, childCount: kids.length })
    if (collapsed.has(n.id)) return
    for (const k of kids) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return rows
}
