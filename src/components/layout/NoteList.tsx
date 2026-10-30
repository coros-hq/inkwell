import { NoteListEmpty } from './NoteListEmpty'
import { Star, Trash2, List, PanelTop, Clock, ArrowDownAZ, ChevronRight, Plus, CornerLeftUp } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { TagChip } from '../shared/TagChip'
import { formatDate } from '../../lib/utils'
import { cn, glassBg } from '../../lib/utils'
import { handleListKeyNav } from '../../lib/listKeyNav'
import { useState } from 'react'
import { confirmDeleteNote, confirmDeleteNotes } from '../../lib/deleteActions'
import { handleNoteSelect } from '../../lib/noteSelection'
import { canNestUnder, flattenNoteTree } from '../../lib/noteTree'

export function NoteList() {
  const {
    notes,
    folders,
    selectedNoteIds,
    selectedFolderId,
    setNoteSidebarMode,
    sidebarOpen,
    pinNote,
    moveNotes,
    createNote,
    setNoteParent,
    bodyGlass,
    glassOpacity,
    theme,
  } = useAppStore()
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [dragOverNoteId, setDragOverNoteId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggleCollapsed = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const folder = selectedFolderId
    ? (function findFolder(fs: typeof folders): typeof folders[0] | null {
        for (const f of fs) {
          if (f.id === selectedFolderId) return f
          const found = findFolder(f.children)
          if (found) return found
        }
        return null
      })(folders)
    : null

  let displayNotes = folder
    ? folder.notes
    : notes.filter(n => n.folder === null)
  displayNotes = [...displayNotes].sort((a, b) =>
    sortBy === 'date'
      ? b.updatedAt.getTime() - a.updatedAt.getTime()
      : a.title.localeCompare(b.title)
  )

  const rows = flattenNoteTree(displayNotes, collapsed)
  const orderedIds = rows.map(r => r.note.id)

  const handleDeleteClick = (noteId: string, noteTitle: string) => {
    const { selectedNoteIds: ids, notes: allNotes } = useAppStore.getState()
    if (ids.includes(noteId) && ids.length > 1) {
      const selected = allNotes.filter(n => ids.includes(n.id))
      confirmDeleteNotes(selected.map(n => ({ id: n.id, title: n.title })))
    } else {
      confirmDeleteNote(noteId, noteTitle)
    }
  }

  return (
    <div
      className={cn(
        'w-[272px] shrink-0 flex flex-col h-full overflow-hidden border-r border-border-strong',
        bodyGlass ? 'glass-pane' : 'bg-sidebar',
      )}
      style={bodyGlass ? glassBg('sidebar', glassOpacity, theme) : undefined}
    >
      <div
        className={cn(
          'h-10 flex items-center justify-between px-3.5 shrink-0 transition-colors',
          dragOverFolderId === (selectedFolderId ?? '__root__') && 'bg-accent/10 ring-inset ring-1 ring-accent'
        )}
        data-tauri-drag-region
        onDragOver={e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOverFolderId(selectedFolderId ?? '__root__')
        }}
        onDragLeave={() => setDragOverFolderId(null)}
        onDrop={e => {
          e.preventDefault()
          setDragOverFolderId(null)
          const noteId = e.dataTransfer.getData('text/note-id')
          const bulkIds = e.dataTransfer.getData('text/note-ids')
          if (!noteId) return
          const ids = bulkIds ? JSON.parse(bulkIds) as string[] : [noteId]
          moveNotes(ids, selectedFolderId)
          // Dropping on the header also lifts nested notes back to the top level.
          for (const id of ids) setNoteParent(id, null)
        }}
      >
        {/* Clears the macOS traffic-light overlay — normally reserved by the
            Sidebar column, which is gone from the layout while it's collapsed. */}
        {!sidebarOpen && <div className="w-20 shrink-0" data-tauri-drag-region />}
        <span className="text-[14px] font-bold text-foreground truncate">
          {selectedNoteIds.length > 1
            ? `${selectedNoteIds.length} selected`
            : (folder?.name ?? 'Unfiled')}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0 bg-muted border border-border-strong rounded-md p-0.5">
            <button
              className="w-6 h-6 flex items-center justify-center rounded bg-card text-foreground shadow-sm"
              title="Notes list"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-6 h-6 flex items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground"
              onClick={() => setNoteSidebarMode('tabs')}
              title="Switch to open tabs"
            >
              <PanelTop className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            className="w-[30px] h-[30px] flex items-center justify-center rounded-md border border-border-strong bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSortBy(sortBy === 'date' ? 'name' : 'date')}
            title={sortBy === 'date' ? 'Sorted by date — click to sort by name' : 'Sorted by name — click to sort by date'}
          >
            {sortBy === 'date' ? <Clock className="w-3.5 h-3.5" /> : <ArrowDownAZ className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2" data-nav-list="notelist" onKeyDown={handleListKeyNav}>
        {displayNotes.length === 0 ? (
          <NoteListEmpty folderName={folder?.name} />
        ) : (
          rows.map(({ note, depth, childCount }) => {
            const isSelected = selectedNoteIds.includes(note.id)
            const isCollapsed = collapsed.has(note.id)
            return (
              <div
                key={note.id}
                draggable
                tabIndex={-1}
                data-nav="note"
                data-nav-id={`note:${note.id}`}
                style={depth > 0 ? { marginLeft: depth * 14 } : undefined}
                className={cn(
                  'group rounded-lg px-2.5 py-2.5 my-0.5 outline-none focus:bg-accent/25 focus:text-foreground cursor-grab active:cursor-grabbing transition-colors',
                  isSelected ? 'bg-active' : 'hover:bg-surface',
                  depth > 0 && 'border-l border-border-strong',
                  dragOverNoteId === note.id && 'ring-1 ring-inset ring-accent bg-accent/10',
                )}
                onClick={e => handleNoteSelect(e, note.id, orderedIds)}
                onDragOver={e => {
                  const { notes: all } = useAppStore.getState()
                  const dragged = e.dataTransfer.types.includes('text/note-id')
                  if (!dragged) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverNoteId !== note.id && all.some(n => n.id === note.id)) setDragOverNoteId(note.id)
                }}
                onDragLeave={() => setDragOverNoteId(null)}
                onDrop={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverNoteId(null)
                  const noteId = e.dataTransfer.getData('text/note-id')
                  if (!noteId) return
                  const bulkIds = e.dataTransfer.getData('text/note-ids')
                  const ids = bulkIds ? JSON.parse(bulkIds) as string[] : [noteId]
                  const all = useAppStore.getState().notes
                  for (const id of ids) {
                    if (canNestUnder(all, id, note.id)) setNoteParent(id, note.id)
                  }
                  setCollapsed(prev => {
                    if (!prev.has(note.id)) return prev
                    const next = new Set(prev)
                    next.delete(note.id)
                    return next
                  })
                }}
                onDragStart={e => {
                  const ids = selectedNoteIds.includes(note.id) ? selectedNoteIds : [note.id]
                  e.dataTransfer.setData('text/note-id', note.id)
                  e.dataTransfer.setData('text/note-ids', JSON.stringify(ids))
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-start gap-1 min-w-0">
                    {childCount > 0 && (
                      <button
                        className="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                        title={isCollapsed ? `Expand ${childCount} sub-notes` : 'Collapse sub-notes'}
                        onClick={e => { e.stopPropagation(); toggleCollapsed(note.id) }}
                      >
                        <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
                      </button>
                    )}
                    <span className={cn(
                      'text-[13.5px] font-medium leading-snug line-clamp-1 min-w-0',
                      isSelected ? 'text-accent' : 'text-foreground',
                    )}>
                      {note.title}
                    </span>
                    {childCount > 0 && isCollapsed && (
                      <span className="mt-0.5 text-[11px] text-tertiary shrink-0">{childCount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {note.pinned && (
                      <button
                        className="mt-0.5"
                        onClick={e => { e.stopPropagation(); pinNote(note.id) }}
                      >
                        <Star className="w-3.5 h-3.5 text-accent fill-accent" />
                      </button>
                    )}
                    {note.parentId && (
                      <button
                        className={cn(
                          'w-6 h-6 flex items-center justify-center rounded transition-all',
                          'text-muted-foreground hover:text-foreground hover:bg-surface',
                          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                        title="Move out of parent"
                        onClick={e => { e.stopPropagation(); setNoteParent(note.id, null) }}
                      >
                        <CornerLeftUp className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      className={cn(
                        'w-6 h-6 flex items-center justify-center rounded transition-all',
                        'text-muted-foreground hover:text-foreground hover:bg-surface',
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      title="New sub-note"
                      onClick={e => {
                        e.stopPropagation()
                        createNote(note.folder, note.id)
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className={cn(
                        'w-6 h-6 flex items-center justify-center rounded transition-all',
                        'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      title="Delete note"
                      onClick={e => {
                        e.stopPropagation()
                        handleDeleteClick(note.id, note.title)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-2">
                  {note.content.replace(/^#+ /gm, '').replace(/\n/g, ' ').slice(0, 120)}
                </p>

                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    'text-xs shrink-0',
                    isSelected ? 'text-muted-foreground' : 'text-tertiary',
                  )}>
                    {formatDate(note.updatedAt)}
                  </span>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {note.tags.slice(0, 2).map(tag => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
