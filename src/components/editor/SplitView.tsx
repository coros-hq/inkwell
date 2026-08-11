import { useCallback, useMemo, useRef, useState } from 'react'
import { ScrollSync, ScrollSyncPane } from 'react-scroll-sync'
import { MarkdownEditor } from './MarkdownEditor'
import { RichPreview } from './RichPreview'
import { EditorToolbar } from './EditorToolbar'
import { StructureRail } from './StructureRail'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'

interface SplitViewProps {
  noteId: string
  content: string
}

// Keeps either pane from being dragged down to nothing.
const MIN_PANE_FRACTION = 0.2

export function SplitView({ noteId, content }: SplitViewProps) {
  const { markdownSplitRatio, setMarkdownSplitRatio } = useAppStore()
  const [editorScroller, setEditorScroller] = useState<HTMLElement | null>(null)
  const [previewScroller, setPreviewScroller] = useState<HTMLElement | null>(null)
  const editorScrollerRef = useMemo(() => ({ current: editorScroller }), [editorScroller])
  const previewScrollerRef = useMemo(() => ({ current: previewScroller }), [previewScroller])

  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (ev: PointerEvent) => {
      const fraction = (ev.clientX - rect.left) / rect.width
      setMarkdownSplitRatio(Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction)))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [setMarkdownSplitRatio])

  return (
    <ScrollSync>
      <div ref={containerRef} className="flex flex-1 h-full overflow-hidden relative">
        {/* Source pane — muted, monospace utility face; quieter than the preview */}
        <div
          className="markdown-mode-source h-full overflow-hidden flex flex-col relative shrink-0"
          style={{ width: `${markdownSplitRatio * 100}%`, minWidth: 220 }}
        >
          <MarkdownEditor noteId={noteId} content={content} onScrollerReady={setEditorScroller} liveConceal={false} />
          <EditorToolbar />
        </div>

        {/* Resizable divider — hairline by default, thickens on hover/drag */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handlePointerDown}
          className={cn(
            'markdown-mode-divider shrink-0 h-full cursor-col-resize relative z-10',
            dragging && 'is-dragging',
          )}
        >
          <div className="markdown-mode-divider-line" />
        </div>

        {/* Preview pane — primary content */}
        <div className="flex-1 h-full overflow-hidden relative min-w-0" style={{ minWidth: 220 }}>
          <RichPreview content={content} noteId={noteId} onScrollerReady={setPreviewScroller} />
          <StructureRail content={content} scrollerEl={previewScroller} />
        </div>

        {/* Register scrollable elements with ScrollSync (attached via ref, render nothing) */}
        <ScrollSyncPane attachTo={editorScrollerRef as React.RefObject<HTMLElement>}><></></ScrollSyncPane>
        <ScrollSyncPane attachTo={previewScrollerRef as React.RefObject<HTMLElement>}><></></ScrollSyncPane>
      </div>
    </ScrollSync>
  )
}
