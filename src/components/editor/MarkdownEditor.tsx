import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { saveNote } from '../../lib/fs';
import { useAppStore } from '../../store/useAppStore';

import { deleteAttachmentFile } from '../../lib/attachments';
import { createFileEmbedPlugin, highlightMarkPlugin, markdownHighlighting, markdownKeymap, slashCommandCompletion, tablePlugin } from '../../lib/editorExtensions';
import { searchHighlightExtension } from '../../lib/searchHighlightExtension';
import { useEditorViewRef } from './EditorViewContext';

interface MarkdownEditorProps {
  noteId: string
  content: string
  onScrollerReady?: (el: HTMLElement) => void
}

export function MarkdownEditor({ noteId, content, onScrollerReady }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useEditorViewRef()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { updateNote, setSaveStatus, theme, vaultPath, editorFontSize, editorFontFamily, editorLineHeight, removeAttachment } = useAppStore()

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

    const customTheme = EditorView.theme({
      '&': {
        backgroundColor: 'hsl(var(--background))',
        height: '100%',
      },
      '.cm-editor': {
        ...editorFontStyles,
      },
      '.cm-scroller': {
        overflow: 'auto',
        padding: '0',
        height: '100%',
        backgroundColor: 'hsl(var(--background))',
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
      // Autocomplete (slash command) dropdown
      '.cm-tooltip-autocomplete': {
        backgroundColor: 'hsl(var(--surface))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        padding: '4px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: editorFontFamily,
        maxHeight: '280px',
      },
      '.cm-tooltip-autocomplete ul li': {
        padding: '6px 10px',
        borderRadius: '4px',
        color: 'hsl(var(--foreground))',
        fontSize: '13px',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'hsl(var(--active))',
        color: 'hsl(var(--foreground))',
      },
      '.cm-completionDetail': {
        color: 'hsl(var(--muted-foreground))',
        fontSize: '11px',
        marginLeft: '8px',
      },
    })

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
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap]),
        // Chromium's contenteditable fires its own native undo/redo (beforeinput
        // historyUndo/historyRedo) which bypasses CodeMirror's managed history and
        // corrupts editor state. This only surfaces on Chromium-based WebViews
        // (WebView2 on Windows) — WebKit on macOS doesn't do this. Intercept it and
        // redirect through CodeMirror's own undo/redo commands instead.
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
        createFileEmbedPlugin(vaultPath ?? '', handleRemoveEmbed),
        slashCommandCompletion,
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
  }, [noteId, theme, editorFontSize, editorFontFamily, editorLineHeight])

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
      className="inkwell-editor h-full w-full overflow-hidden bg-background"
      style={{ minHeight: 0 }}
    />
  )
}
