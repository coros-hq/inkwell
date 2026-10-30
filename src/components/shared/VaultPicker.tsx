import { useState, useEffect } from 'react'
import { FolderOpen, Plus, Clock, X, ChevronRight } from 'lucide-react'
import {
  pickVaultDirectory,
  getSuggestedVaultPath,
  ensureVaultDirectory,
  isEmptyVault,
  readVaultFS,
  addRecentVault,
  getRecentVaults,
  removeRecentVault,
  writeBoardsFile,
  type RecentVault,
} from '../../lib/vault'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'

export function VaultPicker() {
  const { openVault } = useAppStore()
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // First launch (no recent vaults): offer a ready-made vault location the user
  // can accept or change.
  const [suggestedPath, setSuggestedPath] = useState<string | null>(null)

  useEffect(() => {
    const recent = getRecentVaults()
    setRecentVaults(recent)
    if (recent.length === 0) getSuggestedVaultPath().then(setSuggestedPath)
  }, [])

  const createAt = async (path: string) => {
    setError(null)
    setLoading(true)
    try {
      await ensureVaultDirectory(path)
      const data = await readVaultFS(path)
      addRecentVault(path)
      // null seeds the welcome note, so a brand-new or empty folder starts with it
      openVault(path, isEmptyVault(data) ? null : data)
    } catch (e) {
      setError('Could not create the vault there. Please choose another location.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleChangeSuggested = async () => {
    try {
      const path = await pickVaultDirectory()
      if (path) setSuggestedPath(path)
    } catch (e) {
      console.error(e)
    }
  }

  const handleOpen = async () => {
    setError(null)
    setLoading(true)
    try {
      const path = await pickVaultDirectory()
      if (!path) return
      const data = await readVaultFS(path)
      addRecentVault(path)
      openVault(path, data)
    } catch (e) {
      setError('Could not open vault. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    setError(null)
    setLoading(true)
    try {
      const path = await pickVaultDirectory()
      if (!path) return
      addRecentVault(path)
      openVault(path, null)
    } catch (e) {
      setError('Could not create vault. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenRecent = async (vault: RecentVault) => {
    setError(null)
    setLoading(true)
    try {
      // Flush current vault boards before reading the new one
      const { vaultPath: currentPath, boards, boardColumns, boardTasks } = useAppStore.getState()
      if (currentPath && currentPath !== vault.path) {
        await writeBoardsFile(currentPath, { version: 1, boards, boardColumns, boardTasks })
      }
      const data = await readVaultFS(vault.path)
      addRecentVault(vault.path)
      setRecentVaults(getRecentVaults())
      openVault(vault.path, data)
    } catch (e) {
      setError(`Could not open "${vault.name}". The folder may have moved or been deleted.`)
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveRecent = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    removeRecentVault(path)
    setRecentVaults(getRecentVaults())
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center w-full max-w-md px-6">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="font-sans text-3xl font-semibold text-foreground tracking-tight">
            inkwell
          </span>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a folder to store your notes
          </p>
        </div>

        {/* First-launch suggestion */}
        {suggestedPath && (
          <div className="w-full mb-6 rounded-xl border border-accent/40 bg-surface p-4">
            <p className="text-sm font-medium text-foreground">Create your vault</p>
            <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
              Your notes will be stored in this folder. You can change it now or move it later.
            </p>
            <p className="mt-3 px-2.5 py-2 rounded-md bg-background border border-border text-xs text-foreground break-all select-text">
              {suggestedPath}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                className={cn(
                  'px-3.5 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:opacity-90 transition-opacity',
                  loading && 'opacity-50 pointer-events-none',
                )}
                onClick={() => createAt(suggestedPath)}
              >
                Create vault
              </button>
              <button
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-background transition-colors',
                  loading && 'opacity-50 pointer-events-none',
                )}
                onClick={handleChangeSuggested}
              >
                Change location…
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 w-full mb-6">
          <button
            className={cn(
              'flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border border-border bg-surface',
              'text-foreground transition-all hover:border-accent/50 hover:bg-surface/80',
              loading && 'opacity-50 pointer-events-none',
            )}
            onClick={handleOpen}
          >
            <FolderOpen className="w-5 h-5 text-accent" />
            <span className="text-sm font-medium">Open Vault</span>
            <span className="text-[11px] text-muted-foreground text-center leading-tight">
              Open an existing vault folder
            </span>
          </button>

          <button
            className={cn(
              'flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border border-border bg-surface',
              'text-foreground transition-all hover:border-accent/50 hover:bg-surface/80',
              loading && 'opacity-50 pointer-events-none',
            )}
            onClick={handleCreate}
          >
            <Plus className="w-5 h-5 text-accent" />
            <span className="text-sm font-medium">New Vault</span>
            <span className="text-[11px] text-muted-foreground text-center leading-tight">
              Start fresh in a new folder
            </span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <p className="mb-4 text-xs text-red-400 text-center">{error}</p>
        )}

        {/* Recent vaults */}
        {recentVaults.length > 0 && (
          <div className="w-full">
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Clock className="w-3 h-3 text-tertiary" />
              <span className="text-[10px] uppercase tracking-widest text-tertiary">
                Recent
              </span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              {recentVaults.map((vault, i) => (
                <button
                  key={vault.path}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                    'hover:bg-surface group',
                    i > 0 && 'border-t border-border',
                    loading && 'pointer-events-none opacity-50',
                  )}
                  onClick={() => handleOpenRecent(vault)}
                >
                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">
                      {vault.name}
                    </p>
                    <p className="text-[11px] text-tertiary truncate">{vault.path}</p>
                  </div>
                  <span className="text-[11px] text-tertiary shrink-0 mr-1">
                    {formatDate(vault.lastOpenedAt)}
                  </span>
                  <span
                    role="button"
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-foreground text-muted-foreground transition-all"
                    onClick={(e) => handleRemoveRecent(e, vault.path)}
                  >
                    <X className="w-3 h-3" />
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
