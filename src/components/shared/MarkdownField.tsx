import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Image, Paperclip } from 'lucide-react'
import {
  markdownHighlighting,
  slashCommandCompletion,
  highlightMarkPlugin,
  tablePlugin,
  createFileEmbedPlugin,
  autocompleteTheme,
} from '../../lib/editorExtensions'
import { applyInlineFormat, applyFormatAction, FORMAT_TOOLBAR_ITEMS } from '../../lib/editorFormatting'
import { saveClipboardImage } from '../../lib/images'
import { pickAndCopyAttachment, makeAttachmentMarkdown, deleteAttachmentFile } from '../../lib/attachments'
import { cn } from '../../lib/utils'
import type { Attachment } from '../../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

interface MarkdownFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
  autoFocus?: boolean
  className?: string
  /** When provided, enables image paste and image/file embedding — pasted or
   *  uploaded files are copied into {vaultPath}/assets (images) or
   *  {vaultPath}/attachments (other files) and rendered inline via the same
   *  `![[path|name|size]]` embed widget the note editor uses. Omit to keep
   *  this field pure text (no filesystem access). */
  vaultPath?: string
}

/**
 * A small, self-contained CodeMirror markdown field — same syntax
 * highlighting/slash-commands/@-mention/image-embed support as the main note
 * editor, but bound to a plain value/onChange pair instead of a note. Used
 * wherever a "details" field needs to feel like the note editor without
 * creating an actual note (e.g. task details on the board). Remount with a
 * `key` prop when switching to a different record — this only reads `value`
 * once, on mount.
 */
export function MarkdownField({ value, onChange, placeholder, minHeight = '100px', autoFocus, className, vaultPath }: MarkdownFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const theme = EditorView.theme({
      '&': { backgroundColor: 'transparent' },
      '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
      '.cm-content': {
        padding: '8px 10px',
        caretColor: 'hsl(var(--accent))',
        fontSize: '13.5px',
        lineHeight: '1.6',
        minHeight,
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
    })

    // Remove the embedded file from disk when its trash button is clicked.
    // There's no attachment index for task details (unlike notes), so the
    // `![[...]]` markdown itself is the only bookkeeping needed.
    const handleRemoveEmbed = (relativePath: string) => {
      if (!vaultPath) return
      const att: Attachment = { id: '', name: relativePath.split('/').pop() ?? relativePath, path: relativePath, size: 0, type: 'other' }
      deleteAttachmentFile(vaultPath, att).catch(console.error)
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Cmd/Ctrl+B/I toggle bold/italic, and (when vaultPath is set) paste an
        // image straight from the clipboard. Handled via raw dom events (not
        // `keymap.of`) so keydown can stopPropagation — Cmd+B is also the
        // global "toggle sidebar" shortcut listened for on `window`, and
        // without stopping propagation it fires both. See MarkdownEditor.tsx
        // for the same fix on the main note editor.
        EditorView.domEventHandlers({
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
            return false
          },
          paste: (event, view) => {
            const files = event.clipboardData?.files
            const imageFile = files && Array.from(files).find(f => f.type.startsWith('image/'))
            if (!imageFile || !vaultPath) return false
            event.preventDefault()
            const { from, to } = view.state.selection.main
            saveClipboardImage(vaultPath, imageFile).then(attachment => {
              if (!attachment) return
              const snippet = makeAttachmentMarkdown(attachment)
              view.dispatch({
                changes: { from, to, insert: snippet },
                selection: { anchor: from + snippet.length },
              })
            })
            return true
          },
        }),
        markdown({ base: markdownLanguage }),
        markdownHighlighting,
        highlightMarkPlugin,
        tablePlugin,
        ...(vaultPath ? [createFileEmbedPlugin(vaultPath, handleRemoveEmbed)] : []),
        slashCommandCompletion,
        autocompleteTheme,
        placeholderExt(placeholder ?? ''),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(() => {
            onChangeRef.current(update.state.doc.toString())
          }, 500)
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    if (autoFocus) view.focus()

    return () => {
      // Flush any pending debounced change before tearing down, so switching
      // records right after typing doesn't silently drop the last edit.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        const doc = view.state.doc.toString()
        if (doc !== value) onChangeRef.current(doc)
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const insertEmbed = (attachment: Attachment) => {
    const view = viewRef.current
    if (!view) return
    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    const needsLeading = cursor !== line.from || line.text.trim().length > 0
    const snippet = (needsLeading ? '\n' : '') + makeAttachmentMarkdown(attachment) + '\n'
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: snippet },
      selection: { anchor: cursor + snippet.length },
    })
    view.focus()
  }

  const handleUploadImage = async () => {
    if (!vaultPath) return
    const attachment = await pickAndCopyAttachment(vaultPath)
    if (attachment) insertEmbed(attachment)
  }

  const handleAttachFile = async () => {
    if (!vaultPath) return
    const attachment = await pickAndCopyAttachment(vaultPath)
    if (attachment) insertEmbed(attachment)
  }

  return (
    <div className={cn('w-full bg-surface border border-border rounded-md focus-within:border-accent/50 transition-colors overflow-hidden', className)}>
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border/60">
        {FORMAT_TOOLBAR_ITEMS.map((item, i) =>
          item === null ? (
            <div key={i} className="w-px h-4 bg-border mx-0.5" />
          ) : (
            <button
              key={item.label}
              type="button"
              title={item.title}
              onMouseDown={e => {
                // Prevent focus loss from the editor before applying
                e.preventDefault()
                const view = viewRef.current
                if (view) applyFormatAction(view, item.action)
              }}
              className={cn(
                'text-[11px] font-medium text-muted-foreground hover:text-accent w-6 h-6 rounded hover:bg-active transition-colors flex items-center justify-center',
                item.className,
              )}
            >
              {item.label}
            </button>
          )
        )}
        {vaultPath && isTauri && (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              type="button"
              title="Upload image from computer"
              onMouseDown={e => { e.preventDefault(); void handleUploadImage() }}
              className="text-muted-foreground hover:text-accent w-6 h-6 rounded hover:bg-active transition-colors flex items-center justify-center"
            >
              <Image className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Attach file or document"
              onMouseDown={e => { e.preventDefault(); void handleAttachFile() }}
              className="text-muted-foreground hover:text-accent w-6 h-6 rounded hover:bg-active transition-colors flex items-center justify-center"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
      <div ref={containerRef} className="text-sm" />
    </div>
  )
}
