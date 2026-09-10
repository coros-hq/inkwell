/**
 * vault.ts — filesystem-based storage for inkwell
 *
 * Storage layout:
 *   {vaultPath}/
 *   ├── .inkwell/
 *   │   └── app.json          boards, boardColumns, boardTasks, tasks, noteMeta
 *   ├── some-note.md          note at vault root (folder: null)
 *   ├── Getting Started/
 *   │   └── welcome.md
 *   └── Projects/
 *       ├── inkwell.md
 *       └── Research/
 *           └── notes.md
 *
 * Each .md file has YAML frontmatter:
 *   ---
 *   id: note-1234567890
 *   created: 2024-01-15T10:30:00.000Z
 *   updated: 2024-01-15T11:00:00.000Z
 *   pinned: false
 *   tags: []
 *   ---
 *
 *   # Note Title
 *   ...content...
 *
 * Folder IDs = vault-relative path, e.g. "Getting Started" or "Projects/Research"
 * Note.folder = vault-relative folder path, or null for root notes
 * Note.path   = absolute path to the .md file
 */

import type { Folder, Note, Task, Board, BoardColumn, BoardTask, Attachment, LinkedItem } from '../types'
import { slugifyTitle } from './utils'
import { genId } from './id'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const INKWELL_DIR = '.inkwell'
const APP_DATA_FILE = 'app.json'
const BOARDS_FILE = 'boards.json'
const TEAM_FILE = 'team.json'
const CANVAS_FILE = 'canvas.json'
const CANVAS_NOTES_FILE = 'canvas-notes.md'
const RECENT_KEY = 'inkwell-recent-vaults'
const LAST_VAULT_KEY = 'inkwell-last-vault'

// Directories to skip entirely when scanning a vault — common dependency/build/VCS
// folders that show up when a vault is nested inside a code project. These aren't
// notes and recursing into them (node_modules especially) is also a real perf cost.
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  'venv', '.venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.next', '.nuxt', '.turbo', '.parcel-cache', '.cache', 'coverage',
  '.vscode', '.idea', '.vs', 'vendor', 'Pods', '.gradle', '.dart_tool', 'DerivedData',
])

// ── Public types ──────────────────────────────────────────────────────────────

export interface AppData {
  version: number
  tasks: Task[]
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
  noteMeta: Record<string, { attachments: Attachment[]; linkedItems: LinkedItem[] }>
  /** Absolute paths of standalone .md files opened into this vault via "Open File". */
  externalFiles?: string[]
}

export interface VaultData {
  folders: Folder[]
  notes: Note[]
  tasks: Task[]
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
}

export interface RecentVault {
  path: string
  name: string
  lastOpenedAt: string
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

interface FrontmatterMeta {
  id: string
  created: string
  updated: string
  pinned: boolean
  tags: string[]
}

function parseFrontmatter(raw: string): { meta: Partial<FrontmatterMeta>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }

  const block = raw.slice(4, end).trim()
  const body = raw.slice(end + 4).replace(/^\n/, '')

  const meta: Partial<FrontmatterMeta> = {}
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    switch (key) {
      case 'id':      meta.id      = val; break
      case 'created': meta.created = val; break
      case 'updated': meta.updated = val; break
      case 'pinned':  meta.pinned  = val === 'true'; break
      case 'tags':
        meta.tags = val === '[]' ? [] : val.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean)
        break
    }
  }
  return { meta, body }
}

