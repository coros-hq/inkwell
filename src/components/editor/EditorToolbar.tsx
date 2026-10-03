import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image, Upload, Paperclip, Highlighter, Baseline, List, Ban, KanbanSquare } from 'lucide-react'
import { useEditorViewRef } from './EditorViewContext'
import { useAppStore } from '../../store/useAppStore'
import { pickAndCopyAttachment, makeAttachmentMarkdown } from '../../lib/attachments'
import { insertAtCursor, applyFormatAction, applyColorFormat, applyBulletColorFormat, FORMAT_TOOLBAR_ITEMS, type FormatAction, type ColorKind } from '../../lib/editorFormatting'
import { PALETTE } from '../../lib/palette'

/** Toolbar button that opens a swatch popover above it. Mouse-down is
 *  default-prevented throughout so the editor keeps its selection. */
function ColorMenu({ title, icon: Icon, current, onPick, resetLabel, tint }: {
  title: string
  icon: typeof Highlighter
  current?: string
  onPick: (name: string | null) => void
  resetLabel: string
  tint?: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const swatch = PALETTE.find(c => c.name === current)

  const toggle = () => {
    if (pos) { setPos(null); return }
    const r = btnRef.current!.getBoundingClientRect()
    setPos({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 })
  }

  return (
    <>
      <button
        ref={btnRef}
        title={title}
        onMouseDown={e => { e.preventDefault(); toggle() }}
        className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
      >
        <Icon className="w-3.5 h-3.5" style={tint && swatch ? { color: swatch.hex } : undefined} />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={e => { e.preventDefault(); setPos(null) }} />
          <div
            style={{ left: pos.left, bottom: pos.bottom, transform: 'translateX(-50%)' }}
            className="fixed z-50 bg-card border border-border rounded-xl shadow-lg shadow-black/10 p-2 w-[188px]"
            onMouseDown={e => e.preventDefault()}
          >
            <div className="grid grid-cols-4 gap-1">
              {PALETTE.map(c => (
                <button
                  key={c.name}
                  title={c.label}
                  onClick={() => { onPick(c.name); setPos(null) }}
                  className="w-10 h-8 rounded-md flex items-center justify-center hover:bg-active"
                >
                  <span className="w-4 h-4 rounded-full" style={{ background: c.hex, outline: c.name === current ? '2px solid hsl(var(--accent))' : undefined, outlineOffset: 2 }} />
                </button>
              ))}
            </div>
            <button
              onClick={() => { onPick(null); setPos(null) }}
              className="mt-1 w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-active"
            >
              <Ban className="w-3.5 h-3.5" /> {resetLabel}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function EditorToolbar() {
  const viewRef = useEditorViewRef()
  const { vaultPath, openPrompt, addAttachment, lastSelectedNoteId, openBoardRefDialog } = useAppStore()
  const [lastColor, setLastColor] = useState<Record<ColorKind, string | undefined>>({ highlight: undefined, text: undefined })

  const handleAction = (action: FormatAction) => {
    const view = viewRef.current
    if (!view) return
    applyFormatAction(view, action)
  }

  const handleColor = (kind: ColorKind, name: string | null) => {
    const view = viewRef.current
    if (!view) return
    setLastColor(c => ({ ...c, [kind]: name ?? undefined }))
    applyColorFormat(view, kind, name)
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

      <ColorMenu title="Highlight text" icon={Highlighter} current={lastColor.highlight} tint onPick={n => handleColor('highlight', n)} resetLabel="Remove highlight" />
      <ColorMenu title="Text color" icon={Baseline} current={lastColor.text} tint onPick={n => handleColor('text', n)} resetLabel="Default color" />
      <ColorMenu title="Bullet color (selected list items)" icon={List} onPick={n => { const v = viewRef.current; if (v) applyBulletColorFormat(v, n) }} resetLabel="Default bullet color" />

      <div className="w-px h-4 bg-border mx-1" />

      <button
        title="Insert board or task"
        onMouseDown={e => { e.preventDefault(); const v = viewRef.current; if (v) openBoardRefDialog(v.state.selection.main.head) }}
        className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
      >
        <KanbanSquare className="w-3.5 h-3.5" />
      </button>

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
