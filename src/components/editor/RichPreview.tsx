import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { remarkHighlight } from '../../lib/remarkHighlight'
import { useAppStore } from '../../store/useAppStore'
import { formatFileSize } from '../../lib/attachments'
import { navigateToNote } from '../../lib/noteReferences'
// No external hljs stylesheet — token colors come from CSS variables in globals.css

// ─── Embed helpers ────────────────────────────────────────────────────────────

const FILE_EMBED_RE = /!\[\[([^\]|]+?)(?:\|([^\]|]*))?(?:\|(\d+))?\]\]/g
const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ─── Export mode context ─────────────────────────────────────────────────────
// When true, video embeds render as thumbnail+link and PDFs as download links,
// because file:// pages block cross-origin iframes and data: URL iframes.
const ExportModeContext = React.createContext(false)

// ─── Preload context ─────────────────────────────────────────────────────────
// Maps absolute file path → base64 data URL.
// Provided by ShareDialog before capture so all media is synchronously available.
export const PreloadContext = React.createContext<ReadonlyMap<string, string>>(new Map())

// ─── Video URL detection ─────────────────────────────────────────────────────

type VideoEmbed = {
  platform: 'youtube' | 'vimeo' | 'loom'
  embedUrl: string
  watchUrl: string
  thumbUrl?: string
}

function getVideoEmbed(url: string): VideoEmbed | null {
  if (!url) return null
  try {
    // YouTube: watch?v=, youtu.be/, /embed/, /shorts/
    const yt = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
    )
    if (yt) {
      return {
        platform: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${yt[1]}?rel=0`,
        watchUrl: `https://www.youtube.com/watch?v=${yt[1]}`,
        thumbUrl: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`,
      }
    }
    // Vimeo: vimeo.com/ID or vimeo.com/channels/.../ID
    const vm = url.match(/vimeo\.com\/(?:.*\/)?(\d+)/)
    if (vm) {
      return {
        platform: 'vimeo',
        embedUrl: `https://player.vimeo.com/video/${vm[1]}?dnt=1`,
        watchUrl: `https://vimeo.com/${vm[1]}`,
      }
    }
    // Loom
    const lm = url.match(/loom\.com\/share\/([\w-]+)/)
    if (lm) {
      return {
        platform: 'loom',
        embedUrl: `https://www.loom.com/embed/${lm[1]}`,
        watchUrl: `https://www.loom.com/share/${lm[1]}`,
      }
    }
  } catch { /* ignore */ }
  return null
}

// YouTube play-button SVG (matches YouTube's brand icon)
const YT_PLAY_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="45" viewBox="0 0 68 48">
    <path d="M66.5 7.7c-.8-2.9-2.9-5.1-5.8-5.8C55.8 0 34 0 34 0S12.2 0 7.3 1.9c-2.9.7-5 2.9-5.8 5.8C-.7 12.7 0 24 0 24s-.7 11.3 1.5 16.3c.8 2.9 2.9 5.1 5.8 5.8C12.2 48 34 48 34 48s21.8 0 26.7-1.9c2.9-.7 5-2.9 5.8-5.8C68 35.3 68 24 68 24s.7-11.3-1.5-16.3z" fill="#ff0000" fillOpacity="0.9"/>
    <path d="M27 34l18-10-18-10z" fill="#fff"/>
  </svg>
)

