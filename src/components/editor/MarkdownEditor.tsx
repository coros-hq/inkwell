import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { useAppStore } from '../../store/useAppStore'
import { cn, glassBg } from '../../lib/utils'

import { markdownHighlighting, slashCommandCompletion, tryAbbreviationReplace, highlightMarkPlugin, tablePlugin, autocompleteTheme, formattingKeymap } from '../../lib/editorExtensions'
import { searchHighlightExtension } from '../../lib/searchHighlightExtension'
import { useEditorViewRef } from './EditorViewContext'
import { saveImageBytes, makeAttachmentMarkdown } from '../../lib/attachments'
import type { Attachment } from '../../types'

interface MarkdownEditorProps {
  /** Unique id of the document being edited — switching it fully re-initializes CodeMirror. */
  docId: string
  content: string
  /** Fired on every keystroke with the full document text. */
  onChange: (content: string) => void
  /** Fired ~800ms after typing stops, for persistence. */
  onSave?: (content: string) => void | Promise<void>
  onSaveStatusChange?: (status: 'saving' | 'saved') => void
  /** Fired when an image pasted into the editor has been copied into the vault's attachments folder. */
  onAttachmentSaved?: (attachment: Attachment) => void
  onScrollerReady?: (el: HTMLElement) => void
}

export function MarkdownEditor({ docId, content, onChange, onSave, onSaveStatusChange, onAttachmentSaved, onScrollerReady }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useEditorViewRef()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { theme, editorFontSize, editorFontFamily, editorLineHeight, bodyGlass, glassOpacity } = useAppStore()

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  onSaveStatusChangeRef.current = onSaveStatusChange
  const onAttachmentSavedRef = useRef(onAttachmentSaved)
  onAttachmentSavedRef.current = onAttachmentSaved

  const editorFontStyles = {
    fontFamily: editorFontFamily,
    fontSize: editorFontSize,
    lineHeight: editorLineHeight,
    fontWeight: '400',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
  } as const

  useEffect(() => {
    if (!containerRef.current) return

    const editorBg = bodyGlass ? `hsl(var(--background) / ${glassOpacity / 100})` : 'hsl(var(--background))'

    const customTheme = EditorView.theme({
      '&': {
        backgroundColor: editorBg,
        height: '100%',
      },
      '.cm-editor': {
        ...editorFontStyles,
      },
      '.cm-scroller': {
        overflow: 'auto',
        padding: '0',
        height: '100%',
        backgroundColor: editorBg,
        ...editorFontStyles,
      },
      '.cm-content': {
        padding: '24px 32px',
        maxWidth: '720px',
        margin: '0 auto',
        caretColor: 'hsl(var(--accent))',
        ...editorFontStyles,
      },
      '.cm-line': {
        color: 'hsl(var(--foreground))',
        fontFamily: editorFontFamily,
      },
      '.cm-gutters': { display: 'none' },
      '.cm-cursor': {
        borderLeftColor: 'hsl(var(--accent))',
        borderLeftWidth: '2px',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'hsl(var(--accent) / 0.2) !important',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'hsl(var(--accent) / 0.25) !important',
      },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
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
    })

    // Saves a pasted image to the vault's attachments folder and inserts an
    // embed at the cursor position it was pasted at.
    const handlePasteImage = async (file: File, view: EditorView, pos: number) => {
      const vaultPath = useAppStore.getState().vaultPath
      if (!vaultPath) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      const att = await saveImageBytes(vaultPath, bytes, file.type)
      if (!att) return
      onAttachmentSavedRef.current?.(att)
      const embed = makeAttachmentMarkdown(att)
      view.dispatch({
        changes: { from: pos, to: pos, insert: embed },
        selection: { anchor: pos + embed.length },
      })
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        formattingKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Chromium's contenteditable fires its own native undo/redo (beforeinput
        // historyUndo/historyRedo) which bypasses CodeMirror's managed history and
        // corrupts editor state. This only surfaces on Chromium-based WebViews
        // (WebView2 on Windows) — WebKit on macOS doesn't do this. Intercept it and
        // redirect through CodeMirror's own undo/redo commands instead.
        EditorView.domEventHandlers({
          beforeinput: (event, view) => {
            if (event.inputType === 'historyUndo') { event.preventDefault(); undo(view); return true }
            if (event.inputType === 'historyRedo') { event.preventDefault(); redo(view); return true }
            if ((event.inputType === 'insertText' || event.inputType === 'insertFromPaste') && event.data) {
              if (tryAbbreviationReplace(view, event.data)) {
                event.preventDefault()
                return true
              }
            }
            return false
          },
          paste: (event, view) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            const imageFile = files.find(f => f.type.startsWith('image/'))
            if (!imageFile) return false
            event.preventDefault()
            const pos = view.state.selection.main.from
            handlePasteImage(imageFile, view, pos).catch(console.error)
            return true
          },
        }),
        markdown({ base: markdownLanguage }),
        markdownHighlighting,
        highlightMarkPlugin,
        tablePlugin,
        slashCommandCompletion,
        autocompleteTheme,
        EditorView.lineWrapping,
        ...searchHighlightExtension,
        customTheme,
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const newContent = update.state.doc.toString()
          onChangeRef.current(newContent)

          onSaveStatusChangeRef.current?.('saving')
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(async () => {
            await onSaveRef.current?.(newContent)
            onSaveStatusChangeRef.current?.('saved')
          }, 800)
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    onScrollerReady?.(view.scrollDOM)

    return () => {
      view.destroy()
      viewRef.current = null
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [docId, theme, editorFontSize, editorFontFamily, editorLineHeight, bodyGlass, glassOpacity])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      })
    }
  }, [content])

  return (
    <div
      ref={containerRef}
      className={cn("inkwell-editor h-full w-full overflow-hidden", bodyGlass ? "backdrop-blur-2xl" : "bg-background")}
      style={{ minHeight: 0, ...(bodyGlass ? glassBg('background', glassOpacity) : {}) }}
    />
  )
}
