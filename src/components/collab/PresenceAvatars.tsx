import { useState } from 'react'
import { Users } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { ShareVaultDialog } from './ShareVaultDialog'

const STATUS_DOT: Record<string, string> = {
  synced: 'bg-green-500',
  syncing: 'bg-amber-400',
  offline: 'bg-muted-foreground',
  error: 'bg-red-500',
  idle: 'bg-muted-foreground',
}

const STATUS_LABEL: Record<string, string> = {
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes sync when you reconnect',
  error: 'Sync error — retrying',
  idle: '',
}

/**
 * Editor-header collaboration control: who else is here (people on this note
 * first, ringed in their cursor color), the sync status, and the entry point
 * to the Share dialog. For a local vault it's just the "Share" button.
 */
export function PresenceAvatars({ noteId }: { noteId: string }) {
  const { sharedVault, peers, syncStatus } = useAppStore()
  const [open, setOpen] = useState(false)

  const sorted = [...peers].sort((a, b) => Number(b.noteId === noteId) - Number(a.noteId === noteId))
  const shown = sorted.slice(0, 4)
  const overflow = sorted.length - shown.length

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-7 flex items-center gap-1.5 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        title={sharedVault ? `Shared vault · ${STATUS_LABEL[syncStatus]}` : 'Share this vault'}
      >
        {shown.length > 0 && (
          <span className="flex -space-x-1.5">
            {shown.map(p => {
              const here = p.noteId === noteId
              return (
                <span
                  key={p.userId}
                  title={`${p.email}${here ? ' — editing this note' : ''}`}
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white border-2 border-background',
                    !here && 'opacity-50',
                  )}
                  style={{ backgroundColor: p.color }}
                >
                  {p.email.slice(0, 1).toUpperCase()}
                </span>
              )
            })}
            {overflow > 0 && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium bg-surface border-2 border-background">
                +{overflow}
              </span>
            )}
          </span>
        )}
        <span className="relative">
          <Users className="w-3.5 h-3.5" />
          {sharedVault && (
            <span className={cn('absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full', STATUS_DOT[syncStatus])} />
          )}
        </span>
      </button>
      <ShareVaultDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
