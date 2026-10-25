const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const EXTERNAL_URL_RE = /^(https?:\/\/|mailto:)/i

export function isExternalUrl(href: string | null | undefined): href is string {
  return !!href && EXTERNAL_URL_RE.test(href.trim())
}

// Opens a web/mailto link in the system browser. A Tauri webview ignores
// plain <a href> navigation, so every external link has to go through here.
export function openExternalUrl(url: string): void {
  const target = url.trim()
  if (!isExternalUrl(target)) return
  if (isTauriEnv) {
    import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(target))
      .catch(console.error)
  } else {
    window.open(target, '_blank', 'noopener,noreferrer')
  }
}

// Capture-phase listener: any click on an <a> with an external href opens in
// the browser instead of navigating the app webview away.
export function installExternalLinkHandler(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    const anchor = (e.target as Element | null)?.closest?.('a[href]')
    const href = anchor?.getAttribute('href')
    if (!isExternalUrl(href)) return
    e.preventDefault()
    openExternalUrl(href)
  }, true)
}