function VideoEmbedPlayer({ embed }: { embed: VideoEmbed }) {
  const forExport = React.useContext(ExportModeContext)
  const label =
    embed.platform === 'youtube' ? 'YouTube' :
    embed.platform === 'vimeo'   ? 'Vimeo'   : 'Loom'

  // In exported HTML, file:// origin causes iframes to be blocked by YouTube/Vimeo/Loom.
  // Render a clickable thumbnail that opens the video in a browser tab instead.
  if (forExport) {
    return (
      <div className="my-4 not-prose">
        <a
          href={embed.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', textDecoration: 'none', borderRadius: '8px', overflow: 'hidden', border: '1px solid hsl(var(--border))' }}
        >
          {embed.thumbUrl ? (
            <div style={{ position: 'relative', paddingBottom: '56.25%', background: '#000' }}>
              <img
                src={embed.thumbUrl}
                alt={`${label} video thumbnail`}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
              />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {YT_PLAY_SVG}
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px', background: '#111', textAlign: 'center', color: '#888' }}>
              ▶ {label} video
            </div>
          )}
          <div style={{ padding: '8px 12px', fontSize: '12px', color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--surface))' }}>
            ▶ Watch on {label} ↗
          </div>
        </a>
      </div>
    )
  }

  return (
    <div className="my-4 not-prose">
      <div
        className="relative w-full rounded-lg overflow-hidden border border-border bg-black"
        style={{ paddingBottom: '56.25%' /* 16:9 */ }}
      >
        <iframe
          src={embed.embedUrl}
          className="absolute inset-0 w-full h-full border-none"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          title={`${label} video`}
        />
      </div>
    </div>
  )
}

const EMBED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'])
const EMBED_VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

function embedFileType(ext: string): 'image' | 'pdf' | 'video' | 'other' {
  if (EMBED_IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (EMBED_VIDEO_EXTS.has(ext)) return 'video'
  return 'other'
}

function uint8ToBase64(bytes: Uint8Array): string {
  let str = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(str)
}

// Bare video URL on its own line (YouTube / Vimeo / Loom)
const VIDEO_LINE_RE =
  /^(https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|(?:www\.)?vimeo\.com\/(?:.*\/)?|(?:www\.)?loom\.com\/share\/)[\w\-?=&#%/+.]+)\s*$/gm

type ContentSegment =
  | { kind: 'md'; text: string }
  | { kind: 'embed'; relativePath: string; displayName: string; sizeBytes: number }
  | { kind: 'video-url'; url: string }

function splitByEmbeds(content: string): ContentSegment[] {
  // Collect all special ranges: ![[...]] file embeds + bare video URL lines
  type Range = { start: number; end: number; seg: ContentSegment }
  const ranges: Range[] = []

  const embedRe = new RegExp(FILE_EMBED_RE)
  let m: RegExpExecArray | null
  while ((m = embedRe.exec(content)) !== null) {
    const relativePath = m[1]
    const displayName = m[2] || relativePath.split('/').pop() || relativePath
    const sizeBytes = parseInt(m[3] || '0') || 0
    ranges.push({ start: m.index, end: m.index + m[0].length, seg: { kind: 'embed', relativePath, displayName, sizeBytes } })
  }

  VIDEO_LINE_RE.lastIndex = 0
  while ((m = VIDEO_LINE_RE.exec(content)) !== null) {
    const url = m[1]
    ranges.push({ start: m.index, end: m.index + m[0].length, seg: { kind: 'video-url', url } })
  }

  ranges.sort((a, b) => a.start - b.start)

  const segments: ContentSegment[] = []
  let last = 0
  for (const r of ranges) {
    if (r.start < last) continue // overlapping, skip
    if (r.start > last) segments.push({ kind: 'md', text: content.slice(last, r.start) })
    segments.push(r.seg)
    last = r.end
  }
  if (last < content.length) segments.push({ kind: 'md', text: content.slice(last) })
  return segments
}

// ─── Inline file embed preview card ─────────────────────────────────────────

function PreviewFileEmbed({
  relativePath,
  displayName,
  sizeBytes,
  vaultPath,
  searchRoot,
  noteId,
  defaultExpanded = false,
}: {
  relativePath: string
  displayName: string
  sizeBytes: number
  vaultPath: string | null
  searchRoot?: string
  noteId?: string
  defaultExpanded?: boolean
}) {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  const type = embedFileType(ext)
  const directPath = vaultPath ? `${vaultPath}/${relativePath}` : relativePath

  // Obsidian's `![[filename]]` embeds are bare filenames resolved by searching the
  // whole vault, since the file usually lives in an attachments folder, not next to
  // the note. Try the direct vault-relative path first, then a vault-wide search by
  // basename, then (for a note opened from outside this vault) the same search
  // rooted at the note's own source vault, so images from an externally-opened
  // Obsidian note still resolve.
  const [fullPath, setFullPath] = useState<string | null>(directPath)
  const [resolving, setResolving] = useState(isTauriEnv)

  useEffect(() => {
    let cancelled = false
    setFullPath(directPath)
    if (!isTauriEnv) { setResolving(false); return }
    setResolving(true)
    import('@tauri-apps/plugin-fs').then(async ({ exists }) => {
      if (await exists(directPath).catch(() => false)) {
        if (!cancelled) setResolving(false)
        return
      }
      const { findFileInVault } = await import('../../lib/vault')
      const filename = relativePath.split('/').pop() || relativePath
      for (const root of [vaultPath, searchRoot]) {
        if (!root) continue
        const found = await findFileInVault(root, filename)
        if (found) {
          if (!cancelled) { setFullPath(found); setResolving(false) }
          return
        }
      }
      if (!cancelled) { setFullPath(null); setResolving(false) }
    }).catch(() => { if (!cancelled) setResolving(false) })
    return () => { cancelled = true }
  }, [directPath, vaultPath, searchRoot, relativePath])

  const notFound = !resolving && !fullPath

  // Preloaded data from ShareDialog (synchronous — ready before mount)
  const preloads = React.useContext(PreloadContext)
  const preloaded = preloads.get(fullPath ?? '') ?? null

  const [expanded, setExpanded] = useState(defaultExpanded)
  // Initialise from preloaded data so there's no async gap during export capture
  const [pdfUrl, setPdfUrl] = useState<string | null>(
    preloaded?.startsWith('data:application/pdf') ? preloaded : null
  )
  const [imgUrl, setImgUrl] = useState<string | null>(
    preloaded?.startsWith('data:image') ? preloaded : null
  )
  const [videoUrl, setVideoUrl] = useState<string | null>(
    preloaded?.startsWith('data:video') ? preloaded : null
  )

  // Sync state if preloads arrive after mount (context updates after async load)
  useEffect(() => {
    if (!preloaded) return
    if (preloaded.startsWith('data:application/pdf') && !pdfUrl) setPdfUrl(preloaded)
    else if (preloaded.startsWith('data:image') && !imgUrl) setImgUrl(preloaded)
    else if (preloaded.startsWith('data:video') && !videoUrl) setVideoUrl(preloaded)
  }, [preloaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // All local media uses base64 data URLs so they work both in Tauri preview
  // AND in exported HTML files opened in a regular browser.
  // These effects are skipped when preloaded data is already available.

  // PDF → base64 (asset:// is blocked inside iframes in WKWebView)
  useEffect(() => {
    if (!expanded || type !== 'pdf' || pdfUrl || !isTauriEnv || resolving || !fullPath) return
    import('@tauri-apps/plugin-fs')
      .then(({ readFile }) => readFile(fullPath))
      .then(bytes => {
        const b64 = uint8ToBase64(new Uint8Array(bytes))
        setPdfUrl(`data:application/pdf;base64,${b64}`)
      })
      .catch(console.error)
  }, [expanded, fullPath, type, pdfUrl, resolving])

  // Image → base64 (asset:// URLs are Tauri-only; data: URLs work everywhere)
  // Images render directly (no accordion), so load eagerly rather than on expand.
  useEffect(() => {
    if (type !== 'image' || imgUrl || !isTauriEnv || resolving || !fullPath) return
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      avif: 'image/avif', bmp: 'image/bmp',
    }
    const mime = mimeMap[ext] ?? 'image/jpeg'
    import('@tauri-apps/plugin-fs')
      .then(({ readFile }) => readFile(fullPath))
      .then(bytes => {
        const b64 = uint8ToBase64(new Uint8Array(bytes))
        setImgUrl(`data:${mime};base64,${b64}`)
      })
      .catch(console.error)
  }, [fullPath, type, ext, imgUrl, resolving])

  // Video → base64 (asset:// is blocked inside <video> in WKWebView)
  useEffect(() => {
    if (!expanded || type !== 'video' || videoUrl || !isTauriEnv || resolving || !fullPath) return
    const mime =
      ext === 'webm' ? 'video/webm' :
      ext === 'mov'  ? 'video/quicktime' :
      ext === 'avi'  ? 'video/x-msvideo' :
      'video/mp4'
    import('@tauri-apps/plugin-fs')
      .then(({ readFile }) => readFile(fullPath))
      .then(bytes => {
        const b64 = uint8ToBase64(new Uint8Array(bytes))
        setVideoUrl(`data:${mime};base64,${b64}`)
      })
      .catch(console.error)
  }, [expanded, fullPath, type, ext, videoUrl, resolving])

  const openExternally = () => {
    if (!isTauriEnv || !fullPath) return
    import('@tauri-apps/plugin-opener')
      .then(({ openPath }) => openPath(fullPath))
      .catch(console.error)
  }

  const { removeAttachment: storeRemoveAttachment, updateNote: storeUpdateNote, notes } = useAppStore()

  const handleRemove = () => {
    if (!noteId) return
    // Remove embed syntax from note content
    const note = notes.find(n => n.id === noteId)
    if (note) {
      const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`!\\[\\[${escaped}[^\\]]*\\]\\]\\n?`, 'g')
      storeUpdateNote(noteId, note.content.replace(re, ''))
    }
    // Remove from attachment list + disk
    const att = notes.find(n => n.id === noteId)?.attachments?.find(a => a.path === relativePath)
    if (att) {
      storeRemoveAttachment(noteId, att.id)
      if (vaultPath) {
        import('../../lib/attachments')
          .then(({ deleteAttachmentFile }) => deleteAttachmentFile(vaultPath, att))
          .catch(console.error)
      }
    }
  }

  const icon =
    type === 'pdf' ? '📄' : type === 'image' ? '🖼' : type === 'video' ? '🎬' : '📎'

  // Images render directly, like a normal markdown image — no accordion chrome.
  if (type === 'image') {
    return (
      <div className="group/embed relative my-3 not-prose inline-block max-w-full">
        {imgUrl
          ? <img src={imgUrl} alt={displayName} className="max-w-full rounded-lg border border-border/40 block" />
          : <div className="h-32 w-full min-w-[200px] flex items-center justify-center text-sm text-muted-foreground border border-border/40 rounded-lg">
              {notFound ? `Image not found: ${displayName}` : 'Loading…'}
            </div>
        }
        {noteId && (
          <button
            title="Remove from note and list"
            onClick={e => { e.stopPropagation(); handleRemove() }}
            className="absolute top-2 right-2 shrink-0 opacity-0 group-hover/embed:opacity-100 bg-background/80 hover:text-red-400 text-muted-foreground transition-opacity p-1 rounded-md border border-border/40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="group/embed border border-border rounded-lg overflow-hidden my-3 bg-surface/60 not-prose">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface transition-colors"
      >
        <span className="text-base leading-none">{icon}</span>
        <span className="flex-1 text-sm text-foreground truncate">{displayName}</span>
        {sizeBytes > 0 && (
          <span className="text-[11px] text-muted-foreground mr-1 shrink-0">
            {formatFileSize(sizeBytes)}
          </span>
        )}
        {noteId && (
          <button
            title="Remove from note and list"
            onClick={e => { e.stopPropagation(); handleRemove() }}
            className="shrink-0 opacity-0 group-hover/embed:opacity-100 hover:text-red-400 text-muted-foreground transition-opacity p-0.5 rounded"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <span
          className="text-[10px] text-muted-foreground shrink-0 transition-transform duration-150"
          style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : '' }}
        >
          ▼
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {type === 'pdf' && (
            pdfUrl
              ? (
                  // Chrome blocks data: URL iframes from file:// pages.
                  // In export mode (defaultExpanded=true) show a download link instead.
                  defaultExpanded
                    ? <div className="flex items-center gap-3 px-4 py-4">
                        <span className="text-2xl">📄</span>
                        <a href={pdfUrl} download={displayName}
                           className="text-sm text-accent underline underline-offset-2 hover:opacity-80">
                          ⬇ Download {displayName}
                        </a>
                      </div>
                    : <iframe src={pdfUrl} className="w-full block border-none" style={{ height: 560 }} title={displayName} />
                )
              : <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">{notFound ? `File not found: ${displayName}` : 'Loading PDF…'}</div>
          )}
          {type === 'video' && (
            videoUrl
              ? <video controls src={videoUrl} className="w-full block bg-black" style={{ maxHeight: 400 }} />
              : <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">{notFound ? `File not found: ${displayName}` : 'Loading…'}</div>
          )}
          {type === 'other' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-muted-foreground">No inline preview for this file type.</p>
              <button
                onClick={openExternally}
                className="text-xs px-3 py-1.5 rounded border border-border bg-surface text-accent hover:opacity-80 transition-opacity"
              >
                ↗ Open with system app
              </button>
            </div>
          )}
          <div className="flex justify-end px-3 py-2 bg-surface/80 border-t border-border">
            <button
              onClick={openExternally}
              className="text-[11px] px-2 py-1 rounded border border-border bg-surface text-foreground hover:opacity-80 transition-opacity"
            >
              ↗ Open in Preview
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface RichPreviewProps {
  content: string
  noteId?: string
  searchQuery?: string
  searchMatchIndex?: number
  /** When true, all file embeds start expanded and use base64 for portability (used by HTML/PDF export) */
  forExport?: boolean
  onScrollerReady?: (el: HTMLElement) => void
}

// Module-level cache: absPath → data URL. Persists across re-renders and note switches.
const imageCache = new Map<string, string>()

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
}

/** Renders an external (http/https) image with a styled error fallback. */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground border border-border/40 rounded-md px-2 py-1 my-2">
        <span className="opacity-60">⚠</span> Could not load image — make sure the URL points directly to an image, not a webpage.
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className="max-w-full rounded-lg my-4 border border-border/40"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/** Renders a local image by reading it via plugin-fs and converting to a data URL. */
function LocalImage({ absPath, alt, vaultPath, searchRoot }: { absPath: string; alt: string; vaultPath: string | null; searchRoot?: string }) {
  const preloads = React.useContext(PreloadContext)
  // Prefer preloaded data (synchronous, from ShareDialog), then module cache, then empty
  const [dataSrc, setDataSrc] = useState(
    () => preloads.get(absPath) ?? imageCache.get(absPath) ?? ''
  )
  const [notFound, setNotFound] = useState(false)

  // Sync with preload context if it populates after mount
  useEffect(() => {
    const pre = preloads.get(absPath)
    if (pre && pre !== dataSrc) setDataSrc(pre)
  }, [preloads, absPath, dataSrc])

  useEffect(() => {
    if (!isTauriEnv || dataSrc) return
    const loadBytes = (path: string) => import('@tauri-apps/plugin-fs').then(({ readFile }) => readFile(path))

    loadBytes(absPath)
      .catch(async () => {
        // Fall back to a vault-wide search by filename — Obsidian-style relative
        // paths (e.g. a differently-named/nested attachments folder) commonly
        // don't line up with the literal path written in the markdown. For a note
        // opened from outside this vault, also search its own source vault.
        const filename = absPath.split('/').pop() ?? ''
        if (!filename) throw new Error('cannot resolve fallback path')
        const { findFileInVault } = await import('../../lib/vault')
        for (const root of [vaultPath, searchRoot]) {
          if (!root) continue
          const found = await findFileInVault(root, filename)
          if (found) return loadBytes(found)
        }
        throw new Error('image not found in vault')
      })
      .then(bytes => {
        const ext = absPath.split('.').pop()?.toLowerCase() ?? 'jpg'
        const mime = MIME[ext] ?? 'image/jpeg'
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const dataUrl = `data:${mime};base64,${btoa(binary)}`
        imageCache.set(absPath, dataUrl)
        setDataSrc(dataUrl)
      })
      .catch(e => { console.error('Failed to load image:', absPath, e); setNotFound(true) })
  }, [absPath, dataSrc, vaultPath, searchRoot])

  if (notFound) {
    return (
      <div className="h-32 w-full max-w-full my-4 flex items-center justify-center text-sm text-muted-foreground border border-border/40 rounded-lg">
        Image not found: {absPath.split('/').pop()}
      </div>
    )
  }

  return (
    <img
      src={dataSrc}
      alt={alt}
      className="max-w-full rounded-lg my-4 border border-border/40"
    />
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] px-2 py-0.5 rounded bg-surface border border-border text-muted-foreground hover:text-foreground"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

/**
 * Encode spaces in local image/link paths so the CommonMark parser accepts them.
 * Must run on the raw markdown string BEFORE react-markdown sees it, because
 * micromark rejects `![alt](path with spaces)` as plain text — urlTransform
 * is never called for paths that the parser already rejected.
 */
function preprocessMarkdown(md: string): string {
  return md.replace(
    /(!?\[[^\]]*\])\(([^)]+)\)/g,
    (match, prefix, url) => {
      // Leave external URLs untouched
      if (/^(https?:|data:|blob:|ftp:|#)/.test(url.trim())) return match
      return `${prefix}(${url.replace(/ /g, '%20')})`
    }
  )
}

export function RichPreview({ content, noteId, searchQuery = '', searchMatchIndex = 0, forExport = false, onScrollerReady }: RichPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingScrollRef = useRef<number | null>(null)
  const { updateNote, vaultPath, notes } = useAppStore()
  const searchRoot = notes.find(n => n.id === noteId)?.searchRoot

  // Restore scroll position synchronously before the browser repaints,
  // preventing the visible jump when markdown re-parses after a toggle.
  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = pendingScrollRef.current
      pendingScrollRef.current = null
    }
  })

  useEffect(() => {
    if (scrollRef.current) onScrollerReady?.(scrollRef.current)
  }, [])

  // ── Search highlighting in preview DOM ──────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Remove previous highlights
    container.querySelectorAll('mark.inkwell-search').forEach(el => {
      const parent = el.parentNode
      if (!parent) return
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
      parent.normalize()
    })

    if (!searchQuery || searchQuery.length < 1) return

    const query = searchQuery.toLowerCase()
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip text inside <code> and <pre> blocks
        let el = node.parentElement
        while (el) {
          if (el.tagName === 'CODE' || el.tagName === 'PRE') return NodeFilter.FILTER_REJECT
          el = el.parentElement
        }
        return NodeFilter.FILTER_ACCEPT
      }
    })

    const textNodes: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text)) textNodes.push(node)

    let matchCount = 0
    textNodes.forEach(textNode => {
      const text = textNode.textContent ?? ''
      if (!text.toLowerCase().includes(query)) return
      const fragment = document.createDocumentFragment()
      let last = 0
      let pos = text.toLowerCase().indexOf(query)
      while (pos !== -1) {
        if (pos > last) fragment.appendChild(document.createTextNode(text.slice(last, pos)))
        const mark = document.createElement('mark')
        mark.className = matchCount === searchMatchIndex
          ? 'inkwell-search inkwell-search-active'
          : 'inkwell-search'
        mark.textContent = text.slice(pos, pos + searchQuery.length)
        fragment.appendChild(mark)
        matchCount++
        last = pos + searchQuery.length
        pos = text.toLowerCase().indexOf(query, last)
      }
      if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)))
      textNode.parentNode?.replaceChild(fragment, textNode)
    })

    // Scroll active match into view
    const active = container.querySelector('mark.inkwell-search-active')
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [searchQuery, searchMatchIndex, content])

  // ── DOM-position-based handler: find the checkbox's index among all checkboxes
  // in the committed DOM at event time instead of counting during render.
  // This is immune to React StrictMode's double-invocation of components.
  const handleCheckboxMouseDown = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault()

    const container = containerRef.current
    if (!container) return
    const allCheckboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    )
    const index = allCheckboxes.indexOf(e.currentTarget)
    if (index === -1) return

    if (scrollRef.current) pendingScrollRef.current = scrollRef.current.scrollTop

    const state = useAppStore.getState()
    const targetId = noteId ?? state.lastSelectedNoteId ?? state.selectedNoteIds[0]
    if (!targetId) return
    const note = state.notes.find(n => n.id === targetId)
    if (!note) return

    let count = 0
    const updated = note.content.replace(/- \[[ xX]\]/g, (match) => {
      const hit = count === index
      count++
      if (!hit) return match
      return match.toLowerCase() === '- [x]' ? '- [ ]' : '- [x]'
    })
    updateNote(targetId, updated)
  }, [noteId, updateNote])

  const segments = splitByEmbeds(content)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mdComponents: Record<string, any> = {
    h1: ({ children }: any) => <h1 className="text-[30px] font-semibold mb-4 text-foreground leading-tight tracking-[-0.015em]">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-[22px] font-semibold mb-3 text-foreground mt-9 tracking-tight">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-[17px] font-semibold mb-2 text-foreground mt-7 tracking-tight">{children}</h3>,
    p: ({ children }: any) => {
      // If the paragraph is a single link pointing to a video URL, embed the player
      const kids = React.Children.toArray(children)
      if (kids.length === 1 && React.isValidElement(kids[0])) {
        const el = kids[0] as React.ReactElement<{ href?: string; children?: React.ReactNode }>
        const href = el.props.href
        // covers <a href="..."> (linked) and plain autolinked URLs (same element)
        if (href) {
          const embed = getVideoEmbed(href)
          if (embed) return <VideoEmbedPlayer embed={embed} />
        }
      }
      return <p className="mb-4 text-foreground">{children}</p>
    },

    // react-markdown v9 removed the `inline` prop.
    code: ({ className, children, ...props }: any) => {
      const isBlock = className?.startsWith('language-') || String(children).includes('\n')
      return isBlock ? (
        <code className={className} {...props}>{children}</code>
      ) : (
        <code className="font-mono text-[13px] text-accent bg-code-bg px-1.5 py-0.5 rounded" {...props}>{children}</code>
      )
    },

    pre: ({ children }: any) => (
      <div className="relative group mb-4">
        <pre className="inkwell-code-block font-mono text-[13px] p-4 rounded-lg overflow-x-auto border border-border/50">{children}</pre>
        <CopyButton getText={() => extractText(children)} />
      </div>
    ),

    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-accent pl-4 my-4 text-muted-foreground italic">{children}</blockquote>
    ),

    table:  ({ children }: any) => <div className="overflow-x-auto mb-4"><table className="w-full border-collapse text-sm">{children}</table></div>,
    thead:  ({ children }: any) => <thead className="border-b border-border">{children}</thead>,
    tbody:  ({ children }: any) => <tbody>{children}</tbody>,
    tr:     ({ children }: any) => <tr className="border-b border-border/50 hover:bg-surface/50 transition-colors">{children}</tr>,
    th:     ({ children }: any) => <th className="px-3 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{children}</th>,
    td:     ({ children }: any) => <td className="px-3 py-2.5 text-foreground text-[14px]">{children}</td>,

    ul: ({ children, className }: any) =>
      className === 'contains-task-list'
        ? <ul className="mb-4 space-y-1 list-none pl-4">{children}</ul>
        : <ul className="list-disc list-inside mb-4 space-y-1 text-foreground">{children}</ul>,

    ol: ({ children }: any) => <ol className="list-decimal list-inside mb-4 space-y-1 text-foreground">{children}</ol>,

    li: ({ children, className }: any) =>
      className === 'task-list-item'
        ? <li className="flex flex-wrap items-start gap-x-2 leading-[1.7] list-none [&>ul]:w-full [&>ul]:mt-1 [&>ol]:w-full [&>ol]:mt-1">{children}</li>
        : <li className="leading-[1.7]">{children}</li>,

    input: ({ type, checked }: any) => {
      if (type !== 'checkbox') return null
      return (
        <input
          type="checkbox"
          checked={checked === true}
          disabled={false}
          readOnly={false}
          onChange={() => {}}
          onMouseDown={handleCheckboxMouseDown}
          className="w-[15px] h-[15px] mt-[3px] shrink-0 rounded cursor-pointer"
          style={{ accentColor: 'hsl(var(--accent))' }}
        />
      )
    },

    a:  ({ children, href }: any) => {
      const noteMatch = typeof href === 'string' ? href.match(/^note:\/\/([a-zA-Z0-9-]+)$/) : null
      if (noteMatch) {
        return (
          <button
            onClick={() => navigateToNote(noteMatch[1])}
            className="text-accent underline underline-offset-2 hover:opacity-80 cursor-pointer inline"
          >
            {children}
          </button>
        )
      }
      return <a href={href} className="text-accent underline underline-offset-2 hover:opacity-80">{children}</a>
    },
    hr: () => <hr className="border-border my-6" />,

    img: ({ src, alt }: any) => {
      // Decode any %20 we inserted during preprocessing so the actual file path is restored
      const decoded = src ? decodeURIComponent(src) : ''
      const isExternal = !decoded || /^(https?:|data:|blob:)/.test(decoded)
      if (isExternal) return <ExternalImage src={decoded} alt={alt ?? ''} />
      const absPath = vaultPath ? (decoded.startsWith('/') ? decoded : `${vaultPath}/${decoded}`) : decoded
      return <LocalImage absPath={absPath} alt={alt ?? ''} vaultPath={vaultPath ?? null} searchRoot={searchRoot} />
    },

    strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
    em:     ({ children }: any) => <em className="italic text-foreground">{children}</em>,
    mark:   ({ children }: any) => <mark className="bg-yellow-300/30 text-foreground rounded px-0.5">{children}</mark>,
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-10 pt-16 pb-24 antialiased">
      <div ref={containerRef} className="max-w-[740px] mx-auto font-sans text-[15.5px] leading-[1.7] text-foreground">
        <ExportModeContext.Provider value={forExport}>
        {segments.map((seg, i) =>
          seg.kind === 'embed' ? (
            <PreviewFileEmbed
              key={i}
              relativePath={seg.relativePath}
              displayName={seg.displayName}
              sizeBytes={seg.sizeBytes}
              vaultPath={vaultPath ?? null}
              searchRoot={searchRoot}
              noteId={noteId}
              defaultExpanded={forExport}
            />
          ) : seg.kind === 'video-url' ? (
            <VideoEmbedPlayer key={i} embed={getVideoEmbed(seg.url)!} />
          ) : (
            <ReactMarkdown
              key={i}
              remarkPlugins={[remarkGfm, remarkHighlight]}
              rehypePlugins={[rehypeHighlight, rehypeRaw]}
              components={mdComponents}
              urlTransform={(url) => {
                if (url.startsWith('note://')) return url
                if (/^(https?:|mailto:|#|\/)/.test(url)) return url
                return undefined
              }}
            >
              {preprocessMarkdown(seg.text)}
            </ReactMarkdown>
          )
        )}
        </ExportModeContext.Provider>
      </div>
    </div>
  )
}
