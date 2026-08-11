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
