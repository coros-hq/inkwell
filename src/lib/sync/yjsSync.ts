/**
 * Yjs <-> Supabase sync for shared vaults.
 *
 * Design: keep useAppStore's boards/boardColumns/boardTasks arrays as the
 * single source of truth for every component that already reads them. A Yjs
 * doc sits underneath as a sync layer — local mutations get diff-patched into
 * it (pushLocalBoardsState), and remote changes get applied back onto the
 * store via a callback (onRemoteUpdate). Unshared vaults never call anything
 * in this file, so behavior for the local-only case is unchanged.
 *
 * Each board/column/task is stored as a single JSON value keyed by its id in
 * a top-level Y.Map (not as a nested Y.Map per field) — concurrent edits to
 * *different* entities never conflict; concurrent edits to the *same* entity
 * resolve via Yjs's default last-write-wins on that map key. That's a
 * deliberate v1 simplification over field-level merging (see plan Phase 2).
 *
 * Transport: doc_updates is an append-only Postgres table of Yjs binary
 * updates. Outbound updates are inserted directly; inbound updates arrive via
 * a Supabase Realtime postgres_changes subscription, with a catch-up fetch on
 * open to cover anything missed while offline. bytea columns round-trip as
 * Postgres hex-encoded strings ("\xdeadbeef") over both PostgREST and
 * Realtime — see bytesToPgHex/pgHexToBytes. Verify this empirically against
 * the live project during the two-instance manual test (Realtime's bytea
 * encoding isn't contractually documented the way PostgREST's is).
 */
import * as Y from 'yjs'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { getSession } from '../auth'
import { readTeamData } from '../vault'
import { useAppStore } from '../../store/useAppStore'
import type { Board, BoardColumn, BoardTask } from '../../types'

const LOCAL_ORIGIN = 'inkwell-local'
const HYDRATE_ORIGIN = 'inkwell-hydrate'
const SNAPSHOT_THRESHOLD = 200
const DOC_NAME = 'boards'

export interface BoardsState {
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
}

export interface SyncHandle {
  vaultPath: string
  vaultId: string
  userId: string
  doc: Y.Doc
  boardsMap: Y.Map<Board>
  columnsMap: Y.Map<BoardColumn>
  tasksMap: Y.Map<BoardTask>
  channel: RealtimeChannel
  lastAppliedUpdateId: number
  updatesSinceSnapshot: number
}

const handles = new Map<string, SyncHandle>()

export function getSyncHandle(vaultPath: string): SyncHandle | undefined {
  return handles.get(vaultPath)
}

// ── bytea <-> Uint8Array ──────────────────────────────────────────────────────

function bytesToPgHex(bytes: Uint8Array): string {
  let hex = '\\x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function pgHexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ── Doc <-> arrays ─────────────────────────────────────────────────────────────

function extractState(handle: SyncHandle): BoardsState {
  return {
    boards: Array.from(handle.boardsMap.values()),
    boardColumns: Array.from(handle.columnsMap.values()),
    boardTasks: Array.from(handle.tasksMap.values()),
  }
}

function patchYMapFromArray<T extends { id: string }>(yMap: Y.Map<T>, arr: T[]): void {
  const seen = new Set<string>()
  for (const item of arr) {
    seen.add(item.id)
    const existing = yMap.get(item.id)
    if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) {
      yMap.set(item.id, item)
    }
  }
  for (const key of Array.from(yMap.keys())) {
    if (!seen.has(key)) yMap.delete(key)
  }
}

// ── Snapshot compaction ────────────────────────────────────────────────────────

async function maybeCompactSnapshot(handle: SyncHandle): Promise<void> {
  if (handle.updatesSinceSnapshot < SNAPSHOT_THRESHOLD) return
  const snapshot = Y.encodeStateAsUpdate(handle.doc)
  const { error } = await supabase.from('doc_snapshots').upsert({
    vault_id: handle.vaultId,
    doc_name: DOC_NAME,
    snapshot: bytesToPgHex(snapshot),
    up_to_update_id: handle.lastAppliedUpdateId,
    updated_at: new Date().toISOString(),
  })
  if (!error) handle.updatesSinceSnapshot = 0
}

