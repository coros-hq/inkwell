/**
 * The vault manifest: a shared Yjs doc describing the *structure* of a shared
 * vault — which notes and folders exist and where, plus the per-note metadata
 * that doesn't live in the note body (pinned, tags, attachments, links).
 * Note bodies live in their own `note:<id>` docs (see vaultSession.ts).
 *
 *   notes:   Y.Map<noteId, NoteEntry>        (deleted notes are tombstoned,
 *   folders: Y.Map<folderRelPath, FolderEntry>  never removed, so a peer that
 *                                               was offline can't resurrect them)
 *
 * Local → manifest is diff-based: we compare the vault structure *before* and
 * *after* each local change (not local vs. manifest), so a note a peer just
 * created that hasn't landed on this disk yet is never mistaken for a local
 * delete.
 *
 * Manifest → local is applyManifestToDisk(): make the filesystem match, then
 * fold the result into the store via refreshVaultFromDisk.
 */
import * as Y from 'yjs'
import type { Attachment, Folder, LinkedItem, Note } from '../../types'
import { useAppStore } from '../../store/useAppStore'
import {
  createFolderDir, deleteFolderDir, deleteNoteFile, renameItem, writeNoteFile, writeNoteMeta,
} from '../vault'

export interface NoteEntry {
  folder: string | null
  file: string
  pinned: boolean
  tags: string[]
  createdAt: string
  attachments: Attachment[]
  linkedItems: LinkedItem[]
  deleted?: boolean
}

export interface FolderEntry {
  deleted?: boolean
}

export interface Structure {
  notes: Record<string, NoteEntry>
  folders: string[]
}

export interface ManifestMaps {
  notes: Y.Map<NoteEntry>
  folders: Y.Map<FolderEntry>
}

export function getManifestMaps(doc: Y.Doc): ManifestMaps {
  return { notes: doc.getMap<NoteEntry>('notes'), folders: doc.getMap<FolderEntry>('folders') }
}

// ── Snapshot of the local store ───────────────────────────────────────────────

function flattenFolderIds(folders: Folder[], out: string[] = []): string[] {
  for (const f of folders) {
    out.push(f.id)
    flattenFolderIds(f.children, out)
  }
  return out
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function noteToEntry(n: Note): NoteEntry {
  return {
    folder: n.folder,
    file: basename(n.path),
    pinned: n.pinned,
    tags: [...n.tags],
    createdAt: (n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt)).toISOString(),
    attachments: (n.attachments ?? []).map(a => ({ id: a.id, name: a.name, path: a.path, size: a.size, type: a.type })),
    linkedItems: (n.linkedItems ?? []).map(l => ({ ...l })),
  }
}

/** Structure of the vault as the store sees it now. External files are never shared. */
export function snapshotStructure(notes: Note[], folders: Folder[]): Structure {
  const out: Structure = { notes: {}, folders: flattenFolderIds(folders).sort() }
  for (const n of notes) {
    if (n.external) continue
    out.notes[n.id] = noteToEntry(n)
  }
  return out
}

function sameEntry(a: NoteEntry | undefined, b: NoteEntry | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.folder === b.folder &&
    a.file === b.file &&
    a.pinned === b.pinned &&
    Boolean(a.deleted) === Boolean(b.deleted) &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
    JSON.stringify(a.attachments) === JSON.stringify(b.attachments) &&
    JSON.stringify(a.linkedItems) === JSON.stringify(b.linkedItems)
  )
}

export function sameStructure(a: Structure | null, b: Structure): boolean {
  if (!a) return false
  if (a.folders.length !== b.folders.length || a.folders.some((f, i) => f !== b.folders[i])) return false
  const aIds = Object.keys(a.notes)
  if (aIds.length !== Object.keys(b.notes).length) return false
  return aIds.every(id => sameEntry(a.notes[id], b.notes[id]))
}

// ── Local → manifest ──────────────────────────────────────────────────────────

/**
 * Apply the local change prev → next to the manifest. Call inside a
 * doc.transact with a local origin. Returns ids of notes the manifest had
 * never seen, so the caller can seed their body docs.
 */
export function applyLocalDiff(m: ManifestMaps, prev: Structure | null, next: Structure): string[] {
  const before = prev ?? { notes: {}, folders: [] }
  const newNoteIds: string[] = []

  for (const [id, entry] of Object.entries(next.notes)) {
    if (sameEntry(before.notes[id], entry)) continue
    const current = m.notes.get(id)
    if (!current) newNoteIds.push(id)
    if (!sameEntry(current, entry)) m.notes.set(id, entry)
  }
  for (const [id, entry] of Object.entries(before.notes)) {
    if (next.notes[id]) continue
    const current = m.notes.get(id)
    if (current && !current.deleted) m.notes.set(id, { ...(current ?? entry), deleted: true })
  }

  const nextFolders = new Set(next.folders)
  const beforeFolders = new Set(before.folders)
  for (const id of nextFolders) {
    if (beforeFolders.has(id)) continue
    const current = m.folders.get(id)
    if (!current || current.deleted) m.folders.set(id, {})
  }
  for (const id of beforeFolders) {
    if (nextFolders.has(id)) continue
    const current = m.folders.get(id)
    if (current && !current.deleted) m.folders.set(id, { deleted: true })
  }

  return newNoteIds
}

