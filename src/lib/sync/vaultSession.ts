/**
 * Live sync session for a shared vault.
 *
 * Documents (all Yjs):
 *   manifest     vault structure — see manifest.ts
 *   boards       boards / columns / tasks, one JSON value per entity id
 *   note:<id>    a note body as Y.Text
 *
 * Two transport lanes, both over Supabase:
 *   live      Realtime Broadcast on the private channel `vault:<id>` carries
 *             each local Yjs update to online peers immediately. Presence and
 *             cursor awareness use a separate `vault-presence:<id>` channel,
 *             because Realtime authorizes a whole channel at join time and
 *             viewers may send presence but not edits.
 *   durable   local updates are buffered per doc and written to doc_updates
 *             as one merged row per doc every FLUSH_MS. Clients catch up from
 *             that table on start, on reconnect, on focus, on a slow poll,
 *             and when a peer "pokes" after an update too large to broadcast.
 *
 * Offline: each doc's state is saved locally (.inkwell/sync, see docStore.ts)
 * together with the outbox of unacknowledged updates, so edits made offline
 * or across restarts are merged — never re-seeded and never dropped.
 *
 * The store stays the source of truth for the UI. Local changes flow into the
 * docs through a store subscription (structure diffs + note-body diffs);
 * remote changes flow back via applyRemoteNoteUpdate / applyRemoteBoardsUpdate
 * / applyManifestToDisk. The note open in the editor is bound to its Y.Text
 * directly (bindNote → y-codemirror.next) so concurrent typing merges
 * character by character.
 *
 * Local-only vaults (no .inkwell/team.json) never create a session.
 */
import * as Y from 'yjs'
import {
  Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates,
} from 'y-protocols/awareness'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { getSession } from '../auth'
import {
  readTeamData, removeTeamData, writeNoteFile, isEphemeralNoteId, writeTeamData, readVaultFS, addRecentVault,
} from '../vault'
import { genId } from '../id'
import { createSharedVault } from '../team'
import { useAppStore } from '../../store/useAppStore'
import type { Attachment, Board, BoardColumn, BoardTask } from '../../types'
import { base64ToBytes, bytesToBase64, bytesToPgHex, hashText, pgHexToBytes } from './codec'
import {
  clearSyncData, decodeOutbox, encodeOutbox, readDocState, readSyncState, writeDocState,
  writeSyncState, type SyncState,
} from './docStore'
import {
  applyLocalDiff, applyManifestToDisk, getManifestMaps, sameStructure, snapshotStructure,
  type Structure,
} from './manifest'
import { attachmentExistsLocally, downloadAttachment, uploadAttachment } from './attachmentsSync'

const REMOTE = 'inkwell-remote'
const LOAD = 'inkwell-load'

const FLUSH_MS = 1500
const SAVE_MS = 800
const STRUCTURE_MS = 300
const REMOTE_APPLY_MS = 60
const POLL_MS = 30_000
/** Catch-up cadence while the live channel is down, so edits still arrive promptly. */
const DEGRADED_POLL_MS = 5_000
const MAX_BACKOFF_MS = 60_000
const INLINE_BROADCAST_MAX = 64 * 1024
const SNAPSHOT_THRESHOLD = 200
const MAX_CACHED_DOCS = 24
const PAGE_SIZE = 500
const FLUSH_CHUNK_ROWS = 100
const BROADCAST_MS = 40

export type VaultRole = 'owner' | 'editor' | 'viewer'
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'

export interface Peer {
  userId: string
  email: string
  color: string
  noteId: string | null
}

export interface NoteBinding {
  ytext: Y.Text
  awareness: Awareness
  undoManager: Y.UndoManager
  readOnly: boolean
  release: () => void
}

interface DocEntry {
  name: string
  doc: Y.Doc
  pins: number
  lastUsed: number
  dirty: boolean
  sinceSnapshot: number
}

const PEER_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f']

export function colorForUser(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length]
}

function noteDocName(id: string): string {
  return `note:${id}`
}

/** Replace a Y.Text's content with `next`, touching only the changed span. */
function diffIntoText(text: Y.Text, next: string): void {
  const current = text.toString()
  if (current === next) return
  let start = 0
  const maxStart = Math.min(current.length, next.length)
  while (start < maxStart && current[start] === next[start]) start++
  let endA = current.length
  let endB = next.length
  while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) { endA--; endB-- }
  if (endA > start) text.delete(start, endA - start)
  if (endB > start) text.insert(start, next.slice(start, endB))
}

function patchYMapFromArray<T extends { id: string }>(yMap: Y.Map<T>, arr: T[]): void {
  const seen = new Set<string>()
  for (const item of arr) {
    seen.add(item.id)
    const existing = yMap.get(item.id)
    if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) yMap.set(item.id, item)
  }
  for (const key of Array.from(yMap.keys())) {
    if (!seen.has(key)) yMap.delete(key)
  }
}

