/**
 * Manual cloud backup: push/pull between the local vault and Supabase.
 *
 * This is NOT realtime sync — it only runs when the user clicks "Sync now" in
 * Settings → Cloud Backup. Local vault files are always the source of truth;
 * cloud is a mirror that can restore a vault onto a new device.
 *
 * Conflict model:
 *   Notes have real per-note `updatedAt` timestamps, so we diff note-by-note
 *   against the last-synced marker and surface a Keep Local / Keep Cloud choice
 *   only for notes that changed on both sides since the last sync.
 *
 *   Folders/Tasks/Boards/BoardColumns/BoardTasks have no per-item timestamps in
 *   the local data model (see src/types/index.ts) — inventing fake timestamps
 *   would make the conflict UI lie about what actually happened. Instead these
 *   are synced as a single collection snapshot per table, with one conflict
 *   prompt for "structural data" as a whole when both sides changed.
 */
import type { Folder, Note, Task, Board, BoardColumn, BoardTask } from '../types'
import { supabase } from './supabase'
import {
  writeNoteFile, deleteNoteFile, createFolderDir,
  readAppData, writeAppData, writeBoardsFile, readVaultFS,
  serializeFrontmatter, type FrontmatterMeta,
} from './vault'
import { slugifyTitle } from './utils'
import { useAppStore } from '../store/useAppStore'

// ── Sync manifest (per-vault "last synced" marker, kept locally) ─────────────

interface SyncManifest {
  lastSyncedAt: string | null // ISO timestamp of the last successful sync
  /** local_ids of notes present in the vault as of the last successful sync — lets us
   *  tell "deleted locally since last sync" apart from "never seen on this device". */
  syncedNoteIds: string[]
  /** filenames already confirmed present in the "attachments" storage bucket, so
   *  push doesn't re-upload unchanged images every sync. */
  uploadedAttachments: string[]
}

function manifestKey(vaultPath: string): string {
  return `inkwell-cloud-sync:${vaultPath}`
}

export function loadManifest(vaultPath: string): SyncManifest {
  const empty: SyncManifest = { lastSyncedAt: null, syncedNoteIds: [], uploadedAttachments: [] }
  try {
    const raw = localStorage.getItem(manifestKey(vaultPath))
    if (!raw) return empty
    return { ...empty, ...(JSON.parse(raw) as Partial<SyncManifest>) }
  } catch {
    return empty
  }
}

