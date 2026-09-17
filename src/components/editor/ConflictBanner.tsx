import { AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'

/**
 * Shown when the vault watcher sees the currently-open note change on disk
 * (git pull, iCloud/Dropbox/Syncthing, an external editor) — see
 * refreshVaultFromDisk in useAppStore.ts. Non-modal by design: the user can
 * keep working elsewhere while deciding which version to keep.
 */
export function ConflictBanner() {
  const { conflictNoteId, notes, resolveConflictKeepMine, resolveConflictReloadFromDisk } = useAppStore()
  if (!conflictNoteId) return null

  const note = notes.find((n) => n.id === conflictNoteId)
  const title = note?.title ?? 'This note'

  return (
    <div
      className={cn(
        'fixed bottom-5 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border border-border bg-panel',
        'max-w-md',
      )}
    >
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">
          &ldquo;{title}&rdquo; changed on disk
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          It was edited outside inkwell while open here. Keep your version, or reload the one on disk?
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={resolveConflictReloadFromDisk}
          className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          Reload from disk
        </button>
        <button
          onClick={resolveConflictKeepMine}
          className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
        >
          Keep mine
        </button>
      </div>
    </div>
  )
}