function serializeFrontmatter(meta: FrontmatterMeta, body: string): string {
  const tagStr = meta.tags.length === 0 ? '[]' : `[${meta.tags.join(', ')}]`
  return `---\nid: ${meta.id}\ncreated: ${meta.created}\nupdated: ${meta.updated}\npinned: ${meta.pinned}\ntags: ${tagStr}\n---\n\n${body}`
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

interface FSEntry { name: string; path: string; isDirectory: boolean }

async function listDir(dirPath: string): Promise<FSEntry[]> {
  const { readDir } = await import('@tauri-apps/plugin-fs')
  const entries = await readDir(dirPath)
  return entries
    .filter(e => e.name != null)
    .map(e => ({ name: e.name!, path: `${dirPath}/${e.name}`, isDirectory: e.isDirectory }))
}

function extractTitle(body: string, filename: string): string {
  const match = body.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  return filename.replace(/\.md$/, '').replace(/-/g, ' ')
}

// ── Vault-wide filename search ────────────────────────────────────────────────
// Obsidian's `![[filename]]` embeds reference a bare filename that Obsidian resolves
// by searching the whole vault (images usually live in a dedicated attachments
// folder, not next to the note). Inkwell has no such index, so this walks the vault
// tree looking for a file matching that name. Results are cached per vault session
// since the tree rarely changes between renders of the same note.
const fileSearchCache = new Map<string, string | null>()

export function clearFileSearchCache(vaultPath?: string): void {
  if (!vaultPath) { fileSearchCache.clear(); return }
  for (const key of fileSearchCache.keys()) {
    if (key.startsWith(`${vaultPath}::`)) fileSearchCache.delete(key)
  }
}

// An external note (see "External files" below) doesn't live inside the current
// vault, so embeds/images referenced from it (Obsidian `![[filename]]` syntax, or
// relative image paths) can't be found by searching the current vaultPath — they
// live in the note's OWN source vault instead. Walk up from the file looking for
// an `.obsidian` folder (Obsidian's vault-root marker) so a proper vault-wide
// search can be rooted there too; fall back to the file's immediate parent
// directory (covers images sitting next to the note or in a subfolder of it).
export async function findExternalSearchRoot(absolutePath: string): Promise<string> {
  const immediateParent = absolutePath.substring(0, absolutePath.lastIndexOf('/')) || '/'
  if (!isTauri) return immediateParent
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    let dir = immediateParent
    for (let i = 0; i < 8; i++) {
      if (await exists(`${dir}/.obsidian`)) return dir
      const parent = dir.substring(0, dir.lastIndexOf('/'))
      if (!parent || parent === dir) break
      dir = parent
    }
  } catch { /* fall through */ }
  return immediateParent
}

export async function findFileInVault(vaultPath: string, filename: string): Promise<string | null> {
  const cacheKey = `${vaultPath}::${filename.toLowerCase()}`
  if (fileSearchCache.has(cacheKey)) return fileSearchCache.get(cacheKey)!

  const target = filename.toLowerCase()
  const queue: string[] = [vaultPath]
  let found: string | null = null

  while (queue.length && !found) {
    const dir = queue.shift()!
    let entries: FSEntry[] = []
    try { entries = await listDir(dir) } catch { continue }

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!entry.name.startsWith('.') && !IGNORED_DIR_NAMES.has(entry.name)) queue.push(entry.path)
      } else if (entry.name.toLowerCase() === target) {
        found = entry.path
        break
      }
    }
  }

  fileSearchCache.set(cacheKey, found)
  return found
}

// ── Vault reading ─────────────────────────────────────────────────────────────

