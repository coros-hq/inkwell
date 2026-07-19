import { useState, useEffect } from 'react'
import { Cloud, CloudUpload, CloudDownload, LogOut, Check, AlertTriangle, Download, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { pickVaultDirectory } from '../../lib/vault'
import { supabase, isCloudBackupConfigured, sendLoginCode, verifyLoginCode, signOut } from '../../lib/supabase'
import {
  computeSyncPlan, runSync, loadManifest, exportCloudBackup, deleteCloudBackup,
  type SyncPlan, type ConflictResolutions, type ConflictChoice, type SyncResult, type ExportResult,
} from '../../lib/cloudSync'
import type { Session } from '@supabase/supabase-js'

export function CloudBackupSection() {
  const [session, setSession] = useState<Session | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    if (!supabase) { setCheckingSession(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isCloudBackupConfigured) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-foreground">
          <Cloud className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium">Cloud backup isn't set up yet</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This build has no Supabase project configured. Create a free project at{' '}
          <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            supabase.com
          </a>
          , run <code className="bg-surface px-1 py-0.5 rounded">supabase/schema.sql</code> from this repo in its SQL
          editor, then set <code className="bg-surface px-1 py-0.5 rounded">VITE_SUPABASE_URL</code> and{' '}
          <code className="bg-surface px-1 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code> in <code className="bg-surface px-1 py-0.5 rounded">.env</code> before restarting the app.
        </p>
      </div>
    )
  }

  if (checkingSession) return null

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Cloud backup is opt-in and only runs when you click "Sync now" below. Your vault stays local-first —
        the cloud copy exists to protect against data loss and to move a vault between devices, not to live there
        permanently. You can download everything back to plain files, or delete it from the cloud entirely, at any time.
      </p>
      {session ? <SyncPanel session={session} /> : <SignInPanel />}
    </div>
  )
}

// ─── Sign-in (email → 6-digit code, no redirect needed for a desktop app) ────

