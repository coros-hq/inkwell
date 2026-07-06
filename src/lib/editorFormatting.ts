import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

export function applyInlineFormat(view: EditorView, prefix: string, suffix: string) {
  const { state } = view

  const changes = state.changeByRange(range => {
    const selected = state.sliceDoc(range.from, range.to)

    // 1. Exact inner wrap (e.g., selection is exactly "**bold**")
    if (
      selected.startsWith(prefix) &&
      selected.endsWith(suffix) &&
      selected.length >= prefix.length + suffix.length
    ) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }

    // 2. Enclosed wrap (cursor/selection is inside "**bold**")
    const line = state.doc.lineAt(range.from)
    let foundLeft = -1
    let foundRight = -1

    // Scan left for prefix within the same line
    for (let i = range.from; i >= line.from + prefix.length; i--) {
      if (state.sliceDoc(i - prefix.length, i) === prefix) {
        foundLeft = i - prefix.length
        break
      }
    }

    // Scan right for suffix within the same line
    if (foundLeft !== -1) {
      const lineEnd = state.doc.lineAt(range.to).to
      for (let i = range.to; i + suffix.length <= lineEnd; i++) {
        if (state.sliceDoc(i, i + suffix.length) === suffix) {
          foundRight = i
          break
        }
      }
    }

    // If enclosed, unwrap the entire block
    if (foundLeft !== -1 && foundRight !== -1) {
      const enclosedText = state.sliceDoc(foundLeft + prefix.length, foundRight)
      return {
        changes: { from: foundLeft, to: foundRight + suffix.length, insert: enclosedText },
        range: EditorSelection.range(foundLeft, foundLeft + enclosedText.length),
      }
    }

    // 3. Apply format normally
    const insert = prefix + selected + suffix
    const newFrom = range.from + prefix.length
    const newTo = newFrom + selected.length

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(newFrom, newTo),
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

    if (lineText.startsWith(prefix)) {
      const stripped = lineText.slice(prefix.length)
      const delta = -prefix.length
      return {
        changes: { from: line.from, to: line.to, insert: stripped },
        range: EditorSelection.range(range.from + delta, range.head + delta),
      }
    }

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