async function readDirectory(
  dirPath: string,
  folderRelPath: string,
  parentId: string | null,
  appData: AppData,
): Promise<{ folder: Folder; notes: Note[] }> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')

  let entries: FSEntry[] = []
  try { entries = await listDir(dirPath) } catch { /* empty */ }

  const childFolders: Folder[] = []
  const folderNotes: Note[] = []
  const allNotes: Note[] = []

  const dirs  = entries.filter(e => e.isDirectory && !e.name.startsWith('.') && !IGNORED_DIR_NAMES.has(e.name))
  const files = entries.filter(e => !e.isDirectory && e.name.endsWith('.md'))

  for (const dir of dirs) {
    const childRelPath = `${folderRelPath}/${dir.name}`
    const { folder: child, notes: childNotes } = await readDirectory(dir.path, childRelPath, folderRelPath, appData)
    childFolders.push(child)
    allNotes.push(...childNotes)
  }

  for (const file of files) {
    try {
      const raw = await readTextFile(file.path)
      const { meta, body } = parseFrontmatter(raw)
      const id = meta.id ?? genId('note')
      const noteMeta = appData.noteMeta?.[id] ?? { attachments: [], linkedItems: [] }
      const note: Note = {
        id,
        title: extractTitle(body, file.name),
        content: body,
        path: file.path,
        folder: folderRelPath,
        tags: meta.tags ?? [],
        pinned: meta.pinned ?? false,
        createdAt: meta.created ? new Date(meta.created) : new Date(),
        updatedAt: meta.updated ? new Date(meta.updated) : new Date(),
        wordCount: body.trim().split(/\s+/).filter(Boolean).length,
        attachments: noteMeta.attachments ?? [],
        linkedItems: noteMeta.linkedItems ?? [],
      }
      folderNotes.push(note)
      allNotes.push(note)
    } catch { /* skip unreadable */ }
  }

  const folderName = folderRelPath.split('/').pop()!
  const folder: Folder = {
    id: folderRelPath,
    name: folderName,
    path: dirPath,
    parentId,
    children: childFolders,
    notes: folderNotes,
    expanded: true,
  }
  return { folder, notes: allNotes }
}

export async function readVaultFS(vaultPath: string): Promise<VaultData | null> {
  if (!isTauri) return null

  const migrated = await migrateFromJson(vaultPath)
  if (migrated) return migrated

  const appData = (await readAppData(vaultPath)) ?? emptyAppData()
  // Board persistence layers (first match wins):
  //   1. boards.json  — async disk write, portable
  //   2. localStorage — synchronous write, survives Tauri WebView reloads instantly
  //   3. app.json     — legacy / debounced fallback
  const boardsData = await readBoardsFile(vaultPath)
  const localBoards: { boards: Board[]; boardColumns: BoardColumn[]; boardTasks: BoardTask[] } | null = (() => {
    if (boardsData) return null // already have disk copy, skip
    try {
      const raw = localStorage.getItem(`inkwell-boards:${vaultPath}`)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })()
  const { readTextFile } = await import('@tauri-apps/plugin-fs')

  let entries: FSEntry[] = []
  try { entries = await listDir(vaultPath) } catch { return null }

  const rootFolders: Folder[] = []
  const allNotes: Note[] = []

  const dirs  = entries.filter(e => e.isDirectory && !e.name.startsWith('.') && !IGNORED_DIR_NAMES.has(e.name))
  const files = entries.filter(e => !e.isDirectory && e.name.endsWith('.md'))

  for (const file of files) {
    try {
      const raw = await readTextFile(file.path)
      const { meta, body } = parseFrontmatter(raw)
      const id = meta.id ?? genId('note')
      const noteMeta = appData.noteMeta?.[id] ?? { attachments: [], linkedItems: [] }
      allNotes.push({
        id,
        title: extractTitle(body, file.name),
        content: body,
        path: file.path,
        folder: null,
        tags: meta.tags ?? [],
        pinned: meta.pinned ?? false,
        createdAt: meta.created ? new Date(meta.created) : new Date(),
        updatedAt: meta.updated ? new Date(meta.updated) : new Date(),
        wordCount: body.trim().split(/\s+/).filter(Boolean).length,
        attachments: noteMeta.attachments ?? [],
        linkedItems: noteMeta.linkedItems ?? [],
      })
    } catch { /* skip */ }
  }

  for (const dir of dirs) {
    const { folder, notes: childNotes } = await readDirectory(dir.path, dir.name, null, appData)
    rootFolders.push(folder)
    allNotes.push(...childNotes)
  }

  // External files opened via "Open File" — standalone .md files that live outside
  // this vault's directory tree. Re-read fresh from disk on every vault open so
  // edits made elsewhere show up; silently drop entries whose file has moved/gone
  // and persist the pruned list so they don't keep coming back as ghosts.
  const externalPaths = appData.externalFiles ?? []
  if (externalPaths.length > 0) {
    const stillValid: string[] = []
    for (const path of externalPaths) {
      const note = await readExternalNote(path)
      if (note) {
        allNotes.push(note)
        stillValid.push(path)
      }
    }
    if (stillValid.length !== externalPaths.length) {
      writeAppData(vaultPath, { ...appData, externalFiles: stillValid }).catch(console.error)
    }
  }

  return {
    folders: rootFolders,
    notes: allNotes,
    tasks: appData.tasks,
    boards: boardsData?.boards ?? localBoards?.boards ?? appData.boards,
    boardColumns: boardsData?.boardColumns ?? localBoards?.boardColumns ?? appData.boardColumns,
    boardTasks: boardsData?.boardTasks ?? localBoards?.boardTasks ?? appData.boardTasks,
  }
}

// ── Note file writes ──────────────────────────────────────────────────────────

export async function writeNoteFile(note: Note): Promise<void> {
  if (!isTauri) return
  const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const parent = note.path.substring(0, note.path.lastIndexOf('/'))
  if (parent && !await exists(parent)) await mkdir(parent, { recursive: true })
  const meta: FrontmatterMeta = {
    id: note.id,
    created: note.createdAt.toISOString(),
    updated: note.updatedAt.toISOString(),
    pinned: note.pinned,
    tags: note.tags,
  }
  await writeTextFile(note.path, serializeFrontmatter(meta, note.content))
}

export async function deleteNoteFile(absolutePath: string): Promise<void> {
  if (!isTauri) return
  try {
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(absolutePath)
  } catch { /* already gone */ }
}

// ── Folder operations ─────────────────────────────────────────────────────────

export async function createFolderDir(absolutePath: string): Promise<void> {
  if (!isTauri) return
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(absolutePath, { recursive: true })
}

export async function deleteFolderDir(absolutePath: string): Promise<void> {
  if (!isTauri) return
  try {
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(absolutePath, { recursive: true })
  } catch { /* ok */ }
}

export async function renameItem(oldPath: string, newPath: string): Promise<void> {
  if (!isTauri) return
  const { rename } = await import('@tauri-apps/plugin-fs')
  await rename(oldPath, newPath)
}

// ── App data ──────────────────────────────────────────────────────────────────

function emptyAppData(): AppData {
  return { version: 1, tasks: [], boards: [], boardColumns: [], boardTasks: [], noteMeta: {}, externalFiles: [] }
}

export async function readAppData(vaultPath: string): Promise<AppData | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const filePath = `${vaultPath}/${INKWELL_DIR}/${APP_DATA_FILE}`
    if (!await exists(filePath)) return null
    return JSON.parse(await readTextFile(filePath)) as AppData
  } catch { return null }
}

