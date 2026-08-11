import { Image, Upload, Paperclip } from 'lucide-react'
import { useEditorViewRef } from './EditorViewContext'
import { useAppStore } from '../../store/useAppStore'
import { pickAndCopyAttachment, makeAttachmentMarkdown } from '../../lib/attachments'
import { insertAtCursor, applyFormatAction, FORMAT_TOOLBAR_ITEMS, type FormatAction } from '../../lib/editorFormatting'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function EditorToolbar() {
  const viewRef = useEditorViewRef()
  const { vaultPath, openPrompt, addAttachment, lastSelectedNoteId } = useAppStore()

  const handleAction = (action: FormatAction) => {
    const view = viewRef.current
    if (!view) return
    applyFormatAction(view, action)
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

  // Shared by both the "Upload image" and "Attach file" buttons — the picker's
  // dialog already lists Images first, so a dedicated image-only picker isn't
  // needed. Both insert the `![[path|name|size]]` embed syntax so the result
  // actually renders inline (a plain `![image](url)` snippet does not).
  const handleAttachmentUpload = async () => {
    if (!vaultPath) return
    const attachment = await pickAndCopyAttachment(vaultPath)
    if (!attachment) return
    if (lastSelectedNoteId) addAttachment(lastSelectedNoteId, attachment)
    const view = viewRef.current
    if (!view) return
    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    // Ensure the embed is on its own line
    const needsLeading = cursor !== line.from || line.text.trim().length > 0
    const snippet = (needsLeading ? '\n' : '') + makeAttachmentMarkdown(attachment) + '\n'
    insertAtCursor(view, snippet)
  }

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-card border border-border rounded-full shadow-md shadow-black/5 h-10 px-3 flex items-center gap-0.5">
      {FORMAT_TOOLBAR_ITEMS.map((item, i) =>
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
          onMouseDown={e => { e.preventDefault(); void handleAttachmentUpload() }}
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
            onMouseDown={e => { e.preventDefault(); void handleAttachmentUpload() }}
            className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
