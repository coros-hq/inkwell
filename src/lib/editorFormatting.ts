import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

// Shared inline/block markdown-toggling logic, used by both the floating
// toolbar (mouse) and the editor's own keymap (Cmd/Ctrl+B, +I, ...).

export function applyInlineFormat(view: EditorView, prefix: string, suffix: string) {
  const { state } = view
  const changes = state.changeByRange(range => {
    const selected = state.sliceDoc(range.from, range.to)

    // Toggle off if the selection itself is fully wrapped, e.g. "**bold**" selected whole
    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }

    // Toggle off if the markers sit just outside the selection/cursor, e.g. cursor
    // placed inside "**|bold|**" or "**|**" with nothing selected — the common case
    // when the button is clicked with no text highlighted.
    const before = state.sliceDoc(Math.max(0, range.from - prefix.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + suffix.length))
    if (before === prefix && after === suffix) {
      return {
        changes: [
          { from: range.from - prefix.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + suffix.length, insert: '' },
        ],
        range: EditorSelection.range(range.from - prefix.length, range.to - prefix.length),
      }
    }

    const insert = prefix + selected + suffix
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + prefix.length, range.from + prefix.length + selected.length),
    }
  })
  view.dispatch(changes)
  view.focus()
}

export function applyBlockFormat(view: EditorView, prefix: string) {
  const { state } = view
  const changes = state.changeByRange(range => {
    const line = state.doc.lineAt(range.from)
    const lineText = line.text

    // Toggle off if the line already starts with this prefix
    if (lineText.startsWith(prefix)) {
      const stripped = lineText.slice(prefix.length)
      const delta = -prefix.length
      return {
        changes: { from: line.from, to: line.to, insert: stripped },
        range: EditorSelection.range(range.from + delta, range.head + delta),
      }
    }

    // Remove any existing heading prefix first
    const withoutPrefix = lineText.replace(/^#{1,6} /, '')
    const insert = prefix + withoutPrefix
    const delta = insert.length - withoutPrefix.length
    return {
      changes: { from: line.from, to: line.to, insert },
      range: EditorSelection.range(range.from + delta, range.head + delta),
    }
  })
  view.dispatch(changes)
  view.focus()
}

export function insertAtCursor(view: EditorView, text: string) {
  const cursor = view.state.selection.main.head
  view.dispatch({
    changes: { from: cursor, to: cursor, insert: text },
    selection: { anchor: cursor + text.length },
  })
  view.focus()
}

// Shared formatting-button set — same buttons in the main note editor's
// floating toolbar and the inline toolbar on markdown fields (e.g. task details).

export type FormatAction =
  | { type: 'inline'; prefix: string; suffix: string }
  | { type: 'block'; prefix: string }

export const FORMAT_TOOLBAR_ITEMS: Array<{
  label: string
  title: string
  className: string
  action: FormatAction
} | null> = [
  { label: 'B', title: 'Bold', className: 'font-bold', action: { type: 'inline', prefix: '**', suffix: '**' } },
  { label: 'I', title: 'Italic', className: 'italic', action: { type: 'inline', prefix: '_', suffix: '_' } },
  { label: 'U', title: 'Underline', className: 'underline', action: { type: 'inline', prefix: '<u>', suffix: '</u>' } },
  { label: 'S', title: 'Strikethrough', className: 'line-through', action: { type: 'inline', prefix: '~~', suffix: '~~' } },
  { label: '</>', title: 'Inline Code', className: 'font-mono text-[11px]', action: { type: 'inline', prefix: '`', suffix: '`' } },
  null,
  { label: 'H1', title: 'Heading 1', className: '', action: { type: 'block', prefix: '# ' } },
  { label: 'H2', title: 'Heading 2', className: '', action: { type: 'block', prefix: '## ' } },
  { label: 'H3', title: 'Heading 3', className: '', action: { type: 'block', prefix: '### ' } },
]

export function applyFormatAction(view: EditorView, action: FormatAction) {
  if (action.type === 'inline') applyInlineFormat(view, action.prefix, action.suffix)
  else applyBlockFormat(view, action.prefix)
}

// ─── Colors ──────────────────────────────────────────────────────────────────
// Highlight and text color are inline HTML so they stay plain-text portable:
//   <mark class="hl-yellow">text</mark>   <span class="tc-red">text</span>
// The classes are defined in globals.css (palette in lib/palette.ts).

export type ColorKind = 'highlight' | 'text'

const COLOR_TAGS: Record<ColorKind, { tag: 'mark' | 'span'; prefix: 'hl' | 'tc' }> = {
  highlight: { tag: 'mark', prefix: 'hl' },
  text: { tag: 'span', prefix: 'tc' },
}

/** Wrap the selection in a color tag, swap the color if it's already wrapped
 *  in one of the same kind, or unwrap when `color` is null. */
export function applyColorFormat(view: EditorView, kind: ColorKind, color: string | null) {
  const { tag, prefix } = COLOR_TAGS[kind]
  const openRe = new RegExp(`<${tag} class="${prefix}-[a-z]+">`)
  const close = `</${tag}>`
  const open = (c: string) => `<${tag} class="${prefix}-${c}">`
  const { state } = view

  const spec = state.changeByRange(range => {
    const selected = state.sliceDoc(range.from, range.to)

    // Selection includes the tags themselves.
    const whole = selected.match(new RegExp(`^(<${tag} class="${prefix}-[a-z]+">)([\\s\\S]*)${close}$`))
    if (whole) {
      const inner = whole[2]
      const insert = color ? open(color) + inner + close : inner
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from, range.from + insert.length) }
    }

    // Tags sit just outside the selection / cursor.
    const lineFrom = state.doc.lineAt(range.from).from
    const beforeText = state.sliceDoc(lineFrom, range.from)
    const openMatch = beforeText.match(new RegExp(`${openRe.source}$`))
    if (openMatch && state.sliceDoc(range.to, range.to + close.length) === close) {
      const openFrom = range.from - openMatch[0].length
      const changes = color
        ? [{ from: openFrom, to: range.from, insert: open(color) }]
        : [{ from: openFrom, to: range.from, insert: '' }, { from: range.to, to: range.to + close.length, insert: '' }]
      const shift = color ? open(color).length - openMatch[0].length : -openMatch[0].length
      return { changes, range: EditorSelection.range(range.from + shift, range.to + shift) }
    }

    if (!color) return { range }
    const o = open(color)
    return {
      changes: { from: range.from, to: range.to, insert: o + selected + close },
      range: EditorSelection.range(range.from + o.length, range.from + o.length + selected.length),
    }
  })
  view.dispatch(spec)
  view.focus()
}

// ─── Per-item bullet color ───────────────────────────────────────────────────
// Stored as an empty tag right after the list marker: `- <i class="bc-red"></i>item`.
// Hidden in the preview/live editor; the item's marker takes the color.

export const BULLET_TAG_RE = /^(\s*(?:[-*+]|\d+[.)])[ \t]+)(<i class="bc-([a-z]+)"><\/i>)?/
const TASK_RE = /^\s*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\]/

/** Color (or with null, reset) the marker of every list item the selection touches. */
export function applyBulletColorFormat(view: EditorView, color: string | null) {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const done = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) {
      if (done.has(n)) continue
      done.add(n)
      const line = state.doc.line(n)
      const m = line.text.match(BULLET_TAG_RE)
      if (!m || TASK_RE.test(line.text)) continue
      const at = line.from + m[1].length
      changes.push({ from: at, to: at + (m[2]?.length ?? 0), insert: color ? `<i class="bc-${color}"></i>` : '' })
    }
  }
  if (changes.length) view.dispatch({ changes })
  view.focus()
}