export async function writeAppData(vaultPath: string, data: AppData): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dir = `${vaultPath}/${INKWELL_DIR}`
    if (!await exists(dir)) await mkdir(dir, { recursive: true })
    await writeTextFile(`${dir}/${APP_DATA_FILE}`, JSON.stringify(data, null, 2))
  } catch (e) { console.error('Failed to write app data:', e) }
}

// ── Team data (.inkwell/team.json) ────────────────────────────────────────────
// Durable link between this local vault folder and a `vaults` row in Supabase.
// Only present once a vault has been shared with a team or joined from one —
// its absence means the vault is (and stays) purely local, so all sync code
// paths should treat a missing team.json as "nothing to do here".

export interface TeamData {
  vaultId: string
  teamId: string
  sharedAt: string
}

export async function readTeamData(vaultPath: string): Promise<TeamData | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const filePath = `${vaultPath}/${INKWELL_DIR}/${TEAM_FILE}`
    if (!await exists(filePath)) return null
    return JSON.parse(await readTextFile(filePath)) as TeamData
  } catch { return null }
}

export async function writeTeamData(vaultPath: string, data: TeamData): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dir = `${vaultPath}/${INKWELL_DIR}`
    if (!await exists(dir)) await mkdir(dir, { recursive: true })
    await writeTextFile(`${dir}/${TEAM_FILE}`, JSON.stringify(data, null, 2))
  } catch (e) { console.error('Failed to write team data:', e) }
}

