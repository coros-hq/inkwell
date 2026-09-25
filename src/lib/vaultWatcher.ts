/**
 * vaultWatcher.ts — watches the open vault for changes made by anything
 * other than inkwell itself (a `git pull`, iCloud Drive / Dropbox / Syncthing,
 * a manual edit in another editor) and notifies the caller so the store can
 * fold them in without a full vault reload. See git-sync-feature-design.md.
 */

import { isSelfWrite } from './selfWriteRegistry'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface VaultWatcherHandle {
  stop: () => void
}

interface FsWatchEvent {
  paths?: string[]
  type?: unknown
}

const NOOP_HANDLE: VaultWatcherHandle = { stop: () => {} }

export async function startVaultWatcher(
  vaultPath: string,
  onExternalChange: (paths: string[]) => void,
): Promise<VaultWatcherHandle> {
  if (!isTauri) return NOOP_HANDLE

  let unwatch: (() => void) | null = null
  let stopped = false

  try {
    const { watch } = await import('@tauri-apps/plugin-fs')
    unwatch = await watch(
      vaultPath,
      (event: FsWatchEvent) => {
        if (stopped) return
        const paths = event?.paths ?? []
        const external = paths.filter(
          (p) =>
            !isSelfWrite(p) &&
            !p.includes('/.git/') && !p.endsWith('/.git') &&
            !p.includes('/.inkwell/sync/'),
        )
        if (external.length) onExternalChange(external)
      },
      { recursive: true, delayMs: 500 },
    )
  } catch (e) {
    console.warn('[inkwell] vault watcher failed to start:', e)
    return NOOP_HANDLE
  }

  return {
    stop: () => {
      stopped = true
      unwatch?.()
    },
  }
}
