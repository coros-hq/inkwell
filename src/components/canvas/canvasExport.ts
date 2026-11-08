import rough from 'roughjs'
import type { Options } from 'roughjs/bin/core'
import { FONT_HAND } from './CanvasToolbar'
import { shapeBounds } from './canvasTypes'
import type { Shape, ArrowShape } from './canvasTypes'
import {
  adaptShape, boundFont, containerTextBox, ctxFont, getMeasureCtx, roughOptions, wrapCanvasText,
  STICKY_TEXT_COLOR, BOUND_LINE_HEIGHT,
} from './canvasShared'

// Exports a set of canvas shapes as an SVG document or a PNG. The SVG is built
// directly from the shape data (vector, no canvas involved); the PNG is painted
// by CanvasView's own renderer through the `paint` callback so it looks exactly
// like the live canvas.

export type ExportFormat = 'svg' | 'png'
export type ExportBackground = 'transparent' | 'light' | 'dark'

export interface ExportOptions {
  background: ExportBackground
  /** PNG pixel density multiplier. */
  scale: number
  padding: number
  /** Hand-drawn look (roughjs) instead of clean geometry. */
  sketchy: boolean
  /** Used to pick legible ink when the background is transparent. */
  appIsDark: boolean
}

export const EXPORT_BG: Record<'light' | 'dark', string> = { light: '#ffffff', dark: '#16140f' }
const INK_ON_DARK = '#f3ede2'
const INK_ON_LIGHT = '#1e1b18'

const MAX_SIDE = 16384
const MAX_PIXELS = 120_000_000

function isDarkBg(o: ExportOptions): boolean {
  return o.background === 'dark' || (o.background === 'transparent' && o.appIsDark)
}

/** Shapes recolored so near-neutral ink stays visible on the chosen background. */
function adaptAll(shapes: Shape[], o: ExportOptions): Shape[] {
  const dark = isDarkBg(o)
  return shapes.map(s => adaptShape(s, dark, dark ? INK_ON_DARK : INK_ON_LIGHT))
}

// ── Bounds ─────────────────────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

function shapeExportBox(s: Shape): Box {
  let b: Box = shapeBounds(s)
  if (s.type === 'text') {
    const ctx = getMeasureCtx()
    ctx.save(); ctx.font = ctxFont(s)
    const w = ctx.measureText(s.text).width
    ctx.restore()
    b = { x: s.x, y: s.y - s.size, w: Math.max(w, 1), h: s.size * 1.35 }
  }
  const extra = s.type === 'sticky' ? 14 : s.type === 'image' ? 0 : s.width / 2 + (s.type === 'arrow' ? 8 : 0)
  b = { x: b.x - extra, y: b.y - extra, w: b.w + extra * 2, h: b.h + extra * 2 }
  if (s.rotation) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, c = Math.cos(s.rotation), sn = Math.sin(s.rotation)
    const xs: number[] = [], ys: number[] = []
    for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      const dx = px - cx, dy = py - cy
      xs.push(cx + dx * c - dy * sn); ys.push(cy + dx * sn + dy * c)
    }
    const x = Math.min(...xs), y = Math.min(...ys)
    b = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  return b
}

/** Padded bounding box of all shapes (null when there is nothing to export). */
export function exportBox(shapes: Shape[], padding: number): Box | null {
  if (!shapes.length) return null
  const boxes = shapes.map(shapeExportBox)
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  const x2 = Math.max(...boxes.map(b => b.x + b.w)), y2 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: Math.floor(x - padding), y: Math.floor(y - padding), w: Math.ceil(x2 - x + padding * 2), h: Math.ceil(y2 - y + padding * 2) }
}

/** Pixel size of the PNG for these options, with the scale reduced if it would exceed canvas limits. */
export function pngSize(box: Box, scale: number): { w: number; h: number; scale: number } {
  let sc = scale
  sc = Math.min(sc, MAX_SIDE / box.w, MAX_SIDE / box.h, Math.sqrt(MAX_PIXELS / (box.w * box.h)))
  sc = Math.max(sc, 0.05)
  return { w: Math.max(1, Math.round(box.w * sc)), h: Math.max(1, Math.round(box.h * sc)), scale: sc }
}

// ── SVG ────────────────────────────────────────────────────────────────────────

const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => +n.toFixed(2)

