import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image, Upload, Paperclip, Highlighter, Baseline, List, Ban, KanbanSquare, MoreHorizontal, MoreVertical, EyeOff, PanelBottom, PanelTop, PanelLeft, PanelRight } from 'lucide-react'
import { useEditorViewRef } from './EditorViewContext'
import { useAppStore, type ToolbarPosition } from '../../store/useAppStore'
import { formatCombo } from '../../lib/shortcuts'
import { cn } from '../../lib/utils'
import { pickAndCopyAttachment, makeAttachmentMarkdown } from '../../lib/attachments'
import { insertAtCursor, applyFormatAction, applyColorFormat, applyBulletColorFormat, FORMAT_TOOLBAR_ITEMS, type FormatAction, type ColorKind } from '../../lib/editorFormatting'
import { PALETTE } from '../../lib/palette'

type PopoverPos = { left?: number; right?: number; top?: number; bottom?: number; transform: string }

/** Where a popover opens for a toolbar button: always toward the editor, away
 *  from the edge the toolbar is docked to. */
function popoverPos(btn: HTMLElement, position: ToolbarPosition): PopoverPos {
  const r = btn.getBoundingClientRect()
  switch (position) {
    case 'top': return { left: r.left + r.width / 2, top: r.bottom + 8, transform: 'translateX(-50%)' }
    case 'left': return { left: r.right + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' }
    case 'right': return { right: window.innerWidth - r.left + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' }
    default: return { left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8, transform: 'translateX(-50%)' }
  }
}

/** Toolbar button that opens a swatch popover beside it. Mouse-down is
 *  default-prevented throughout so the editor keeps its selection. */
function ColorMenu({ title, icon: Icon, current, onPick, resetLabel, tint, position }: {
  title: string
  icon: typeof Highlighter
  current?: string
  onPick: (name: string | null) => void
  resetLabel: string
  tint?: boolean
  position: ToolbarPosition
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const swatch = PALETTE.find(c => c.name === current)

  const toggle = () => {
    if (pos) { setPos(null); return }
    setPos(popoverPos(btnRef.current!, position))
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
            style={pos}
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

const POSITION_OPTIONS: { value: ToolbarPosition; label: string; icon: typeof PanelBottom }[] = [
  { value: 'top', label: 'Top', icon: PanelTop },
  { value: 'bottom', label: 'Bottom', icon: PanelBottom },
  { value: 'left', label: 'Left', icon: PanelLeft },
  { value: 'right', label: 'Right', icon: PanelRight },
]

/** The toolbar's own menu: move it to another edge, or hide it. */
function ToolbarOptions({ position, vertical }: { position: ToolbarPosition; vertical: boolean }) {
  const setToolbarPosition = useAppStore(s => s.setToolbarPosition)
  const setToolbarVisible = useAppStore(s => s.setToolbarVisible)
  const toggleCombo = useAppStore(s => s.shortcuts.toggleToolbar)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const Icon = vertical ? MoreHorizontal : MoreVertical

  return (
    <>
      <button
        ref={btnRef}
        title="Toolbar options"
        onMouseDown={e => { e.preventDefault(); setPos(p => p ? null : popoverPos(btnRef.current!, position)) }}
        className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={e => { e.preventDefault(); setPos(null) }} />
          <div
            style={pos}
            className="fixed z-50 bg-card border border-border rounded-xl shadow-lg shadow-black/10 p-1.5 w-[188px]"
            onMouseDown={e => e.preventDefault()}
          >
            <p className="px-1.5 pt-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-tertiary">Position</p>
            <div className="grid grid-cols-4 gap-1">
              {POSITION_OPTIONS.map(o => (
                <button
                  key={o.value}
                  title={o.label}
                  onClick={() => { setToolbarPosition(o.value); setPos(null) }}
                  className={cn(
                    'h-8 rounded-md flex items-center justify-center transition-colors',
                    position === o.value ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-foreground hover:bg-active',
                  )}
                >
                  <o.icon className="w-4 h-4" />
                </button>
              ))}
            </div>
            <div className="h-px bg-border my-1.5" />
            <button
              onClick={() => { setToolbarVisible(false); setPos(null) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-active"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">Hide toolbar</span>
              {toggleCombo && <span className="text-[10px] text-tertiary font-mono">{formatCombo(toggleCombo)}</span>}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

/** Container placement per docked edge. Right sits left of the structure rail (globals.css .structure-rail). */
const POSITION_CLASSES: Record<ToolbarPosition, string> = {
  bottom: 'bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)]',
  top: 'top-4 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)]',
  left: 'left-4 top-1/2 -translate-y-1/2 max-h-[calc(100%-1.5rem)]',
  right: 'right-[42px] top-1/2 -translate-y-1/2 max-h-[calc(100%-1.5rem)]',
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function EditorToolbar() {
  const viewRef = useEditorViewRef()
  const { vaultPath, openPrompt, addAttachment, lastSelectedNoteId, openBoardRefDialog, toolbarVisible, toolbarPosition } = useAppStore()
  const vertical = toolbarPosition === 'left' || toolbarPosition === 'right'
  const sep = vertical ? 'h-px w-4 bg-border my-1' : 'w-px h-4 bg-border mx-1'
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

  if (!toolbarVisible) return null

  return (
    <div
      // Small panes: cap to the pane size and scroll along the bar instead of clipping buttons.
      className={cn(
        'absolute z-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 bg-card border border-border rounded-full shadow-md shadow-black/5 flex items-center gap-0.5',
        vertical ? 'flex-col w-10 py-3 overflow-y-auto overflow-x-hidden' : 'h-10 px-3 overflow-x-auto overflow-y-hidden',
        POSITION_CLASSES[toolbarPosition],
      )}
      onWheel={(e) => { if (!vertical && e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY }}
    >
      {FORMAT_TOOLBAR_ITEMS.map((item, i) =>
        item === null ? (
          <div key={i} className={sep} />
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

      <div className={sep} />

      <ColorMenu title="Highlight text" icon={Highlighter} current={lastColor.highlight} tint onPick={n => handleColor('highlight', n)} resetLabel="Remove highlight" position={toolbarPosition} />
      <ColorMenu title="Text color" icon={Baseline} current={lastColor.text} tint onPick={n => handleColor('text', n)} resetLabel="Default color" position={toolbarPosition} />
      <ColorMenu title="Bullet color (selected list items)" icon={List} onPick={n => { const v = viewRef.current; if (v) applyBulletColorFormat(v, n) }} resetLabel="Default bullet color" position={toolbarPosition} />

      <div className={sep} />

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
          <div className={sep} />
          <button
            title="Attach file or document (PDF, Word, etc.)"
            onMouseDown={e => { e.preventDefault(); void handleAttachmentUpload() }}
            className="text-muted-foreground hover:text-accent w-7 h-7 rounded-full hover:bg-active transition-colors flex items-center justify-center"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      <div className={sep} />
      <ToolbarOptions position={toolbarPosition} vertical={vertical} />
    </div>
  )
}
