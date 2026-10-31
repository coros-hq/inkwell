import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  markdownHighlighting,
  codeHighlighting,
  shellHighlightPlugin,
  liveMarkdownPlugin,
  highlightMarkPlugin,
  tablePlugin,
  mathPreviewField,
  tablePreviewField,
} from '../../lib/editorExtensions'
import { applyInlineFormat } from '../../lib/editorFormatting'

interface Props {
  value: string
  onChange: (value: string) => void
}

// This editor renders inside the note editor's DOM, so the note editor's scoped
// theme (page padding, centred max-width, 100% height) also matches here.
// !important keeps those from leaking in.
const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: 'auto !important' },
  '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible !important', height: 'auto !important', padding: '0 !important' },
  '.cm-content': {
    padding: '0 !important',
    margin: '0 !important',
    maxWidth: 'none !important',
    minHeight: '72px',
    caretColor: 'hsl(var(--accent))',
    fontSize: '14.5px',
    lineHeight: '1.7',
  },
  '.cm-line': { color: 'hsl(var(--foreground))', padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--accent))', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'hsl(var(--accent) / 0.2) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--accent) / 0.25) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-placeholder': { color: 'hsl(var(--tertiary))' },
})

/**
 * Markdown editor for one tab: the same live formatting as the note editor
 * (concealed markup, highlighted code fences, tables, math), minus the
 * note-level features. Reads `value` once on mount — remount with a `key`
 * when switching tabs.
 */
export function TabEditor({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // The note editor's drawSelection hides the native caret for every .cm-content
          // inside it, this one included, so draw our own (it blinks).
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // Raw DOM handler so Cmd+B / Cmd+I don't also reach the window-level
          // "toggle sidebar" shortcut (same as the note editor).
          EditorView.domEventHandlers({
            keydown: (event, v) => {
              if (!(event.metaKey || event.ctrlKey)) return false
              const key = event.key.toLowerCase()
              if (key !== 'b' && key !== 'i') return false
              event.preventDefault()
              event.stopPropagation()
              if (key === 'b') applyInlineFormat(v, '**', '**')
              else applyInlineFormat(v, '_', '_')
              return true
            },
          }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          codeHighlighting,
          shellHighlightPlugin,
          markdownHighlighting,
          liveMarkdownPlugin,
          mathPreviewField,
          tablePreviewField,
          highlightMarkPlugin,
          tablePlugin,
          placeholderExt('Write markdown for this tab…'),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} />
}