// ── Manifest → disk ───────────────────────────────────────────────────────────

function findFolder(folders: Folder[], id: string): Folder | null {
  for (const f of folders) {
    if (f.id === id) return f
    const hit = findFolder(f.children, id)
    if (hit) return hit
  }
  return null
}

function isUnder(folderId: string | null, ancestor: string): boolean {
  return folderId === ancestor || (folderId?.startsWith(`${ancestor}/`) ?? false)
}

async function pathExists(path: string): Promise<boolean> {
  const { exists } = await import('@tauri-apps/plugin-fs')
  return exists(path)
}

export interface ApplyContext {
  vaultPath: string
  maps: ManifestMaps
  /** Current body of a note's doc (loads it if needed). */
  noteText: (noteId: string) => Promise<string>
  /** Called after a note body is written to disk from the doc. */
  onNoteWritten: (noteId: string, text: string) => void
  /** Called for every attachment the manifest references, so missing files can be fetched. */
  ensureAttachment: (attachment: Attachment) => Promise<void>
}

/**
 * Make the filesystem (and then the store) match the manifest. Returns true
 * if anything on disk changed.
 */
export async function applyManifestToDisk(ctx: ApplyContext): Promise<boolean> {
  const { vaultPath, maps } = ctx
  const store = useAppStore.getState()
  if (store.vaultPath !== vaultPath) return false

  const local = new Map(store.notes.filter(n => !n.external).map(n => [n.id, n]))
  const pathOwner = new Map(store.notes.map(n => [n.path, n.id]))
  const liveNotes: Array<[string, NoteEntry]> = []
  for (const [id, e] of maps.notes.entries()) if (!e.deleted) liveNotes.push([id, e])

  let changed = false
  const folderAbs = (folder: string | null) => (folder ? `${vaultPath}/${folder}` : vaultPath)

  // Folders first so notes have somewhere to land.
  for (const [id, e] of maps.folders.entries()) {
    if (e.deleted || findFolder(store.folders, id)) continue
    await createFolderDir(`${vaultPath}/${id}`)
    changed = true
  }

  for (const [id, e] of maps.notes.entries()) {
    const n = local.get(id)

    if (e.deleted) {
      if (n) {
        await deleteNoteFile(n.path)
        changed = true
      }
      continue
    }

    let target = `${folderAbs(e.folder)}/${e.file}`
    const owner = pathOwner.get(target)
    if (owner && owner !== id) {
      // Two notes want the same filename (e.g. both renamed to "Meeting" in the
      // same folder). Keep both: suffix this one — the renamed file flows back
      // into the manifest through the normal local-diff path.
      target = `${folderAbs(e.folder)}/${e.file.replace(/\.md$/, '')}-${id.slice(-4)}.md`
    }

    if (!n) {
      const content = await ctx.noteText(id)
      await writeNoteFile(entryToNote(id, e, target, content))
      ctx.onNoteWritten(id, content)
      if (e.attachments.length || e.linkedItems.length) {
        await writeNoteMeta(vaultPath, id, { attachments: e.attachments, linkedItems: e.linkedItems })
      }
      changed = true
    } else {
      if (n.path !== target) {
        const parent = target.slice(0, target.lastIndexOf('/'))
        if (!await pathExists(parent)) await createFolderDir(parent)
        await renameItem(n.path, target)
        changed = true
      }
      if (n.pinned !== e.pinned || JSON.stringify(n.tags) !== JSON.stringify(e.tags)) {
        await writeNoteFile({ ...n, path: target, pinned: e.pinned, tags: [...e.tags] })
        changed = true
      }
      const local = noteToEntry(n)
      if (
        JSON.stringify(local.attachments) !== JSON.stringify(e.attachments) ||
        JSON.stringify(local.linkedItems) !== JSON.stringify(e.linkedItems)
      ) {
        await writeNoteMeta(vaultPath, id, { attachments: e.attachments, linkedItems: e.linkedItems })
        changed = true
      }
    }

    for (const a of e.attachments) await ctx.ensureAttachment(a)
  }

  // Remove tombstoned folders once nothing live remains inside them. Deepest
  // first so a parent isn't removed out from under a child we still check.
  const deadFolders = [...maps.folders.entries()]
    .filter(([, e]) => e.deleted)
    .map(([id]) => id)
    .sort((a, b) => b.length - a.length)
  for (const id of deadFolders) {
    if (!findFolder(store.folders, id)) continue
    const stillUsed =
      liveNotes.some(([, e]) => isUnder(e.folder, id)) ||
      [...maps.folders.entries()].some(([fid, fe]) => !fe.deleted && isUnder(fid, id))
    if (stillUsed) continue
    await deleteFolderDir(`${vaultPath}/${id}`)
    changed = true
  }

  if (changed) await useAppStore.getState().refreshVaultFromDisk({ adoptContentFor: new Set() })
  return changed
}

function entryToNote(id: string, e: NoteEntry, path: string, content: string): Note {
  return {
    id,
    title: '',
    content,
    path,
    folder: e.folder,
    tags: [...e.tags],
    pinned: e.pinned,
    createdAt: new Date(e.createdAt),
    updatedAt: new Date(),
    wordCount: 0,
    attachments: e.attachments,
    linkedItems: e.linkedItems,
  }
}
