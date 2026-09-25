/**
 * Attachment files for shared vaults, stored in the private
 * `vault-attachments` Storage bucket at {vaultId}/{vault-relative path}
 * (e.g. `<uuid>/attachments/report.pdf`, `<uuid>/assets/paste-123.png`).
 *
 * Which attachments exist is synced through the manifest (each note entry
 * carries its attachment list); this module only moves the bytes. Access is
 * enforced by the storage.objects policies in supabase/migrations/0002_collab.sql.
 */
import { supabase } from '../supabase'
import { markSelfWrite } from '../selfWriteRegistry'

const BUCKET = 'vault-attachments'
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function objectPath(vaultId: string, relPath: string): string {
  return `${vaultId}/${relPath.replace(/^\/+/, '')}`
}

export async function attachmentExistsLocally(vaultPath: string, relPath: string): Promise<boolean> {
  if (!isTauri) return true
  const { exists } = await import('@tauri-apps/plugin-fs')
  return exists(`${vaultPath}/${relPath}`)
}

export async function uploadAttachment(vaultPath: string, vaultId: string, relPath: string): Promise<void> {
  if (!isTauri) return
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(`${vaultPath}/${relPath}`)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath(vaultId, relPath), new Blob([bytes]), { upsert: true })
  if (error) throw new Error(error.message)
}

/** Returns false if the file isn't in Storage (yet) — e.g. the uploader is still offline. */
export async function downloadAttachment(vaultPath: string, vaultId: string, relPath: string): Promise<boolean> {
  if (!isTauri) return false
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(vaultId, relPath))
  if (error || !data) return false
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const dest = `${vaultPath}/${relPath}`
  const parent = dest.slice(0, dest.lastIndexOf('/'))
  if (!await exists(parent)) await mkdir(parent, { recursive: true })
  markSelfWrite(dest)
  await writeFile(dest, new Uint8Array(await data.arrayBuffer()))
  return true
}
