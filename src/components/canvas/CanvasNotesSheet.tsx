import { useState, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkMathCodeBlocks } from '../../lib/remarkMathCodeBlocks'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import {
  markdownHighlighting,
  highlightMarkPlugin,
  tablePlugin,
} from '../../lib/editorExtensions'

interface Props {
  content: string
  onChange: (c: string) => void
  onClose: () => void
}

export function CanvasNotesSheet({ content, onChange, onClose }: Props) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const { theme, editorFontSize, editorFontFamily, editorLineHeight } = useAppStore()

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const viewRef            = useRef<EditorView | null>(null)
  const onChangeRef        = useRef(onChange)
  const contentRef         = useRef(content)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { contentRef.current = content },   [content])

  // ── Build CodeMirror — same theme/extensions as MarkdownEditor ───────────

  useEffect(() => {
    if (tab !== 'edit' || !editorContainerRef.current) return

    const fontStyles = {
      fontFamily:            editorFontFamily,
      fontSize:              editorFontSize,
      lineHeight:            editorLineHeight,
      fontWeight:            '400',
      WebkitFontSmoothing:   'antialiased',
      MozOsxFontSmoothing:   'grayscale',
      fontFeatureSettings:   '"kern" 1, "liga" 1, "calt" 1',
    } as const

    const customTheme = EditorView.theme({
      '&': {
        backgroundColor: 'hsl(var(--background))',
        height: '100%',
      },
      '.cm-editor': { ...fontStyles },
      '.cm-scroller': {
        overflow: 'auto',
        height: '100%',
        backgroundColor: 'hsl(var(--background))',
        ...fontStyles,
      },
      '.cm-content': {
        padding: '20px 24px',
        caretColor: 'hsl(var(--accent))',
        ...fontStyles,
      },
      '.cm-line': {
        color: 'hsl(var(--foreground))',
        fontFamily: editorFontFamily,
      },
      '.cm-gutters':      { display: 'none' },
      '.cm-cursor':       { borderLeftColor: 'hsl(var(--accent))', borderLeftWidth: '2px' },
      '.cm-selectionBackground':         { backgroundColor: 'hsl(var(--accent) / 0.2) !important' },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--accent) / 0.25) !important' },
      '.cm-activeLine':      { backgroundColor: 'transparent' },
      '.cm-activeLineGutter':{ backgroundColor: 'transparent' },
      // ==Highlight== mark
      '.cm-highlight-mark': {
        backgroundColor: 'hsl(47 96% 53% / 0.3)',
        borderRadius: '2px',
        padding: '0 1px',
      },
      // Tables
      '.cm-table-header':    { backgroundColor: 'hsl(var(--accent) / 0.1)', fontWeight: '600' },
      '.cm-table-separator': { color: 'hsl(var(--border))', opacity: '0.5' },
      '.cm-table-row-even':  { backgroundColor: 'hsl(var(--surface) / 0.5)' },
      '.cm-table-row-odd':   { backgroundColor: 'transparent' },
      '.cm-table-pipe':      { color: 'hsl(var(--accent) / 0.6)', fontWeight: '500' },
    })

    const state = EditorState.create({
      doc: contentRef.current,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        markdownHighlighting,
        highlightMarkPlugin,
        tablePlugin,
        EditorView.lineWrapping,
        customTheme,
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          contentRef.current = text
          onChangeRef.current(text)
        }),
      ],
    })

    const view = new EditorView({ state, parent: editorContainerRef.current })
    viewRef.current = view
    setTimeout(() => view.focus(), 50)

    return () => { view.destroy(); viewRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, theme, editorFontFamily, editorFontSize, editorLineHeight])

  // Sync external content → editor (e.g. initial load from disk)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } })
    }
  }, [content])

  // ⌘⇧P → toggle preview
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault()
      setTab(t => t === 'edit' ? 'preview' : 'edit')
    }
  }, [])

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  return (
    <div className="h-full flex flex-col bg-background" onKeyDown={handleKeyDown}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">Diagram Notes</span>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setTab('edit')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                tab === 'edit'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Edit
            </button>
            <button
              onClick={() => setTab('preview')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                tab === 'preview'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Preview
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close notes (⌘/)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {/* Edit — CodeMirror */}
        <div
          ref={editorContainerRef}
          className="inkwell-editor h-full w-full overflow-hidden"
          style={{ display: tab === 'edit' ? 'block' : 'none' }}
        />

        {/* Preview — ReactMarkdown */}
        {tab === 'preview' && (
          <div className="h-full overflow-auto px-6 py-5">
            {content.trim() ? (
              <div className="canvas-notes-preview text-sm text-foreground leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath, remarkMathCodeBlocks]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false, output: 'htmlAndMathml' }]]}
                >{content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/40 italic mt-4">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 border-t border-border shrink-0 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount} chars
        </span>
        <span className="text-[10px] text-muted-foreground/50">⌘/ to close</span>
      </div>
    </div>
  )
}