function roughPaths(drawable: ReturnType<ReturnType<typeof rough.generator>['rectangle']>): string {
  const gen = rough.generator()
  return gen.toPaths(drawable).map(p =>
    `<path d="${esc(p.d)}" stroke="${esc(p.stroke)}" stroke-width="${num(p.strokeWidth)}" fill="${p.fill ? esc(p.fill) : 'none'}"/>`,
  ).join('')
}

function shapeToSvg(s: Shape, sketchy: boolean, defs: Set<string>): string {
  const gen = rough.generator()
  const ro = (): Options => roughOptions(s) as Options
  const fill = s.fill === 'none' ? 'none' : s.fill
  const stroke = `stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"`
  let out = ''

  switch (s.type) {
    case 'path': {
      const p = s.pts
      if (p.length < 2) return ''
      let d = `M ${num(p[0].x)} ${num(p[0].y)}`
      for (let i = 1; i < p.length - 1; i++) {
        d += ` Q ${num(p[i].x)} ${num(p[i].y)} ${num((p[i].x + p[i + 1].x) / 2)} ${num((p[i].y + p[i + 1].y) / 2)}`
      }
      d += ` L ${num(p[p.length - 1].x)} ${num(p[p.length - 1].y)}`
      out = `<path d="${d}" fill="none" ${stroke}/>`
      break
    }
    case 'rect': {
      const b = shapeBounds(s)
      out = sketchy
        ? roughPaths(gen.rectangle(s.x, s.y, s.w, s.h, ro()))
        : `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${s.radius ?? 3}" fill="${esc(fill)}" ${stroke}/>`
      break
    }
    case 'ellipse': {
      out = sketchy
        ? roughPaths(gen.ellipse(s.cx, s.cy, Math.max(1, Math.abs(s.rx)) * 2, Math.max(1, Math.abs(s.ry)) * 2, ro()))
        : `<ellipse cx="${num(s.cx)}" cy="${num(s.cy)}" rx="${num(Math.max(1, Math.abs(s.rx)))}" ry="${num(Math.max(1, Math.abs(s.ry)))}" fill="${esc(fill)}" ${stroke}/>`
      break
    }
    case 'line': {
      out = sketchy
        ? roughPaths(gen.line(s.x1, s.y1, s.x2, s.y2, ro()))
        : `<line x1="${num(s.x1)}" y1="${num(s.y1)}" x2="${num(s.x2)}" y2="${num(s.y2)}" ${stroke}/>`
      break
    }
    case 'arrow': {
      const a = s as ArrowShape
      if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 1) return ''
      const cpx = a.cpx ?? (a.x1 + a.x2) / 2, cpy = a.cpy ?? (a.y1 + a.y2) / 2
      const angle = Math.atan2(a.y2 - cpy, a.x2 - cpx)
      const H = Math.max(14, a.width * 5)
      const h1: [number, number] = [a.x2 - H * Math.cos(angle - Math.PI / 7), a.y2 - H * Math.sin(angle - Math.PI / 7)]
      const h2: [number, number] = [a.x2 - H * Math.cos(angle + Math.PI / 7), a.y2 - H * Math.sin(angle + Math.PI / 7)]
      if (sketchy) {
        const o = { ...ro(), fill: undefined }
        out = roughPaths(gen.path(`M ${a.x1} ${a.y1} Q ${cpx} ${cpy}, ${a.x2} ${a.y2}`, o))
            + roughPaths(gen.linearPath([h1, [a.x2, a.y2], h2], o))
      } else {
        out = `<path d="M ${num(a.x1)} ${num(a.y1)} Q ${num(cpx)} ${num(cpy)} ${num(a.x2)} ${num(a.y2)} M ${num(h1[0])} ${num(h1[1])} L ${num(a.x2)} ${num(a.y2)} L ${num(h2[0])} ${num(h2[1])}" fill="none" ${stroke}/>`
      }
      break
    }
    case 'text': {
      out = `<text x="${num(s.x)}" y="${num(s.y)}" font-family="${esc(s.fontFamily ?? FONT_HAND)}" font-size="${s.size}"`
        + `${s.bold ? ' font-weight="bold"' : ''}${s.italic ? ' font-style="italic"' : ''} fill="${esc(s.color)}" xml:space="preserve">${esc(s.text)}</text>`
      break
    }
    case 'sticky': {
      defs.add('<filter id="sticky-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.28"/></filter>')
      const ctx = getMeasureCtx()
      ctx.save(); ctx.font = `13px ${FONT_HAND}`
      const pad = 8, lineH = 13 * 1.3
      const lines = wrapCanvasText(ctx, s.text, Math.max(s.w - pad * 2, 10))
      ctx.restore()
      out = `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" rx="3" fill="${esc(s.color)}" filter="url(#sticky-shadow)"/>`
        + lines.map((l, i) =>
          `<text x="${num(s.x + pad)}" y="${num(s.y + pad + i * lineH)}" font-family="${esc(FONT_HAND)}" font-size="13" dominant-baseline="hanging" fill="${STICKY_TEXT_COLOR}" xml:space="preserve">${esc(l)}</text>`,
        ).join('')
      break
    }
    case 'image': {
      const id = `img-clip-${esc(s.id)}`
      defs.add(`<clipPath id="${id}"><rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" rx="4"/></clipPath>`)
      out = `<image href="${esc(s.src)}" x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" preserveAspectRatio="none" clip-path="url(#${id})"/>`
      break
    }
  }

  if ((s.type === 'rect' || s.type === 'ellipse') && s.boundText?.text) {
    const bt = s.boundText
    const box = containerTextBox(s)
    const ctx = getMeasureCtx()
    ctx.save(); ctx.font = boundFont(bt)
    const lines = wrapCanvasText(ctx, bt.text, box.w)
    ctx.restore()
    const lineH = bt.size * BOUND_LINE_HEIGHT
    let y = box.y + box.h / 2 - (lines.length * lineH) / 2 + lineH / 2
    for (const l of lines) {
      out += `<text x="${num(box.x + box.w / 2)}" y="${num(y)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(bt.fontFamily)}" font-size="${bt.size}"`
        + `${bt.bold ? ' font-weight="bold"' : ''}${bt.italic ? ' font-style="italic"' : ''} fill="${esc(bt.color)}" xml:space="preserve">${esc(l)}</text>`
      y += lineH
    }
  }

  if (s.rotation) {
    const b = shapeBounds(s)
    out = `<g transform="rotate(${num((s.rotation * 180) / Math.PI)} ${num(b.x + b.w / 2)} ${num(b.y + b.h / 2)})">${out}</g>`
  }
  return out
}

