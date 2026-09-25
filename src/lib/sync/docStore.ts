/**
 * Local persistence for shared-vault sync, under {vault}/.inkwell/sync/:
 *
 *   docs/<docName>.ybin   full Yjs state of each doc as of the last save —
 *                          what lets a device merge its offline edits
 *                          against the last state it synced, instead of
 *                          re-seeding (and duplicating) text from disk
 *   state.json            catch-up cursor, the outbox of updates not yet
 *                          acknowledged by the server, and the bookkeeping
 *                          used to tell offline/external edits apart from
 *                          stale files (see SyncState)
 *
 * The folder is device-local and never synced (it's git-ignored, and hidden
 * from the vault scan like everything under .inkwell/).
 */
import { markSelfWrite } from '../selfWriteRegistry'
import { base64ToBytes, bytesToBase64 } from './codec'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface SyncState {
  version: 1
  /** Highest doc_updates.id applied locally. 0 = never caught up. */
  cursor: number
  /** Local vault structure at the last point it matched the manifest — diffed
   *  against the current structure on startup to recover changes made while
   *  the app was closed. null until the first successful sync. */
  lastLocal: unknown | null
  /** noteId → hash of the note body last written to / read from disk by sync.
   *  A mismatch on startup means the file was edited outside a sync session. */
  diskHashes: Record<string, string>
  /** Vault-relative attachment paths known to be in Storage. */
  uploaded: string[]
  /** docName → base64 merged Yjs update not yet written to doc_updates. */
  outbox: Record<string, string>
}

export function emptySyncState(): SyncState {
  return { version: 1, cursor: 0, lastLocal: null, diskHashes: {}, uploaded: [], outbox: {} }
}

function syncDir(vaultPath: string): string {
  return `${vaultPath}/.inkwell/sync`
}

function docFile(vaultPath: string, docName: string): string {
  // doc names are 'manifest', 'boards', 'note:<id>' — ids are [A-Za-z0-9_-]
  return `${syncDir(vaultPath)}/docs/${docName.replace(/[^A-Za-z0-9_-]/g, '_')}.ybin`
}

export async function readSyncState(vaultPath: string): Promise<SyncState> {
  if (!isTauri) return emptySyncState()
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const path = `${syncDir(vaultPath)}/state.json`
    if (!await exists(path)) return emptySyncState()
    return { ...emptySyncState(), ...(JSON.parse(await readTextFile(path)) as Partial<SyncState>) }
  } catch {
    return emptySyncState()
  }
}

export async function writeSyncState(vaultPath: string, state: SyncState): Promise<void> {
  if (!isTauri) return
  const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const dir = syncDir(vaultPath)
  if (!await exists(dir)) await mkdir(dir, { recursive: true })
  const path = `${dir}/state.json`
  markSelfWrite(path)
  await writeTextFile(path, JSON.stringify(state))
}

export async function readDocState(vaultPath: string, docName: string): Promise<Uint8Array | null> {
  if (!isTauri) return null
  try {
    const { readFile, exists } = await import('@tauri-apps/plugin-fs')
    const path = docFile(vaultPath, docName)
    if (!await exists(path)) return null
    return await readFile(path)
  } catch {
    return null
  }
}

export async function writeDocState(vaultPath: string, docName: string, state: Uint8Array): Promise<void> {
  if (!isTauri) return
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const dir = `${syncDir(vaultPath)}/docs`
  if (!await exists(dir)) await mkdir(dir, { recursive: true })
  const path = docFile(vaultPath, docName)
  markSelfWrite(path)
  await writeFile(path, state)
}

/** Forget all local sync state — used when leaving a shared vault or on revocation. */
export async function clearSyncData(vaultPath: string): Promise<void> {
  if (!isTauri) return
  try {
    const { remove, exists } = await import('@tauri-apps/plugin-fs')
    const dir = syncDir(vaultPath)
    if (await exists(dir)) await remove(dir, { recursive: true })
  } catch (e) {
    console.error('[inkwell:sync] failed to clear sync data:', e)
  }
}

export function encodeOutbox(pending: Map<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, update] of pending) out[name] = bytesToBase64(update)
  return out
}

export function decodeOutbox(outbox: Record<string, string>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const [name, b64] of Object.entries(outbox)) out.set(name, base64ToBytes(b64))
  return out
}
