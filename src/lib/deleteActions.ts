import { useAppStore } from '../store/useAppStore'
import type { Folder } from '../types'
import { collectDescendantIds } from './noteTree'

function findFolderById(folders: Folder[], id: string): Folder | null {
  for (const f of folders) {
    if (f.id === id) return f
    const found = findFolderById(f.children, id)
    if (found) return found
  }
  return null
}

function countNotesInFolder(folder: Folder): number {
  let count = folder.notes.length
  for (const child of folder.children) {
    count += countNotesInFolder(child)
  }
  return count
}

export function confirmDeleteNote(noteId: string, noteTitle: string, external = false) {
  if (external) {
    useAppStore.getState().openConfirm({
      title: 'Remove from library',
      description: `Remove "${noteTitle}" from inkwell? The file itself won't be touched.`,
      confirmLabel: 'Remove',
      destructive: false,
      onConfirm: () => useAppStore.getState().deleteNotes([noteId]),
    })
    return
  }
  confirmDeleteNotes([{ id: noteId, title: noteTitle }])
}

export function confirmDeleteNotes(notes: { id: string; title: string }[]) {
  if (notes.length === 0) return

  const all = useAppStore.getState().notes
  const picked = new Set(notes.map(n => n.id))
  const nestedIds = new Set<string>()
  for (const n of notes) {
    for (const id of collectDescendantIds(all, n.id)) if (!picked.has(id)) nestedIds.add(id)
  }
  const nested = nestedIds.size

  if (notes.length === 1) {
    useAppStore.getState().openConfirm({
      title: 'Delete note',
      description: nested > 0
        ? `Delete "${notes[0].title}" and the ${nested === 1 ? '1 note' : `${nested} notes`} nested under it? This cannot be undone.`
        : `Are you sure you want to delete "${notes[0].title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => useAppStore.getState().deleteNotes([notes[0].id]),
    })
    return
  }

  useAppStore.getState().openConfirm({
    title: `Delete ${notes.length} notes`,
    description: nested > 0
      ? `Delete ${notes.length} notes and the ${nested === 1 ? '1 note' : `${nested} notes`} nested under them? This cannot be undone.`
      : `Are you sure you want to delete ${notes.length} notes? This cannot be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => useAppStore.getState().deleteNotes(notes.map(n => n.id)),
  })
}

export function confirmDeleteSelectedNotes() {
  const { selectedNoteIds, notes } = useAppStore.getState()
  const selected = notes.filter(n => selectedNoteIds.includes(n.id))
  confirmDeleteNotes(selected.map(n => ({ id: n.id, title: n.title })))
}

export function confirmDeleteFolder(folderId: string, folderName: string, noteCount: number) {
  const noteLabel = noteCount === 1 ? '1 note' : `${noteCount} notes`
  useAppStore.getState().openConfirm({
    title: 'Delete folder',
    description:
      noteCount > 0
        ? `Delete "${folderName}" and all ${noteLabel} inside it? This cannot be undone.`
        : `Are you sure you want to delete "${folderName}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => useAppStore.getState().deleteFolder(folderId),
  })
}

export function confirmDeleteFolderItem(folder: Folder) {
  confirmDeleteFolder(folder.id, folder.name, countNotesInFolder(folder))
}

export function confirmDeleteFolderById(folderId: string) {
  const folder = findFolderById(useAppStore.getState().folders, folderId)
  if (folder) confirmDeleteFolderItem(folder)
}