function SignInPanel() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendLoginCode(email.trim())
      setCodeSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code.')
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async () => {
    setBusy(true)
    setError(null)
    try {
      await verifyLoginCode(email.trim(), code.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid or expired code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Email</label>
        <input
          type="email"
          value={email}
          disabled={codeSent}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={cn(
            'w-full px-3 py-2 rounded-lg text-xs bg-surface border border-border',
            'text-foreground placeholder:text-tertiary',
            'focus:outline-none focus:border-accent/50 transition-colors',
            codeSent && 'opacity-60',
          )}
        />
      </div>

      {codeSent && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">
            6-digit code (check your email)
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className={cn(
              'w-full px-3 py-2 rounded-lg text-xs bg-surface border border-border font-mono tracking-widest',
              'text-foreground placeholder:text-tertiary',
              'focus:outline-none focus:border-accent/50 transition-colors',
            )}
          />
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={codeSent ? handleVerify : handleSendCode}
        disabled={busy || !email.trim() || (codeSent && !code.trim())}
        className={cn(
          'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
          'bg-accent text-white hover:opacity-90',
          (busy || !email.trim() || (codeSent && !code.trim())) && 'opacity-40 pointer-events-none',
        )}
      >
        {busy ? 'Please wait…' : codeSent ? 'Verify & sign in' : 'Send code'}
      </button>
    </div>
  )
}

// ─── Signed-in: sync now / conflict resolution / status ─────────────────────

type Phase = 'idle' | 'planning' | 'conflicts' | 'syncing' | 'done' | 'error'

function SyncPanel({ session }: { session: Session }) {
  const vaultPath = useAppStore((s) => s.vaultPath)
  const [phase, setPhase] = useState<Phase>('idle')
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [noteChoices, setNoteChoices] = useState<Record<string, ConflictChoice>>({})
  const [structuralChoice, setStructuralChoice] = useState<ConflictChoice | undefined>(undefined)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadResult, setDownloadResult] = useState<(ExportResult & { destDir: string }) | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (vaultPath) setLastSyncedAt(loadManifest(vaultPath).lastSyncedAt)
  }, [vaultPath, result])

  const handleSyncNow = async () => {
    if (!vaultPath) return
    setPhase('planning')
    setError(null)
    setResult(null)
    try {
      const { notes, folders, tasks, boards, boardColumns, boardTasks } = useAppStore.getState()
      const p = await computeSyncPlan(vaultPath, { notes, folders, tasks, boards, boardColumns, boardTasks })
      setPlan(p)
      setNoteChoices({})
      setStructuralChoice(undefined)
      if (p.noteConflicts.length > 0 || p.structuralConflict) {
        setPhase('conflicts')
      } else {
        await applyPlan(p, {})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check sync status.')
      setPhase('error')
    }
  }

  const applyPlan = async (p: SyncPlan, resolutions: Record<string, ConflictChoice>) => {
    if (!vaultPath) return
    setPhase('syncing')
    try {
      const conflictResolutions: ConflictResolutions = { notes: resolutions, structural: structuralChoice }
      const r = await runSync(vaultPath, p, conflictResolutions)
      setResult(r)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
      setPhase('error')
    }
  }

  const allConflictsResolved =
    plan &&
    plan.noteConflicts.every((c) => noteChoices[c.localId]) &&
    (!plan.structuralConflict || structuralChoice)

  const handleDownload = async () => {
    const destDir = await pickVaultDirectory()
    if (!destDir) return
    setDownloading(true)
    setError(null)
    setDownloadResult(null)
    try {
      const r = await exportCloudBackup(destDir)
      setDownloadResult({ ...r, destDir })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  const handleDeleteClick = () => {
    useAppStore.getState().openConfirm({
      title: 'Delete cloud backup?',
      description:
        'Permanently deletes every note, image, and the folders/tasks/boards snapshot backed up for your account. ' +
        'Your local vault on this device is untouched — only the cloud copy is removed. This cannot be undone.',
      confirmLabel: 'Delete cloud backup',
      destructive: true,
      onConfirm: async () => {
        setDeleting(true)
        setError(null)
        try {
          await deleteCloudBackup(vaultPath)
          setResult(null)
          setLastSyncedAt(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed.')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{session.user.email}</p>
          <p className="text-[10px] text-tertiary">
            {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : 'Never synced'}
          </p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>

      {!vaultPath && (
        <p className="text-xs text-tertiary">Open a vault first to sync it.</p>
      )}

      {vaultPath && phase !== 'conflicts' && (
        <button
          onClick={handleSyncNow}
          disabled={phase === 'planning' || phase === 'syncing'}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            'bg-accent text-white hover:opacity-90',
            (phase === 'planning' || phase === 'syncing') && 'opacity-60 pointer-events-none',
          )}
        >
          <Cloud className="w-3.5 h-3.5" />
          {phase === 'planning' ? 'Checking…' : phase === 'syncing' ? 'Syncing…' : 'Sync now'}
        </button>
      )}

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
        </p>
      )}

      {phase === 'conflicts' && plan && (
        <div className="space-y-3">
          <p className="text-xs text-foreground font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Both sides changed — pick which version to keep
          </p>

          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {plan.noteConflicts.map((c) => (
              <div key={c.localId} className="px-3 py-2 space-y-1.5">
                <p className="text-xs font-medium text-foreground truncate">{c.title || 'Untitled'}</p>
                <div className="flex gap-1.5 text-[10px]">
                  <ChoiceButton
                    label={`Keep local (${new Date(c.localUpdatedAt).toLocaleString()})`}
                    active={noteChoices[c.localId] === 'local'}
                    onClick={() => setNoteChoices((s) => ({ ...s, [c.localId]: 'local' }))}
                  />
                  <ChoiceButton
                    label={`Keep cloud (${new Date(c.cloudUpdatedAt).toLocaleString()})`}
                    active={noteChoices[c.localId] === 'cloud'}
                    onClick={() => setNoteChoices((s) => ({ ...s, [c.localId]: 'cloud' }))}
                  />
                </div>
              </div>
            ))}

            {plan.structuralConflict && (
              <div className="px-3 py-2 space-y-1.5">
                <p className="text-xs font-medium text-foreground">{plan.structuralConflict.label}</p>
                <div className="flex gap-1.5 text-[10px]">
                  <ChoiceButton
                    label="Keep local"
                    active={structuralChoice === 'local'}
                    onClick={() => setStructuralChoice('local')}
                  />
                  <ChoiceButton
                    label={`Keep cloud (${new Date(plan.structuralConflict.cloudUpdatedAt).toLocaleString()})`}
                    active={structuralChoice === 'cloud'}
                    onClick={() => setStructuralChoice('cloud')}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => applyPlan(plan, noteChoices)}
              disabled={!allConflictsResolved}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                'bg-accent text-white hover:opacity-90',
                !allConflictsResolved && 'opacity-40 pointer-events-none',
              )}
            >
              Apply & sync
            </button>
            <button
              onClick={() => setPhase('idle')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="rounded-lg border border-border px-3 py-2 space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 text-foreground font-medium">
            <Check className="w-3.5 h-3.5 text-green-400" /> Sync complete
          </p>
          <p className="flex items-center gap-1.5"><CloudUpload className="w-3 h-3" /> {result.pushed} note(s) pushed, {result.deleted} deletion(s) synced</p>
          <p className="flex items-center gap-1.5"><CloudDownload className="w-3 h-3" /> {result.pulled} note(s) pulled</p>
          <p className="flex items-center gap-1.5"><Cloud className="w-3 h-3" /> {result.attachmentsUploaded} image(s) backed up, {result.attachmentsDownloaded} restored</p>
        </div>
      )}

      {phase !== 'conflicts' && (
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary pt-2">Your cloud data</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border transition-colors',
                'text-muted-foreground hover:text-foreground hover:border-accent/50',
                downloading && 'opacity-60 pointer-events-none',
              )}
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Downloading…' : 'Download backup'}
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={deleting}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border transition-colors',
                'text-red-400 hover:bg-red-500/10 hover:border-red-500/40',
                deleting && 'opacity-60 pointer-events-none',
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? 'Deleting…' : 'Delete from cloud'}
            </button>
          </div>
          <p className="text-[10px] text-tertiary leading-relaxed">
            Download writes a plain, openable vault folder (.md files + images) — no proprietary format. Delete
            permanently erases your cloud copy only; your local vault is never touched by either action.
          </p>
          {downloadResult && (
            <p className="text-xs text-foreground flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              Saved {downloadResult.notes} note(s) and {downloadResult.images} image(s) to {downloadResult.destDir}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ChoiceButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-md border transition-colors',
        active ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
