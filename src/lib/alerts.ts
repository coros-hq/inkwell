// GitHub-style alerts: a blockquote whose first line is `[!TYPE]`, e.g.
//
//   > [!WARNING] Optional custom title
//   > Body text, any markdown.
//
// Shared by the Reading view (remarkAlerts → RichPreview), Normal-mode live
// preview (editorExtensions.ts) and the slash menu, so all three agree on the
// types, labels and icons. Styling lives in globals.css (.md-alert / .cm-line-alert)
// and is mirrored in export.ts so exported HTML keeps it.
import { Info, Lightbulb, MessageSquareWarning, TriangleAlert, OctagonAlert, type LucideIcon } from 'lucide-react'

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export const ALERT_META: Record<AlertType, { label: string; icon: LucideIcon; hint: string }> = {
  note: { label: 'Note', icon: Info, hint: 'Useful information worth noticing' },
  tip: { label: 'Tip', icon: Lightbulb, hint: 'Advice for doing things better' },
  important: { label: 'Important', icon: MessageSquareWarning, hint: 'Key information not to miss' },
  warning: { label: 'Warning', icon: TriangleAlert, hint: 'Needs attention to avoid problems' },
  caution: { label: 'Caution', icon: OctagonAlert, hint: 'Risks or negative outcomes' },
}

/** The `[!TYPE] optional title` marker at the start of an alert's first line (after `> `). */
export const ALERT_MARKER_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*([^\n]*)/i

export function parseAlertType(raw: string): AlertType {
  return raw.toLowerCase() as AlertType
}

// One stylesheet for the app (injected by ensureAlertStyles) and HTML export
// (inlined by export.ts). Colours are fixed per type, like GitHub's, and read
// fine on both light and dark backgrounds; the tint is mixed from the same one.
export const ALERT_CSS = `
.md-alert-note      { --alert-c: #4493f8; }
.md-alert-tip       { --alert-c: #3fb950; }
.md-alert-important { --alert-c: #a371f7; }
.md-alert-warning   { --alert-c: #d29922; }
.md-alert-caution   { --alert-c: #f85149; }

.md-alert {
  margin: 1rem 0;
  padding: 0.6rem 1rem;
  border-left: 3px solid var(--alert-c);
  border-radius: 6px;
  background: color-mix(in srgb, var(--alert-c) 9%, transparent);
}
.md-alert > :last-child { margin-bottom: 0; }
.md-alert-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.35rem;
  font-weight: 600;
  color: var(--alert-c);
}
.md-alert-title:last-child { margin-bottom: 0; }
.md-alert-icon { width: 1em; height: 1em; flex-shrink: 0; }

/* Normal-mode live preview: the same box, drawn line by line. */
.cm-line.cm-line-alert {
  border-left: 3px solid var(--alert-c);
  background: color-mix(in srgb, var(--alert-c) 9%, transparent);
  padding-left: 14px !important;
  padding-right: 14px !important;
}
.cm-line.cm-line-alert-first { border-top-right-radius: 6px; padding-top: 6px !important; }
.cm-line.cm-line-alert-last { border-bottom-right-radius: 6px; padding-bottom: 6px !important; }
.cm-alert-title {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
  color: var(--alert-c);
}
.cm-alert-title svg { width: 1em; height: 1em; }
.cm-line-alert .cm-quote-text { color: hsl(var(--foreground)); font-style: normal; }
.cm-alert-custom-title, .cm-alert-custom-title .cm-quote-text { font-weight: 600; color: var(--alert-c); }
`

let injected = false
/** Adds ALERT_CSS to the document once. */
export function ensureAlertStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.dataset.inkwell = 'alerts'
  style.textContent = ALERT_CSS
  document.head.appendChild(style)
}
