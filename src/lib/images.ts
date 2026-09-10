import type { Attachment } from '../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

/** Writes a pasted clipboard image into {vaultPath}/assets/ and returns an
 *  Attachment describing it — same shape `pickAndCopyAttachment` returns, so it
 *  can be registered on the note and rendered via the `![[path|name|size]]`
 *  embed widget (plain `![image](url)` markdown is not rendered inline). */
export async function saveClipboardImage(vaultPath: string, file: File): Promise<Attachment | null> {
  if (!isTauri) return null
  try {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

    const assetsDir = `${vaultPath}/assets`
    if (!(await exists(assetsDir))) {
      await mkdir(assetsDir, { recursive: true })
    }

    const ext = MIME_EXT[file.type] ?? 'png'
    const filename = `pasted-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(`${assetsDir}/${filename}`, bytes)

    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: filename,
      path: `assets/${filename}`,
      size: bytes.byteLength,
      type: 'image',
    }
  } catch (e) {
    console.error('Failed to save pasted image:', e)
    return null
  }
}

