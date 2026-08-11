import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { vim } from '@replit/codemirror-vim'
import { useAppStore } from '../../store/useAppStore'
import { saveNote } from '../../lib/fs'
import { cn, glassBg } from '../../lib/utils'

import { markdownHighlighting, codeHighlighting, slashCommandCompletion, tryAbbreviationReplace, highlightMarkPlugin, tablePlugin, createFileEmbedPlugin, autocompleteTheme, liveMarkdownPlugin } from '../../lib/editorExtensions'
import { searchHighlightExtension } from '../../lib/searchHighlightExtension'
import { useEditorViewRef } from './EditorViewContext'
import { deleteAttachmentFile, makeAttachmentMarkdown } from '../../lib/attachments'
import { saveClipboardImage } from '../../lib/images'
import { applyInlineFormat } from '../../lib/editorFormatting'

interface MarkdownEditorProps {
  noteId: string
  content: string
  onScrollerReady?: (el: HTMLElement) => void
  /** false for the raw-source pane in Markdown mode — Normal mode wants the
   * WYSIWYG live-preview conceal behavior, the source pane wants plain markdown. */
  liveConceal?: boolean
}

export function MarkdownEditor({ noteId, content, onScrollerReady, liveConceal = true }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useEditorViewRef()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { updateNote, setSaveStatus, theme, vaultPath, editorFontSize, editorFontFamily, editorLineHeight, removeAttachment, addAttachment, bodyGlass, glassOpacity, vimModeEnabled } = useAppStore()

  const editorFontStyles = {
    fontFamily: editorFontFamily,
    fontSize: editorFontSize,
    lineHeight: editorLineHeight,
    fontWeight: '500',
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
        padding: '64px 40px 96px',
        maxWidth: '740px',
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
      // ── Vim mode (only present when vimModeEnabled) ──────────────────────
      // The package ships its own theme (block cursor color, status panel) with
      // Prec.highest + hardcoded colors (a pink cursor block) that clash with
      // every app theme. Override with `!important` — that's the only thing
      // that reliably beats both the package's own Prec.highest theme and the
      // inline `style.color` it sets directly on the cursor element per frame.
      '.cm-vim-panel': {
        borderTop: '1px solid hsl(var(--border))',
        color: 'hsl(var(--foreground))',
        backgroundColor: editorBg,
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
    }, { dark: theme === 'dark' })

    // Called by the embed widget's trash button: remove the attachment from the
    // note's list and delete the file from disk.
    const handleRemoveEmbed = (relativePath: string) => {
      const note = useAppStore.getState().notes.find(n => n.id === noteId)
      const att = note?.attachments?.find(a => a.path === relativePath)
      if (att) {
        removeAttachment(noteId, att.id)
        if (vaultPath) deleteAttachmentFile(vaultPath, att).catch(console.error)
      }
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Must be the first extension — it needs to see keystrokes before the
        // default keymap does so it can interpret them as vim motions/commands
        // instead of plain text input while in Normal/Visual mode.
        ...(vimModeEnabled ? [vim({ status: true })] : []),
        history(),
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
          // Cmd/Ctrl+B/I/U/Shift+S toggle inline formatting. Handled here (not via
          // `keymap.of`) so we can stopPropagation — Cmd+B is also the global
          // "toggle sidebar" shortcut (see shortcuts.ts) listened for on `window`,
          // and without stopping propagation it would fire both.
          keydown: (event, view) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            const key = event.key.toLowerCase()
            const wrap = (prefix: string, suffix: string) => {
              event.preventDefault()
              event.stopPropagation()
              applyInlineFormat(view, prefix, suffix)
              return true
            }
            if (key === 'b') return wrap('**', '**')
            if (key === 'i') return wrap('_', '_')
            if (key === 'u') return wrap('<u>', '</u>')
            if (event.shiftKey && key === 's') return wrap('~~', '~~')
            return false
          },
          // Paste a clipboard image straight into the note, saved to
          // {vaultPath}/assets/, instead of dropping it silently.
          paste: (event, view) => {
            const vp = useAppStore.getState().vaultPath
            const files = event.clipboardData?.files
            const imageFile = files && Array.from(files).find(f => f.type.startsWith('image/'))
            if (!imageFile || !vp) return false
            event.preventDefault()
            const { from, to } = view.state.selection.main
            saveClipboardImage(vp, imageFile).then(attachment => {
              if (!attachment) return
              addAttachment(noteId, attachment)
              const snippet = makeAttachmentMarkdown(attachment)
              view.dispatch({
                changes: { from, to, insert: snippet },
                selection: { anchor: from + snippet.length },
              })
            })
            return true
          },
        }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        markdownHighlighting,
        codeHighlighting,
        ...(liveConceal ? [liveMarkdownPlugin] : []),
        highlightMarkPlugin,
        tablePlugin,
        createFileEmbedPlugin(vaultPath ?? '', handleRemoveEmbed, useAppStore.getState().notes.find(n => n.id === noteId)?.searchRoot),
        slashCommandCompletion,
        autocompleteTheme,
        EditorView.lineWrapping,
        ...searchHighlightExtension,
        customTheme,
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const newContent = update.state.doc.toString()
          updateNote(noteId, newContent)

          setSaveStatus('saving')
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(async () => {
            const note = useAppStore.getState().notes.find(n => n.id === noteId)
            if (note) {
              await saveNote(note.path, newContent)
            }
            setSaveStatus('saved')
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
  }, [noteId, theme, editorFontSize, editorFontFamily, editorLineHeight, bodyGlass, glassOpacity, vimModeEnabled, liveConceal])

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
