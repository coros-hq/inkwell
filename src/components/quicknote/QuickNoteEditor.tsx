import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  markdownHighlighting,
  slashCommandCompletionBasic,
  highlightMarkPlugin,
  tablePlugin,
  autocompleteTheme,
} from '../../lib/editorExtensions'

export interface QuickNoteEditorHandle {
  focus: () => void
}

interface QuickNoteEditorProps {
  onChange: (text: string) => void
  onSave: () => void
  onCancel: () => void
}

/**
 * A small, self-contained CodeMirror markdown editor for the quick-note
 * popup. Deliberately independent from the main `MarkdownEditor` — that one
 * is wired into useAppStore/autosave for a note that already lives in an
 * open vault, whereas here there's no note and often no vault selected yet.
 * Reuses the same syntax highlighting/extensions so it still feels like
 * inkwell, just without the store coupling.
 */
export const QuickNoteEditor = forwardRef<QuickNoteEditorHandle, QuickNoteEditorProps>(
  function QuickNoteEditor({ onChange, onSave, onCancel }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)

    // The CodeMirror instance is created once on mount; keep the latest
    // callbacks in refs so its keymap always calls current logic instead of
    // whatever closure existed at mount time.
    const onChangeRef = useRef(onChange)
    const onSaveRef = useRef(onSave)
    const onCancelRef = useRef(onCancel)
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onCancelRef.current = onCancel

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const theme = EditorView.theme({
        '&': { backgroundColor: 'transparent', height: '100%' },
        '.cm-scroller': {
          overflow: 'auto',
          padding: '0',
          height: '100%',
          backgroundColor: 'transparent',
          fontFamily: 'inherit',
        },
        '.cm-content': {
          padding: '12px 16px',
          caretColor: 'hsl(var(--accent))',
          fontSize: '13.5px',
          lineHeight: '1.6',
        },
        '.cm-line': { color: 'hsl(var(--foreground))' },
        '.cm-gutters': { display: 'none' },
        '.cm-cursor': { borderLeftColor: 'hsl(var(--accent))', borderLeftWidth: '2px' },
        '.cm-selectionBackground': { backgroundColor: 'hsl(var(--accent) / 0.2) !important' },
        '&.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--accent) / 0.25) !important' },
        '.cm-activeLine': { backgroundColor: 'transparent' },
        '.cm-placeholder': { color: 'hsl(var(--tertiary))' },
        '.cm-highlight-mark': {
          backgroundColor: 'hsl(47 96% 53% / 0.3)',
          borderRadius: '2px',
          padding: '0 1px',
        },
        // Autocomplete (slash command / @-mention) popup styling lives in
        // autocompleteTheme, bundled into slashCommandCompletionBasic below.
      })

      // Cmd/Ctrl+Enter saves, Escape cancels — placed ahead of the default
      // keymaps so they always win.
      const shortcutKeymap = keymap.of([
        { key: 'Mod-Enter', run: () => { onSaveRef.current(); return true } },
        { key: 'Escape', run: () => { onCancelRef.current(); return true } },
        ...defaultKeymap,
        ...historyKeymap,
      ])

      const state = EditorState.create({
        doc: '',
        extensions: [
          history(),
          shortcutKeymap,
          // See MarkdownEditor.tsx for why this is needed — Chromium's native
          // contenteditable undo (WebView2 on Windows) bypasses CodeMirror's own
          // history and must be redirected through it explicitly.
          EditorView.domEventHandlers({
            beforeinput: (event, view) => {
              if (event.inputType === 'historyUndo') { event.preventDefault(); undo(view); return true }
              if (event.inputType === 'historyRedo') { event.preventDefault(); redo(view); return true }
              return false
            },
          }),
          markdown({ base: markdownLanguage }),
          markdownHighlighting,
          highlightMarkPlugin,
          tablePlugin,
          slashCommandCompletionBasic,
          autocompleteTheme,
          placeholder('Quick note… (Markdown supported)'),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            onChangeRef.current(update.state.doc.toString())
          }),
        ],
      })

      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
      view.focus()

      return () => {
        view.destroy()
        viewRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return <div ref={containerRef} className="h-full w-full overflow-hidden" />
  },
)
