const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * True when running inside the Windows desktop app. There the native frame is
 * disabled (see src-tauri/tauri.windows.conf.json), so the app draws its own
 * titlebar and window controls.
 */
export const isWindowsApp =
  inTauri && typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent)

/** True when running inside the macOS desktop app (native overlay titlebar with traffic lights). */
export const isMacApp =
  inTauri && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
