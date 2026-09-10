import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Users, FolderDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { pickVaultDirectory, readVaultFS, addRecentVault, writeTeamData, writeBoardsFile } from '../../lib/vault'
import { getSession } from '../../lib/auth'
import { listSharedVaults, type SharedVault } from '../../lib/team'
import { pullVaultFromCloud } from '../../lib/sync/yjsSync'

interface Props {
  open: boolean
  onClose: () => void
}

export function JoinVaultDialog({ open, onClose }: Props) {
  const { openVault, applyRemoteBoardsUpdate, setSharedVault } = useAppStore()
  const [vaults, setVaults] = useState<SharedVault[]>([])
  const [loading, setLoading] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    listSharedVaults()
      .then(setVaults)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load shared vaults.'))
      .finally(() => setLoading(false))
  }, [open])

  const handleJoin = async (vault: SharedVault) => {
    setError(null)
    setJoining(vault.id)
    try {
      const session = await getSession()
      if (!session) throw new Error('Sign in first.')

      const path = await pickVaultDirectory()
      if (!path) { setJoining(null); return }

      await writeTeamData(path, { vaultId: vault.id, teamId: vault.team_id, sharedAt: new Date().toISOString() })

      const pulled = await pullVaultFromCloud(path, vault.id, session.user.id)
      await writeBoardsFile(path, { version: 1, ...pulled })

      const data = await readVaultFS(path)
      addRecentVault(path)
      openVault(path, data)
      applyRemoteBoardsUpdate(pulled.boards, pulled.boardColumns, pulled.boardTasks)
      setSharedVault({ vaultId: vault.id, teamId: vault.team_id })

      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join vault.')
    } finally {
      setJoining(null)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-full max-w-md bg-panel border border-border rounded-lg shadow-lg p-5',
            'focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <Dialog.Title className="text-sm font-semibold text-foreground">Join a shared vault</Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-xs text-muted-foreground mb-4">
            Pick a local folder to download this vault's boards into.
          </Dialog.Description>

          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : vaults.length === 0 ? (
            <p className="text-xs text-muted-foreground">No shared vaults yet.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              {vaults.map((v, i) => (
                <div
                  key={v.id}
                  className={cn('flex items-center gap-2.5 px-3 py-2.5', i > 0 && 'border-t border-border')}
                >
                  <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-xs font-medium text-foreground truncate">{v.name}</span>
                  <button
                    onClick={() => handleJoin(v)}
                    disabled={!!joining}
                    className={cn(
                      'shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors',
                      'border-border hover:border-accent hover:text-accent text-muted-foreground',
                      !!joining && 'opacity-40 pointer-events-none',
                    )}
                  >
                    <FolderDown className="w-3 h-3" />
                    {joining === v.id ? 'Joining…' : 'Download & open'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
