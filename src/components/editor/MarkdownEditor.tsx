import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { vim } from '@replit/codemirror-vim'
import { useAppStore } from '../../store/useAppStore'
import { saveNote } from '../../lib/fs'
import { cn, glassBg } from '../../lib/utils'

import { markdownHighlighting, codeHighlighting, slashCommandCompletion, tryAbbreviationReplace, highlightMarkPlugin, tablePlugin, createFileEmbedPlugin, autocompleteTheme, liveMarkdownPlugin, mathPreviewField, chartPreviewField, tablePreviewField } from '../../lib/editorExtensions'
import { searchHighlightExtension } from '../../lib/searchHighlightExtension'
import { useEditorViewRef } from './EditorViewContext'
import { deleteAttachmentFile, makeAttachmentMarkdown } from '../../lib/attachments'
import { saveClipboardImage } from '../../lib/images'
import { applyInlineFormat } from '../../lib/editorFormatting'
import { NOTE_REF_RE, navigateToNote } from '../../lib/noteReferences'

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
        // Render selection ourselves so `.cm-selectionBackground` (styled
        // translucent in customTheme) applies. Without this CodeMirror falls
        // back to the opaque native browser highlight, which turns a selection
        // over a code block into an unreadable solid-blue rectangle.
        drawSelection(),
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
          // Cmd/Ctrl+click a `[@Title](note://id)` reference to jump to that
          // note — in both the raw-source pane and liveConceal (Normal) mode,
          // where the syntax is usually concealed down to just "@Title". A
          // plain click always stays free to place the cursor, so it doesn't
          // interfere with editing the link text or the surrounding line.
          mousedown: (event, view) => {
            if (event.button !== 0 || event.shiftKey || event.altKey) return false
            if (!(event.metaKey || event.ctrlKey)) return false
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            const offsetInLine = pos - line.from
            const re = new RegExp(NOTE_REF_RE.source, 'g')
            let match: RegExpExecArray | null
            while ((match = re.exec(line.text))) {
              if (offsetInLine >= match.index && offsetInLine <= match.index + match[0].length) {
                event.preventDefault()
                navigateToNote(match[2])
                return true
              }
            }
            return false
          },
        }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        // codeHighlighting first so its StyleModule loads before
        // markdownHighlighting's — on tags both define (punctuation, meta) the
        // markdown rule then wins the CSS tie and prose looks unchanged, while
        // code-only tags (keyword, string, number, …) still get coloured.
        codeHighlighting,
        markdownHighlighting,
        ...(liveConceal ? [liveMarkdownPlugin, mathPreviewField, chartPreviewField, tablePreviewField] : []),
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
