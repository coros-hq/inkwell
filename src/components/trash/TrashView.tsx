import { useCallback, useEffect, useState } from 'react'
import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn, glassBg } from '../../lib/utils'
import { listTrash, restoreFromTrash, purgeTrash, type TrashEntry } from '../../lib/safeFs'

// Items deleted from the vault land in .inkwell/trash/ (see moveToTrash in
// safeFs.ts). This page lists them and puts them back, or erases them for good.

function formatDeleted(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function TrashView() {
  const vaultPath = useAppStore(s => s.vaultPath)
  const openConfirm = useAppStore(s => s.openConfirm)
  const bodyGlass = useAppStore(s => s.bodyGlass)
  const glassOpacity = useAppStore(s => s.glassOpacity)
  const theme = useAppStore(s => s.theme)
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!vaultPath) return
    try {
      setEntries(await listTrash(vaultPath))
    } catch (e) {
      setError(`Couldn't read the trash: ${e instanceof Error ? e.message : String(e)}`)
      setEntries([])
    }
  }, [vaultPath])

  useEffect(() => { void reload() }, [reload])

  const restore = async (entry: TrashEntry) => {
    if (!vaultPath) return
    setError(null)
    try {
      await restoreFromTrash(vaultPath, entry)
      await useAppStore.getState().refreshVaultFromDisk()
    } catch (e) {
      setError(`Couldn't restore "${entry.name}": ${e instanceof Error ? e.message : String(e)}`)
    }
    await reload()
  }

  const purge = (entry?: TrashEntry) => {
    if (!vaultPath) return
    openConfirm({
      title: entry ? `Delete "${entry.name}" forever?` : 'Empty trash?',
      description: entry
        ? 'This permanently deletes the item. It cannot be restored afterwards.'
        : `This permanently deletes all ${entries?.length ?? 0} items in the trash. They cannot be restored afterwards.`,
      confirmLabel: entry ? 'Delete forever' : 'Empty trash',
      destructive: true,
      onConfirm: async () => {
        setError(null)
        try { await purgeTrash(vaultPath, entry) }
        catch (e) { setError(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`) }
        await reload()
      },
    })
  }

  return (
    <div
      className={cn('flex-1 flex flex-col min-w-0', bodyGlass ? 'glass-card' : 'bg-background')}
      style={bodyGlass ? glassBg('background', glassOpacity, theme, 'card') : undefined}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Trash</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Deleted notes and folders are kept here until you delete them forever.
          </p>
        </div>
        {!!entries?.length && (
          <button
            onClick={() => purge()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Empty trash
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-3 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-[12px]">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-3">
        {entries === null ? null : entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Trash2 className="w-8 h-8 opacity-50" />
            <p className="text-sm">Trash is empty.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {entries.map(entry => (
              <li key={entry.id} className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface">
                {entry.kind === 'folder'
                  ? <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                  : <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-foreground truncate">{entry.name}</p>
                  <p className="text-[11px] text-tertiary truncate">
                    {entry.originalRelPath ? `from ${entry.originalRelPath}` : 'original location unknown'}
                    {formatDeleted(entry.deletedAt) && ` · deleted ${formatDeleted(entry.deletedAt)}`}
                  </p>
                </div>
                <button
                  onClick={() => restore(entry)}
                  title="Restore to original location"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground bg-surface hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore
                </button>
                <button
                  onClick={() => purge(entry)}
                  title="Delete forever"
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
