import type { Brainstorm } from '../types'
import { exportXmind, importXmind } from './xmind'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function safeName(title: string): string {
  return (title.trim() || 'brainstorm').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
}

/** Save a brainstorm as a .xmind file. Returns false if the user cancelled. */
export async function exportBrainstormToXmind(brainstorm: Brainstorm): Promise<boolean> {
  const bytes = exportXmind(brainstorm)
  const defaultName = `${safeName(brainstorm.title)}.xmind`

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ defaultPath: defaultName, filters: [{ name: 'XMind', extensions: ['xmind'] }] })
    if (!path) return false
    await writeFile(path, bytes)
    return true
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.xmind.workbook' }))
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  URL.revokeObjectURL(url)
  return true
}

/** Pick and parse a .xmind file. Returns null if the user cancelled; throws XmindError for bad files. */
export async function pickXmindFile(): Promise<Brainstorm[] | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      directory: false,
      multiple: false,
      title: 'Import XMind file',
      filters: [{ name: 'XMind', extensions: ['xmind'] }],
    })
    if (typeof path !== 'string') return null
    return importXmind(await readFile(path)).brainstorms
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xmind'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(importXmind(new Uint8Array(await file.arrayBuffer())).brainstorms)
      } catch (e) {
        reject(e)
      }
    }
    input.click()
  })
}