class VaultSession {
  private state!: SyncState
  private docs = new Map<string, DocEntry>()
  private loading = new Map<string, Promise<DocEntry>>()
  /** docName → local updates not yet acknowledged by doc_updates. */
  private pending = new Map<string, Uint8Array[]>()
  private needPoke = false
  /** Updates waiting for the next coalesced broadcast (BROADCAST_MS). */
  private outgoing = new Map<string, Uint8Array[]>()
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  /** Attachments the manifest references that weren't in Storage yet. */
  private missingAttachments = new Map<string, Attachment>()

  private docChannel: RealtimeChannel | null = null
  private presenceChannel: RealtimeChannel | null = null
  private docChannelLive = false
  private presenceLive = false
  private wasDisconnected = false

  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private structureTimer: ReturnType<typeof setTimeout> | null = null
  private remoteTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private backoffMs = 0
  private flushing: Promise<void> | null = null
  private catchingUp: Promise<void> | null = null
  private catchUpAgain = false
  private remoteChain: Promise<void> = Promise.resolve()
  private remoteDirty = new Set<string>()
  private unsubscribeStore: (() => void) | null = null
  private awarenesses = new Map<string, Awareness>()
  private currentNoteId: string | null = null
  private closed = false

  private readonly onFocus = () => { void this.catchUp() }
  private readonly onOnline = () => { void this.catchUp().then(() => this.flush()) }

  constructor(
    readonly vaultPath: string,
    readonly vaultId: string,
    readonly userId: string,
    readonly email: string,
    public role: VaultRole,
  ) {}

