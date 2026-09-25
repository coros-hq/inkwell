import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Link2, Copy, Check, LogOut, UserPlus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { getSession } from '../../lib/auth'
import {
  listMyTeams, listVaultMembers, inviteToVault, setVaultMemberRole, removeVaultMember, createInviteLink,
  type Team, type VaultMember, type VaultRole,
} from '../../lib/team'
import { shareVault, leaveVaultOnThisDevice } from '../../lib/sync/vaultSession'

interface Props {
  open: boolean
  onClose: () => void
}

const ROLE_LABEL: Record<VaultRole, string> = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' }

const inputCls = cn(
  'px-3 py-2 rounded-lg text-xs bg-surface border border-border',
  'text-foreground placeholder:text-tertiary',
  'focus:outline-none focus:border-accent/50 transition-colors',
)
const primaryBtn = 'px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 transition-colors disabled:opacity-40'

function RoleSelect({ value, onChange, allowOwner = false, disabled }: {
  value: VaultRole
  onChange: (r: VaultRole) => void
  allowOwner?: boolean
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value as VaultRole)}
      className={cn(inputCls, 'py-1.5 pr-6 cursor-pointer disabled:cursor-default disabled:opacity-60')}
    >
      {allowOwner && <option value="owner">{ROLE_LABEL.owner}</option>}
      <option value="editor">{ROLE_LABEL.editor}</option>
      <option value="viewer">{ROLE_LABEL.viewer}</option>
    </select>
  )
}