// ── Board data (boards.json) ──────────────────────────────────────────────────

export interface BoardsData {
  version: number
  boards: Board[]
  boardColumns: BoardColumn[]
  boardTasks: BoardTask[]
}

export async function writeBoardsFile(vaultPath: string, data: BoardsData): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dir = `${vaultPath}/${INKWELL_DIR}`
    if (!await exists(dir)) await mkdir(dir, { recursive: true })
    await writeTextFile(`${dir}/${BOARDS_FILE}`, JSON.stringify(data, null, 2))
    // Once safely on disk, the localStorage backup is no longer needed
    try { localStorage.removeItem(`inkwell-boards:${vaultPath}`) } catch { /* ok */ }
  } catch (e) { console.error('Failed to write boards:', e) }
}

export async function readBoardsFile(vaultPath: string): Promise<BoardsData | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const filePath = `${vaultPath}/${INKWELL_DIR}/${BOARDS_FILE}`
    if (!await exists(filePath)) return null
    return JSON.parse(await readTextFile(filePath)) as BoardsData
  } catch { return null }
}

// ── Canvas data (~/.inkwell/canvas.json) ───────────────────────────────────────
// Stored globally by default — independent of which vault is open. The user
// can optionally link the canvas to a specific vault
// (see canvasLinkedVaultPath in useAppStore), in which case it's stored at
// {vaultPath}/.inkwell/canvas.json instead, regardless of the vault currently open.

async function getGlobalCanvasPath(): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path')
  const home = await homeDir()
  return join(home, INKWELL_DIR, CANVAS_FILE)
}

async function getGlobalCanvasNotesPath(): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path')
  const home = await homeDir()
  return join(home, INKWELL_DIR, CANVAS_NOTES_FILE)
}

export async function writeGlobalCanvasFile(shapes: unknown): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const { homeDir, join } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const dir  = await join(home, INKWELL_DIR)
    await mkdir(dir, { recursive: true })
    await writeTextFile(await getGlobalCanvasPath(), JSON.stringify(shapes))
  } catch (e) { console.error('Failed to write global canvas:', e) }
}

export async function readGlobalCanvasFile(): Promise<unknown[]> {
  if (!isTauri) return []
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const filePath = await getGlobalCanvasPath()
    if (!await exists(filePath)) return []
    return JSON.parse(await readTextFile(filePath))
  } catch { return [] }
}

export async function writeGlobalCanvasNotes(content: string): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const { homeDir, join } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const dir  = await join(home, INKWELL_DIR)
    await mkdir(dir, { recursive: true })
    await writeTextFile(await getGlobalCanvasNotesPath(), content)
  } catch (e) { console.error('Failed to write global canvas notes:', e) }
}

export async function readGlobalCanvasNotes(): Promise<string> {
  if (!isTauri) return ''
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const filePath = await getGlobalCanvasNotesPath()
    if (!await exists(filePath)) return ''
    return await readTextFile(filePath)
  } catch { return '' }
}

export async function writeNoteMeta(
  vaultPath: string,
  noteId: string,
  meta: { attachments: Attachment[]; linkedItems: LinkedItem[] }
): Promise<void> {
  const current = (await readAppData(vaultPath)) ?? emptyAppData()
  current.noteMeta = { ...current.noteMeta, [noteId]: meta }
  await writeAppData(vaultPath, current)
}

// ── Migration from inkwell.json ───────────────────────────────────────────────

function reviveDates(key: string, value: unknown): unknown {
  if (typeof value === 'string' && (key === 'createdAt' || key === 'updatedAt' || key === 'dueDate')) {
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d
  }
  return value
}

function findFolderRelPath(folders: Folder[], folderId: string, prefix = ''): string | null {
  for (const f of folders) {
    const rel = prefix ? `${prefix}/${f.name}` : f.name
    if (f.id === folderId) return rel
    const found = findFolderRelPath(f.children, folderId, rel)
    if (found) return found
  }
  return null
}

