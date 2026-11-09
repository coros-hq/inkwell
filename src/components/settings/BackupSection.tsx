import { useEffect, useState } from 'react'
import { FolderOpen, HardDriveDownload, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import {
  KEEP_OPTIONS, getBackupSettings, getLastBackup, pickBackupDirectory, revealBackupFolder,
  runBackup, setBackupAuto, setBackupDir, setBackupKeep, type BackupResult,
} from '../../lib/backup'

const fmtBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

export function BackupSection() {
  const { vaultPath } = useAppStore()
  const [settings, setSettings] = useState(getBackupSettings)
  const [lastAt, setLastAt] = useState<Date | null>(null)
  // vaultPath is mirrored from the main window, so it can arrive after first render.
  useEffect(() => { setLastAt(vaultPath ? getLastBackup(vaultPath) : null) }, [vaultPath])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BackupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => setSettings(getBackupSettings())

  const chooseFolder = async () => {
    const dir = await pickBackupDirectory()
    if (dir) { setBackupDir(dir); refresh(); setError(null) }
  }

  const backUp = async () => {
    if (!vaultPath) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await runBackup(vaultPath)
      setResult(r)
      setLastAt(getLastBackup(vaultPath))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-foreground">Local backup</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Saves a zip of the open vault to a folder on this computer — nothing is uploaded.
          Choose an external drive or a cloud-synced folder to keep copies somewhere safe.
        </p>
      </div>

      <Row label="Backup folder" description={settings.dir ?? 'No folder chosen yet'}>
        <div className="flex items-center gap-2">
          {settings.dir && (
            <button
              onClick={() => revealBackupFolder(settings.dir!).catch(console.error)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              title="Open in file manager"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Show
            </button>
          )}
          <button
            onClick={chooseFolder}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-surface"
          >
            {settings.dir ? 'Change…' : 'Choose folder…'}
          </button>
        </div>
      </Row>

      <Row
        label="Back up now"
        description={lastAt ? `Last backup: ${lastAt.toLocaleString()}` : 'This vault has not been backed up yet'}
      >
        <button
          onClick={backUp}
          disabled={busy || !settings.dir || !vaultPath}
          className={cn(
            'flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity',
            'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
      </Row>

      {result && (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground">
          Backed up {result.files} {result.files === 1 ? 'file' : 'files'} ({fmtBytes(result.bytes)}) to{' '}
          <span className="break-all text-muted-foreground">{result.path}</span>
          {result.pruned > 0 && ` · removed ${result.pruned} older ${result.pruned === 1 ? 'backup' : 'backups'}`}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}

      <Row label="Automatic backups" description="Back up when the app opens a vault, at most once a day">
        <button
          role="switch"
          aria-checked={settings.auto}
          aria-label="Automatic backups"
          disabled={!settings.dir}
          onClick={() => { setBackupAuto(!settings.auto); refresh() }}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            settings.auto ? 'bg-accent' : 'bg-border',
          )}
        >
          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', settings.auto ? 'left-[18px]' : 'left-0.5')} />
        </button>
      </Row>

      <Row label="Keep" description="Older backups of this vault are deleted automatically">
        <div className="flex items-center gap-1">
          {KEEP_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => { setBackupKeep(n); refresh() }}
              aria-pressed={settings.keep === n}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                settings.keep === n
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground hover:bg-surface hover:text-foreground',
              )}
            >
              {n === 0 ? 'All' : `Last ${n}`}
            </button>
          ))}
        </div>
      </Row>
    </div>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 [overflow-wrap:anywhere] text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