// ── Open / hydrate / subscribe ─────────────────────────────────────────────────

export async function openVaultSync(
  vaultPath: string,
  vaultId: string,
  userId: string,
  onRemoteUpdate: (state: BoardsState) => void,
): Promise<SyncHandle> {
  const existing = handles.get(vaultPath)
  if (existing) return existing

  const doc = new Y.Doc()
  const boardsMap = doc.getMap<Board>('boards')
  const columnsMap = doc.getMap<BoardColumn>('boardColumns')
  const tasksMap = doc.getMap<BoardTask>('boardTasks')

  let lastAppliedUpdateId = 0

  const { data: snapshotRow } = await supabase
    .from('doc_snapshots')
    .select('snapshot, up_to_update_id')
    .eq('vault_id', vaultId)
    .eq('doc_name', DOC_NAME)
    .maybeSingle()

  if (snapshotRow) {
    Y.applyUpdate(doc, pgHexToBytes(snapshotRow.snapshot as string), HYDRATE_ORIGIN)
    lastAppliedUpdateId = snapshotRow.up_to_update_id as number
  }

  const { data: updateRows } = await supabase
    .from('doc_updates')
    .select('id, update')
    .eq('vault_id', vaultId)
    .eq('doc_name', DOC_NAME)
    .gt('id', lastAppliedUpdateId)
    .order('id', { ascending: true })

  for (const row of updateRows ?? []) {
    Y.applyUpdate(doc, pgHexToBytes(row.update as string), HYDRATE_ORIGIN)
    lastAppliedUpdateId = row.id as number
  }

  const handle: SyncHandle = {
    vaultPath, vaultId, userId, doc, boardsMap, columnsMap, tasksMap,
    channel: null as unknown as RealtimeChannel, // set below
    lastAppliedUpdateId,
    updatesSinceSnapshot: updateRows?.length ?? 0,
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) return
    useAppStore.getState().setSyncStatus('syncing')
    supabase
      .from('doc_updates')
      .insert({
        vault_id: handle.vaultId,
        doc_name: DOC_NAME,
        update: bytesToPgHex(update),
        created_by: handle.userId,
      })
      .then(({ error }) => {
        if (error) { console.error('Failed to push board update:', error); useAppStore.getState().setSyncStatus('error'); return }
        handle.updatesSinceSnapshot += 1
        void maybeCompactSnapshot(handle)
        useAppStore.getState().setSyncStatus('synced')
      })
  })

  const channel = supabase
    .channel(`doc_updates:${vaultId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'doc_updates', filter: `vault_id=eq.${vaultId}` },
      (payload) => {
        const row = payload.new as { id: number; doc_name: string; update: string }
        if (row.doc_name !== DOC_NAME) return
        if (row.id <= handle.lastAppliedUpdateId) return // our own write, already applied locally
        Y.applyUpdate(doc, pgHexToBytes(row.update), HYDRATE_ORIGIN)
        handle.lastAppliedUpdateId = row.id
        onRemoteUpdate(extractState(handle))
      },
    )
    .subscribe()

  handle.channel = channel
  handles.set(vaultPath, handle)

  // Deliver the hydrated (possibly empty) state once, synchronously with open,
  // so callers (share/join flow, startup restore) see cloud state immediately.
  onRemoteUpdate(extractState(handle))

  return handle
}

export function closeVaultSync(vaultPath: string): void {
  const handle = handles.get(vaultPath)
  if (!handle) return
  supabase.removeChannel(handle.channel)
  handles.delete(vaultPath)
}

/** Push the current in-memory board state into the shared doc (diff-patch, not wholesale replace). */
export function pushLocalBoardsState(handle: SyncHandle, state: BoardsState): void {
  handle.doc.transact(() => {
    patchYMapFromArray(handle.boardsMap, state.boards)
    patchYMapFromArray(handle.columnsMap, state.boardColumns)
    patchYMapFromArray(handle.tasksMap, state.boardTasks)
  }, LOCAL_ORIGIN)
}

/**
 * Join flow: hydrate a fresh doc from the cloud for a vault the caller doesn't
 * have open locally yet, returning the current board state so it can be
 * written to boards.json before the vault is opened. Thin wrapper over
 * openVaultSync — hydration behavior is identical, this just names the intent.
 */
export async function pullVaultFromCloud(
  vaultPath: string,
  vaultId: string,
  userId: string,
): Promise<BoardsState> {
  let state: BoardsState = { boards: [], boardColumns: [], boardTasks: [] }
  await openVaultSync(vaultPath, vaultId, userId, s => { state = s })
  return state
}

/**
 * If this vault has been shared/joined (.inkwell/team.json present) and the
 * user is signed in, resume its Yjs sync so remote board changes keep
 * flowing in. No-op for local-only vaults or a signed-out user. Called after
 * openVault on startup restore and on every vault switch.
 */
export async function resumeVaultSyncIfShared(vaultPath: string): Promise<void> {
  const team = await readTeamData(vaultPath)
  if (!team) return
  const session = await getSession()
  if (!session) return
  useAppStore.getState().setSharedVault({ vaultId: team.vaultId, teamId: team.teamId })
  await openVaultSync(vaultPath, team.vaultId, session.user.id, ({ boards, boardColumns, boardTasks }) => {
    useAppStore.getState().applyRemoteBoardsUpdate(boards, boardColumns, boardTasks)
  })
  useAppStore.getState().setSyncStatus('synced')
}

// ─── Note content sync (Phase 3) ───────────────────────────────────────────────
// Same machinery as boards, one Y.Doc per open note (doc_name: `note:<id>`),
// holding a single Y.Text for content. Deliberately per-note rather than
// folded into the vault's boards doc — see file header. Notes aren't hydrated
// eagerly for a whole vault; a note's sync doc is opened lazily the first
// time it's edited (see pushNoteContent), which keeps a shared vault with
// many notes from opening dozens of Realtime channels it doesn't need yet.

interface NoteSyncHandle {
  vaultPath: string
  vaultId: string
  noteId: string
  userId: string
  doc: Y.Doc
  text: Y.Text
  channel: RealtimeChannel
  lastAppliedUpdateId: number
  updatesSinceSnapshot: number
}

const noteHandles = new Map<string, NoteSyncHandle>()
const openingNoteSyncs = new Map<string, Promise<NoteSyncHandle>>()

function noteHandleKey(vaultPath: string, noteId: string): string {
  return `${vaultPath}::${noteId}`
}

function noteDocName(noteId: string): string {
  return `note:${noteId}`
}

async function maybeCompactNoteSnapshot(handle: NoteSyncHandle): Promise<void> {
  if (handle.updatesSinceSnapshot < SNAPSHOT_THRESHOLD) return
  const snapshot = Y.encodeStateAsUpdate(handle.doc)
  const { error } = await supabase.from('doc_snapshots').upsert({
    vault_id: handle.vaultId,
    doc_name: noteDocName(handle.noteId),
    snapshot: bytesToPgHex(snapshot),
    up_to_update_id: handle.lastAppliedUpdateId,
    updated_at: new Date().toISOString(),
  })
  if (!error) handle.updatesSinceSnapshot = 0
}

async function openNoteSync(
  vaultPath: string,
  vaultId: string,
  userId: string,
  noteId: string,
  onRemoteUpdate: (content: string) => void,
): Promise<NoteSyncHandle> {
  const key = noteHandleKey(vaultPath, noteId)
  const existing = noteHandles.get(key)
  if (existing) return existing

  const docName = noteDocName(noteId)
  const doc = new Y.Doc()
  const text = doc.getText('content')

  let lastAppliedUpdateId = 0

  const { data: snapshotRow } = await supabase
    .from('doc_snapshots')
    .select('snapshot, up_to_update_id')
    .eq('vault_id', vaultId)
    .eq('doc_name', docName)
    .maybeSingle()

  if (snapshotRow) {
    Y.applyUpdate(doc, pgHexToBytes(snapshotRow.snapshot as string), HYDRATE_ORIGIN)
    lastAppliedUpdateId = snapshotRow.up_to_update_id as number
  }

  const { data: updateRows } = await supabase
    .from('doc_updates')
    .select('id, update')
    .eq('vault_id', vaultId)
    .eq('doc_name', docName)
    .gt('id', lastAppliedUpdateId)
    .order('id', { ascending: true })

  for (const row of updateRows ?? []) {
    Y.applyUpdate(doc, pgHexToBytes(row.update as string), HYDRATE_ORIGIN)
    lastAppliedUpdateId = row.id as number
  }

  const handle: NoteSyncHandle = {
    vaultPath, vaultId, noteId, userId, doc, text,
    channel: null as unknown as RealtimeChannel,
    lastAppliedUpdateId,
    updatesSinceSnapshot: updateRows?.length ?? 0,
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) return
    useAppStore.getState().setSyncStatus('syncing')
    supabase
      .from('doc_updates')
      .insert({ vault_id: handle.vaultId, doc_name: docName, update: bytesToPgHex(update), created_by: handle.userId })
      .then(({ error }) => {
        if (error) { console.error('Failed to push note update:', error); useAppStore.getState().setSyncStatus('error'); return }
        handle.updatesSinceSnapshot += 1
        void maybeCompactNoteSnapshot(handle)
        useAppStore.getState().setSyncStatus('synced')
      })
  })

  const channel = supabase
    .channel(`doc_updates:${vaultId}:${docName}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'doc_updates', filter: `vault_id=eq.${vaultId}` },
      (payload) => {
        const row = payload.new as { id: number; doc_name: string; update: string }
        if (row.doc_name !== docName) return
        if (row.id <= handle.lastAppliedUpdateId) return
        Y.applyUpdate(doc, pgHexToBytes(row.update), HYDRATE_ORIGIN)
        handle.lastAppliedUpdateId = row.id
        onRemoteUpdate(text.toString())
      },
    )
    .subscribe()

  handle.channel = channel
  noteHandles.set(key, handle)
  onRemoteUpdate(text.toString())

  return handle
}

