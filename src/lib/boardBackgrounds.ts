import type { CSSProperties } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { BoardBackground } from '../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const BACKGROUND_DIR = 'assets/board-backgrounds'

export const GRADIENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Aurora', value: 'linear-gradient(135deg, #43cea2 0%, #185a9d 100%)' },
  { name: 'Sunset', value: 'linear-gradient(135deg, #f7971e 0%, #ff4e50 100%)' },
  { name: 'Dusk', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { name: 'Ocean', value: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)' },
  { name: 'Blossom', value: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)' },
  { name: 'Forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { name: 'Midnight', value: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' },
  { name: 'Ember', value: 'radial-gradient(circle at 20% 20%, #ff9a9e 0%, transparent 55%), radial-gradient(circle at 80% 70%, #a18cd1 0%, transparent 55%), #fbc2eb' },
]

export const COLOR_PRESETS: { name: string; value: string }[] = [
  { name: 'Blue', value: '#0079bf' },
  { name: 'Orange', value: '#d29034' },
  { name: 'Green', value: '#519839' },
  { name: 'Red', value: '#b04632' },
  { name: 'Purple', value: '#89609e' },
  { name: 'Pink', value: '#cd5a91' },
  { name: 'Teal', value: '#00aecc' },
  { name: 'Slate', value: '#4d5b6b' },
]

function imageUrl(vaultPath: string | null, path: string): string | null {
  if (!vaultPath) return null
  const full = `${vaultPath}/${path}`
  if (!isTauri) return full
  try {
    return convertFileSrc(full)
  } catch {
    return null
  }
}

/** CSS for a board's wallpaper, or null when it has none (or its image can't be resolved). */
export function backgroundStyle(bg: BoardBackground | undefined, vaultPath: string | null): CSSProperties | null {
  if (!bg) return null
  if (bg.type === 'color') return { backgroundColor: bg.value }
  if (bg.type === 'gradient') return { background: bg.value }
  const url = imageUrl(vaultPath, bg.path)
  if (!url) return null
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * Lets the user pick an image, copies it into `<vault>/assets/board-backgrounds/`
 * and returns its vault-relative path (null if cancelled or unavailable).
 */
export async function pickBackgroundImage(vaultPath: string): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile, writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
    })
    if (!selected || typeof selected !== 'string') return null

    const dir = `${vaultPath}/${BACKGROUND_DIR}`
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    const ext = (selected.split('.').pop() ?? 'jpg').toLowerCase()
    const filename = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    await writeFile(`${dir}/${filename}`, await readFile(selected))
    return `${BACKGROUND_DIR}/${filename}`
  } catch (e) {
    console.error('[inkwell] could not set board background image:', e)
    return null
  }
}
