/**
 * Byte/string encodings used by the sync layer.
 *
 * bytea columns round-trip as Postgres hex strings ("\xdeadbeef") over
 * PostgREST; Realtime Broadcast payloads are JSON, so updates travel there as
 * base64.
 */
import { uint8ToBase64 } from '../utils'

export function bytesToPgHex(bytes: Uint8Array): string {
  let hex = '\\x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

export function pgHexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export const bytesToBase64 = uint8ToBase64

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** FNV-1a — cheap fingerprint for "has this text changed since we last synced it". */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${text.length}`
}
