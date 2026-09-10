import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
// Raw KaTeX stylesheet, inlined into exported HTML so rendered formulas keep
// their layout outside the app. Font files are referenced by URL and won't
// resolve in a standalone file — KaTeX's MathML fallback keeps math legible.
import katexCss from 'katex/dist/katex.min.css?inline'

// ─── Theme vars ───────────────────────────────────────────────────────────────

export interface ThemeVars {
  background: string
  foreground: string
  accent: string
  muted: string
  border: string
  surface: string
}

/** Read the current theme's resolved CSS variable values from the DOM. */
export function captureThemeVars(): ThemeVars {
  const style = window.getComputedStyle(document.documentElement)
  const get = (v: string) => `hsl(${style.getPropertyValue(v).trim()})`
  return {
    background: get('--background'),
    foreground: get('--foreground'),
    accent:     get('--accent'),
    muted:      get('--muted-foreground'),
    border:     get('--border'),
    surface:    get('--surface'),
  }
}

// ─── HTML document builder ────────────────────────────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Wrap captured innerHTML from RichPreview into a portable, self-contained
 * HTML document using the current theme's resolved colors.
 */
export function buildHtmlDocument(title: string, bodyHtml: string, vars: ThemeVars): string {
  const { background, foreground, accent, muted, border, surface } = vars

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
${katexCss}
</style>
<style>
  *, *::before, *::after { box-sizing: border-box; }

  :root {
    --bg:     ${background};
    --fg:     ${foreground};
    --accent: ${accent};
    --muted:  ${muted};
    --border: ${border};
    --surface:${surface};
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.7;
  }

  article {
    max-width: 720px;
    margin: 0 auto;
    padding: 3rem 2rem;
  }

  /* ── Typography ─────────────────────────────────────────────── */
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 1rem; line-height: 1.25; letter-spacing: -0.02em; }
  h2 { font-size: 1.125rem; font-weight: 600; color: var(--accent); margin: 2rem 0 0.75rem; letter-spacing: -0.015em; }
  h3 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; letter-spacing: -0.01em; }
  p  { margin: 0 0 1rem; }
  strong { font-weight: 600; }
  em { font-style: italic; }
  hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

  /* ── Links ──────────────────────────────────────────────────── */
  a { color: var(--accent); text-underline-offset: 2px; }
  a:hover { opacity: 0.8; }

  /* ── Code ───────────────────────────────────────────────────── */
  code {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
    font-size: 0.85em;
    color: var(--accent);
    background: rgba(128,128,128,0.1);
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
  pre {
    background: rgba(128,128,128,0.08);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    overflow-x: auto;
    margin: 0 0 1rem;
  }
  pre code { background: none; padding: 0; color: inherit; font-size: 0.8rem; }

  /* ── Blockquote ─────────────────────────────────────────────── */
  blockquote {
    border-left: 2px solid var(--accent);
    padding-left: 1rem;
    margin: 1rem 0 1rem 0;
    color: var(--muted);
    font-style: italic;
  }

  /* ── Lists ──────────────────────────────────────────────────── */
  ul, ol { margin: 0 0 1rem; padding-left: 1.5rem; }
  li { margin-bottom: 0.25rem; line-height: 1.7; }
  ul.contains-task-list { list-style: none; padding-left: 1rem; }
  li.task-list-item { display: flex; gap: 0.5rem; align-items: flex-start; }

  /* ── Tables ─────────────────────────────────────────────────── */
  .overflow-x-auto { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0 0 1rem; }
  thead { border-bottom: 1px solid var(--border); }
  th {
    padding: 0.625rem 0.75rem;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  td { padding: 0.625rem 0.75rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
  tbody tr:hover td { background: rgba(128,128,128,0.04); }

  /* ── Highlight ==text== ─────────────────────────────────────── */
  mark { background: rgba(253,224,71,0.3); color: inherit; border-radius: 2px; padding: 0 2px; }

  /* ── Images ─────────────────────────────────────────────────── */
  img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); margin: 1rem 0; }

  /* ── Checkboxes ─────────────────────────────────────────────── */
  input[type="checkbox"] { accent-color: var(--accent); margin-top: 4px; cursor: default; }

  /* Hide interactive UI elements from the export */
  button:not(input):not([type="checkbox"]) { display: none !important; }
  .absolute.top-2 { display: none !important; }

  /* ── Tailwind utility aliases (for captured class-based HTML) ── */
  .text-2xl  { font-size: 1.5rem;   line-height: 2rem; }
  .text-lg   { font-size: 1.125rem; line-height: 1.75rem; }
  .text-base { font-size: 1rem;     line-height: 1.5rem; }
  .text-sm   { font-size: 0.875rem; line-height: 1.25rem; }
  .text-xs   { font-size: 0.75rem;  line-height: 1rem; }
  .text-\\[15px\\] { font-size: 15px; }
  .text-\\[14px\\] { font-size: 14px; }
  .text-\\[13px\\] { font-size: 13px; }
  .text-\\[12px\\] { font-size: 12px; }
  .text-\\[11px\\] { font-size: 11px; }

  .font-semibold { font-weight: 600; }
  .font-medium   { font-weight: 500; }
  .font-sans     { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  .font-mono     { font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace; }
  .italic        { font-style: italic; }
  .uppercase     { text-transform: uppercase; }
  .tracking-wide { letter-spacing: 0.025em; }
  .tracking-tight { letter-spacing: -0.025em; }
  .leading-tight { line-height: 1.25; }
  .leading-\\[1\\.7\\] { line-height: 1.7; }
  .antialiased   { -webkit-font-smoothing: antialiased; }

  .text-foreground       { color: var(--fg); }
  .text-accent           { color: var(--accent); }
  .text-muted-foreground { color: var(--muted); }

  .mb-4 { margin-bottom: 1rem; }
  .mb-3 { margin-bottom: 0.75rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mt-8 { margin-top: 2rem; }
  .mt-6 { margin-top: 1.5rem; }
  .my-4 { margin-top: 1rem;    margin-bottom: 1rem; }
  .my-6 { margin-top: 1.5rem;  margin-bottom: 1.5rem; }
  .px-3   { padding-left: 0.75rem; padding-right: 0.75rem; }
  .py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
  .px-1\\.5 { padding-left: 0.375rem; padding-right: 0.375rem; }
  .py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
  .pl-4   { padding-left: 1rem; }
  .p-4    { padding: 1rem; }

  .flex       { display: flex; }
  .flex-wrap  { flex-wrap: wrap; }
  .items-start { align-items: flex-start; }
  .gap-x-2   { column-gap: 0.5rem; }
  .w-full     { width: 100%; }
  .max-w-full { max-width: 100%; }
  .max-w-\\[720px\\] { max-width: 720px; }
  .mx-auto    { margin-left: auto; margin-right: auto; }
  .relative   { position: relative; }
  .overflow-x-auto { overflow-x: auto; }

  .border-collapse { border-collapse: collapse; }
  .border-border   { border-color: var(--border); }
  .border-b        { border-bottom-width: 1px; border-bottom-style: solid; }
  .border-l-2      { border-left-width: 2px; border-left-style: solid; }
  .border-accent   { border-color: var(--accent); }

  .list-disc    { list-style-type: disc; }
  .list-decimal { list-style-type: decimal; }
  .list-inside  { list-style-position: inside; }
  .list-none    { list-style: none; padding-left: 0; }
  .space-y-1 > * + * { margin-top: 0.25rem; }

  .underline           { text-decoration: underline; }
  .underline-offset-2  { text-underline-offset: 2px; }

  .rounded    { border-radius: 0.25rem; }
  .rounded-lg { border-radius: 0.5rem; }

  .bg-yellow-300\\/30 { background: rgba(253,224,71,0.3); }
  .bg-code-bg         { background: rgba(128,128,128,0.1); }
  .inkwell-code-block { background: rgba(128,128,128,0.08); border: 1px solid var(--border); }

  /* Hide copy buttons that appear on code blocks */
  .group > button, .group > .absolute { display: none !important; }
</style>
</head>
<body>
<article>
${bodyHtml}
</article>
</body>
</html>`
}

// ─── File save ────────────────────────────────────────────────────────────────

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Open a native save dialog and write the content to the chosen path.
 * Falls back to a browser download anchor outside Tauri.
 */
export async function saveAsFile(
  content: string,
  defaultName: string,
  ext: string,
): Promise<boolean> {
  if (isTauri) {
    try {
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
      if (!filePath) return false
      await writeTextFile(filePath, content)
      return true
    } catch (e) {
      console.error('Save failed:', e)
      return false
    }
  } else {
    // Browser fallback
    const blob = new Blob([content], { type: ext === 'html' ? 'text/html' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

// ─── Print to PDF ─────────────────────────────────────────────────────────────

/**
 * Write HTML into a hidden iframe and open the system print dialog.
 * On macOS/Windows the user can choose "Save as PDF" from there.
 */
export function printAsHtml(htmlContent: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:900px;height:700px;border:none;visibility:hidden;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    document.body.removeChild(iframe)
    return
  }

  doc.open()
  doc.write(htmlContent)
  doc.close()

  // Give the browser a moment to fully parse + apply styles before printing
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch (e) {
      console.error('Print failed:', e)
    }
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 2000)
  }, 400)
}