  get canEdit(): boolean {
    return this.role !== 'viewer'
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    setStatus('syncing')
    this.state = await readSyncState(this.vaultPath)
    for (const [name, update] of decodeOutbox(this.state.outbox)) this.pending.set(name, [update])

    const manifest = await this.loadDoc('manifest')
    const boards = await this.loadDoc('boards')
    manifest.pins++
    boards.pins++

    if (this.canEdit) await this.recordOfflineChanges()

    await this.connect()
    try {
      await this.catchUp()
    } catch (e) {
      console.warn('[inkwell:sync] initial catch-up failed, continuing offline:', e)
      setStatus('offline')
    }
    if (this.closed) return

    // Whatever catch-up brought in, make sure disk + store reflect the merged state.
    this.remoteDirty.add('manifest')
    this.remoteDirty.add('boards')
    await this.processRemote()

    this.unsubscribeStore = useAppStore.subscribe((s, prev) => this.onStoreChange(s, prev))
    let lastPoll = Date.now()
    this.pollTimer = setInterval(() => {
      const due = this.docChannelLive ? POLL_MS : DEGRADED_POLL_MS
      if (Date.now() - lastPoll < due) return
      lastPoll = Date.now()
      void this.catchUp().catch(() => {})
    }, DEGRADED_POLL_MS)
    window.addEventListener('focus', this.onFocus)
    window.addEventListener('online', this.onOnline)

    await this.flush()
    if (!this.pending.size && this.docChannelLive) setStatus('synced')
  }

  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    window.removeEventListener('focus', this.onFocus)
    window.removeEventListener('online', this.onOnline)
    this.unsubscribeStore?.()
    for (const t of [this.flushTimer, this.saveTimer, this.structureTimer, this.remoteTimer, this.broadcastTimer]) if (t) clearTimeout(t)
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const [noteId, aw] of this.awarenesses) {
      removeAwarenessStates(aw, [aw.clientID], 'local')
      aw.destroy()
      this.awarenesses.delete(noteId)
    }
    try {
      await this.flushOnce()
    } catch { /* outbox is persisted below — it'll go out next session */ }
    await this.saveNow().catch(console.error)
    if (this.docChannel) supabase.removeChannel(this.docChannel)
    if (this.presenceChannel) supabase.removeChannel(this.presenceChannel)
    for (const e of this.docs.values()) e.doc.destroy()
    this.docs.clear()
  }

  // ── Docs ───────────────────────────────────────────────────────────────────

  private loadDoc(name: string): Promise<DocEntry> {
    const existing = this.docs.get(name)
    if (existing) {
      existing.lastUsed = Date.now()
      return Promise.resolve(existing)
    }
    const inflight = this.loading.get(name)
    if (inflight) return inflight

    const promise = (async () => {
      const doc = new Y.Doc()
      const saved = await readDocState(this.vaultPath, name)
      if (saved) Y.applyUpdate(doc, saved, LOAD)
      // Outbox updates are applied too: if the app died after persisting the
      // outbox but before the doc state, they'd otherwise be missing locally.
      for (const u of this.pending.get(name) ?? []) Y.applyUpdate(doc, u, LOAD)

      const entry: DocEntry = { name, doc, pins: 0, lastUsed: Date.now(), dirty: false, sinceSnapshot: 0 }
      doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(entry, update, origin))
      this.docs.set(name, entry)
      this.loading.delete(name)
      return entry
    })()
    this.loading.set(name, promise)
    return promise
  }

  private hasLocalDoc(name: string): Promise<boolean> {
    if (this.docs.has(name)) return Promise.resolve(true)
    return readDocState(this.vaultPath, name).then(s => s !== null)
  }

  private onDocUpdate(entry: DocEntry, update: Uint8Array, origin: unknown): void {
    entry.dirty = true
    this.scheduleSave()
    if (origin === LOAD) return
    if (origin === REMOTE) {
      this.remoteDirty.add(entry.name)
      this.scheduleRemote()
      return
    }
    if (!this.canEdit) return
    const list = this.pending.get(entry.name) ?? []
    list.push(update)
    this.pending.set(entry.name, list)
    this.broadcastUpdate(entry.name, update)
    this.scheduleFlush(FLUSH_MS)
  }

  private evictIdleDocs(): void {
    if (this.docs.size <= MAX_CACHED_DOCS) return
    const idle = [...this.docs.values()]
      .filter(e => e.pins === 0 && !e.dirty && !this.remoteDirty.has(e.name))
      .sort((a, b) => a.lastUsed - b.lastUsed)
    for (const e of idle.slice(0, this.docs.size - MAX_CACHED_DOCS)) {
      e.doc.destroy()
      this.docs.delete(e.name)
    }
  }

  // ── Local → docs ───────────────────────────────────────────────────────────

  /**
   * Fold in whatever changed on this device while no session was running:
   * structure changes (diffed against the last synced structure) and note
   * bodies whose file no longer matches what sync last wrote/read.
   * Runs BEFORE catch-up, so these land as concurrent edits and merge with
   * remote ones instead of overwriting them.
   */
  private async recordOfflineChanges(): Promise<void> {
    const store = useAppStore.getState()

    // Notes read from files without an `id:` get a fresh random id per read —
    // pin them down before they become shared identities.
    for (const n of store.notes) {
      if (!n.external && isEphemeralNoteId(n.id)) await writeNoteFile(n)
    }

    const now = snapshotStructure(store.notes, store.folders)
    const prev = this.state.lastLocal as Structure | null
    const manifest = this.docs.get('manifest')!
    let newIds: string[] = []
    manifest.doc.transact(() => {
      newIds = applyLocalDiff(getManifestMaps(manifest.doc), prev, now)
    })
    this.state.lastLocal = now

    const newSet = new Set(newIds)
    for (const n of store.notes) {
      if (n.external || !now.notes[n.id]) continue
      const name = noteDocName(n.id)
      const known = this.state.diskHashes[n.id]
      if (newSet.has(n.id)) {
        const e = await this.loadDoc(name)
        const text = e.doc.getText('content')
        if (text.length === 0 && n.content) e.doc.transact(() => text.insert(0, n.content))
      } else if (known !== undefined && known !== hashText(n.content) && await this.hasLocalDoc(name)) {
        const e = await this.loadDoc(name)
        e.doc.transact(() => diffIntoText(e.doc.getText('content'), n.content))
      } else {
        continue
      }
      this.state.diskHashes[n.id] = hashText(n.content)
    }

    // Boards: the first sync seeds the doc; later ones record offline edits.
    const boards = this.docs.get('boards')!
    if (this.state.cursor === 0 || (await readDocState(this.vaultPath, 'boards')) !== null) {
      this.pushBoards({ boards: store.boards, boardColumns: store.boardColumns, boardTasks: store.boardTasks }, boards)
    }
    this.scheduleSave()
  }

  private onStoreChange(s: ReturnType<typeof useAppStore.getState>, prev: ReturnType<typeof useAppStore.getState>): void {
    if (this.closed || s.vaultPath !== this.vaultPath || !this.canEdit) return
    if (s.notes === prev.notes && s.folders === prev.folders) return

    if (s.notes !== prev.notes) {
      const before = new Map(prev.notes.map(n => [n.id, n.content]))
      for (const n of s.notes) {
        if (n.external) continue
        const old = before.get(n.id)
        if (old !== undefined && old !== n.content) this.pushNoteContent(n.id)
      }
    }

    if (this.structureTimer) clearTimeout(this.structureTimer)
    this.structureTimer = setTimeout(() => this.pushStructure(), STRUCTURE_MS)
  }

  private pushNoteContent(noteId: string): void {
    const apply = (e: DocEntry) => {
      const note = useAppStore.getState().notes.find(n => n.id === noteId)
      if (!note) return
      e.doc.transact(() => diffIntoText(e.doc.getText('content'), note.content))
      this.state.diskHashes[noteId] = hashText(note.content)
    }
    // Synchronous when the doc is already loaded (the common case: the note
    // being typed in), so a remote update can't slip in between the store
    // change and the doc write.
    const loaded = this.docs.get(noteDocName(noteId))
    if (loaded) { loaded.lastUsed = Date.now(); apply(loaded); return }
    this.loadDoc(noteDocName(noteId)).then(apply).catch(console.error)
  }

  private pushStructure(): void {
    if (this.structureTimer) { clearTimeout(this.structureTimer); this.structureTimer = null }
    if (this.closed || !this.canEdit) return
    const s = useAppStore.getState()
    const next = snapshotStructure(s.notes, s.folders)
    const prev = this.state.lastLocal as Structure | null
    if (sameStructure(prev, next)) return

    const manifest = this.docs.get('manifest')!
    let newIds: string[] = []
    manifest.doc.transact(() => {
      newIds = applyLocalDiff(getManifestMaps(manifest.doc), prev, next)
    })
    this.state.lastLocal = next
    this.scheduleSave()

    for (const id of newIds) {
      this.loadDoc(noteDocName(id)).then(e => {
        const note = useAppStore.getState().notes.find(n => n.id === id)
        const text = e.doc.getText('content')
        if (note?.content && text.length === 0) e.doc.transact(() => text.insert(0, note.content))
      }).catch(console.error)
    }

    void this.uploadNewAttachments(next)
  }

  pushBoards(state: { boards: Board[]; boardColumns: BoardColumn[]; boardTasks: BoardTask[] }, entry = this.docs.get('boards')): void {
    if (!entry || !this.canEdit) return
    entry.doc.transact(() => {
      patchYMapFromArray(entry.doc.getMap<Board>('boards'), state.boards)
      patchYMapFromArray(entry.doc.getMap<BoardColumn>('boardColumns'), state.boardColumns)
      patchYMapFromArray(entry.doc.getMap<BoardTask>('boardTasks'), state.boardTasks)
    })
  }

  private async uploadNewAttachments(structure: Structure): Promise<void> {
    const uploaded = new Set(this.state.uploaded)
    for (const entry of Object.values(structure.notes)) {
      for (const a of entry.attachments) {
        if (uploaded.has(a.path)) continue
        if (!await attachmentExistsLocally(this.vaultPath, a.path)) continue
        try {
          await uploadAttachment(this.vaultPath, this.vaultId, a.path)
          uploaded.add(a.path)
          this.state.uploaded = [...uploaded]
          this.scheduleSave()
        } catch (e) {
          console.warn('[inkwell:sync] attachment upload failed, will retry:', a.path, e)
        }
      }
    }
  }

  // ── Docs → local ───────────────────────────────────────────────────────────

  private scheduleRemote(): void {
    if (this.remoteTimer) return
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null
      void this.processRemote()
    }, REMOTE_APPLY_MS)
  }

  /** Serialized: never two manifest applications racing on the filesystem. */
  private processRemote(): Promise<void> {
    this.remoteChain = this.remoteChain.then(() => this.applyRemote()).catch(e => {
      console.error('[inkwell:sync] applying remote changes failed:', e)
    })
    return this.remoteChain
  }

  private async applyRemote(): Promise<void> {
    if (this.closed) return
    const dirty = [...this.remoteDirty]
    this.remoteDirty.clear()
    const store = useAppStore.getState()
    if (store.vaultPath !== this.vaultPath) return

    if (dirty.includes('boards')) {
      const b = this.docs.get('boards')!.doc
      store.applyRemoteBoardsUpdate(
        [...b.getMap<Board>('boards').values()],
        [...b.getMap<BoardColumn>('boardColumns').values()],
        [...b.getMap<BoardTask>('boardTasks').values()],
      )
    }

    if (dirty.includes('manifest')) {
      // Record any local structure change still in its debounce window first —
      // otherwise the refresh below would fold it into the baseline unshared.
      this.pushStructure()
      const maps = getManifestMaps(this.docs.get('manifest')!.doc)
      await applyManifestToDisk({
        vaultPath: this.vaultPath,
        maps,
        noteText: async id => (await this.loadDoc(noteDocName(id))).doc.getText('content').toString(),
        onNoteWritten: (id, text) => { this.state.diskHashes[id] = hashText(text) },
        ensureAttachment: a => this.ensureAttachment(a),
      })
      // The store now mirrors the manifest; make that the diff baseline so the
      // refresh isn't echoed back as a local change.
      const after = useAppStore.getState()
      this.state.lastLocal = snapshotStructure(after.notes, after.folders)
      this.scheduleSave()
    }

    for (const name of dirty) {
      if (!name.startsWith('note:')) continue
      const id = name.slice(5)
      const entry = this.docs.get(name)
      const note = useAppStore.getState().notes.find(n => n.id === id)
      if (!entry || !note) continue // not materialized yet — the manifest pass writes it
      const text = entry.doc.getText('content').toString()
      if (note.content !== text) useAppStore.getState().applyRemoteNoteUpdate(id, text)
      this.state.diskHashes[id] = hashText(text)
      this.scheduleSave()
    }

    this.evictIdleDocs()
  }

  private async ensureAttachment(a: Attachment): Promise<void> {
    if (await attachmentExistsLocally(this.vaultPath, a.path)) {
      this.missingAttachments.delete(a.path)
      return
    }
    const ok = await downloadAttachment(this.vaultPath, this.vaultId, a.path)
    if (!ok) {
      // Probably still uploading from the other device — retried on each catch-up.
      this.missingAttachments.set(a.path, a)
      return
    }
    this.missingAttachments.delete(a.path)
    if (!this.state.uploaded.includes(a.path)) {
      this.state.uploaded = [...this.state.uploaded, a.path]
      this.scheduleSave()
    }
  }

  private async retryMissingAttachments(): Promise<void> {
    for (const a of [...this.missingAttachments.values()]) {
      await this.ensureAttachment(a).catch(() => {})
    }
  }

  // ── Transport: live lane ───────────────────────────────────────────────────

  private async connect(): Promise<void> {
    // Private channels are authorized with the user's JWT (realtime.messages
    // policies). Without this the join happens as anon and is rejected with
    // "You do not have permissions to read from this Topic".
    await supabase.realtime.setAuth().catch(e => console.warn('[inkwell:sync] realtime setAuth failed:', e))
    if (this.closed) return

    this.docChannel = supabase
      .channel(`vault:${this.vaultId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'u' }, ({ payload }) => {
        const { d, u } = payload as { d: string; u: string }
        this.loadDoc(d).then(e => Y.applyUpdate(e.doc, base64ToBytes(u), REMOTE)).catch(console.error)
      })
      .on('broadcast', { event: 'poke' }, () => { void this.catchUp() })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          this.docChannelLive = true
          if (this.wasDisconnected) {
            this.wasDisconnected = false
            void this.catchUp().then(() => this.flush())
          }
          if (!this.pending.size) setStatus('synced')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (status !== 'CLOSED' || !this.closed) {
            console.warn(`[inkwell:sync] live channel ${status}${err ? `: ${err.message}` : ''} — falling back to polling`)
          }
          this.docChannelLive = false
          this.wasDisconnected = true
          if (!this.closed) {
            setStatus('offline')
            void this.checkAccess()
          }
        }
      })

    this.presenceChannel = supabase
      .channel(`vault-presence:${this.vaultId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: `${this.userId}:${Math.random().toString(36).slice(2, 8)}` } },
      })
      .on('presence', { event: 'sync' }, () => this.publishPeers())
      .on('presence', { event: 'join' }, () => this.rebroadcastAwareness())
      .on('broadcast', { event: 'aw' }, ({ payload }) => {
        const { d, u } = payload as { d: string; u: string }
        const aw = this.awarenesses.get(d)
        if (aw) applyAwarenessUpdate(aw, base64ToBytes(u), 'remote')
      })
      .on('broadcast', { event: 'aw-req' }, ({ payload }) => {
        const { d } = payload as { d: string }
        const aw = this.awarenesses.get(d)
        if (aw) this.sendAwareness(d, aw, [aw.clientID])
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[inkwell:sync] presence channel ${status}${err ? `: ${err.message}` : ''}`)
        }
        this.presenceLive = status === 'SUBSCRIBED'
        if (this.presenceLive) void this.trackPresence()
      })
  }

  /** Coalesces a burst of keystrokes into one broadcast per doc every BROADCAST_MS. */
  private broadcastUpdate(name: string, update: Uint8Array): void {
    if (!this.docChannelLive || !this.docChannel) return
    const list = this.outgoing.get(name) ?? []
    list.push(update)
    this.outgoing.set(name, list)
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const batch = [...this.outgoing.entries()]
      this.outgoing.clear()
      if (!this.docChannelLive || !this.docChannel) { this.needPoke = true; return }
      for (const [d, updates] of batch) {
        const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates)
        if (merged.byteLength > INLINE_BROADCAST_MAX) {
          // Too big for a broadcast frame — peers fetch it from doc_updates once flushed.
          this.needPoke = true
          continue
        }
        this.docChannel.send({ type: 'broadcast', event: 'u', payload: { d, u: bytesToBase64(merged) } })
          .catch(() => { this.needPoke = true })
      }
    }, BROADCAST_MS)
  }

  // ── Transport: durable lane ────────────────────────────────────────────────

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delay)
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.flushOnce()
      .then(() => {
        this.backoffMs = 0
        if (this.pending.size) this.scheduleFlush(FLUSH_MS)
        else if (this.docChannelLive) setStatus('synced')
      })
      .catch(async (e: { code?: string; message?: string }) => {
        console.warn('[inkwell:sync] flush failed:', e?.message ?? e)
        if (e?.code === '42501') {
          await this.checkAccess()
          return
        }
        setStatus(navigator.onLine ? 'error' : 'offline')
        this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs ? this.backoffMs * 2 : 2000)
        this.scheduleFlush(this.backoffMs)
      })
      .finally(() => { this.flushing = null })
    return this.flushing
  }

  private async flushOnce(): Promise<void> {
    if (!this.pending.size || !this.canEdit) return
    setStatus('syncing')
    const batch = [...this.pending.entries()].map(([name, updates]) => ({
      name,
      count: updates.length,
      merged: updates.length === 1 ? updates[0] : Y.mergeUpdates(updates),
    }))
    // Chunked so a first share of a large vault doesn't become one giant request.
    for (let i = 0; i < batch.length; i += FLUSH_CHUNK_ROWS) {
      const chunk = batch.slice(i, i + FLUSH_CHUNK_ROWS)
      const { error } = await supabase.from('doc_updates').insert(
        chunk.map(b => ({
          vault_id: this.vaultId,
          doc_name: b.name,
          update: bytesToPgHex(b.merged),
          created_by: this.userId,
        })),
      )
      if (error) throw error

      for (const b of chunk) {
        const rest = (this.pending.get(b.name) ?? []).slice(b.count)
        if (rest.length) this.pending.set(b.name, rest)
        else this.pending.delete(b.name)
        const e = this.docs.get(b.name)
        if (e) e.sinceSnapshot++
      }
      this.scheduleSave()
    }

    if (this.needPoke && this.docChannel && this.docChannelLive) {
      this.needPoke = false
      this.docChannel.send({ type: 'broadcast', event: 'poke', payload: {} }).catch(() => {})
    }
    void this.compactSnapshots()
  }

  /** Pull every doc_updates row after our cursor (and snapshots on first sync). */
  catchUp(): Promise<void> {
    if (this.catchingUp) {
      this.catchUpAgain = true
      return this.catchingUp
    }
    this.catchingUp = (async () => {
      do {
        this.catchUpAgain = false
        await this.catchUpOnce()
      } while (this.catchUpAgain && !this.closed)
    })().finally(() => { this.catchingUp = null })
    return this.catchingUp
  }

  private async catchUpOnce(): Promise<void> {
    if (this.closed) return
    const covered = new Map<string, number>()
    const initial = this.state.cursor === 0

    if (this.state.cursor === 0) {
      const { data, error } = await supabase
        .from('doc_snapshots')
        .select('doc_name, snapshot, up_to_update_id')
        .eq('vault_id', this.vaultId)
      if (error) throw error
      for (const row of data ?? []) {
        const e = await this.loadDoc(row.doc_name as string)
        Y.applyUpdate(e.doc, pgHexToBytes(row.snapshot as string), REMOTE)
        covered.set(row.doc_name as string, row.up_to_update_id as number)
      }
    }

    for (;;) {
      const { data, error } = await supabase
        .from('doc_updates')
        .select('id, doc_name, update')
        .eq('vault_id', this.vaultId)
        .gt('id', this.state.cursor)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (error) throw error
      const rows = data ?? []
      for (const row of rows) {
        const name = row.doc_name as string
        const id = row.id as number
        if ((covered.get(name) ?? 0) < id) {
          const e = await this.loadDoc(name)
          Y.applyUpdate(e.doc, pgHexToBytes(row.update as string), REMOTE)
          e.sinceSnapshot++
        }
        this.state.cursor = id
      }
      if (rows.length) {
        if (initial) setProgress(rows.length)
        this.scheduleSave()
      }
      if (rows.length < PAGE_SIZE) break
    }
    if (initial) setProgress(null)
    if (this.missingAttachments.size) void this.retryMissingAttachments()
  }

  /** Any editor may compact a busy doc; the snapshot covers everything ≤ cursor. */
  private async compactSnapshots(): Promise<void> {
    for (const e of this.docs.values()) {
      if (e.sinceSnapshot < SNAPSHOT_THRESHOLD) continue
      e.sinceSnapshot = 0
      const { error } = await supabase.from('doc_snapshots').upsert({
        vault_id: this.vaultId,
        doc_name: e.name,
        snapshot: bytesToPgHex(Y.encodeStateAsUpdate(e.doc)),
        up_to_update_id: this.state.cursor,
        updated_at: new Date().toISOString(),
      })
      if (error) console.warn('[inkwell:sync] snapshot failed:', error.message)
    }
  }

  // ── Local persistence ──────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow().catch(console.error)
    }, SAVE_MS)
  }

  private async saveNow(): Promise<void> {
    const merged = new Map<string, Uint8Array>()
    for (const [name, updates] of this.pending) {
      merged.set(name, updates.length === 1 ? updates[0] : Y.mergeUpdates(updates))
    }
    this.state.outbox = encodeOutbox(merged)
    // Outbox first: if we die between the two writes, the next start re-sends
    // the outbox and catch-up restores the doc. The reverse order could leave
    // an edit in the local doc that never reaches the server.
    await writeSyncState(this.vaultPath, this.state)
    for (const e of this.docs.values()) {
      if (!e.dirty) continue
      e.dirty = false
      await writeDocState(this.vaultPath, e.name, Y.encodeStateAsUpdate(e.doc))
    }
    if (!this.closed) this.evictIdleDocs()
  }

  // ── Access ─────────────────────────────────────────────────────────────────

  /** Re-read our role; handles revocation and role changes made by the owner. */
  async checkAccess(): Promise<void> {
    if (this.closed) return
    const { data, error } = await supabase.rpc('vault_role', { p_vault: this.vaultId })
    if (error) return // offline or transient — keep going
    const role = data as VaultRole | null
    if (!role) {
      await revokeLocalAccess(this.vaultPath)
      return
    }
    if (role !== this.role) {
      this.role = role
      const shared = useAppStore.getState().sharedVault
      if (shared) useAppStore.getState().setSharedVault({ ...shared, role })
    }
  }

  // ── Presence & awareness ───────────────────────────────────────────────────

  private async trackPresence(): Promise<void> {
    if (!this.presenceChannel || !this.presenceLive) return
    await this.presenceChannel.track({
      userId: this.userId,
      email: this.email,
      color: colorForUser(this.userId),
      noteId: this.currentNoteId,
    }).catch(() => {})
  }

  private publishPeers(): void {
    if (!this.presenceChannel) return
    const state = this.presenceChannel.presenceState<Peer>()
    const byUser = new Map<string, Peer>()
    for (const metas of Object.values(state)) {
      for (const m of metas) {
        if (m.userId === this.userId) continue
        // One avatar per person; prefer the device that has a note open.
        const prev = byUser.get(m.userId)
        if (!prev || (!prev.noteId && m.noteId)) {
          byUser.set(m.userId, { userId: m.userId, email: m.email, color: m.color, noteId: m.noteId })
        }
      }
    }
    useAppStore.getState().setPeers([...byUser.values()])
  }

  private sendAwareness(noteId: string, aw: Awareness, clients: number[]): void {
    if (!this.presenceChannel || !this.presenceLive) return
    this.presenceChannel.send({
      type: 'broadcast',
      event: 'aw',
      payload: { d: noteId, u: bytesToBase64(encodeAwarenessUpdate(aw, clients)) },
    }).catch(() => {})
  }

  private rebroadcastAwareness(): void {
    for (const [noteId, aw] of this.awarenesses) this.sendAwareness(noteId, aw, [aw.clientID])
  }

  /** Bind the editor to a note's live Y.Text. Call release() on unmount. */
  async bindNote(noteId: string): Promise<NoteBinding> {
    const entry = await this.loadDoc(noteDocName(noteId))
    entry.pins++
    const ytext = entry.doc.getText('content')

    // The store and the doc should agree already; if the doc was never seeded
    // (a note that predates the share and hasn't been diffed in yet), seed it.
    const note = useAppStore.getState().notes.find(n => n.id === noteId)
    if (note && this.canEdit && ytext.length === 0 && note.content) {
      entry.doc.transact(() => ytext.insert(0, note.content))
    } else if (note && note.content !== ytext.toString()) {
      useAppStore.getState().applyRemoteNoteUpdate(noteId, ytext.toString())
    }

    let aw = this.awarenesses.get(noteId)
    if (!aw) {
      aw = new Awareness(entry.doc)
      this.awarenesses.set(noteId, aw)
      const color = colorForUser(this.userId)
      aw.setLocalStateField('user', { name: this.email.split('@')[0], color, colorLight: `${color}33` })
      const awRef = aw
      aw.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin !== 'local') return
        this.sendAwareness(noteId, awRef, [...added, ...updated, ...removed])
      })
      this.presenceChannel?.send({ type: 'broadcast', event: 'aw-req', payload: { d: noteId } }).catch(() => {})
    }

    const undoManager = new Y.UndoManager(ytext)
    this.currentNoteId = noteId
    void this.trackPresence()

    const awareness = aw
    return {
      ytext,
      awareness,
      undoManager,
      readOnly: !this.canEdit,
      release: () => {
        undoManager.destroy()
        entry.pins = Math.max(0, entry.pins - 1)
        if (entry.pins === 0) {
          removeAwarenessStates(awareness, [awareness.clientID], 'local')
          awareness.destroy()
          this.awarenesses.delete(noteId)
        }
        if (this.currentNoteId === noteId) {
          this.currentNoteId = null
          void this.trackPresence()
        }
      },
    }
  }
}

// ── Module API ───────────────────────────────────────────────────────────────

let active: VaultSession | null = null
let starting: Promise<void> | null = null

function setStatus(status: SyncStatus): void {
  if (!active) return
  const store = useAppStore.getState()
  if (store.syncStatus !== status) store.setSyncStatus(status)
}

function setProgress(rows: number | null): void {
  useAppStore.getState().setSyncProgress(rows === null ? null : (useAppStore.getState().syncProgress ?? 0) + rows)
}

export function getVaultSession(vaultPath?: string | null): VaultSession | null {
  if (!active || active.vaultPath !== (vaultPath ?? active.vaultPath)) return null
  return active
}

/**
 * Start syncing `vaultPath` if it is linked to a cloud vault (.inkwell/team.json)
 * and the user is signed in. Stops any session for another vault first.
 * No-op for local-only vaults.
 */
export async function startVaultSync(vaultPath: string): Promise<void> {
  if (starting) await starting.catch(() => {})
  if (active?.vaultPath === vaultPath) return
  starting = (async () => {
    await stopVaultSync()
    const team = await readTeamData(vaultPath)
    if (!team) return
    const session = await getSession().catch(() => null)
    if (!session) {
      useAppStore.getState().setSharedVault({ vaultId: team.vaultId, teamId: team.teamId, role: team.role ?? 'editor' })
      useAppStore.getState().setSyncStatus('offline')
      return
    }

    let role: VaultRole = team.role ?? 'editor'
    const { data, error } = await supabase.rpc('vault_role', { p_vault: team.vaultId })
    if (!error) {
      if (!data) {
        await revokeLocalAccess(vaultPath)
        return
      }
      role = data as VaultRole
    }

    if (useAppStore.getState().vaultPath !== vaultPath) return
    useAppStore.getState().setSharedVault({ vaultId: team.vaultId, teamId: team.teamId, role })
    const s = new VaultSession(vaultPath, team.vaultId, session.user.id, session.user.email ?? '', role)
    active = s
    await s.start()
  })()
  try {
    await starting
  } finally {
    starting = null
  }
}

export async function stopVaultSync(): Promise<void> {
  const s = active
  active = null
  useAppStore.getState().setSharedVault(null)
  useAppStore.getState().setPeers([])
  if (s) await s.stop()
}

/** Owner removed us (or the vault was deleted): unlink the folder, keep the files. */
async function revokeLocalAccess(vaultPath: string): Promise<void> {
  if (active?.vaultPath === vaultPath) await stopVaultSync()
  await removeTeamData(vaultPath)
  await clearSyncData(vaultPath)
  useAppStore.getState().setCollabNotice(
    'Your access to this shared vault was removed. Your local copy is kept, but it no longer syncs.',
  )
}

/** Leave a shared vault on this device: stop syncing, keep the files. */
export async function leaveVaultOnThisDevice(vaultPath: string): Promise<void> {
  if (active?.vaultPath === vaultPath) await stopVaultSync()
  await removeTeamData(vaultPath)
  await clearSyncData(vaultPath)
}

/**
 * Share the open vault: create the cloud record (the caller becomes its
 * owner), link the folder to it and start syncing — the session's first run
 * uploads every note, folder and board.
 */
export async function shareVault(vaultPath: string, teamId: string | null): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('Sign in first (Settings → Team).')
  const name = vaultPath.split('/').pop() || 'Vault'
  const vault = await createSharedVault(teamId, name, genId('vault'), session.user.id)
  await stopVaultSync()
  await clearSyncData(vaultPath) // never reuse state from an earlier share of this folder
  await writeTeamData(vaultPath, { vaultId: vault.id, teamId, sharedAt: new Date().toISOString(), role: 'owner' })
  await startVaultSync(vaultPath)
}

/** True if the folder already contains notes or subfolders. */
export async function folderHasContent(path: string): Promise<boolean> {
  const data = await readVaultFS(path)
  return !!data && (data.notes.length > 0 || data.folders.length > 0)
}

/**
 * Link a local folder to a cloud vault and open it. The sync session (started
 * by AppShell when the vault opens) downloads everything into the folder.
 */
export async function joinVaultInto(
  path: string,
  vault: { id: string; team_id: string | null },
  role: VaultRole,
): Promise<void> {
  await clearSyncData(path)
  await writeTeamData(path, { vaultId: vault.id, teamId: vault.team_id, sharedAt: new Date().toISOString(), role })
  const data = await readVaultFS(path)
  addRecentVault(path)
  useAppStore.getState().openVault(path, data ?? { folders: [], notes: [], tasks: [], boards: [], boardColumns: [], boardTasks: [] })
}
