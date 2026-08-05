import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { Image, Upload, Paperclip } from 'lucide-react'
import { useEditorViewRef } from './EditorViewContext'
import { useAppStore } from '../../store/useAppStore'
import { pickAndCopyImage } from '../../lib/images'
import { pickAndCopyAttachment, makeAttachmentMarkdown } from '../../lib/attachments'
import { applyInlineFormat } from '../../lib/editorExtensions'
import { cn } from '../../lib/utils'
import type { Attachment } from '../../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

type FormatAction =
  | { type: 'inline'; prefix: string; suffix: string }
  | { type: 'block'; prefix: string }

const TOOLBAR_ITEMS: Array<{
  label: string
  title: string
  className: string
  action: FormatAction
} | null> = [
  { label: 'B', title: 'Bold', className: 'font-bold', action: { type: 'inline', prefix: '**', suffix: '**' } },
  { label: 'I', title: 'Italic', className: 'italic', action: { type: 'inline', prefix: '_', suffix: '_' } },
  { label: 'U', title: 'Underline', className: 'underline', action: { type: 'inline', prefix: '<u>', suffix: '</u>' } },
  { label: 'S', title: 'Strikethrough', className: 'line-through', action: { type: 'inline', prefix: '~~', suffix: '~~' } },
  { label: '</>', title: 'Inline Code', className: 'font-mono text-[11px]', action: { type: 'inline', prefix: '`', suffix: '`' } },
  null,
  { label: 'H1', title: 'Heading 1', className: '', action: { type: 'block', prefix: '# ' } },
  { label: 'H2', title: 'Heading 2', className: '', action: { type: 'block', prefix: '## ' } },
  { label: 'H3', title: 'Heading 3', className: '', action: { type: 'block', prefix: '### ' } },
]

function applyBlockFormat(view: EditorView, prefix: string) {
  const { state } = view
  const changes = state.changeByRange(range => {
    const line = state.doc.lineAt(range.from)
    const lineText = line.text

    // Toggle off if the line already starts with this prefix
    if (lineText.startsWith(prefix)) {
      const stripped = lineText.slice(prefix.length)
      const delta = -prefix.length
      return {
        changes: { from: line.from, to: line.to, insert: stripped },
        range: EditorSelection.range(range.from + delta, range.head + delta),
      }
    }

    // Remove any existing heading prefix first
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

function insertAtCursor(view: EditorView, text: string) {
  const cursor = view.state.selection.main.head
  view.dispatch({
    changes: { from: cursor, to: cursor, insert: text },
    selection: { anchor: cursor + text.length },
  })
  view.focus()
}

interface EditorToolbarProps {
  /** Overrides the default "attach to the last-selected note" behavior — used
   *  when the toolbar is driving an editor outside the notes domain (e.g. a
   *  task description) that has nowhere to track attachments. */
  onAttachmentAdded?: (attachment: Attachment) => void
  /** 'floating' (default) is the pill anchored over the bottom of the full-page
   *  note editor. 'sticky-top' is a full-width bar docked to the top of a
   *  bounded field, e.g. a task description box. */
  variant?: 'floating' | 'sticky-top'
}

export function EditorToolbar({ onAttachmentAdded, variant = 'floating' }: EditorToolbarProps = {}) {
  const viewRef = useEditorViewRef()
  const { vaultPath, openPrompt, addAttachment, lastSelectedNoteId } = useAppStore()

  const handleAction = (action: FormatAction) => {
    const view = viewRef.current
    if (!view) return
    if (action.type === 'inline') {
      applyInlineFormat(view, action.prefix, action.suffix)
    } else {
      applyBlockFormat(view, action.prefix)
    }
  }

  const handleImageUrl = () => {
    openPrompt({
      title: 'Insert Image from URL',
      description: 'Paste any image URL. It must point directly to an image, not a webpage.',
      placeholder: 'https://example.com/photo.jpg',
      confirmLabel: 'Insert',
      onConfirm: (url) => {
        const view = viewRef.current
        if (!view || !url.trim()) return
        insertAtCursor(view, `![image](${url.trim()})`)
      },
    })
  }

  const handleImageUpload = async () => {
    if (!vaultPath) return
    const snippet = await pickAndCopyImage(vaultPath)
    if (!snippet) return
    const view = viewRef.current
    if (!view) return
    insertAtCursor(view, snippet)
  }

  const handleFileUpload = async () => {
    if (!vaultPath) return
    const attachment = await pickAndCopyAttachment(vaultPath)
    if (!attachment) return
    // Track the attachment against whichever entity owns this editor instance
    if (onAttachmentAdded) onAttachmentAdded(attachment)
    else if (lastSelectedNoteId) addAttachment(lastSelectedNoteId, attachment)
    // Insert embed syntax at cursor
    const view = viewRef.current
    if (!view) return
    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    // Ensure the embed is on its own line
    const needsLeading  = cursor !== line.from || line.text.trim().length > 0
    const snippet = (needsLeading ? '\n' : '') + makeAttachmentMarkdown(attachment) + '\n'
    insertAtCursor(view, snippet)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-0.5',
        variant === 'floating'
          ? 'absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-surface border border-border rounded-full shadow-lg h-10 px-3'
          : 'sticky top-0 z-10 bg-surface border-b border-border h-10 px-3 shrink-0',
      )}
    >
      {TOOLBAR_ITEMS.map((item, i) =>
        item === null ? (
          <div key={i} className="w-px h-4 bg-border mx-1" />
        ) : (
          <button
            key={item.label}
            title={item.title}
            onMouseDown={e => {
              // Prevent focus loss from the editor before applying
              e.preventDefault()
              handleAction(item.action)
            }}
            className={`text-xs font-medium text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center ${item.className}`}
          >
            {item.label}
          </button>
        )
      )}

      <div className="w-px h-4 bg-border mx-1" />

      <button
        title="Insert image from URL"
        onMouseDown={e => { e.preventDefault(); handleImageUrl() }}
        className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
      >
        <Image className="w-3.5 h-3.5" />
      </button>

      {isTauri && (
        <button
          title="Upload image from computer"
          onMouseDown={e => { e.preventDefault(); void handleImageUpload() }}
          className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
      )}

      {isTauri && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            title="Attach file or document (PDF, Word, etc.)"
            onMouseDown={e => { e.preventDefault(); void handleFileUpload() }}
            className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
