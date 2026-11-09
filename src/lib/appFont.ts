/**
 * The user's chosen font applies to the whole app, not just the editor.
 * It is exposed as the `--font-app` CSS variable on <html>; Tailwind's
 * `font-sans`/`font-serif`, the body and the editor all read it. Code stays
 * monospace on purpose.
 */
export const DEFAULT_APP_FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

// Historical key from when this was an editor-only setting — kept so existing choices carry over.
export const APP_FONT_KEY = 'inkwell-editor-fontFamily'

export function savedAppFont(): string {
  try { return localStorage.getItem(APP_FONT_KEY) || DEFAULT_APP_FONT } catch { return DEFAULT_APP_FONT }
}

export function applyAppFont(stack: string): void {
  document.documentElement.style.setProperty('--font-app', stack || DEFAULT_APP_FONT)
}
