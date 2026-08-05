import type { Attachment } from '../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ─── File-type detection ──────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'])

function detectType(ext: string): Attachment['type'] {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

// ─── Size formatter ───────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Markdown embed snippet ───────────────────────────────────────────────────

/** Returns the text to insert at cursor: ![[attachments/file.pdf|name|size]] */
export function makeAttachmentMarkdown(attachment: Attachment): string {
  return `![[${attachment.path}|${attachment.name}|${attachment.size}]]`
}

// ─── File icon ────────────────────────────────────────────────────────────────

export function fileIcon(type: Attachment['type'], ext: string): string {
  if (type === 'image') return '🖼'
  if (type === 'video') return '🎬'
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📑'
  if (['zip', 'tar', 'gz', '7z'].includes(ext)) return '📦'
  return '📎'
}

// ─── Tauri convertFileSrc ─────────────────────────────────────────────────────

/** Returns a URL that WebView can load for a file on disk. */
export async function getAttachmentUrl(vaultPath: string, attachment: Attachment): Promise<string> {
  if (!isTauri) return ''
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(`${vaultPath}/${attachment.path}`)
}

/** Synchronous version — safe only after the first async call has warmed up. */
export function getAttachmentUrlSync(vaultPath: string, relativePath: string): string {
  if (!isTauri) return ''
  // convertFileSrc works synchronously in the global scope after the module loads
  // Fallback: construct the asset URL manually (Tauri v2 uses asset:// protocol)
  const fullPath = `${vaultPath}/${relativePath}`
  return `asset://localhost/${encodeURIComponent(fullPath).replace(/%2F/g, '/')}`
}

// ─── Pick and copy a file into the vault ─────────────────────────────────────

export async function pickAndCopyAttachment(vaultPath: string): Promise<Attachment | null> {
  if (!isTauri) return null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile, writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const { basename } = await import('@tauri-apps/api/path')

    const selected = await open({
      multiple: false,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx'] },
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
        { name: 'All files', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'zip', 'tar', 'gz'] },
      ],
    })

    if (!selected || typeof selected !== 'string') return null

    // ── Prepare the attachments directory ──────────────────────────────────────
    const attachDir = `${vaultPath}/attachments`
    if (!(await exists(attachDir))) {
      await mkdir(attachDir, { recursive: true })
    }

    // ── Deduplicate the filename if it already exists ──────────────────────────
    const originalName = await basename(selected)
    const dotIdx = originalName.lastIndexOf('.')
    const baseName = dotIdx >= 0 ? originalName.slice(0, dotIdx) : originalName
    const ext = (dotIdx >= 0 ? originalName.slice(dotIdx + 1) : '').toLowerCase()

    let filename = originalName
    let counter = 1
    while (await exists(`${attachDir}/${filename}`)) {
      filename = ext ? `${baseName} (${counter}).${ext}` : `${baseName} (${counter})`
      counter++
    }

    // ── Copy the file and use its byte length for the size ────────────────────
    const bytes = await readFile(selected)
    const destPath = `${attachDir}/${filename}`
    await writeFile(destPath, bytes)
    const size = bytes.byteLength

    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: filename,
      path: `attachments/${filename}`,
      size,
      type: detectType(ext),
    }
  } catch (e) {
    console.error('Failed to pick/copy attachment:', e)
    return null
  }
}

// ─── Save pasted/dropped image bytes into the vault ──────────────────────────

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

/** Saves raw image bytes (e.g. from a clipboard paste) into `<vault>/attachments/`. */
export async function saveImageBytes(vaultPath: string, bytes: Uint8Array, mimeType: string): Promise<Attachment | null> {
  if (!isTauri) return null
  try {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')

    const attachDir = `${vaultPath}/attachments`
    if (!(await exists(attachDir))) {
      await mkdir(attachDir, { recursive: true })
    }

    const ext = MIME_EXT[mimeType] ?? 'png'
    const baseName = `Pasted image ${new Date().toISOString().replace(/[:.]/g, '-')}`

    let filename = `${baseName}.${ext}`
    let counter = 1
    while (await exists(`${attachDir}/${filename}`)) {
      filename = `${baseName} (${counter}).${ext}`
      counter++
    }

    const destPath = `${attachDir}/${filename}`
    await writeFile(destPath, bytes)

    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: filename,
      path: `attachments/${filename}`,
      size: bytes.byteLength,
      type: 'image',
    }
  } catch (e) {
    console.error('Failed to save pasted image:', e)
    return null
  }
}

// ─── Open a file with the system default app ──────────────────────────────────

export async function openAttachment(vaultPath: string, attachment: Attachment): Promise<void> {
  if (!isTauri) return
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener')
    await openPath(`${vaultPath}/${attachment.path}`)
  } catch (e) {
    console.error('Failed to open attachment:', e)
  }
}

// ─── Delete the attachment file from disk ─────────────────────────────────────

export async function deleteAttachmentFile(vaultPath: string, attachment: Attachment): Promise<void> {
  if (!isTauri) return
  try {
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(`${vaultPath}/${attachment.path}`)
  } catch (e) {
    console.error('Failed to delete attachment file:', e)
  }
}