export function ShareVaultDialog({ open, onClose }: Props) {
  const { vaultPath, sharedVault, syncStatus } = useAppStore()
  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Not yet shared
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')

  // Shared
  const [members, setMembers] = useState<VaultMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<VaultRole>('editor')
  const [linkRole, setLinkRole] = useState<VaultRole>('editor')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const isOwner = sharedVault?.role === 'owner'

  useEffect(() => {
    if (!open) return
    setError(null)
    setLink(null)
    setConfirmLeave(false)
    getSession().then(s => setMyEmail(s?.user.email ?? null)).catch(() => setMyEmail(null))
    if (!sharedVault) {
      listMyTeams().then(setTeams).catch(() => setTeams([]))
    } else {
      listVaultMembers(sharedVault.vaultId)
        .then(setMembers)
        .catch(e => setError(e instanceof Error ? e.message : 'Failed to load members.'))
    }
  }, [open, sharedVault?.vaultId])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }

  const handleShare = () => run(async () => {
    if (!vaultPath) return
    await shareVault(vaultPath, teamId || null)
  })

  const handleInvite = () => run(async () => {
    if (!sharedVault || !inviteEmail.trim()) return
    const m = await inviteToVault(sharedVault.vaultId, inviteEmail, inviteRole === 'owner' ? 'editor' : inviteRole)
    setMembers(ms => [...ms, m])
    setInviteEmail('')
  })

  const handleRole = (m: VaultMember, role: VaultRole) => run(async () => {
    await setVaultMemberRole(m.id, role)
    setMembers(ms => ms.map(x => (x.id === m.id ? { ...x, role } : x)))
  })

  const handleRemove = (m: VaultMember) => run(async () => {
    await removeVaultMember(m.id)
    setMembers(ms => ms.map(x => (x.id === m.id ? { ...x, status: 'removed' } : x)))
  })

  const handleLink = () => run(async () => {
    if (!sharedVault) return
    setLink(await createInviteLink(sharedVault.vaultId, linkRole === 'owner' ? 'editor' : linkRole))
    setCopied(false)
  })

  const copyLink = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleLeave = () => run(async () => {
    if (!vaultPath) return
    await leaveVaultOnThisDevice(vaultPath)
    onClose()
  })

  const vaultName = vaultPath?.split('/').pop() ?? 'Vault'
  const activeMembers = members.filter(m => m.status !== 'removed')

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-full max-w-lg max-h-[85vh] overflow-y-auto bg-panel border border-border rounded-lg shadow-lg p-5',
            'focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <Dialog.Title className="text-sm font-semibold text-foreground">Share “{vaultName}”</Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>

          {!sharedVault ? (
            <>
              <Dialog.Description className="text-xs text-muted-foreground mb-4">
                Everyone you invite gets the whole vault — notes, folders, boards and attachments — and can edit
                live with you. Your files stay on your disk; inkwell keeps them in sync.
              </Dialog.Description>
              <div className="space-y-1.5 mb-4">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Access</label>
                <select value={teamId} onChange={e => setTeamId(e.target.value)} className={cn(inputCls, 'w-full')}>
                  <option value="">Only people I invite</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>Everyone in {t.name} (can edit)</option>
                  ))}
                </select>
              </div>
              <button onClick={handleShare} disabled={busy || !vaultPath} className={primaryBtn}>
                {busy ? 'Sharing…' : 'Share vault'}
              </button>
            </>
          ) : (
            <>
              <Dialog.Description className="text-xs text-muted-foreground mb-4">
                You {isOwner ? 'own this vault' : sharedVault.role === 'editor' ? 'can edit this vault' : 'can view this vault'}
                {' · '}
                {syncStatus === 'synced' ? 'Up to date' : syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'offline' ? 'Offline — changes will sync when you reconnect' : syncStatus === 'error' ? 'Sync error — retrying' : ''}
              </Dialog.Description>

              {isOwner && (
                <div className="space-y-1.5 mb-4">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Invite by email</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleInvite() }}
                      placeholder="teammate@example.com"
                      className={cn(inputCls, 'flex-1')}
                    />
                    <RoleSelect value={inviteRole} onChange={setInviteRole} />
                    <button onClick={handleInvite} disabled={busy || !inviteEmail.trim()} className={cn(primaryBtn, 'flex items-center gap-1')}>
                      <UserPlus className="w-3 h-3" />
                      Invite
                    </button>
                  </div>
                  <p className="text-[10px] text-tertiary">They get access as soon as they sign in to inkwell with that email.</p>
                </div>
              )}

              {isOwner && (
                <div className="space-y-1.5 mb-4">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Invite link</label>
                  <div className="flex items-center gap-2">
                    <RoleSelect value={linkRole} onChange={setLinkRole} />
                    <button onClick={handleLink} disabled={busy} className={cn(primaryBtn, 'flex items-center gap-1')}>
                      <Link2 className="w-3 h-3" />
                      Create link
                    </button>
                  </div>
                  {link && (
                    <div className="flex items-center gap-2">
                      <input readOnly value={link} className={cn(inputCls, 'flex-1 font-mono text-[10px]')} onFocus={e => e.target.select()} />
                      <button onClick={copyLink} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-tertiary">Links expire after 7 days. Anyone with the link who signs in can join.</p>
                </div>
              )}

              <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">People with access</p>
              <div className="rounded-lg border border-border overflow-hidden mb-4">
                {activeMembers.length === 0 && (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground">
                    {sharedVault.teamId ? 'Shared with your whole team.' : 'Only you so far.'}
                  </p>
                )}
                {activeMembers.map((m, i) => {
                  const isMe = m.email === myEmail?.toLowerCase()
                  return (
                    <div key={m.id} className={cn('flex items-center gap-2.5 px-3 py-2 text-xs', i > 0 && 'border-t border-border')}>
                      <span className="flex-1 min-w-0 truncate text-foreground font-medium">
                        {m.email}{isMe && <span className="text-tertiary font-normal"> (you)</span>}
                      </span>
                      {m.status === 'pending' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border text-tertiary border-border shrink-0">invited</span>
                      )}
                      {isOwner && !isMe ? (
                        <>
                          <RoleSelect value={m.role} onChange={r => handleRole(m, r)} allowOwner disabled={busy} />
                          <button
                            onClick={() => handleRemove(m)}
                            disabled={busy}
                            className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Remove access"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground shrink-0">{ROLE_LABEL[m.role]}</span>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between">
                {confirmLeave ? (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">Stop syncing on this device? Files stay.</span>
                    <button onClick={handleLeave} disabled={busy} className="text-red-400 font-medium hover:underline">Stop</button>
                    <button onClick={() => setConfirmLeave(false)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmLeave(true)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <LogOut className="w-3 h-3" />
                    Stop syncing on this device
                  </button>
                )}
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
