import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Users, FolderDown, Link2 } from 'lucide-react'
import { cn, getInitials } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { pickVaultDirectory, getRecentVaults, readTeamData } from '../../lib/vault'
import { getSession } from '../../lib/auth'
import {
  listSharedVaults, acceptInviteLink, getMyVaultRole, type SharedVault, type VaultRole,
} from '../../lib/team'
import { folderHasContent, joinVaultInto } from '../../lib/sync/vaultSession'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-filled invite link, e.g. from an inkwell://join/… deep link. */
  initialLink?: string | null
}

/** Cloud vault ids already linked to a folder on this device. */
async function linkedVaultIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const v of getRecentVaults()) {
    const team = await readTeamData(v.path).catch(() => null)
    if (team) ids.add(team.vaultId)
  }
  return ids
}

export function JoinVaultDialog({ open, onClose, initialLink }: Props) {
  const syncProgress = useAppStore(s => s.syncProgress)
  const [vaults, setVaults] = useState<SharedVault[]>([])
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')

  const refresh = () => {
    setLoading(true)
    Promise.all([listSharedVaults(), linkedVaultIds()])
      .then(([v, l]) => { setVaults(v); setLinked(l) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load shared vaults.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setLink(initialLink ?? '')
    refresh()
  }, [open, initialLink])

  const downloadInto = async (vault: Pick<SharedVault, 'id' | 'team_id'>, role: VaultRole) => {
    const path = await pickVaultDirectory()
    if (!path) return false
    if (await folderHasContent(path)) {
      throw new Error('Pick an empty folder — anything already in it would be uploaded to the shared vault.')
    }
    await joinVaultInto(path, vault, role)
    return true
  }

  const handleJoin = async (vault: SharedVault) => {
    setError(null)
    setJoining(vault.id)
    try {
      if (!await getSession()) throw new Error('Sign in first (Settings → Team).')
      const role = (await getMyVaultRole(vault.id)) ?? 'viewer'
      if (await downloadInto(vault, role)) onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join vault.')
    } finally {
      setJoining(null)
    }
  }

  const handleLink = async () => {
    setError(null)
    setJoining('link')
    try {
      if (!await getSession()) throw new Error('Sign in first (Settings → Team), then open the link again.')
      const accepted = await acceptInviteLink(link)
      if (await downloadInto({ id: accepted.vaultId, team_id: null }, accepted.role)) onClose()
      else refresh() // folder picker cancelled — the vault now shows in the list
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept invite.')
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
            Pick an empty local folder. Notes, folders, boards and attachments download into it and stay in sync.
          </Dialog.Description>

          <div className="space-y-1.5 mb-4">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Invite link</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder="inkwell://join/…"
                className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-xs bg-surface border border-border',
                  'text-foreground placeholder:text-tertiary',
                  'focus:outline-none focus:border-accent/50 transition-colors',
                )}
              />
              <button
                onClick={handleLink}
                disabled={!!joining || !link.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 transition-colors disabled:opacity-40"
              >
                <Link2 className="w-3 h-3" />
                {joining === 'link' ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">Shared with you</p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : vaults.length === 0 ? (
            <p className="text-xs text-muted-foreground">No shared vaults yet. Ask the owner for an invite.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              {vaults.map((v, i) => (
                <div
                  key={v.id}
                  className={cn('flex items-center gap-2.5 px-3 py-2.5', i > 0 && 'border-t border-border')}
                >
                  <div className="w-6 h-6 rounded-md bg-accent/15 text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">
                    {getInitials(v.name) || <Users className="w-3 h-3" />}
                  </div>
                  <span className="flex-1 text-xs font-medium text-foreground truncate">{v.name}</span>
                  {linked.has(v.id) ? (
                    <span className="text-[10px] text-tertiary shrink-0">On this device</span>
                  ) : (
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
                  )}
                </div>
              ))}
            </div>
          )}

          {syncProgress !== null && (
            <p className="text-[11px] text-muted-foreground mt-3">Downloading… {syncProgress} changes applied</p>
          )}
          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