function saveManifest(vaultPath: string, manifest: SyncManifest): void {
  localStorage.setItem(manifestKey(vaultPath), JSON.stringify(manifest))
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NoteConflict {
  localId: string
  title: string
  local: Note
  remote: RemoteNoteRow
  localUpdatedAt: string
  cloudUpdatedAt: string
}

export interface StructuralConflict {
  table: 'structural'
  label: string
  localUpdatedAt: string
  cloudUpdatedAt: string
}

export interface SyncPlan {
  notesToPush: Note[]
  notesToPull: RemoteNoteRow[]
  /** local_ids that were deleted locally since the last sync — need a tombstone pushed. */
  deletesToPush: string[]
  noteConflicts: NoteConflict[]
  /** true if folders/tasks/boards/etc changed locally since last sync */
  structuralLocalChanged: boolean
  /** true if they changed on the cloud side since last sync */
  structuralCloudChanged: boolean
  structuralConflict: StructuralConflict | null
  remoteStructural: StructuralSnapshot | null
}

export interface RemoteNoteRow {
  local_id: string
  title: string
  content: string
  folder: string | null
  tags: string[]
  pinned: boolean
  word_count: number
  updated_at: string
  deleted_at: string | null
}

export interface StructuralSnapshot {
  folders: Folder[]
  tasks: Task[]
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
  updatedAt: string
}

export interface VaultSnapshot {
  notes: Note[]
  folders: Folder[]
  tasks: Task[]
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
}

function requireClient() {
  if (!supabase) throw new Error('Cloud backup is not configured.')
  return supabase
}

// ── Plan: diff local vault against cloud, without writing anything yet ───────

export async function computeSyncPlan(vaultPath: string, local: VaultSnapshot): Promise<SyncPlan> {
  const client = requireClient()
  const { data: userData, error: userErr } = await client.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in.')
  const userId = userData.user.id

  const manifest = loadManifest(vaultPath)
  const lastSyncedAt = manifest.lastSyncedAt ? new Date(manifest.lastSyncedAt) : null

  const { data: remoteNotes, error: notesErr } = await client
    .from('notes')
    .select('local_id, title, content, folder, tags, pinned, word_count, updated_at, deleted_at')
    .eq('user_id', userId)
  if (notesErr) throw notesErr

  const remoteByLocalId = new Map<string, RemoteNoteRow>((remoteNotes ?? []).map((r) => [r.local_id, r]))
  const previouslySynced = new Set(manifest.syncedNoteIds)

  const notesToPush: Note[] = []
  const notesToPull: RemoteNoteRow[] = []
  const deletesToPush: string[] = []
  const noteConflicts: NoteConflict[] = []

  for (const note of local.notes) {
    const remote = remoteByLocalId.get(note.id)
    remoteByLocalId.delete(note.id)

    if (!remote) {
      // Never synced before, or was deleted on this device before ever syncing.
      notesToPush.push(note)
      continue
    }

    const localChanged = !lastSyncedAt || note.updatedAt > lastSyncedAt
    const remoteChanged = !lastSyncedAt || new Date(remote.updated_at) > lastSyncedAt

    if (remote.deleted_at && !localChanged) {
      // Cloud deleted it and we haven't touched it locally since — pull the delete.
      notesToPull.push(remote)
    } else if (localChanged && remoteChanged) {
      noteConflicts.push({
        localId: note.id,
        title: note.title,
        local: note,
        remote,
        localUpdatedAt: note.updatedAt.toISOString(),
        cloudUpdatedAt: remote.updated_at,
      })
    } else if (localChanged) {
      notesToPush.push(note)
    } else if (remoteChanged) {
      notesToPull.push(remote)
    }
  }

  // Anything left in remoteByLocalId exists in the cloud but not locally.
  for (const remote of remoteByLocalId.values()) {
    if (remote.deleted_at) continue
    if (previouslySynced.has(remote.local_id)) {
      // We synced this note before and it's gone locally now — it was deleted here,
      // not "new from the cloud". Push the tombstone instead of resurrecting it.
      deletesToPush.push(remote.local_id)
    } else {
      notesToPull.push(remote)
    }
  }

  // Structural data (folders/tasks/boards) — single snapshot comparison.
  const { data: structuralRow, error: structuralErr } = await client
    .from('vault_structural')
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (structuralErr) throw structuralErr

  const structuralCloudChanged = Boolean(
    structuralRow && (!lastSyncedAt || new Date(structuralRow.updated_at) > lastSyncedAt),
  )
  // We don't have a local structural timestamp, so treat "changed" as "always push"
  // unless the cloud also changed, in which case ask before overwriting either way.
  const structuralLocalChanged = true
  const remoteStructural = structuralRow
    ? { ...(structuralRow.data as Omit<StructuralSnapshot, 'updatedAt'>), updatedAt: structuralRow.updated_at }
    : null

  const structuralConflict: StructuralConflict | null =
    structuralCloudChanged && remoteStructural
      ? {
          table: 'structural',
          label: 'Folders, tasks & boards',
          localUpdatedAt: new Date().toISOString(),
          cloudUpdatedAt: remoteStructural.updatedAt,
        }
      : null

  return {
    notesToPush,
    notesToPull,
    deletesToPush,
    noteConflicts,
    structuralLocalChanged,
    structuralCloudChanged,
    structuralConflict,
    remoteStructural,
  }
}

// ── Apply: after conflicts are resolved by the user ──────────────────────────

export type ConflictChoice = 'local' | 'cloud'

export async function pushNotes(notes: Note[]): Promise<void> {
  if (notes.length === 0) return
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  const rows = notes.map((n) => ({
    user_id: userId,
    local_id: n.id,
    title: n.title,
    content: n.content,
    folder: n.folder,
    tags: n.tags,
    pinned: n.pinned,
    word_count: n.wordCount,
    updated_at: n.updatedAt.toISOString(),
    deleted_at: null,
  }))

  const { error } = await client.from('notes').upsert(rows, { onConflict: 'user_id,local_id' })
  if (error) throw error
}

/** Marks notes deleted locally as tombstones in the cloud, so other devices pull the deletion. */
export async function pushDeletedNotes(localIds: string[]): Promise<void> {
  if (localIds.length === 0) return
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  const { error } = await client
    .from('notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('local_id', localIds)
  if (error) throw error
}

export function remoteNoteToLocal(remote: RemoteNoteRow, existing?: Note): Note {
  return {
    id: remote.local_id,
    title: remote.title,
    content: remote.content,
    path: existing?.path ?? '',
    folder: remote.folder,
    tags: remote.tags,
    pinned: remote.pinned,
    createdAt: existing?.createdAt ?? new Date(remote.updated_at),
    updatedAt: new Date(remote.updated_at),
    wordCount: remote.word_count,
    attachments: existing?.attachments ?? [],
    linkedItems: existing?.linkedItems ?? [],
  }
}

export async function pushStructural(snapshot: Omit<StructuralSnapshot, 'updatedAt'>): Promise<void> {
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  const { error } = await client
    .from('vault_structural')
    .upsert(
      { user_id: userId, data: snapshot, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (error) throw error
}

/** Call after a sync completes, with the final set of local_ids present in the vault. */
export async function finalizeSync(
  vaultPath: string,
  finalNoteIds: string[],
  uploadedAttachments: string[],
): Promise<void> {
  saveManifest(vaultPath, {
    lastSyncedAt: new Date().toISOString(),
    syncedNoteIds: finalNoteIds,
    uploadedAttachments,
  })
}

// ── Attachments (images) ─────────────────────────────────────────────────────
// Images live in the vault's assets/ (inline markdown images) and attachments/
// (file picker attachments) folders on disk. We mirror them into the "attachments"
// Storage bucket under {user_id}/{filename}. This is a flat namespace — same-name
// files from different folders collide, matching how the vault itself already
// dedupes filenames within each folder (see images.ts/attachments.ts).

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])
const IMAGE_DIRS = ['assets', 'attachments']

interface VaultImageFile {
  relPath: string
  filename: string
}

async function listVaultImageFiles(vaultPath: string): Promise<VaultImageFile[]> {
  if (!isTauri) return []
  const { readDir, exists } = await import('@tauri-apps/plugin-fs')
  const results: VaultImageFile[] = []
  for (const dir of IMAGE_DIRS) {
    const full = `${vaultPath}/${dir}`
    if (!(await exists(full))) continue
    const entries = await readDir(full)
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTS.has(ext)) results.push({ relPath: `${dir}/${entry.name}`, filename: entry.name })
    }
  }
  return results
}

