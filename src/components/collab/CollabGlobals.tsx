import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { INVITE_LINK_PREFIX } from '../../lib/team'
import { JoinVaultDialog } from '../settings/JoinVaultDialog'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * App-wide collaboration plumbing, mounted whether or not a vault is open:
 *  - opens the Join dialog for inkwell://join/<token> invite links (on launch
 *    and while running)
 *  - shows one-off notices from the sync session (e.g. access revoked)
 */
export function CollabGlobals() {
  const { collabNotice, setCollabNotice } = useAppStore()
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    const handle = (urls: string[] | null) => {
      const link = urls?.find(u => u.startsWith(INVITE_LINK_PREFIX))
      if (link) setInviteLink(link)
    }
    import('@tauri-apps/plugin-deep-link').then(async ({ getCurrent, onOpenUrl }) => {
      handle(await getCurrent().catch(() => null))
      const off = await onOpenUrl(handle)
      if (cancelled) off()
      else unlisten = off
    }).catch(e => console.warn('[inkwell] deep links unavailable:', e))
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return (
    <>
      <JoinVaultDialog open={!!inviteLink} initialLink={inviteLink} onClose={() => setInviteLink(null)} />
      {collabNotice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md flex items-start gap-3 px-4 py-3 rounded-lg bg-panel border border-border shadow-lg">
          <p className="text-xs text-foreground">{collabNotice}</p>
          <button
            onClick={() => setCollabNotice(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  )
}
