import { useState, useMemo } from 'react'
import { ScrollSync, ScrollSyncPane } from 'react-scroll-sync'
import { MarkdownEditor } from './MarkdownEditor'
import { RichPreview } from './RichPreview'
import { EditorToolbar } from './EditorToolbar'
import { useAppStore } from '../../store/useAppStore'
import { saveNote } from '../../lib/fs'

interface SplitViewProps {
  noteId: string
  content: string
}

export function SplitView({ noteId, content }: SplitViewProps) {
  const { updateNote, setSaveStatus, addAttachment } = useAppStore()
  const [editorScroller, setEditorScroller] = useState<HTMLElement | null>(null)
  const [previewScroller, setPreviewScroller] = useState<HTMLElement | null>(null)
  const editorScrollerRef = useMemo(() => ({ current: editorScroller }), [editorScroller])
  const previewScrollerRef = useMemo(() => ({ current: previewScroller }), [previewScroller])

  return (
    <ScrollSync>
      <div className="flex flex-1 h-full overflow-hidden">
        {/* Editor half — relative so the floating toolbar anchors here */}
        <div className="w-1/2 h-full border-r border-border overflow-hidden flex flex-col relative">
          <MarkdownEditor
            docId={noteId}
            content={content}
            onChange={(c) => updateNote(noteId, c)}
            onSave={async (c) => {
              const n = useAppStore.getState().notes.find((x) => x.id === noteId);
              if (n) await saveNote(n.path, c);
            }}
            onSaveStatusChange={setSaveStatus}
            onAttachmentSaved={(att) => addAttachment(noteId, att)}
            onScrollerReady={setEditorScroller}
          />
          <EditorToolbar />
        </div>
        {/* Preview half */}
        <div className="w-1/2 h-full overflow-hidden">
          <RichPreview content={content} noteId={noteId} onScrollerReady={setPreviewScroller} />
        </div>
        {/* Register scrollable elements with ScrollSync (attached via ref, render nothing) */}
        <ScrollSyncPane attachTo={editorScrollerRef as React.RefObject<HTMLElement>}><></></ScrollSyncPane>
        <ScrollSyncPane attachTo={previewScrollerRef as React.RefObject<HTMLElement>}><></></ScrollSyncPane>
      </div>
    </ScrollSync>
  )
}
