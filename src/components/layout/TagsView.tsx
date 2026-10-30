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
  onClear: () => void
  onFolderContextMenu: (e: React.MouseEvent, folder: Folder) => void
  onOpenFolder: (folder: Folder) => void
  onNoteContextMenu?: (e: React.MouseEvent, note: Note) => void
}

interface TagNode {
  folder: Folder
  /** The folder itself carries the tag (vs. just containing something that does). */
  matched: boolean
  notes: Note[]
  kids: TagNode[]
}

/** The folder tree pruned to branches that lead to something carrying `tag`. */
function pruneTree(folders: Folder[], tag: string, meta: Record<string, { tags?: string[] }>): TagNode[] {
  const out: TagNode[] = []
  for (const folder of folders) {
    const kids = pruneTree(folder.children, tag, meta)
    const notes = folder.notes.filter((n) => n.tags.includes(tag))
    const matched = !!meta[folder.id]?.tags?.includes(tag)
    if (matched || notes.length || kids.length) out.push({ folder, matched, notes, kids })
  }
  return out
}

/**
 * Everything carrying the active tag, shown above the folder tree as a pruned copy
 * of that tree: each match sits under its full folder chain, so identically named
 * notes in different folders stay distinguishable. The real tree stays visible below.
 */
export function TagFolderResults({ tag, onClear, onFolderContextMenu, onOpenFolder, onNoteContextMenu }: ResultsProps) {
  const folders = useAppStore((s) => s.folders)
  const folderMeta = useAppStore((s) => s.folderMeta)
  const notes = useAppStore((s) => s.notes)
  const selectNote = useAppStore((s) => s.selectNote)
  const selectedNoteIds = useAppStore((s) => s.selectedNoteIds)
  const color = useAppStore((s) => s.tagDefs.find((d) => d.name === tag)?.color)

  const tree = useMemo(() => pruneTree(folders, tag, folderMeta), [folders, tag, folderMeta])
  // Tagged notes that live outside every folder (e.g. at the library root).
  const looseNotes = useMemo(() => {
    const inTree = new Set(flattenFolders(folders).flatMap((f) => f.notes.map((n) => n.id)))
    return notes.filter((n) => n.tags.includes(tag) && !inTree.has(n.id))
  }, [folders, notes, tag])

  const noteRow = (n: Note, depth: number) => (
    <div
      key={n.id}
      className={cn(
        'flex items-center gap-1.5 h-[28px] pr-2 rounded-md text-[13px] text-foreground hover:bg-surface cursor-pointer',
        selectedNoteIds.includes(n.id) && 'bg-active',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => selectNote(n.id)}
      onContextMenu={(e) => onNoteContextMenu?.(e, n)}
      title={n.path}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-accent" />
      <span className="truncate font-medium">{n.title}</span>
    </div>
  )

  const renderNode = ({ folder, matched, notes: hits, kids }: TagNode, depth: number): React.ReactNode => (
    <div key={folder.id}>
      <div
        className="flex items-center gap-1.5 h-[28px] pr-2 rounded-md text-[13px] hover:bg-surface cursor-pointer"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpenFolder(folder)}
        onContextMenu={(e) => onFolderContextMenu(e, folder)}
        title={folder.path}
      >
        <FolderIcon icon={folderMeta[folder.id]?.icon} className={cn('w-3.5 h-3.5 shrink-0', matched ? 'text-accent' : 'text-muted-foreground')} />
        <span className={cn('truncate', matched ? 'font-medium text-foreground' : 'text-muted-foreground')}>{folder.name}</span>
        {matched && <span className="w-2 h-2 rounded-full shrink-0 ml-auto" style={{ background: color }} />}
      </div>
      {kids.map((k) => renderNode(k, depth + 1))}
      {hits.map((n) => noteRow(n, depth + 1))}
    </div>
  )

  const empty = tree.length === 0 && looseNotes.length === 0
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-1">
      <div className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[12px] font-semibold text-foreground truncate flex-1">Tagged “{tag}”</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
          onClick={onClear}
          title="Clear tag filter"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {empty && <p className="text-xs text-muted-foreground px-2 py-1">Nothing has this tag yet</p>}
      {looseNotes.map((n) => noteRow(n, 0))}
      {tree.map((node) => renderNode(node, 0))}
    </div>
  )
}