function flattenFolders(folders: Folder[]): Folder[] {
  return folders.flatMap(f => [f, ...flattenFolders(f.children)])
}

async function migrateFromJson(vaultPath: string): Promise<VaultData | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, exists, writeTextFile, mkdir, rename } = await import('@tauri-apps/plugin-fs')
    const jsonPath = `${vaultPath}/inkwell.json`
    if (!await exists(jsonPath)) return null

    console.log('[inkwell] Migrating from inkwell.json…')
    const legacy = JSON.parse(await readTextFile(jsonPath), reviveDates) as {
      folders: Folder[]
      notes: Note[]
      tasks: Task[]
      boards?: Board[]
      boardColumns?: BoardColumn[]
      boardTasks?: BoardTask[]
    }

    for (const folder of flattenFolders(legacy.folders)) {
      const relPath = findFolderRelPath(legacy.folders, folder.id)
      if (relPath) await mkdir(`${vaultPath}/${relPath}`, { recursive: true })
    }

    for (const note of legacy.notes) {
      const folderRelPath = note.folder ? findFolderRelPath(legacy.folders, note.folder) : null
      const dir = folderRelPath ? `${vaultPath}/${folderRelPath}` : vaultPath
      await mkdir(dir, { recursive: true })
      const filename = `${slugifyTitle(note.title) || 'untitled'}.md`
      const meta: FrontmatterMeta = {
        id: note.id,
        created: (note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt)).toISOString(),
        updated: (note.updatedAt instanceof Date ? note.updatedAt : new Date(note.updatedAt)).toISOString(),
        pinned: note.pinned,
        tags: note.tags,
      }
      await writeTextFile(`${dir}/${filename}`, serializeFrontmatter(meta, note.content))
    }

    const noteMeta: AppData['noteMeta'] = {}
    for (const note of legacy.notes) {
      if (note.attachments?.length || note.linkedItems?.length) {
        noteMeta[note.id] = { attachments: note.attachments ?? [], linkedItems: note.linkedItems ?? [] }
      }
    }

    const inkwellDir = `${vaultPath}/${INKWELL_DIR}`
    if (!await exists(inkwellDir)) await mkdir(inkwellDir, { recursive: true })
    const appData: AppData = {
      version: 1,
      tasks: legacy.tasks ?? [],
      boards: legacy.boards ?? [],
      boardColumns: legacy.boardColumns ?? [],
      boardTasks: legacy.boardTasks ?? [],
      noteMeta,
    }
    await writeTextFile(`${inkwellDir}/${APP_DATA_FILE}`, JSON.stringify(appData, null, 2))
    await rename(jsonPath, `${inkwellDir}/inkwell.json.bak`)

    console.log('[inkwell] Migration complete.')
    return readVaultFS(vaultPath)
  } catch (e) {
    console.error('[inkwell] Migration failed:', e)
    return null
  }
}

// ── Recent vaults ─────────────────────────────────────────────────────────────

export async function pickVaultDirectory(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: 'Choose Vault Folder' })
  if (typeof result === 'string') return result
  return null
}

export function getRecentVaults(): RecentVault[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as RecentVault[]) : []
  } catch { return [] }
}

