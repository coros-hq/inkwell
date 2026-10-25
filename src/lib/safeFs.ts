/**
 * safeFs.ts — crash-tolerant file primitives for vault data.
 *
 *  - writeFileAtomic: write to a sibling temp file, then rename over the
 *    target. A crash mid-write leaves the old file intact instead of a
 *    truncated one. Writes to the same path are serialized and coalesced
 *    (latest content wins), so overlapping saves can never land out of order.
 *  - writeJsonAtomic / readJsonResilient: JSON state files additionally keep
 *    a `.bak` of the last good version; a file that fails to parse is
 *    preserved as `.corrupt-<ts>` and the backup is used instead of silently
 *    treating the data as empty.
 *  - moveToTrash: deletes go to `.inkwell/trash/` rather than being erased.
 *  - write failures are reported through onWriteError so the UI can show them.
 */

import { markSelfWrite } from './selfWriteRegistry'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const TMP_SUFFIX = '.inkwell-tmp'
const BAK_SUFFIX = '.bak'

// ── Write-error reporting ─────────────────────────────────────────────────────

type WriteErrorListener = (path: string, error: unknown) => void
const errorListeners = new Set<WriteErrorListener>()

export function onWriteError(cb: WriteErrorListener): () => void {
  errorListeners.add(cb)
  return () => { errorListeners.delete(cb) }
}

function reportWriteError(path: string, error: unknown) {
  console.error('[inkwell] write failed:', path, error)
  for (const cb of errorListeners) {
    try { cb(path, error) } catch { /* listener bugs must not break saving */ }
  }
}

// ── Atomic, serialized writes ─────────────────────────────────────────────────

interface WriteState {
  running: boolean
  pending: { content: string; keepBackup: boolean; waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> } | null
}
const writeStates = new Map<string, WriteState>()

async function doAtomicWrite(path: string, content: string, keepBackup: boolean): Promise<void> {
  const { writeTextFile, rename, exists, copyFile } = await import('@tauri-apps/plugin-fs')
  const tmp = path + TMP_SUFFIX
  markSelfWrite(path)
  markSelfWrite(tmp)
  if (keepBackup && await exists(path)) {
    // Only promote the current file to .bak if it is still valid JSON, so a
    // corrupt file can never overwrite the last good backup.
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      JSON.parse(await readTextFile(path))
      markSelfWrite(path + BAK_SUFFIX)
      await copyFile(path, path + BAK_SUFFIX)
    } catch { /* current file unreadable/invalid: keep the existing .bak */ }
  }
  await writeTextFile(tmp, content)
  await rename(tmp, path)
}

/**
 * Atomically replace `path` with `content`. Concurrent calls for one path are
 * queued; while a write is in flight only the newest queued content is kept.
 * Rejects (after reporting via onWriteError) if the write fails.
 */
export function writeFileAtomic(path: string, content: string, opts: { keepBackup?: boolean } = {}): Promise<void> {
  if (!isTauri) return Promise.resolve()
  const keepBackup = opts.keepBackup ?? false
  let state = writeStates.get(path)
  if (!state) { state = { running: false, pending: null }; writeStates.set(path, state) }

  return new Promise<void>((resolve, reject) => {
    if (state!.pending) {
      state!.pending.content = content
      state!.pending.keepBackup = state!.pending.keepBackup || keepBackup
      state!.pending.waiters.push({ resolve, reject })
    } else {
      state!.pending = { content, keepBackup, waiters: [{ resolve, reject }] }
    }
    if (!state!.running) void drain(path, state!)
  })
}

async function drain(path: string, state: WriteState): Promise<void> {
  state.running = true
  while (state.pending) {
    const job = state.pending
    state.pending = null
    try {
      await doAtomicWrite(path, job.content, job.keepBackup)
      job.waiters.forEach(w => w.resolve())
    } catch (e) {
      reportWriteError(path, e)
      job.waiters.forEach(w => w.reject(e))
    }
  }
  state.running = false
  writeStates.delete(path)
}

// ── JSON state files ──────────────────────────────────────────────────────────

export function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  // Callers often hand over text they already serialized; stringifying it again would
  // store a quoted JSON string that reads back as a string instead of an object.
  return writeFileAtomic(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { keepBackup: true })
}

// Files written by an earlier build were stringified twice, so they parse to a string
// holding the real JSON. Unwrap that so existing data (tags, boards, calendar…) loads.
function parseJsonDeep<T>(text: string): T {
  let value: unknown = JSON.parse(text)
  if (typeof value === 'string') value = JSON.parse(value)
  return value as T
}

/**
 * Read a JSON file. Returns null only if the file is absent (or both it and
 * its backup are unusable). A file that exists but fails to parse is copied
 * to `<path>.corrupt-<timestamp>` for manual recovery, and the `.bak` is
 * returned if it is valid.
 */
export async function readJsonResilient<T>(path: string): Promise<T | null> {
  if (!isTauri) return null
  const { readTextFile, exists, copyFile } = await import('@tauri-apps/plugin-fs')
  if (await exists(path)) {
    try {
      return parseJsonDeep<T>(await readTextFile(path))
    } catch (e) {
      console.error('[inkwell] corrupt data file, trying backup:', path, e)
      try { await copyFile(path, `${path}.corrupt-${Date.now()}`) } catch { /* best effort */ }
    }
  }
  const bak = path + BAK_SUFFIX
  try {
    if (await exists(bak)) return parseJsonDeep<T>(await readTextFile(bak))
  } catch (e) {
    console.error('[inkwell] backup also unreadable:', bak, e)
  }
  return null
}

// ── Trash ─────────────────────────────────────────────────────────────────────

