import { configDir } from './dataRoot'
import { genId } from './id'

// Multiple canvas drawings. Stored globally in ~/.inkwell by default, or in
// {linkedVault}/.inkwell when the canvas is linked to a vault (same rule the
// single legacy canvas followed):
//
//   drawings.json          index: DrawingMeta[]  (title, tags, folder link)
//   drawings/<id>.json     one DrawingFile per drawing (shapes + notes)
//
// The legacy canvas.json / canvas-notes.md are migrated into a first drawing on
// first load and then left untouched on disk.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const INKWELL_DIR = '.inkwell'
const INDEX_FILE = 'drawings.json'
const DRAWINGS_DIR = 'drawings'

export interface DrawingMeta {
  id: string
  title: string
  tags: string[]
  /** Absolute path of the vault folder this drawing is associated with (null = unfiled). */
  folderPath: string | null
  createdAt: number
  updatedAt: number
}

export interface DrawingFile {
  shapes: unknown[]
  notes: string
}

interface IndexFile { version: 1; drawings: DrawingMeta[] }

async function baseDir(linkedVault: string | null): Promise<string> {
  if (linkedVault) return `${linkedVault}/${INKWELL_DIR}`
  return configDir()
}

async function readJson<T>(path: string): Promise<T | null> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
  try {
    if (!(await exists(path))) return null
    return JSON.parse(await readTextFile(path)) as T
  } catch { return null }
}

async function readText(path: string): Promise<string> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
  try { return (await exists(path)) ? await readTextFile(path) : '' } catch { return '' }
}

export function newDrawingMeta(title = 'Untitled drawing', folderPath: string | null = null): DrawingMeta {
  const now = Date.now()
  return { id: genId('drawing'), title, tags: [], folderPath, createdAt: now, updatedAt: now }
}

/** Loads the drawing index; creates it (migrating the legacy single canvas) if absent. */
export async function loadDrawingIndex(linkedVault: string | null): Promise<DrawingMeta[]> {
  if (!isTauri) return [newDrawingMeta('My canvas')]
  const dir = await baseDir(linkedVault)
  const index = await readJson<IndexFile>(`${dir}/${INDEX_FILE}`)
  if (index && Array.isArray(index.drawings) && index.drawings.length) return index.drawings

  const legacyShapes = (await readJson<unknown[]>(`${dir}/canvas.json`)) ?? []
  const legacyNotes = await readText(`${dir}/canvas-notes.md`)
  const first = newDrawingMeta('My canvas')
  await saveDrawing(linkedVault, first.id, { shapes: legacyShapes, notes: legacyNotes })
  await saveDrawingIndex(linkedVault, [first])
  return [first]
}

export async function saveDrawingIndex(linkedVault: string | null, drawings: DrawingMeta[]): Promise<void> {
  if (!isTauri) return
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const dir = await baseDir(linkedVault)
    await mkdir(dir, { recursive: true })
    const body: IndexFile = { version: 1, drawings }
    await writeTextFile(`${dir}/${INDEX_FILE}`, JSON.stringify(body))
  } catch (e) { console.error('[drawings] index save failed:', e) }
}

export async function loadDrawing(linkedVault: string | null, id: string): Promise<DrawingFile> {
  if (!isTauri) return { shapes: [], notes: '' }
  const dir = await baseDir(linkedVault)
  const f = await readJson<DrawingFile>(`${dir}/${DRAWINGS_DIR}/${id}.json`)
  return { shapes: Array.isArray(f?.shapes) ? f!.shapes : [], notes: f?.notes ?? '' }
}

export async function saveDrawing(linkedVault: string | null, id: string, file: DrawingFile): Promise<void> {
  if (!isTauri) return
  // Serialize before the first await so callers can safely mutate their data afterwards.
  const body = JSON.stringify(file)
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const dir = `${await baseDir(linkedVault)}/${DRAWINGS_DIR}`
    await mkdir(dir, { recursive: true })
    await writeTextFile(`${dir}/${id}.json`, body)
  } catch (e) { console.error('[drawings] save failed:', e) }
}

export async function deleteDrawingFile(linkedVault: string | null, id: string): Promise<void> {
  if (!isTauri) return
  try {
    const { remove, exists } = await import('@tauri-apps/plugin-fs')
    const path = `${await baseDir(linkedVault)}/${DRAWINGS_DIR}/${id}.json`
    if (await exists(path)) await remove(path)
  } catch (e) { console.error('[drawings] delete failed:', e) }
}
