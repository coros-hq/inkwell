/**
 * Local vault backups: the whole vault zipped into a folder the user picks
 * (an external drive, a synced cloud folder, …). Nothing leaves the machine.
 *
 * Archive layout: `<vault name>/…` so extracting yields a ready-to-open vault.
 * Left out: `.git` (it has its own history), the app trash, `node_modules`,
 * OS junk, and the backup folder itself when it lives inside the vault.
 */
import { zipSync, type Zippable } from 'fflate'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const DIR_KEY = 'inkwell-backup-dir'
const AUTO_KEY = 'inkwell-backup-auto'
const KEEP_KEY = 'inkwell-backup-keep'
const lastKey = (vaultPath: string) => `inkwell-backup-last:${vaultPath}`

export const KEEP_OPTIONS = [3, 5, 10, 30, 0] as const // 0 = keep everything
export const DEFAULT_KEEP = 10
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db'])
const SKIP_REL = new Set(['.inkwell/trash'])
// Already-compressed formats: re-deflating them only burns CPU.
const STORE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|7z|mp3|m4a|mp4|mov|mkv|webm|pdf)$/i

export interface BackupSettings { dir: string | null; auto: boolean; keep: number }
export interface BackupResult { path: string; files: number; bytes: number; pruned: number }

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

export function getBackupSettings(): BackupSettings {
  const keep = Number(read(KEEP_KEY))
  return {
    dir: read(DIR_KEY),
    auto: read(AUTO_KEY) === 'true',
    keep: (KEEP_OPTIONS as readonly number[]).includes(keep) && read(KEEP_KEY) !== null ? keep : DEFAULT_KEEP,
  }
}
export function setBackupDir(dir: string | null) { write(DIR_KEY, dir) }
export function setBackupAuto(auto: boolean) { write(AUTO_KEY, String(auto)) }
export function setBackupKeep(keep: number) { write(KEEP_KEY, String(keep)) }

export function getLastBackup(vaultPath: string): Date | null {
  const raw = read(lastKey(vaultPath))
  const d = raw ? new Date(raw) : null
  return d && !isNaN(d.getTime()) ? d : null
}

export async function pickBackupDirectory(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: 'Choose backup folder' })
  return typeof result === 'string' ? result : null
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `Vault-2026-11-09-153045-123.zip` — sorts chronologically as plain text. */
export function backupFileName(vaultName: string, at = new Date()): string {
  const safe = vaultName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'vault'
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-` +
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`
  return `${safe}-${stamp}.zip`
}

const vaultNameOf = (vaultPath: string) => vaultPath.replace(/\/+$/, '').split('/').pop() || 'vault'
const BACKUP_RE = (vaultName: string) => new RegExp(`^${vaultName.replace(/[\\/:*?"<>|]/g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}-\\d{6}-\\d{3}\\.zip$`)

let running = false

/** Zips `vaultPath` into the configured backup folder. Throws if no folder is set. */
export async function runBackup(vaultPath: string): Promise<BackupResult> {
  if (!isTauri) throw new Error('Backups are only available in the desktop app.')
  const { dir, keep } = getBackupSettings()
  if (!dir) throw new Error('Choose a backup folder first.')
  if (running) throw new Error('A backup is already running.')
  running = true
  try {
    const { readDir, readFile, writeFile, mkdir, exists, rename, remove } = await import('@tauri-apps/plugin-fs')
    const root = vaultPath.replace(/\/+$/, '')
    const top = vaultNameOf(root)
    const backupDir = dir.replace(/\/+$/, '')

    const entries: Zippable = {}
    let files = 0
    const walk = async (abs: string, rel: string) => {
      for (const e of await readDir(abs)) {
        if (!e.name || SKIP_NAMES.has(e.name)) continue
        const childAbs = `${abs}/${e.name}`
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (SKIP_REL.has(childRel) || childAbs === backupDir) continue
        if (e.isDirectory) { await walk(childAbs, childRel); continue }
        if (!e.isFile) continue // symlinks and the like
        const data = await readFile(childAbs)
        entries[`${top}/${childRel}`] = [data, { level: STORE_EXT.test(e.name) ? 0 : 6 }]
        files++
      }
    }
    await walk(root, '')

    const zipped = zipSync(entries)
    if (!(await exists(backupDir))) await mkdir(backupDir, { recursive: true })
    const name = backupFileName(top)
    const finalPath = `${backupDir}/${name}`
    // Write beside the final name first so an interrupted backup never looks like a good one.
    const partial = `${finalPath}.partial`
    await writeFile(partial, zipped)
    await rename(partial, finalPath)

    let pruned = 0
    if (keep > 0) {
      const re = BACKUP_RE(top)
      const mine = (await readDir(backupDir)).map(e => e.name ?? '').filter(n => re.test(n)).sort()
      for (const old of mine.slice(0, Math.max(0, mine.length - keep))) {
        try { await remove(`${backupDir}/${old}`); pruned++ } catch (e) { console.error('[inkwell] could not prune backup', old, e) }
      }
    }

    write(lastKey(vaultPath), new Date().toISOString())
    return { path: finalPath, files, bytes: zipped.byteLength, pruned }
  } finally {
    running = false
  }
}

/** Runs a backup if automatic backups are on and the last one is over a day old. */
export async function maybeAutoBackup(vaultPath: string): Promise<BackupResult | null> {
  const { dir, auto } = getBackupSettings()
  if (!isTauri || !auto || !dir) return null
  const last = getLastBackup(vaultPath)
  if (last && Date.now() - last.getTime() < AUTO_INTERVAL_MS) return null
  try { return await runBackup(vaultPath) } catch (e) { console.error('[inkwell] automatic backup failed:', e); return null }
}

export async function revealBackupFolder(dir: string): Promise<void> {
  if (!isTauri) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(dir)
}