async function uploadAttachment(userId: string, filename: string, bytes: Uint8Array): Promise<void> {
  const client = requireClient()
  const { error } = await client.storage
    .from('attachments')
    .upload(`${userId}/${filename}`, bytes, { upsert: true })
  if (error) throw error
}

export async function downloadAttachment(userId: string, filename: string): Promise<Uint8Array> {
  const client = requireClient()
  const { data, error } = await client.storage.from('attachments').download(`${userId}/${filename}`)
  if (error) throw error
  return new Uint8Array(await data.arrayBuffer())
}

export async function listRemoteAttachments(userId: string): Promise<string[]> {
  const client = requireClient()
  const { data, error } = await client.storage.from('attachments').list(userId)
  if (error) throw error
  return (data ?? []).map((f) => f.name)
}

/** Uploads any local image not already known-uploaded. Returns filenames newly uploaded. */
export async function pushAttachments(
  vaultPath: string,
  userId: string,
  alreadyUploaded: Set<string>,
): Promise<string[]> {
  const files = await listVaultImageFiles(vaultPath)
  const { readFile } = isTauri ? await import('@tauri-apps/plugin-fs') : { readFile: null }
  const uploaded: string[] = []
  for (const f of files) {
    if (alreadyUploaded.has(f.filename) || !readFile) continue
    const bytes = await readFile(`${vaultPath}/${f.relPath}`)
    await uploadAttachment(userId, f.filename, bytes)
    uploaded.push(f.filename)
  }
  return uploaded
}

