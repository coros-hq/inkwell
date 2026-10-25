import { useMemo, useState } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { FolderIcon } from '../shared/FolderIcon'
import { TagDialog } from '../shared/TagDialog'
import { cn } from '../../lib/utils'
import type { Folder, Note } from '../../types'
import { FileText } from 'lucide-react'

function flattenFolders(folders: Folder[], out: Folder[] = []): Folder[] {
  for (const f of folders) { out.push(f); flattenFolders(f.children, out) }
  return out
}

interface SectionProps {
  /** Tag whose folders are currently shown instead of the tree. */
  active: string | null
  onSelect: (tag: string | null) => void
}

/**
 * The "Tags" section under the folder tree. With folders ticked in the tree a
 * tag row assigns/removes that tag on them; otherwise it filters the tree.
 */
export function TagsSection({ active, onSelect }: SectionProps) {
  const tagDefs = useAppStore((s) => s.tagDefs)
  const folderMeta = useAppStore((s) => s.folderMeta)
  const notes = useAppStore((s) => s.notes)
  const selectedFolderIds = useAppStore((s) => s.selectedFolderIds)
  const { createTag, updateTag, deleteTag, setFoldersTag, clearSelectedFolders } = useAppStore.getState()
  const [dialog, setDialog] = useState<{ name: string; color: string } | 'new' | null>(null)

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of Object.values(folderMeta)) m.tags?.forEach((t) => c.set(t, (c.get(t) ?? 0) + 1))
    for (const n of notes) n.tags.forEach((t) => c.set(t, (c.get(t) ?? 0) + 1))
    return c
  }, [folderMeta, notes])

  const picking = selectedFolderIds.length > 0

  const handleClick = (name: string) => {
    if (!picking) { onSelect(active === name ? null : name); return }
    const allHave = selectedFolderIds.every((id) => folderMeta[id]?.tags?.includes(name))
    setFoldersTag(selectedFolderIds, name, !allHave)
  }

  return (
    <div>
      <div className="flex items-center px-2 mb-1">
        <p className="text-[12px] font-semibold text-tertiary flex-1">Tags</p>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
          onClick={() => setDialog('new')}
          title="New tag"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {picking && (
        <div className="mx-1 mb-1 flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/25 px-2 py-1">
          <span className="text-[11px] font-medium text-accent flex-1">
            {selectedFolderIds.length} folder{selectedFolderIds.length > 1 ? 's' : ''} — pick a tag
          </span>
          <button className="text-muted-foreground hover:text-foreground" onClick={clearSelectedFolders} title="Clear selection">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {tagDefs.length === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-1">No tags yet — press + to create one</p>
      )}

      {tagDefs.map(({ name, color }) => {
        const isActive = active === name
        const applied = picking && selectedFolderIds.every((id) => folderMeta[id]?.tags?.includes(name))
        return (
          <div
            key={name}
            className={cn(
              'group flex items-center gap-2 h-[30px] px-2 rounded-md text-[13px] cursor-pointer transition-colors',
              isActive ? 'bg-active font-medium' : 'hover:bg-surface',
            )}
            onClick={() => handleClick(name)}
            onContextMenu={(e) => { e.preventDefault(); setDialog({ name, color }) }}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
            <span className="truncate flex-1 text-foreground">{name}</span>
            {applied && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
            <button
              className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setDialog({ name, color }) }}
              title="Edit tag"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <span className="text-[11px] text-tertiary tabular-nums">{counts.get(name) ?? 0}</span>
          </div>
        )
      })}

      {dialog && (
        <TagDialog
          initial={dialog === 'new' ? undefined : dialog}
          onSave={(n, c) => {
            if (dialog === 'new') createTag(n, c)
            else {
              updateTag(dialog.name, n, c)
              if (active === dialog.name) onSelect(n)
            }
          }}
          onDelete={dialog === 'new' ? undefined : () => { deleteTag(dialog.name); if (active === dialog.name) onSelect(null) }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

interface ResultsProps {
  tag: string
  onFolderContextMenu: (e: React.MouseEvent, folder: Folder) => void
  onOpenFolder: (folder: Folder) => void
  onNoteContextMenu?: (e: React.MouseEvent, note: Note) => void
}

/** Flat list of every folder carrying the active tag (replaces the tree while a tag is active). */
export function TagFolderResults({ tag, onFolderContextMenu, onOpenFolder, onNoteContextMenu }: ResultsProps) {
  const folders = useAppStore((s) => s.folders)
  const folderMeta = useAppStore((s) => s.folderMeta)
  const matches = flattenFolders(folders).filter((f) => folderMeta[f.id]?.tags?.includes(tag))
  const taggedNotes = useAppStore((s) => s.notes).filter((n) => n.tags.includes(tag))
  const selectNote = useAppStore((s) => s.selectNote)
  if (matches.length === 0 && taggedNotes.length === 0) return <p className="text-xs text-muted-foreground px-2 py-1">Nothing has this tag</p>
  return (
    <div>
      {taggedNotes.map((n) => (
        <div
          key={n.id}
          className="flex items-center gap-1.5 h-[30px] px-2 rounded-md text-[13px] font-medium text-foreground hover:bg-surface cursor-pointer"
          onClick={() => selectNote(n.id)}
          onContextMenu={(e) => onNoteContextMenu?.(e, n)}
          title={n.path}
        >
          <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{n.title}</span>
        </div>
      ))}
      {matches.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-1.5 h-[30px] px-2 rounded-md text-[13px] font-medium text-foreground hover:bg-surface cursor-pointer"
          onClick={() => onOpenFolder(f)}
          onContextMenu={(e) => onFolderContextMenu(e, f)}
          title={f.id}
        >
          <FolderIcon icon={folderMeta[f.id]?.icon} className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{f.name}</span>
          {f.parentId && <span className="truncate text-[10px] font-normal text-tertiary">{f.parentId}</span>}
        </div>
      ))}
    </div>
  )
}