/** Diff old vs new content and apply just the changed span to the Y.Text — naive
 * common-prefix/suffix diff, fine at note-file sizes (no need for a full LCS/
 * diff-match-patch algorithm for v1). */
function pushLocalNoteContent(handle: NoteSyncHandle, content: string): void {
  const current = handle.text.toString()
  if (current === content) return
  handle.doc.transact(() => {
    let start = 0
    const maxStart = Math.min(current.length, content.length)
    while (start < maxStart && current[start] === content[start]) start++
    let endA = current.length
    let endB = content.length
    while (endA > start && endB > start && current[endA - 1] === content[endB - 1]) { endA--; endB-- }
    if (endA > start) handle.text.delete(start, endA - start)
    if (endB > start) handle.text.insert(start, content.slice(start, endB))
  }, LOCAL_ORIGIN)
}

/**
 * Outbound entry point for note edits (called from updateNote when the vault
 * is shared). Lazily opens the note's sync doc on first edit and dedupes
 * concurrent opens for the same note so rapid typing doesn't race multiple
 * hydration fetches.
 */
export function pushNoteContent(vaultPath: string, vaultId: string, noteId: string, content: string): void {
  const key = noteHandleKey(vaultPath, noteId)
  const existing = noteHandles.get(key)
  if (existing) { pushLocalNoteContent(existing, content); return }

  const pending = openingNoteSyncs.get(key)
  if (pending) { pending.then(h => pushLocalNoteContent(h, content)).catch(console.error); return }

  const promise = getSession().then(session => {
    if (!session) throw new Error('Not signed in')
    return openNoteSync(vaultPath, vaultId, session.user.id, noteId, remoteContent => {
      useAppStore.getState().applyRemoteNoteUpdate(noteId, remoteContent)
    })
  })
  openingNoteSyncs.set(key, promise)
  promise
    .then(handle => { openingNoteSyncs.delete(key); pushLocalNoteContent(handle, content) })
    .catch(e => { openingNoteSyncs.delete(key); console.error('Failed to open note sync:', e) })
}