export const TRASH_DIR = 'trash'
const INFO_SUFFIX = '.trashinfo.json'

export interface TrashEntry {
  /** File/folder name inside the trash dir (timestamp-prefixed). */
  id: string
  kind: 'note' | 'folder'
  /** Display name — original file/folder name without the .md extension. */
  name: string
  /** Original location relative to the vault root, or null if unknown. */
  originalRelPath: string | null
  deletedAt: string
}

const trashDirOf = (vaultPath: string) => `${vaultPath}/.inkwell/${TRASH_DIR}`

/**
 * Move a file or folder into `<vault>/.inkwell/trash/`, tagged with a
 * timestamp so repeated deletes of the same name never collide, plus a small
 * `.trashinfo.json` sidecar recording where it came from so it can be
 * restored. Returns false if the target was already gone. Throws if the move
 * fails — callers must not fall back to permanent deletion silently.
 */
export async function moveToTrash(vaultPath: string, absolutePath: string): Promise<boolean> {
  if (!isTauri) return false
  const { exists, mkdir, rename, writeTextFile, stat } = await import('@tauri-apps/plugin-fs')
  if (!await exists(absolutePath)) return false
  const trashDir = trashDirOf(vaultPath)
  await mkdir(trashDir, { recursive: true })
  const base = absolutePath.split('/').filter(Boolean).pop() ?? 'item'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let dest = `${trashDir}/${stamp}__${base}`
  for (let i = 1; await exists(dest); i++) dest = `${trashDir}/${stamp}-${i}__${base}`
  let isDir = false
  try { isDir = (await stat(absolutePath)).isDirectory } catch { /* treat as file */ }
  const info = {
    kind: isDir ? 'folder' : 'note',
    originalRelPath: absolutePath.startsWith(vaultPath + '/') ? absolutePath.slice(vaultPath.length + 1) : null,
    deletedAt: new Date().toISOString(),
  }
  markSelfWrite(absolutePath)
  markSelfWrite(dest)
  await rename(absolutePath, dest)
  try { await writeTextFile(dest + INFO_SUFFIX, JSON.stringify(info)) } catch (e) {
    // The item is safely in trash; without the sidecar it can still be restored to the vault root.
    console.error('[inkwell] could not write trash info:', e)
  }
  return true
}

/** List trashed items, newest first. Items without a sidecar are still listed. */
export async function listTrash(vaultPath: string): Promise<TrashEntry[]> {
  if (!isTauri) return []
  const { readDir, readTextFile, exists } = await import('@tauri-apps/plugin-fs')
  const dir = trashDirOf(vaultPath)
  if (!await exists(dir)) return []
  const entries = await readDir(dir)
  const out: TrashEntry[] = []
  for (const e of entries) {
    if (e.name.endsWith(INFO_SUFFIX)) continue
    let info: Partial<TrashEntry> = {}
    try { info = JSON.parse(await readTextFile(`${dir}/${e.name}${INFO_SUFFIX}`)) } catch { /* no sidecar */ }
    const original = e.name.includes('__') ? e.name.slice(e.name.indexOf('__') + 2) : e.name
    const kind = info.kind ?? (e.isDirectory ? 'folder' : 'note')
    out.push({
      id: e.name,
      kind,
      name: kind === 'note' ? original.replace(/\.md$/, '') : original,
      originalRelPath: info.originalRelPath ?? null,
      deletedAt: info.deletedAt ?? e.name.slice(0, e.name.indexOf('__')).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'),
    })
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/**
 * Move a trashed item back to where it was deleted from (the vault root if
 * unknown), recreating missing parent folders. If something now occupies that
 * path, the restored item gets a " (restored)" suffix instead of overwriting.
 * Returns the vault-relative path it was restored to.
 */
export async function restoreFromTrash(vaultPath: string, entry: TrashEntry): Promise<string> {
  const { exists, mkdir, rename, remove } = await import('@tauri-apps/plugin-fs')
  const src = `${trashDirOf(vaultPath)}/${entry.id}`
  const original = entry.id.slice(entry.id.indexOf('__') + 2)
  const rel = entry.originalRelPath ?? original
  const slash = rel.lastIndexOf('/')
  const parent = slash >= 0 ? rel.slice(0, slash) : ''
  const fileName = slash >= 0 ? rel.slice(slash + 1) : rel
  if (parent) await mkdir(`${vaultPath}/${parent}`, { recursive: true })

  const dot = entry.kind === 'note' ? fileName.lastIndexOf('.') : -1
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let finalName = fileName
  for (let i = 0; await exists(`${vaultPath}/${parent ? parent + '/' : ''}${finalName}`); i++) {
    finalName = `${stem} (restored${i ? ' ' + (i + 1) : ''})${ext}`
  }
  const destRel = `${parent ? parent + '/' : ''}${finalName}`
  markSelfWrite(`${vaultPath}/${destRel}`)
  await rename(src, `${vaultPath}/${destRel}`)
  try { await remove(src + INFO_SUFFIX) } catch { /* no sidecar */ }
  return destRel
}

/** Permanently delete one trashed item, or everything in trash when no entry is given. */
export async function purgeTrash(vaultPath: string, entry?: TrashEntry): Promise<void> {
  const { remove, exists } = await import('@tauri-apps/plugin-fs')
  const dir = trashDirOf(vaultPath)
  if (!entry) {
    if (await exists(dir)) await remove(dir, { recursive: true })
    return
  }
  await remove(`${dir}/${entry.id}`, { recursive: true })
  try { await remove(`${dir}/${entry.id}${INFO_SUFFIX}`) } catch { /* no sidecar */ }
}
