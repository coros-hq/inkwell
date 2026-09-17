/**
 * selfWriteRegistry.ts — lets the vault file watcher tell its own writes
 * apart from genuinely external ones.
 *
 * inkwell writes a note to disk on every keystroke (see updateNote in
 * useAppStore.ts), so a naive fs watcher would treat almost every write as
 * an "external change" and thrash. vault.ts marks a path here right before
 * writing it; vaultWatcher.ts checks the mark and ignores any watch event
 * for a path written by inkwell itself within the last TTL_MS.
 */

const TTL_MS = 1200

const recentWrites = new Map<string, number>()

export function markSelfWrite(path: string): void {
  recentWrites.set(path, Date.now())
  if (recentWrites.size > 500) {
    const cutoff = Date.now() - TTL_MS
    for (const [p, t] of recentWrites) {
      if (t < cutoff) recentWrites.delete(p)
    }
  }
}

export function isSelfWrite(path: string): boolean {
  const t = recentWrites.get(path)
  if (t === undefined) return false
  return Date.now() - t < TTL_MS
}
