// Tauri fs integration — reads/writes .md files to the local filesystem.
// Falls back gracefully when running in browser dev mode.

import { writeFileAtomic } from './safeFs'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function saveNote(path: string, content: string): Promise<void> {
  if (!isTauri) return
  try {
    await writeFileAtomic(path, content)
  } catch (e) {
    console.error('Failed to save note:', e)
    throw e
  }
}

export async function readNote(path: string): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(path)
  } catch (e) {
    console.error('Failed to read note:', e)
    return null
  }
}

export function buildFrontmatter(title: string, tags: string[], pinned: boolean): string {
  return `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\npinned: ${pinned}\ncreatedAt: ${new Date().toISOString().split('T')[0]}\nupdatedAt: ${new Date().toISOString().split('T')[0]}\n---\n\n`
}