/** Standalone SVG document for the shapes, or null if there are none. */
export function buildSvg(shapes: Shape[], o: ExportOptions): { svg: string; width: number; height: number } | null {
  const box = exportBox(shapes, o.padding)
  if (!box) return null
  const adapted = adaptAll(shapes, o)
  const defs = new Set<string>()
  const body = adapted.map(s => shapeToSvg(s, o.sketchy, defs)).join('\n')
  const bg = o.background === 'transparent' ? '' : `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${EXPORT_BG[o.background]}"/>\n`
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}">\n`
    + `${defs.size ? `<defs>${[...defs].join('')}</defs>\n` : ''}`
    + `${bg}${body}\n</svg>\n`
  return { svg, width: box.w, height: box.h }
}

// ── PNG ────────────────────────────────────────────────────────────────────────

/** Paints already-adapted shapes with CanvasView's renderer (ctx is pre-scaled and translated to world space). */
export type PaintFn = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, shapes: Shape[], sketchy: boolean) => void

export async function renderPng(shapes: Shape[], o: ExportOptions, paint: PaintFn): Promise<Uint8Array | null> {
  const box = exportBox(shapes, o.padding)
  if (!box) return null
  const { w, h, scale } = pngSize(box, o.scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  if (o.background !== 'transparent') {
    ctx.fillStyle = EXPORT_BG[o.background]
    ctx.fillRect(0, 0, w, h)
  }
  ctx.scale(scale, scale)
  ctx.translate(-box.x, -box.y)
  paint(ctx, canvas, adaptAll(shapes, o), o.sketchy)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

// ── Saving ─────────────────────────────────────────────────────────────────────

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function safeFileName(title: string): string {
  return (title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)) || 'drawing'
}

/** Native save dialog + write (browser download outside Tauri). Returns false if cancelled or failed. */
export async function saveExport(data: string | Uint8Array, defaultName: string, ext: 'svg' | 'png'): Promise<boolean> {
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
      if (!path) return false
      const fs = await import('@tauri-apps/plugin-fs')
      if (typeof data === 'string') await fs.writeTextFile(path, data)
      else await fs.writeFile(path, data)
      return true
    }
    const blob = new Blob([data as BlobPart], { type: ext === 'svg' ? 'image/svg+xml' : 'image/png' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = defaultName; a.click()
    URL.revokeObjectURL(url)
    return true
  } catch (e) {
    console.error('[canvas] export failed:', e)
    return false
  }
}
