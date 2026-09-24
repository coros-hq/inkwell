import { invoke } from '@tauri-apps/api/core'

let cached: Promise<string[]> | null = null

/** Family names of every font installed on the machine (cached per session). */
export function listSystemFonts(): Promise<string[]> {
  if (!cached) {
    cached = invoke<string[]>('list_system_fonts').catch(err => {
      console.error(err)
      cached = null
      return []
    })
  }
  return cached
}

/** Build a CSS font-family stack for a local font, with a sensible fallback. */
export function localFontStack(family: string): string {
  return `"${family.replace(/"/g, '\\"')}", -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
}

/** The first family named in a CSS font-family stack, unquoted. */
export function primaryFamily(stack: string): string {
  return stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}
