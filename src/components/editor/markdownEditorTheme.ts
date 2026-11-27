import { EditorView } from '@codemirror/view'

// The CodeMirror look shared by the note editor and the canvas notes sheet, so
// markdown (live tables, math, highlights, vim…) renders the same in both.

export interface MarkdownThemeOptions {
  background: string
  fontFamily: string
  fontSize: number | string
  lineHeight: number | string
  fontWeight?: string
  /** CSS padding of the text column. */
  contentPadding: string
  /** CSS max-width of the text column. */
  maxWidth?: string | number
  dark: boolean
}

export function markdownEditorTheme(o: MarkdownThemeOptions) {
  const fontStyles = {
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    lineHeight: o.lineHeight,
    fontWeight: o.fontWeight ?? '500',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
  } as const

  return EditorView.theme({
    '&': {
      backgroundColor: o.background,
      height: '100%',
    },
    '.cm-editor': {
      ...fontStyles,
    },
    '.cm-scroller': {
      overflow: 'auto',
      padding: '0',
      height: '100%',
      backgroundColor: o.background,
      ...fontStyles,
    },
    '.cm-content': {
      padding: o.contentPadding,
      maxWidth: o.maxWidth ?? 'none',
      margin: '0 auto',
      caretColor: 'hsl(var(--accent))',
      ...fontStyles,
    },
    '.cm-line': {
      color: 'hsl(var(--foreground))',
      fontFamily: o.fontFamily,
    },
    '.cm-gutters': { display: 'none' },
    '.cm-cursor': {
      borderLeftColor: 'hsl(var(--accent))',
      borderLeftWidth: '2px',
    },
    // Collaborators' carets (y-codemirror.next). The package hides the name
    // label until hover and sets it in `serif` — keep it always visible and
    // in the UI font so you can tell at a glance who is typing where.
    '.cm-ySelectionCaretDot': { display: 'none' },
    '.cm-ySelectionInfo': {
      opacity: '1',
      top: '-18px',
      left: '-1px',
      padding: '0 5px',
      borderRadius: '4px 4px 4px 0',
      fontFamily: 'var(--font-app)',
      fontSize: '11px',
      fontWeight: '500',
      lineHeight: '16px',
      pointerEvents: 'none',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'hsl(var(--accent) / 0.2) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'hsl(var(--accent) / 0.25) !important',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    // KaTeX live preview widgets
    '.cm-math-inline': {
      cursor: 'text',
      padding: '0 1px',
    },
    '.cm-math-block': {
      display: 'block',
      textAlign: 'center',
      padding: '6px 0',
      overflowX: 'auto',
      overflowY: 'hidden',
    },
    '.cm-math-block .katex-display': {
      margin: '0',
    },
    // Rendered GFM table (Normal mode live preview)
    '.cm-md-table-wrap': {
      // padding, not margin: CM measures the widget's own box
      padding: '8px 0',
      overflowX: 'auto',
    },
    '.cm-md-table': {
      width: '100%',
      borderCollapse: 'separate',
      borderSpacing: '0',
      border: '1px solid hsl(var(--border))',
      borderRadius: '8px',
      overflow: 'hidden',
      fontSize: '0.92em',
      lineHeight: '1.5',
    },
    '.cm-md-table th, .cm-md-table td': {
      padding: '7px 12px',
      textAlign: 'left',
      verticalAlign: 'top',
      borderBottom: '1px solid hsl(var(--border))',
      cursor: 'text',
    },
    '.cm-md-table th + th, .cm-md-table td + td': {
      borderLeft: '1px solid hsl(var(--border))',
    },
    '.cm-md-table tbody tr:last-child td': {
      borderBottom: 'none',
    },
    '.cm-md-table th': {
      fontWeight: '600',
      color: 'hsl(var(--foreground))',
      backgroundColor: 'hsl(var(--surface))',
    },
    '.cm-md-table tbody tr:nth-child(even) td': {
      backgroundColor: 'hsl(var(--surface) / 0.45)',
    },
    '.cm-md-table code': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '0.9em',
      padding: '1px 5px',
      borderRadius: '4px',
      backgroundColor: 'hsl(var(--muted-foreground) / 0.12)',
    },
    '.cm-md-table-link': {
      color: 'hsl(var(--accent))',
      textDecoration: 'underline',
    },
    // ==Highlight== mark
    '.cm-highlight-mark': {
      backgroundColor: 'hsl(47 96% 53% / 0.3)',
      borderRadius: '2px',
      padding: '0 1px',
    },
    // Markdown table
    '.cm-table-header': {
      backgroundColor: 'hsl(var(--accent) / 0.1)',
      fontWeight: '600',
    },
    '.cm-table-separator': {
      color: 'hsl(var(--border))',
      opacity: '0.5',
    },
    '.cm-table-row-even': {
      backgroundColor: 'hsl(var(--surface) / 0.5)',
    },
    '.cm-table-row-odd': {
      backgroundColor: 'transparent',
    },
    '.cm-table-pipe': {
      color: 'hsl(var(--accent) / 0.6)',
      fontWeight: '500',
    },
    // Autocomplete (slash command / @-mention) popup styling lives in
    // autocompleteTheme, bundled into slashCommandCompletion below.
    // ── Vim mode (only present when vimModeEnabled) ──────────────────────
    // The package ships its own theme (block cursor color, status panel) with
    // Prec.highest + hardcoded colors (a pink cursor block) that clash with
    // every app theme. Override with `!important` — that's the only thing
    // that reliably beats both the package's own Prec.highest theme and the
    // inline `style.color` it sets directly on the cursor element per frame.
    '.cm-vim-panel': {
      borderTop: '1px solid hsl(var(--border))',
      color: 'hsl(var(--foreground))',
      backgroundColor: o.background,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
    },
    '.cm-vim-panel input': {
      color: 'hsl(var(--foreground))',
      caretColor: 'hsl(var(--accent))',
    },
    // Normal/Visual-mode block cursor
    '.cm-fat-cursor': {
      backgroundColor: 'hsl(var(--accent)) !important',
      color: 'hsl(var(--background)) !important',
    },
    '&:not(.cm-focused) .cm-fat-cursor': {
      backgroundColor: 'transparent !important',
      outline: '1px solid hsl(var(--accent) / 0.6)',
      color: 'hsl(var(--accent)) !important',
    },
    // `dark` flag below activates vim's own `&dark`/`&light` search-match rule
  }, { dark: o.dark })
}
