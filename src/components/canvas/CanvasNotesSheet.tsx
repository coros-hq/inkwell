import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { useAppStore } from '../../store/useAppStore'
import {
  markdownHighlighting, codeHighlighting, shellHighlightPlugin, highlightMarkPlugin, tablePlugin,
  liveMarkdownPlugin, mathPreviewField, chartPreviewField, mermaidPreviewField, dataTablePreviewField,
  tabsPreviewField, tablePreviewField, slashCommandCompletion, autocompleteTheme, tryAbbreviationReplace,
} from '../../lib/editorExtensions'
import { applyInlineFormat, changeListIndent, continueOutlineItem } from '../../lib/editorFormatting'
import { markdownEditorTheme } from '../editor/markdownEditorTheme'

interface Props {
  /** Focus the editor when the sheet opens (it stays mounted while hidden). */
  open?: boolean
  content: string
  onChange: (c: string) => void
  onClose: () => void
  title?: string
}

/**
 * Notes for a drawing (or one shape/group), edited with the same live markdown
 * editor as regular notes: syntax hides off the cursor line, tables, math and
 * mermaid render inline, lists continue on Enter, ⌘B/⌘I format.
 */
export function CanvasNotesSheet({ open, content, onChange, onClose, title = 'Diagram Notes' }: Props) {
  const { theme, editorFontSize, editorFontFamily, editorLineHeight } = useAppStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef      = useRef<EditorView | null>(null)
  const onChangeRef  = useRef(onChange)
  const contentRef   = useRef(content)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { contentRef.current = content },   [content])

  useEffect(() => {
    if (!containerRef.current) return
    const state = EditorState.create({
      doc: contentRef.current,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        drawSelection(),
        Prec.high(keymap.of([
          { key: 'Tab', run: v => changeListIndent(v, 1) },
          { key: 'Shift-Tab', run: v => changeListIndent(v, -1) },
          { key: 'Enter', run: continueOutlineItem },
        ])),
        EditorView.domEventHandlers({
          beforeinput: (event, view) => {
            if ((event.inputType === 'insertText' || event.inputType === 'insertFromPaste') && event.data
                && tryAbbreviationReplace(view, event.data)) {
              event.preventDefault()
              return true
            }
            return false
          },
          // Stop propagation so ⌘B doesn't also toggle the app sidebar.
          keydown: (event, view) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            const key = event.key.toLowerCase()
            const wrap = (prefix: string, suffix: string) => {
              event.preventDefault(); event.stopPropagation()
              applyInlineFormat(view, prefix, suffix)
              return true
            }
            if (key === 'b') return wrap('**', '**')
            if (key === 'i') return wrap('_', '_')
            if (key === 'u') return wrap('<u>', '</u>')
            if (event.shiftKey && key === 's') return wrap('~~', '~~')
            return false
          },
        }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        codeHighlighting,
        markdownHighlighting,
        shellHighlightPlugin,
        liveMarkdownPlugin, mathPreviewField, chartPreviewField, mermaidPreviewField,
        dataTablePreviewField, tabsPreviewField, tablePreviewField,
        highlightMarkPlugin,
        tablePlugin,
        slashCommandCompletion,
        autocompleteTheme,
        EditorView.lineWrapping,
        markdownEditorTheme({
          background: 'hsl(var(--background))',
          fontFamily: editorFontFamily,
          // A notch smaller than the main editor: this is a side panel.
          fontSize: Math.max(12, Number(editorFontSize) - 1),
          lineHeight: editorLineHeight,
          contentPadding: '16px 20px 48px',
          dark: theme === 'dark',
        }),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          contentRef.current = text
          onChangeRef.current(text)
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [theme, editorFontFamily, editorFontSize, editorLineHeight])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => viewRef.current?.focus(), 320) // after the slide-in
    return () => clearTimeout(t)
  }, [open])

  // Sync external content → editor (switching between diagram / shape notes, load from disk)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) view.dispatch({ changes: { from: 0, to: current.length, insert: content } })
  }, [content])

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  return (
    <div className="h-full flex flex-col bg-background border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pl-4 pr-2 h-11 border-b border-border shrink-0">
        <span className="text-[13px] font-medium text-foreground truncate">{title}</span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Close notes (⌘/)"
        >
          <X size={13} />
        </button>
      </div>

      {/* Editor */}
      <div ref={containerRef} className="inkwell-editor flex-1 min-h-0 overflow-hidden" />

      {/* Footer */}
      <div className="px-4 py-1.5 border-t border-border shrink-0 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <span className="text-[10px] text-muted-foreground/60">Markdown · / for commands</span>
      </div>
    </div>
  )
}