export function addRecentVault(path: string): void {
  const name = path.split('/').pop() ?? path
  const vaults = getRecentVaults().filter(v => v.path !== path)
  vaults.unshift({ path, name, lastOpenedAt: new Date().toISOString() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(vaults.slice(0, 8)))
  localStorage.setItem(LAST_VAULT_KEY, path)
}

export function removeRecentVault(path: string): void {
  const vaults = getRecentVaults().filter(v => v.path !== path)
  localStorage.setItem(RECENT_KEY, JSON.stringify(vaults))
  if (localStorage.getItem(LAST_VAULT_KEY) === path) localStorage.removeItem(LAST_VAULT_KEY)
}

export function getLastVaultPath(): string | null {
  return localStorage.getItem(LAST_VAULT_KEY)
}

// ── Quick note capture ────────────────────────────────────────────────────────
// Notes captured from the global Cmd+N popup are written straight to disk in
// a "Quick Notes" folder inside the chosen vault, independent of whether that
// vault is the one currently open in the main window.

const QUICK_NOTES_FOLDER = 'Quick Notes'

export async function saveQuickNote(vaultPath: string, text: string): Promise<Note> {
  const trimmed = text.trim()
  // Prefer a markdown "# Heading" as the title (same convention the rest of
  // the vault uses); otherwise fall back to the first line of plain text.
  const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/m)
  const firstLine = (headingMatch ? headingMatch[1] : trimmed.split('\n')[0])?.trim() ?? ''
  const title = firstLine.slice(0, 80) || 'Quick Note'
  const now = new Date()
  const id = genId('note')
  const filename = `${slugifyTitle(title)}-${now.getTime()}.md`
  const dir = `${vaultPath}/${QUICK_NOTES_FOLDER}`
  const path = `${dir}/${filename}`

  await createFolderDir(dir)

  const note: Note = {
    id,
    title,
    content: trimmed,
    path,
    folder: QUICK_NOTES_FOLDER,
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    wordCount: trimmed.split(/\s+/).filter(Boolean).length,
    attachments: [],
    linkedItems: [],
  }

  await writeNoteFile(note)
  return note
}

// ── External files ────────────────────────────────────────────────────────────
// "Open File" lets the user edit a single standalone .md file that lives outside
// the current vault's directory tree (e.g. a README elsewhere on disk), without
// switching vaults. These notes are tracked by absolute path only — inkwell never
// writes frontmatter into them, so a foreign file's existing format/frontmatter
// (if any) is left completely alone; edits are saved back as plain raw text via
// saveNote() in lib/fs.ts, never writeNoteFile()'s frontmatter-wrapping writer.
// The note id is derived from the path itself (`ext:<path>`) so re-opening the
// same file, or reloading the vault, resolves to the same stable identity.

export function externalNoteId(absolutePath: string): string {
  return `ext:${absolutePath}`
}

export async function readExternalNote(absolutePath: string): Promise<Note | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    if (!await exists(absolutePath)) return null
    const raw = await readTextFile(absolutePath)
    const filename = absolutePath.split('/').pop() ?? absolutePath
    const now = new Date()
    const searchRoot = await findExternalSearchRoot(absolutePath)
    return {
      id: externalNoteId(absolutePath),
      title: extractTitle(raw, filename),
      content: raw,
      path: absolutePath,
      folder: null,
      tags: [],
      pinned: false,
      createdAt: now,
      updatedAt: now,
      wordCount: raw.trim().split(/\s+/).filter(Boolean).length,
      attachments: [],
      linkedItems: [],
      external: true,
      searchRoot,
    }
  } catch { return null }
}

export async function pickExternalMarkdownFile(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    directory: false,
    multiple: false,
    title: 'Open Markdown File',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  })
  if (typeof result === 'string') return result
  return null
}

export async function addExternalFileToVault(vaultPath: string, absolutePath: string): Promise<void> {
  const data = (await readAppData(vaultPath)) ?? emptyAppData()
  const existing = data.externalFiles ?? []
  if (existing.includes(absolutePath)) return
  await writeAppData(vaultPath, { ...data, externalFiles: [...existing, absolutePath] })
}

export async function removeExternalFileFromVault(vaultPath: string, absolutePath: string): Promise<void> {
  const data = (await readAppData(vaultPath)) ?? emptyAppData()
  const existing = data.externalFiles ?? []
  await writeAppData(vaultPath, { ...data, externalFiles: existing.filter(p => p !== absolutePath) })
}

export async function renameExternalFileInVault(vaultPath: string, oldPath: string, newPath: string): Promise<void> {
  const data = (await readAppData(vaultPath)) ?? emptyAppData()
  const existing = data.externalFiles ?? []
  await writeAppData(vaultPath, { ...data, externalFiles: existing.map(p => p === oldPath ? newPath : p) })
}