/** Downloads any remote image missing locally into the vault's assets/ folder. Returns filenames pulled. */
export async function pullAttachments(vaultPath: string, userId: string): Promise<string[]> {
  if (!isTauri) return []
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const remoteNames = await listRemoteAttachments(userId)
  const localNames = new Set((await listVaultImageFiles(vaultPath)).map((f) => f.filename))
  const assetsDir = `${vaultPath}/assets`

  const pulled: string[] = []
  for (const name of remoteNames) {
    if (localNames.has(name)) continue
    if (!(await exists(assetsDir))) await mkdir(assetsDir, { recursive: true })
    const bytes = await downloadAttachment(userId, name)
    await writeFile(`${assetsDir}/${name}`, bytes)
    pulled.push(name)
  }
  return pulled
}

// ── Orchestration: run a full sync after conflicts (if any) are resolved ────

export interface ConflictResolutions {
  notes: Record<string, ConflictChoice>
  structural?: ConflictChoice
}

export interface SyncResult {
  pushed: number
  pulled: number
  deleted: number
  attachmentsUploaded: number
  attachmentsDownloaded: number
}

export async function runSync(
  vaultPath: string,
  plan: SyncPlan,
  resolutions: ConflictResolutions,
): Promise<SyncResult> {
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  for (const conflict of plan.noteConflicts) {
    if (!resolutions.notes[conflict.localId]) {
      throw new Error(`Unresolved conflict for note "${conflict.title}".`)
    }
  }
  if (plan.structuralConflict && !resolutions.structural) {
    throw new Error('Unresolved conflict for folders/tasks/boards.')
  }

  const notesToPush = [...plan.notesToPush]
  const notesToPull = [...plan.notesToPull]
  for (const conflict of plan.noteConflicts) {
    if (resolutions.notes[conflict.localId] === 'cloud') notesToPull.push(conflict.remote)
    else notesToPush.push(conflict.local)
  }

  const { vaultPath: currentVaultPath, notes: currentNotes } = useAppStore.getState()
  if (currentVaultPath !== vaultPath) throw new Error('Vault changed during sync — try again.')

  // 1. Write pulled notes/deletions to disk.
  for (const remote of notesToPull) {
    const existing = currentNotes.find((n) => n.id === remote.local_id)
    if (remote.deleted_at) {
      if (existing) await deleteNoteFile(existing.path)
      continue
    }
    const note = remoteNoteToLocal(remote, existing)
    if (!note.path) {
      const folderAbsPath = note.folder ? `${vaultPath}/${note.folder}` : vaultPath
      note.path = `${folderAbsPath}/${slugifyTitle(note.title)}-${note.id.slice(-6)}.md`
    }
    await writeNoteFile(note)
  }

  // 2. Structural: apply the cloud snapshot to disk if that's what won.
  const applyCloudStructural =
    plan.structuralConflict ? resolutions.structural === 'cloud' : plan.structuralCloudChanged
  const structuralToWrite = applyCloudStructural ? plan.remoteStructural : null

  if (structuralToWrite) {
    for (const folder of structuralToWrite.folders) {
      await createFolderDir(`${vaultPath}/${folder.path}`)
    }
    const existingAppData = await readAppData(vaultPath)
    await writeAppData(vaultPath, {
      version: 1,
      tasks: structuralToWrite.tasks,
      boards: structuralToWrite.boards,
      boardColumns: structuralToWrite.boardColumns,
      boardTasks: structuralToWrite.boardTasks,
      noteMeta: existingAppData?.noteMeta ?? {},
      externalFiles: existingAppData?.externalFiles,
    })
    await writeBoardsFile(vaultPath, {
      version: 1,
      boards: structuralToWrite.boards,
      boardColumns: structuralToWrite.boardColumns,
      boardTasks: structuralToWrite.boardTasks,
    })
  }

  // 3. Reload in-memory state from disk so it reflects everything just written.
  const reloaded = await readVaultFS(vaultPath)
  useAppStore.getState().openVault(vaultPath, reloaded)

  // 4. Push to cloud: notes, tombstones, and structural (only if we didn't just pull it).
  await pushNotes(notesToPush)
  await pushDeletedNotes(plan.deletesToPush)
  if (!structuralToWrite) {
    const { folders, tasks, boards, boardColumns, boardTasks } = useAppStore.getState()
    await pushStructural({ folders, tasks, boards, boardColumns, boardTasks })
  }

  // 5. Attachments mirror both ways.
  const manifest = loadManifest(vaultPath)
  const alreadyUploaded = new Set(manifest.uploadedAttachments)
  const newlyUploaded = await pushAttachments(vaultPath, userId, alreadyUploaded)
  const pulledAttachments = await pullAttachments(vaultPath, userId)

  // 6. Record the new sync marker.
  const finalNoteIds = useAppStore.getState().notes.map((n) => n.id)
  const uploadedAttachments = [...new Set([...alreadyUploaded, ...newlyUploaded, ...pulledAttachments])]
  await finalizeSync(vaultPath, finalNoteIds, uploadedAttachments)

  return {
    pushed: notesToPush.length,
    pulled: notesToPull.length,
    deleted: plan.deletesToPush.length,
    attachmentsUploaded: newlyUploaded.length,
    attachmentsDownloaded: pulledAttachments.length,
  }
}

// ── Download & delete: the cloud copy is a mirror the user can pull down or ──
// erase entirely — the point of cloud backup is loss-prevention and device-to-
// device transfer, not permanent cloud residency. These two actions make that
// literal: "download everything" and "leave nothing behind" both work without
// needing the original device or vault.

export interface ExportResult {
  notes: number
  images: number
}

/** Writes every non-deleted note, the structural snapshot, and all images
 *  currently backed up in the cloud into destDir as a plain, openable vault —
 *  no proprietary format, just the same .md + frontmatter layout as any vault. */
export async function exportCloudBackup(destDir: string): Promise<ExportResult> {
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  const { writeTextFile, mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
  await mkdir(destDir, { recursive: true })

  const { data: notes, error: notesErr } = await client
    .from('notes')
    .select('local_id, title, content, folder, tags, pinned, updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
  if (notesErr) throw notesErr

  for (const note of notes ?? []) {
    const folderAbsPath = note.folder ? `${destDir}/${note.folder}` : destDir
    await mkdir(folderAbsPath, { recursive: true })
    const filename = `${slugifyTitle(note.title)}-${note.local_id.slice(-6)}.md`
    const meta: FrontmatterMeta = {
      id: note.local_id,
      created: note.updated_at,
      updated: note.updated_at,
      pinned: note.pinned,
      tags: note.tags,
    }
    await writeTextFile(`${folderAbsPath}/${filename}`, serializeFrontmatter(meta, note.content))
  }

  const { data: structuralRow } = await client
    .from('vault_structural')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle()
  if (structuralRow) {
    const snapshot = structuralRow.data as Omit<StructuralSnapshot, 'updatedAt'>
    await mkdir(`${destDir}/.inkwell`, { recursive: true })
    await writeTextFile(
      `${destDir}/.inkwell/app.json`,
      JSON.stringify(
        { version: 1, tasks: snapshot.tasks, boards: [], boardColumns: [], boardTasks: [], noteMeta: {} },
        null,
        2,
      ),
    )
    await writeTextFile(
      `${destDir}/.inkwell/boards.json`,
      JSON.stringify(
        { version: 1, boards: snapshot.boards, boardColumns: snapshot.boardColumns, boardTasks: snapshot.boardTasks },
        null,
        2,
      ),
    )
  }

  const imageNames = await listRemoteAttachments(userId)
  if (imageNames.length > 0) {
    await mkdir(`${destDir}/assets`, { recursive: true })
    for (const name of imageNames) {
      const bytes = await downloadAttachment(userId, name)
      await writeFile(`${destDir}/assets/${name}`, bytes)
    }
  }

  return { notes: (notes ?? []).length, images: imageNames.length }
}

/** Permanently erases this user's cloud backup — all note rows, the structural
 *  snapshot, and every uploaded image. The local vault on disk is untouched.
 *  Clears the local sync manifest too, since there's nothing left to diff against. */
export async function deleteCloudBackup(vaultPath: string | null): Promise<void> {
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in.')

  const { error: notesErr } = await client.from('notes').delete().eq('user_id', userId)
  if (notesErr) throw notesErr

  const { error: structuralErr } = await client.from('vault_structural').delete().eq('user_id', userId)
  if (structuralErr) throw structuralErr

  const imageNames = await listRemoteAttachments(userId)
  if (imageNames.length > 0) {
    const { error: storageErr } = await client.storage
      .from('attachments')
      .remove(imageNames.map((name) => `${userId}/${name}`))
    if (storageErr) throw storageErr
  }

  if (vaultPath) localStorage.removeItem(manifestKey(vaultPath))
}
