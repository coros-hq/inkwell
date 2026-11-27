import { useEffect, useRef, useState, useCallback } from 'react'
import { StickyNote, Keyboard, X, Search } from 'lucide-react'
import { imageFilesToShapes } from './canvasImages'
import { parseExcalidraw, excalidrawToShapes } from './excalidrawImport'
import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import type { Drawable } from 'roughjs/bin/core'
import { useAppStore } from '../../store/useAppStore'
import { cn, glassBg } from '../../lib/utils'
import { CanvasToolbar, FONT_HAND } from './CanvasToolbar'
import { CanvasNotesSheet } from './CanvasNotesSheet'
import { DrawingsPanel } from './DrawingsPanel'
import { DrawingsTabs } from './DrawingsTabs'
import { extractMermaid, mermaidToShapes } from './mermaidImport'
import { CanvasExportDialog } from './CanvasExportDialog'
import { useDrawingsStore } from '../../store/useDrawingsStore'
import { loadDrawing, saveDrawing } from '../../lib/drawings'
import { CanvasTemplatesPicker } from './CanvasTemplatesPicker'
import { CanvasCategoryPanel } from './CanvasCategoryPanel'
import { CanvasMinimap, type MinimapView } from './CanvasMinimap'
import { nodeGeometry } from './canvasNodeShapes'
import { isFrame, drawFrame, frameTitleBox, withFrameContents, FRAME_TITLE_SIZE } from './canvasFrames'
import type { DiagramTemplate, TemplateCategory } from './canvasTemplates'
import {
  adaptShape, ctxFont, roughOptions, wrapCanvasText, getMeasureCtx, boundFont, containerTextBox,
  STICKY_TEXT_COLOR, TEXT_PAD, ELLIPSE_TEXT_RATIO, BOUND_LINE_HEIGHT,
} from './canvasShared'
import { uid, hitTopmost, shapeBounds, recolorTemplateShapes, unrotatePoint, alignOffset, TEXT_LINE_HEIGHT } from './canvasTypes'
import {
  arrowEnds, headGeometry, startHeadOf, endHeadOf, resolveBindings, releaseDetached, remapBindings,
  bindingAt, connectionDots, resolveArrow, SIDE_POINTS,
} from './canvasBindings'
import type { Shape, Tool, Point, PathShape, RectShape, EllipseShape, LineShape, ArrowShape, TextShape, BoundText, StickyShape, ImageShape, TextAlign } from './canvasTypes'

// ── Types ──────────────────────────────────────────────────────────────────────

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br'
type NotesTarget = 'global' | { kind: 'shape'; id: string } | { kind: 'group'; groupId: string }

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Grow a no-wrap textarea to fit its content in both directions. */
function autosizeTextarea(el: HTMLTextAreaElement) {
  el.style.width = '0px'; el.style.height = '0px'
  el.style.width  = `${Math.max(80, el.scrollWidth + 4)}px`
  el.style.height = `${el.scrollHeight}px`
}

function getCSSColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw ? `hsl(${raw})` : fallback
}

// ── Theme-adaptive ink ─────────────────────────────────────────────────────────
// Shapes keep whatever colour they were saved with, but a near-neutral colour
// that would vanish against the current canvas (near-white on the light theme,
// near-black on the dark one) is swapped for the theme's ink at draw time only.
// Saved data is never rewritten, so the same drawing reads well in both themes.

function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** Union bounding box of multiple shapes */
function unionBounds(shapes: Shape[]) {
  const bs = shapes.map(shapeBounds)
  const x  = Math.min(...bs.map(b => b.x))
  const y  = Math.min(...bs.map(b => b.y))
  const x2 = Math.max(...bs.map(b => b.x + b.w))
  const y2 = Math.max(...bs.map(b => b.y + b.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

/** Translate all shapes by (dx, dy) in world space */
function offsetShapes(shapes: Shape[], dx: number, dy: number): Shape[] {
  return shapes.map(s => {
    switch (s.type) {
      case 'path':    return { ...s, pts: (s as PathShape).pts.map(p => ({ x: p.x + dx, y: p.y + dy })) }
      case 'rect':    return { ...s, x: (s as RectShape).x + dx, y: (s as RectShape).y + dy }
      case 'ellipse': return { ...s, cx: (s as EllipseShape).cx + dx, cy: (s as EllipseShape).cy + dy }
      case 'line':    return { ...s, x1: (s as LineShape).x1 + dx, y1: (s as LineShape).y1 + dy, x2: (s as LineShape).x2 + dx, y2: (s as LineShape).y2 + dy }
      case 'arrow': { const a = s as ArrowShape; return { ...a, x1: a.x1+dx, y1: a.y1+dy, x2: a.x2+dx, y2: a.y2+dy, ...(a.cpx !== undefined ? { cpx: a.cpx+dx, cpy: a.cpy!+dy } : {}) } }
      case 'text':    return { ...s, x: (s as TextShape).x + dx, y: (s as TextShape).y + dy }
      case 'sticky':  return { ...s, x: (s as StickyShape).x + dx, y: (s as StickyShape).y + dy }
      case 'image':   return { ...s, x: (s as ImageShape).x + dx, y: (s as ImageShape).y + dy }
      default:        return s
    }
  })
}

function getHandleAt(b: { x: number; y: number; w: number; h: number }, wp: Point, threshold: number): ResizeHandle | null {
  const pad = 6
  const handles: [ResizeHandle, number, number][] = [
    ['tl', b.x - pad,       b.y - pad],
    ['tr', b.x + b.w + pad, b.y - pad],
    ['bl', b.x - pad,       b.y + b.h + pad],
    ['br', b.x + b.w + pad, b.y + b.h + pad],
  ]
  for (const [h, hx, hy] of handles)
    if (Math.hypot(wp.x - hx, wp.y - hy) <= threshold) return h
  return null
}

function applyBoundsToShape(s: Shape, nb: { x: number; y: number; w: number; h: number }): Shape {
  const { x, y, w, h } = nb
  switch (s.type) {
    case 'rect':    return { ...(s as RectShape),    x, y, w, h }
    case 'sticky':  return { ...(s as StickyShape),  x, y, w, h }
    case 'image':   return { ...(s as ImageShape),   x, y, w, h }
    case 'ellipse': return { ...(s as EllipseShape), cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }
    case 'path': {
      const b = shapeBounds(s), sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...(s as PathShape), pts: (s as PathShape).pts.map(p => ({ x: x + (p.x - b.x) * sx, y: y + (p.y - b.y) * sy })) }
    }
    case 'line': {
      const l = s as LineShape, b = shapeBounds(s)
      const sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...l, x1: x + (l.x1 - b.x) * sx, y1: y + (l.y1 - b.y) * sy, x2: x + (l.x2 - b.x) * sx, y2: y + (l.y2 - b.y) * sy }
    }
    case 'arrow': {
      const a = s as ArrowShape, b = shapeBounds(s)
      const sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...a, x1: x + (a.x1 - b.x) * sx, y1: y + (a.y1 - b.y) * sy, x2: x + (a.x2 - b.x) * sx, y2: y + (a.y2 - b.y) * sy,
        ...(a.cpx !== undefined ? { cpx: x + (a.cpx - b.x) * sx, cpy: y + (a.cpy! - b.y) * sy } : {}) }
    }
    case 'text': {
      const t = s as TextShape, b = shapeBounds(t), scale = Math.max(w / Math.max(b.w, 1), h / Math.max(b.h, 1))
      return { ...t, x, y: y + h, size: Math.max(8, Math.round(t.size * scale)) }
    }
  }
}

function offsetShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case 'path':    return { ...(s as PathShape),    pts: (s as PathShape).pts.map(p => ({ x: p.x + dx, y: p.y + dy })) }
    case 'rect':    return { ...(s as RectShape),    x:  (s as RectShape).x  + dx, y:  (s as RectShape).y  + dy }
    case 'ellipse': return { ...(s as EllipseShape), cx: (s as EllipseShape).cx + dx, cy: (s as EllipseShape).cy + dy }
    case 'line':    return { ...(s as LineShape),    x1: (s as LineShape).x1  + dx, y1: (s as LineShape).y1  + dy, x2: (s as LineShape).x2  + dx, y2: (s as LineShape).y2  + dy }
    case 'arrow': { const a = s as ArrowShape; return { ...a, x1: a.x1+dx, y1: a.y1+dy, x2: a.x2+dx, y2: a.y2+dy, ...(a.cpx !== undefined ? { cpx: a.cpx+dx, cpy: a.cpy!+dy } : {}) } }
    case 'text':    return { ...(s as TextShape),    x:  (s as TextShape).x   + dx, y:  (s as TextShape).y   + dy }
    case 'sticky':  return { ...(s as StickyShape),  x:  (s as StickyShape).x + dx, y:  (s as StickyShape).y + dy }
    case 'image':   return { ...(s as ImageShape),   x:  (s as ImageShape).x + dx, y:  (s as ImageShape).y + dy }
  }
}

function duplicateShape(s: Shape): Shape {
  return offsetShape({ ...s, id: uid() }, 20, 20)
}

// ── Canvas rendering ───────────────────────────────────────────────────────────

function drawDotGrid(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, pan: Point, zoom: number) {
  if (zoom < 0.2) return
  ctx.save()
  ctx.translate(pan.x, pan.y)
  ctx.scale(zoom, zoom)
  const r      = Math.max(0.5, 0.9 / zoom)
  const step   = 24
  const startX = Math.ceil(-pan.x / zoom / step) * step
  const startY = Math.ceil(-pan.y / zoom / step) * step
  const endX   = (-pan.x + cssW) / zoom + step
  const endY   = (-pan.y + cssH) / zoom + step
  ctx.fillStyle = getCSSColor('--border', 'rgba(255,255,255,0.08)')
  for (let x = startX; x < endX; x += step)
    for (let y = startY; y < endY; y += step) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  ctx.restore()
}

// Decoded pictures per shape id. Decoding is async, so a shape drawn before its
// image is ready is skipped and the view is asked to repaint once it loads.
const imageCache = new Map<string, { src: string; img: HTMLImageElement }>()
let onImageReady: (() => void) | null = null

function drawImageShape(ctx: CanvasRenderingContext2D, s: ImageShape) {
  let entry = imageCache.get(s.id)
  if (!entry || entry.src !== s.src) {
    const img = new Image()
    img.onload = () => onImageReady?.()
    img.src = s.src
    entry = { src: s.src, img }
    imageCache.set(s.id, entry)
  }
  const { img } = entry
  if (!img.complete || !img.naturalWidth) return
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 4); ctx.clip()
  ctx.drawImage(img, s.x, s.y, s.w, s.h)
  ctx.restore()
}

type RoughCache = Map<string, { key: string; drawables: Drawable[] }>

// roughjs's generator methods build a "Drawable" (the randomized sketchy path
// description) but don't draw it; rc.draw() replays it onto the canvas. Generation
// re-runs the seeded-noise math over every point and is the expensive part, so we
// cache the Drawable per shape and only rebuild it when the shape's own data
// (geometry/color/style) actually changes — draws (called every render, including
// mid-drag/pan/zoom) then just replay cached ops instead of regenerating.
function cachedRoughDraw(rc: RoughCanvas, cache: RoughCache, s: Shape, build: () => Drawable[]) {
  const key = JSON.stringify(s)
  const hit = cache.get(s.id)
  const drawables = hit && hit.key === key ? hit.drawables : build()
  if (!hit || hit.key !== key) cache.set(s.id, { key, drawables })
  drawables.forEach(d => rc.draw(d))
}

const DEFAULT_STICKY_COLOR = '#fbbf24'
const STICKY_DEFAULT_W     = 160
const STICKY_DEFAULT_H     = 40

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, rc?: RoughCanvas | null, sketchy?: boolean, roughCache?: RoughCache | null) {
  ctx.save()
  ctx.strokeStyle = s.color; ctx.fillStyle = s.fill === 'none' ? 'transparent' : s.fill
  ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const useRough = sketchy && rc && roughCache
  switch (s.type) {
    case 'path': {
      const { pts } = s as PathShape
      if (pts.length < 2) break
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.stroke(); break
    }
    case 'rect': {
      const r = s as RectShape
      if (isFrame(r)) { drawFrame(ctx, r); break }
      const sharp = !r.kind && !r.icon && !(r.radius > 0)
      if (useRough) {
        // Sharp boxes keep roughjs's native rectangle; anything with a real outline
        // (rounded corners, cylinder, diamond…) is roughened along its exact path.
        cachedRoughDraw(rc, roughCache, s, () => {
          if (sharp) return [rc.generator.rectangle(r.x, r.y, r.w, r.h, roughOptions(s))]
          const g = nodeGeometry(r.kind, r.icon, shapeBounds(r), r.radius ?? 0)
          const o = roughOptions(s), line = { ...o, fill: undefined }
          const glyph = { ...line, roughness: 0.4, disableMultiStroke: true, strokeWidth: Math.min(s.width, 1.75) }
          return [
            rc.generator.path(g.outline, { ...o, preserveVertices: true }),
            ...g.details.map(d => rc.generator.path(d, { ...line, preserveVertices: true })),
            ...g.icon.map(d => rc.generator.path(d, glyph)),
          ]
        })
        break
      }
      if (!r.kind && !r.icon) {
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.radius ?? 3, Math.abs(r.w) / 2, Math.abs(r.h) / 2))
        if (s.fill !== 'none') ctx.fill(); ctx.stroke(); break
      }
      const g = nodeGeometry(r.kind, r.icon, shapeBounds(r), r.radius ?? 0)
      const outline = new Path2D(g.outline)
      if (s.fill !== 'none') ctx.fill(outline)
      ctx.stroke(outline)
      for (const d of g.details) ctx.stroke(new Path2D(d))
      ctx.lineWidth = Math.min(s.width, 1.75)
      for (const d of g.icon) ctx.stroke(new Path2D(d))
      break
    }
    case 'ellipse': {
      const e = s as EllipseShape
      if (useRough) {
        cachedRoughDraw(rc, roughCache, s, () => [rc.generator.ellipse(e.cx, e.cy, Math.max(1, Math.abs(e.rx)) * 2, Math.max(1, Math.abs(e.ry)) * 2, roughOptions(s))])
        break
      }
      ctx.beginPath(); ctx.ellipse(e.cx, e.cy, Math.max(1, Math.abs(e.rx)), Math.max(1, Math.abs(e.ry)), 0, 0, Math.PI * 2)
      if (s.fill !== 'none') ctx.fill(); ctx.stroke(); break
    }
    case 'line': {
      const l = s as LineShape
      if (useRough) {
        cachedRoughDraw(rc, roughCache, s, () => [rc.generator.line(l.x1, l.y1, l.x2, l.y2, roughOptions(s))])
        break
      }
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); break
    }
    case 'arrow': {
      const a = s as ArrowShape
      if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 1) break
      const cpx = a.cpx ?? (a.x1 + a.x2) / 2
      const cpy = a.cpy ?? (a.y1 + a.y2) / 2
      const ends = arrowEnds(a)
      const heads = [
        headGeometry(startHeadOf(a), ends.start.p, ends.start.ang, a.width),
        headGeometry(endHeadOf(a), ends.end.p, ends.end.ang, a.width),
      ]
      // Open heads like Excalidraw: the shaft runs to the tip and the head is drawn in strokes
      if (useRough) {
        cachedRoughDraw(rc, roughCache, s, () => [
          rc.generator.path(`M ${a.x1} ${a.y1} Q ${cpx} ${cpy}, ${a.x2} ${a.y2}`, { ...roughOptions(s), fill: undefined }),
          ...heads.flatMap(h => [
            ...h.lines.map(l => rc.generator.linearPath(l, { ...roughOptions(s), fill: undefined })),
            ...h.circles.map(c => rc.generator.circle(c.x, c.y, c.r * 2, { ...roughOptions(s), fill: undefined })),
          ]),
        ])
      } else {
        ctx.beginPath(); ctx.moveTo(a.x1, a.y1)
        ctx.quadraticCurveTo(cpx, cpy, a.x2, a.y2)
        for (const h of heads) {
          for (const l of h.lines) { ctx.moveTo(l[0][0], l[0][1]); for (const [x, y] of l.slice(1)) ctx.lineTo(x, y) }
          for (const c of h.circles) { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2) }
        }
        ctx.stroke()
      }
      if (a.label?.text) drawArrowLabel(ctx, a, ends.mid)
      break
    }
    case 'text': {
      const t = s as TextShape
      ctx.font = ctxFont(t); ctx.fillStyle = t.color; ctx.textAlign = 'left'
      const lines = t.text.split('\n')
      const widths = lines.map(l => ctx.measureText(l).width), blockW = Math.max(...widths)
      lines.forEach((l, i) => ctx.fillText(l, t.x + alignOffset(t.align, blockW, widths[i]), t.y + i * t.size * TEXT_LINE_HEIGHT))
      break
    }
    case 'image': drawImageShape(ctx, s as ImageShape); break
    case 'sticky': {
      // Always a clean flat card with a soft drop shadow — a sticky note is a UI
      // element, not a hand-drawn shape, so it's exempt from the sketchy toggle.
      const st = s as StickyShape
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 3
      ctx.fillStyle = st.color
      ctx.beginPath(); ctx.roundRect(st.x, st.y, st.w, st.h, 3); ctx.fill()
      ctx.restore()
      // Text is always a fixed dark ink for reliable contrast against the palette's light/mid-tone swatches
      ctx.font = `13px ${FONT_HAND}`; ctx.fillStyle = STICKY_TEXT_COLOR
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      const pad  = 8
      const lines = wrapCanvasText(ctx, st.text, Math.max(st.w - pad * 2, 10))
      const lineH = 13 * 1.3
      let y = st.y + pad
      for (const line of lines) { ctx.fillText(line, st.x + pad, y); y += lineH }
      break
    }
  }
  ctx.restore()
}

// An ellipse's text lives in the rectangle inscribed in it (~1/√2 of each axis), not its full bounding box

/** Shape height needed so `bt.text`, wrapped to width `w`, fits inside the container */
function containerNeededH(s: RectShape | EllipseShape, bt: BoundText, w: number): number {
  if (s.type === 'rect' && (s.kind || s.icon)) return nodeNeededH(s, bt, w)
  const ctx = getMeasureCtx()
  ctx.save(); ctx.font = boundFont(bt)
  const innerW = s.type === 'ellipse' ? w * ELLIPSE_TEXT_RATIO : w - TEXT_PAD * 2
  const lines = wrapCanvasText(ctx, bt.text, Math.max(innerW, 10))
  ctx.restore()
  const textH = lines.length * bt.size * BOUND_LINE_HEIGHT
  return s.type === 'ellipse' ? textH / ELLIPSE_TEXT_RATIO + 4 : textH + TEXT_PAD * 2
}

/** Node outlines carve their text box differently (cylinder caps, diamond insets…): grow until the label fits. */
function nodeNeededH(s: RectShape, bt: BoundText, w: number): number {
  const ctx = getMeasureCtx()
  ctx.save(); ctx.font = boundFont(bt)
  const b = shapeBounds(s)
  let h = b.h
  for (let i = 0; i < 8; i++) {
    const box = nodeGeometry(s.kind, s.icon, { x: b.x, y: b.y, w, h }, s.radius ?? 0).textBox
    const textH = wrapCanvasText(ctx, bt.text, box.w).length * bt.size * BOUND_LINE_HEIGHT
    if (box.h >= textH - 0.5) break
    h += (textH - box.h) * Math.max(1, h / Math.max(box.h, 1))
  }
  ctx.restore()
  return h
}

/** Grow a labeled rect/ellipse just enough that its text never spills out of it */
function fitContainer(s: Shape): Shape {
  if ((s.type !== 'rect' && s.type !== 'ellipse') || !s.boundText) return s
  const b = shapeBounds(s)
  const needed = containerNeededH(s, s.boundText, b.w)
  return needed > b.h ? applyBoundsToShape(s, { ...b, h: needed }) : s
}

/** Text bound to a rect/ellipse container: wrapped inside the container's text box, vertically centered */
function drawBoundText(ctx: CanvasRenderingContext2D, s: RectShape | EllipseShape) {
  const bt = s.boundText
  if (!bt) return
  const box = containerTextBox(s)
  ctx.save()
  ctx.font = boundFont(bt)
  ctx.fillStyle = bt.color
  const align = bt.align ?? 'center'
  ctx.textAlign = align; ctx.textBaseline = 'middle'
  const lines  = wrapCanvasText(ctx, bt.text, box.w)
  const lineH  = bt.size * BOUND_LINE_HEIGHT
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2
  let y = box.y + box.h / 2 - (lines.length * lineH) / 2 + lineH / 2
  for (const line of lines) { ctx.fillText(line, x, y); y += lineH }
  ctx.restore()
}

/** Arrow label on the curve's midpoint, on a patch of background so the line breaks around it. */
function drawArrowLabel(ctx: CanvasRenderingContext2D, a: ArrowShape, mid: Point) {
  const bt = a.label!
  ctx.save()
  ctx.font = boundFont(bt)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const lines = bt.text.split('\n')
  const lineH = bt.size * BOUND_LINE_HEIGHT
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 8, h = lines.length * lineH + 4
  if (!useAppStore.getState().bodyGlass) {
    ctx.fillStyle = getCSSColor('--background', '#111')
    ctx.fillRect(mid.x - w / 2, mid.y - h / 2, w, h)
  }
  ctx.fillStyle = bt.color
  let y = mid.y - (lines.length * lineH) / 2 + lineH / 2
  for (const line of lines) { ctx.fillText(line, mid.x, y); y += lineH }
  ctx.restore()
}

/** Painter handed to the PNG exporter: same drawing code as the live canvas, minus editor chrome. */
function paintForExport(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, shapes: Shape[], sketchy: boolean) {
  const rc = rough.canvas(canvas)
  const cache: RoughCache = new Map()
  for (const s of shapes) {
    ctx.save()
    applyRotation(ctx, s)
    drawShape(ctx, s, rc, sketchy, cache)
    if ((s.type === 'rect' || s.type === 'ellipse') && s.boundText) drawBoundText(ctx, s)
    ctx.restore()
  }
}

/** Resolves once every image shape is decoded, so exports never miss a picture that is still loading. */
async function preloadImages(shapes: Shape[]) {
  await Promise.all(shapes.filter((s): s is ImageShape => s.type === 'image').map(s => new Promise<void>(resolve => {
    let entry = imageCache.get(s.id)
    if (!entry || entry.src !== s.src) {
      const img = new Image()
      img.src = s.src
      entry = { src: s.src, img }
      imageCache.set(s.id, entry)
    }
    if (entry.img.complete) { resolve(); return }
    entry.img.addEventListener('load', () => resolve(), { once: true })
    entry.img.addEventListener('error', () => resolve(), { once: true })
  })))
}

const SHAPE_TYPE_LABELS: Record<Shape['type'], string> = {
  path: 'Path', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', text: 'Text', sticky: 'Sticky note', image: 'Image',
}

/** Friendly label for a shape's notes-panel title: its bound-text label if it has one, else its type */
function shapeLabel(s: Shape): string {
  if ((s.type === 'rect' || s.type === 'ellipse') && s.boundText?.text) return s.boundText.text.slice(0, 20)
  return SHAPE_TYPE_LABELS[s.type]
}

const NOTE_BADGE_RADIUS = 7

/** World-space center of a shape's note badge — offset past the top-right resize
 * handle's hit radius so the two never overlap when the shape is selected. */
function noteBadgePos(s: Shape): Point {
  const b = shapeBounds(s)
  return { x: b.x + b.w + 16, y: b.y - 16 }
}

/** Small document-icon badge shown on any shape that has an attached note */
function drawNoteBadge(ctx: CanvasRenderingContext2D, s: Shape) {
  const { x, y } = noteBadgePos(s)
  ctx.save()
  ctx.fillStyle = '#a78bfa'
  ctx.beginPath(); ctx.arc(x, y, NOTE_BADGE_RADIUS, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
  // Tiny "lines of text" glyph inside the badge
  ctx.beginPath()
  ctx.moveTo(x - 3, y - 2); ctx.lineTo(x + 3, y - 2)
  ctx.moveTo(x - 3, y);     ctx.lineTo(x + 3, y)
  ctx.moveTo(x - 3, y + 2); ctx.lineTo(x + 1, y + 2)
  ctx.stroke()
  ctx.restore()
}

/** Dashed box + corner resize handles around an arbitrary bounds rect */
const ROTATE_HANDLE_OFFSET = 26

/** Rotates the context around the shape's bounds center */
function applyRotation(ctx: CanvasRenderingContext2D, s: Shape) {
  if (!s.rotation) return
  const b = shapeBounds(s)
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.rotate(s.rotation); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2))
}

function rotateHandlePos(b: { x: number; y: number; w: number; h: number }, rotation: number, zoom: number): Point {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const d = b.h / 2 + 6 + ROTATE_HANDLE_OFFSET / zoom
  return { x: cx + d * Math.sin(rotation), y: cy - d * Math.cos(rotation) }
}

function drawHandles(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, hideBox = false) {
  const pad = 6
  ctx.save()
  if (!hideBox) {
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
    ctx.setLineDash([])
  }
  const corners: [number, number][] = [
    [b.x - pad, b.y - pad], [b.x + b.w + pad, b.y - pad],
    [b.x - pad, b.y + b.h + pad], [b.x + b.w + pad, b.y + b.h + pad],
  ]
  corners.forEach(([cx, cy]) => {
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke()
  })
  ctx.restore()
}

/** Single-shape selection: dashed box + corner resize handles (text shapes get no box, just handles-less) */
function drawSingleSelection(ctx: CanvasRenderingContext2D, s: Shape, zoom: number) {
  const b = shapeBounds(s)
  ctx.save()
  applyRotation(ctx, s)
  drawHandles(ctx, b, s.type === 'text')
  ctx.restore()
  // Rotation handle: a knob on a short stem above the box, following the rotation
  const r = s.rotation ?? 0
  const h = rotateHandlePos(b, r, zoom), cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const top = { x: cx + (b.h / 2 + 6) * Math.sin(r), y: cy - (b.h / 2 + 6) * Math.cos(r) }
  ctx.save()
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5 / zoom
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(h.x, h.y); ctx.stroke()
  ctx.fillStyle = '#1e293b'
  ctx.beginPath(); ctx.arc(h.x, h.y, 5 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.restore()
}

/** Multi-shape selection: dashed box + corner resize handles around union bounds */
function drawMultiSelection(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  if (shapes.length < 2) return
  drawHandles(ctx, unionBounds(shapes))
}

/** Rubber-band selection rectangle */
function drawRubberBand(ctx: CanvasRenderingContext2D, p1: Point, p2: Point) {
  const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y)
  const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y)
  ctx.save()
  ctx.fillStyle = 'rgba(96, 165, 250, 0.08)'; ctx.fillRect(rx, ry, rw, rh)
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1; ctx.setLineDash([4, 3])
  ctx.strokeRect(rx, ry, rw, rh)
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Snap a drag delta so the moving bounds' edges/center line up with other shapes'
 * edges/centers, and return the guide segments to draw for the snapped position.
 */
function snapDrag(mb: { x: number; y: number; w: number; h: number }, others: Shape[], dx: number, dy: number, thr: number) {
  const ob = others.map(shapeBounds)
  const pts = (a: number, len: number) => [a, a + len / 2, a + len]
  const best = (mine: number[], theirs: number[][]) => {
    let d = 0, found = Infinity
    for (const t of theirs) for (const m of mine) {
      const diff = t[0] - m
      if (Math.abs(diff) < thr && Math.abs(diff) < found) { found = Math.abs(diff); d = diff }
    }
    return found === Infinity ? 0 : d
  }
  dx += best(pts(mb.x + dx, mb.w), ob.flatMap(b => pts(b.x, b.w).map(v => [v])))
  dy += best(pts(mb.y + dy, mb.h), ob.flatMap(b => pts(b.y, b.h).map(v => [v])))
  const guides: { x1: number; y1: number; x2: number; y2: number }[] = []
  const mx = mb.x + dx, my = mb.y + dy
  for (const b of ob) {
    for (const t of pts(b.x, b.w)) for (const m of pts(mx, mb.w))
      if (Math.abs(t - m) < 0.5) guides.push({ x1: t, y1: Math.min(my, b.y), x2: t, y2: Math.max(my + mb.h, b.y + b.h) })
    for (const t of pts(b.y, b.h)) for (const m of pts(my, mb.h))
      if (Math.abs(t - m) < 0.5) guides.push({ x1: Math.min(mx, b.x), y1: t, x2: Math.max(mx + mb.w, b.x + b.w), y2: t })
  }
  return { dx, dy, guides }
}

// ── CanvasView ─────────────────────────────────────────────────────────────────

// Default ink color must contrast with the canvas background, which follows the
// app theme — near-white ink is invisible on the light theme's white canvas.
const DEFAULT_COLOR_DARK  = '#f3ede2'
const DEFAULT_COLOR_LIGHT = '#1e1b18'
const DEFAULT_WIDTH  = 2
const DEFAULT_RADIUS = 8

const NOTES_DEFAULT_W = 380
const NOTES_MIN_W     = 280

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'], ['P', 'Pen'], ['R', 'Rectangle'], ['E', 'Ellipse'],
      ['L', 'Line'], ['A', 'Arrow'], ['T', 'Text'], ['F', 'Frame (moves its contents as one block)'], ['Esc', 'Back to select'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Space + drag', 'Pan'], ['⌘/Ctrl + scroll', 'Zoom'],
      ['⇧1', 'Zoom to fit all'], ['⇧2', 'Zoom to fit selection'], ['⇧0', 'Reset zoom'],
      ['⇧M', 'Toggle minimap'],
    ],
  },
  {
    title: 'Text',
    items: [
      ['Double-click', 'Edit text (standalone or inside a shape)'],
      ['⇧ + Enter', 'New line in standalone text'],
      ['Enter', 'Finish standalone text'],
      ['⌘/Ctrl + Enter', 'Finish text inside a shape'],
      ['Esc', 'Finish editing'],
    ],
  },
  {
    title: 'Selection',
    items: [
      ['⌘/Ctrl + A', 'Select all'], ['⇧ + click', 'Add/remove from selection'],
      ['Delete / Backspace', 'Delete selected'], ['Arrow keys', 'Nudge (⇧ for 10px)'],
      ['⌘/Ctrl + D', 'Duplicate'], ['⌘/Ctrl + C / X / V', 'Copy / cut / paste (images, Excalidraw and Mermaid code too)'],
      ['⌘/Ctrl + G', 'Group'], ['⌘/Ctrl + ⇧ + G', 'Ungroup'],
      ['⌘/Ctrl + ⇧ + ]', 'Bring to front'], ['⌘/Ctrl + ⇧ + [', 'Send to back'],
    ],
  },
  {
    title: 'History & panels',
    items: [
      ['⌘/Ctrl + Z', 'Undo'], ['⌘/Ctrl + ⇧ + Z', 'Redo'], ['⌘/Ctrl + /', 'Toggle notes'],
    ],
  },
]

// Parts of a shortcut that describe a mouse action rather than a key to press.
const MOUSE_ACTIONS = new Set(['drag', 'scroll', 'click', 'Double-click'])

/** A shortcut as separate keycaps: "⌘/Ctrl + ⇧ + Z" → [⌘/Ctrl] + [⇧] + [Z]. */
function ShortcutKeys({ keys }: { keys: string }) {
  const parts = keys.split(' + ')
  return (
    <span className="shrink-0 flex items-center gap-1">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-muted-foreground">+</span>}
          {MOUSE_ACTIONS.has(part)
            ? <span className="text-[11px] text-foreground/80">{part}</span>
            : (
              <kbd className="min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-md border border-foreground/20 border-b-2 bg-foreground/10 text-foreground font-sans font-medium text-[11px] leading-none whitespace-nowrap">
                {part}
              </kbd>
            )}
        </span>
      ))}
    </span>
  )
}

/** Keyboard shortcuts popover, filtered by a search over labels and keys. */
function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const groups = SHORTCUT_GROUPS
    .map(g => ({
      ...g,
      // A group-title match keeps the whole group; otherwise match each row's label or keys.
      items: !q || g.title.toLowerCase().includes(q)
        ? g.items
        : g.items.filter(([keys, label]) => label.toLowerCase().includes(q) || keys.toLowerCase().includes(q)),
    }))
    .filter(g => g.items.length)

  return (
    <>
      {/* Click-outside backdrop */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute top-14 right-14 z-30 w-80 max-h-[70vh] flex flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <p className="text-sm font-semibold text-foreground">Keyboard shortcuts</p>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3 flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-border bg-muted/50 focus-within:border-accent transition-colors">
            <Search size={13} className="text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Esc clears the search first, then closes the panel.
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) setQuery(''); else onClose() }
              }}
              placeholder="Search shortcuts"
              aria-label="Search shortcuts"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted-foreground"
            />
            {query && (
              <button onClick={() => setQuery('')} title="Clear search" className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Groups — scrollable */}
        <div className="overflow-y-auto px-4 py-3">
          {groups.length === 0 && (
            <p className="text-[12px] text-muted-foreground text-center py-6">No shortcuts match “{query.trim()}”</p>
          )}
          {groups.map(group => (
            <div key={group.title} className="mb-4 last:mb-0">
              <div className="text-[10px] font-semibold text-accent tracking-wider uppercase mb-2">{group.title}</div>
              <div className="flex flex-col gap-2">
                {group.items.map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-3 min-h-[22px]">
                    <span className="text-[12px] text-foreground/90">{label}</span>
                    <ShortcutKeys keys={keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function CanvasView() {
  const { vaultPath, theme, canvasLinkedVaultPath, bodyGlass, glassOpacity } = useAppStore()
  const defaultColor = theme === 'light' ? DEFAULT_COLOR_LIGHT : DEFAULT_COLOR_DARK

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef      = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>(null)
  const rafIdRef      = useRef<number | null>(null)
  // Mirrors of the open text editor + its commit, readable from the mouse handlers.
  // textCommittedRef remembers which editor was already committed so a click-outside
  // followed by the input's blur can't commit the same text twice.
  const textInputRef     = useRef<unknown>(null)
  const commitTextRef    = useRef<() => void>(() => {})
  const textCommittedRef = useRef<unknown>(null)

  // ── React state ──────────────────────────────────────────────────────────────
  const [tool,              setTool]              = useState<Tool>('select')
  const [color,             setColor]             = useState(defaultColor)
  const [fill,              setFill]              = useState('none')
  const [strokeWidth,       setStrokeWidth]       = useState(DEFAULT_WIDTH)
  const [radius,            setRadius]            = useState(DEFAULT_RADIUS)
  const [fontSize,          setFontSize]          = useState(16)
  const [fontFamily,        setFontFamily]        = useState(FONT_HAND)
  const [bold,              setBold]              = useState(false)
  const [italic,            setItalic]            = useState(false)
  const [textAlign,         setTextAlign]         = useState<TextAlign>('left')
  const [zoom,              setZoomState]         = useState(1)
  const [canUndo,           setCanUndo]           = useState(false)
  const [canRedo,           setCanRedo]           = useState(false)
  // Multi-selection: a Set of shape ids
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [selectedShapeType, setSelectedShapeType] = useState<string | null>(null)
  const [selectionHasBoundText, setSelectionHasBoundText] = useState(false)
  /** Frame whose title is being renamed, with the editor's screen position. */
  const [frameEdit,         setFrameEdit]         = useState<{ id: string; sx: number; sy: number; w: number; fontPx: number; value: string } | null>(null)
  const [textInput,         setTextInput]         = useState<{ sx: number; sy: number; wx: number; wy: number; editingId?: string; containerId?: string; stickyId?: string; isNewSticky?: boolean; boxW?: number; boxH?: number; initialValue?: string } | null>(null)
  const [spacePan,          setSpacePan]          = useState(false)
  const [cursor,            setCursorState]       = useState<string>('crosshair')
  const [showNotes,         setShowNotes]         = useState(false)
  const [notesContent,      setNotesContent]      = useState('')
  const [notesTarget,       setNotesTarget]       = useState<NotesTarget>('global')
  const [shapeNoteDraft,    setShapeNoteDraft]    = useState('')
  const [showTemplates,     setShowTemplates]     = useState(false)
  const [categoryPanel,     setCategoryPanel]     = useState<TemplateCategory | null>(null)
  const [sketchy,           setSketchy]           = useState(true)
  const [showGrid,          setShowGrid]          = useState(false)
  const [showShortcuts,     setShowShortcuts]     = useState(false)
  const [showExport,        setShowExport]        = useState(false)
  const [showDrawings,      setShowDrawings]      = useState(() => {
    try { return localStorage.getItem('inkwell-drawings-panel') !== 'false' } catch { return true }
  })
  // Where the drawings list lives: a left column, or a tab strip along the top of the canvas.
  const [drawingsLayout,    setDrawingsLayout]    = useState<'sidebar' | 'tabs'>(() => {
    try { return localStorage.getItem('inkwell-drawings-layout') === 'sidebar' ? 'sidebar' : 'tabs' } catch { return 'tabs' }
  })
  const [importError,       setImportError]       = useState<string | null>(null)
  const [showMinimap,       setShowMinimap]       = useState(() => {
    try { return localStorage.getItem('inkwell-canvas-minimap') !== 'false' } catch { return true }
  })
  const minimapDrawRef = useRef<(() => void) | null>(null)
  const [notesWidth,        setNotesWidth]        = useState(() => {
    let saved = 0
    try { saved = Number(localStorage.getItem('inkwell-canvas-notes-width')) } catch { /* ignore */ }
    return saved >= NOTES_MIN_W ? saved : NOTES_DEFAULT_W
  })
  const [notesResizing,     setNotesResizing]     = useState(false)
  // Below this canvas width the centered toolbar would reach under the minimap.
  const [canvasNarrow,      setCanvasNarrow]      = useState(false)

  // ── Canvas content refs ──────────────────────────────────────────────────────
  const shapesRef       = useRef<Shape[]>([])
  const sketchyRef       = useRef(true)
  const showGridRef      = useRef(false)
  const roughCanvasRef   = useRef<RoughCanvas | null>(null)
  const roughCacheRef    = useRef<RoughCache>(new Map())
  const historyRef     = useRef<Shape[][]>([])
  const futureRef      = useRef<Shape[][]>([])
  const selectedIdsRef = useRef<Set<string>>(new Set())   // mirrors selectedIds state
  const drawingRef     = useRef<Shape | null>(null)

  // ── View refs ────────────────────────────────────────────────────────────────
  const panRef  = useRef<Point>({ x: 0, y: 0 })
  const zoomRef = useRef(1)

  // ── Tool pref refs ───────────────────────────────────────────────────────────
  const toolRef        = useRef<Tool>('select')
  const colorRef       = useRef(defaultColor)
  const fillRef        = useRef('none')
  const widthRef       = useRef(DEFAULT_WIDTH)
  const radiusRef      = useRef(DEFAULT_RADIUS)
  const fontSizeRef    = useRef(16)
  const fontFamilyRef  = useRef(FONT_HAND)
  const boldRef        = useRef(false)
  const textAlignRef   = useRef<TextAlign>('left')
  const italicRef      = useRef(false)

  // ── Interaction refs ─────────────────────────────────────────────────────────
  const isDrawingRef    = useRef(false)
  const startPtRef      = useRef<Point>({ x: 0, y: 0 })
  const isPanningRef    = useRef(false)
  const panStartRef     = useRef<Point>({ x: 0, y: 0 })
  const panOriginRef    = useRef<Point>({ x: 0, y: 0 })
  const isSpaceRef      = useRef(false)
  const shiftRef        = useRef(false)
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shapeNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag (move selected)
  const isDraggingRef   = useRef(false)
  const dragOriginRef   = useRef<Point>({ x: 0, y: 0 })
  const preDragRef      = useRef<Shape[] | null>(null)
  const dragMovedRef    = useRef(false)
  // Alignment guides shown while dragging (world-space segments)
  const guidesRef       = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([])
  // Shapes as they were before a text edit began, so live auto-grow doesn't pollute undo history
  const editPreRef      = useRef<Shape[] | null>(null)

  // Rubber-band selection
  const isRubberBandRef    = useRef(false)
  const rubberBandStartRef = useRef<Point>({ x: 0, y: 0 })
  const rubberBandEndRef   = useRef<Point>({ x: 0, y: 0 })

  // Editing text shape id (hidden from canvas while input is open)
  const editingIdRef         = useRef<string | null>(null)
  // Editing container (bound-text) shape id — shape still renders, only its bound text is hidden
  const editingContainerIdRef = useRef<string | null>(null)

  // Mirrors of notes state, read inside the selection-sync effect without adding them as deps
  const notesTargetRef = useRef<NotesTarget>('global')
  const showNotesRef   = useRef(false)

  // Resize (single or multi selection)
  const resizingRef          = useRef<ResizeHandle | null>(null)
  const resizeStartBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const resizeStartPtRef     = useRef<Point>({ x: 0, y: 0 })
  const resizePreRef         = useRef<Shape[] | null>(null)
  const cursorRef            = useRef<string>('crosshair')

  // Rotation (single selection)
  const rotatingRef   = useRef<string | null>(null)
  const rotatePreRef  = useRef<Shape[] | null>(null)

  // Arrow bend (control point drag)
  const isBendingRef  = useRef(false)
  const bendPreRef    = useRef<Shape[] | null>(null)

  // Clipboard (in-app only) + last known mouse world position (for paste placement)
  const clipboardRef      = useRef<Shape[] | null>(null)
  const lastMouseWorldRef = useRef<Point>({ x: 0, y: 0 })

  // Arrow binding: the shape showing connection dots under the pointer, the shape an arrow
  // end would attach to right now (highlighted), and a dragged endpoint of a selected arrow.
  const bindHoverRef     = useRef<string | null>(null)
  const bindPreviewRef   = useRef<string | null>(null)
  const endpointDragRef  = useRef<{ id: string; which: 'start' | 'end'; pre: Shape[] } | null>(null)

  // Keyboard nudge (arrow keys) — coalesced into one undo step per burst
  const nudgePreRef = useRef<Shape[] | null>(null)

  // Sync tool pref refs
  useEffect(() => { toolRef.current       = tool       }, [tool])
  useEffect(() => { colorRef.current      = color      }, [color])
  useEffect(() => { fillRef.current       = fill       }, [fill])
  useEffect(() => { widthRef.current      = strokeWidth }, [strokeWidth])
  useEffect(() => { radiusRef.current     = radius     }, [radius])
  useEffect(() => { fontSizeRef.current   = fontSize   }, [fontSize])
  useEffect(() => { fontFamilyRef.current = fontFamily }, [fontFamily])
  useEffect(() => { boldRef.current       = bold       }, [bold])
  useEffect(() => { italicRef.current     = italic     }, [italic])

  // Re-pick a legible default ink color when the app theme flips, but only if
  // the user hasn't picked their own color — otherwise a manual pick would get
  // silently overwritten every time the theme toggles.
  const prevDefaultColorRef = useRef(defaultColor)
  useEffect(() => {
    if (color === prevDefaultColorRef.current && color !== defaultColor) {
      setColor(defaultColor)
    }
    // prevDefaultColorRef itself is advanced below, once shapes have also been migrated
  }, [defaultColor]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateCursor = useCallback((c: string) => {
    if (c !== cursorRef.current) { cursorRef.current = c; setCursorState(c) }
  }, [])

  // ── Selection helpers ────────────────────────────────────────────────────────

  const setSelection = useCallback((ids: Set<string>) => {
    selectedIdsRef.current = ids
    setSelectedIds(new Set(ids))
  }, [])

  const clearSelection = useCallback(() => {
    selectedIdsRef.current = new Set()
    setSelectedIds(new Set())
    setSelectedShapeType(null)
  }, [])

  // Placing a sticky is independent of whatever happens to be selected — clear
  // the selection on entering the tool so the toolbar's selection-context row
  // (note/corner/font controls for the old selection) doesn't linger and so a
  // sticky click can never be mistaken for acting on the previously-selected shape.
  useEffect(() => {
    if (tool === 'sticky') clearSelection()
  }, [tool, clearSelection])

  // When selection changes, sync toolbar to the single selected shape (if any)
  useEffect(() => {
    if (selectedIds.size !== 1) { setSelectedShapeType(null); setSelectionHasBoundText(false); return }
    const id    = [...selectedIds][0]
    const shape = shapesRef.current.find(s => s.id === id)
    if (!shape) { setSelectedShapeType(null); setSelectionHasBoundText(false); return }
    setSelectedShapeType(shape.type)
    setColor(shape.color);       colorRef.current = shape.color
    setFill(shape.fill);         fillRef.current  = shape.fill
    setStrokeWidth(shape.width); widthRef.current = shape.width
    if (shape.type === 'rect') {
      const r = (shape as RectShape).radius ?? DEFAULT_RADIUS; setRadius(r); radiusRef.current = r
    }
    if (shape.type === 'text') {
      const t = shape as TextShape
      const sz = t.size ?? 16;             setFontSize(sz);   fontSizeRef.current   = sz
      const ff = t.fontFamily ?? FONT_HAND; setFontFamily(ff); fontFamilyRef.current = ff
      const b  = t.bold ?? false;           setBold(b);        boldRef.current       = b
      const it = t.italic ?? false;         setItalic(it);     italicRef.current     = it
      const al = t.align ?? 'left';         setTextAlign(al);  textAlignRef.current  = al
    }
    if ((shape.type === 'rect' || shape.type === 'ellipse') && shape.boundText) {
      const bt = shape.boundText
      setSelectionHasBoundText(true)
      setFontSize(bt.size);       fontSizeRef.current   = bt.size
      setFontFamily(bt.fontFamily); fontFamilyRef.current = bt.fontFamily
      setBold(bt.bold);           boldRef.current       = bt.bold
      setItalic(bt.italic);       italicRef.current     = bt.italic
      const al = bt.align ?? 'center'; setTextAlign(al); textAlignRef.current = al
    } else {
      setSelectionHasBoundText(false)
    }
  }, [selectedIds])

  // If the notes panel is open and scoped to a shape/group, follow the selection:
  // switch to the newly-selected shape/group's note, or close if selection is
  // now empty or ambiguous (spans shapes outside one group). Global notes
  // (notesTarget === 'global') are untouched by selection changes.
  useEffect(() => {
    if (!showNotesRef.current || notesTargetRef.current === 'global') return
    const ids = [...selectedIds]
    const shapes = shapesRef.current.filter(s => ids.includes(s.id))
    if (shapes.length === 1) {
      const shape = shapes[0]
      setNotesTarget(shape.groupId ? { kind: 'group', groupId: shape.groupId } : { kind: 'shape', id: shape.id })
    } else if (shapes.length > 1) {
      const groupIds = new Set(shapes.map(s => s.groupId).filter(Boolean))
      if (groupIds.size === 1 && shapes.every(s => s.groupId)) {
        setNotesTarget({ kind: 'group', groupId: [...groupIds][0] as string })
      } else {
        setShowNotes(false); setNotesTarget('global')
      }
    } else {
      setShowNotes(false); setNotesTarget('global')
    }
  }, [selectedIds])

  // ── Render ───────────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx  = canvas.getContext('2d')!
    const DPR  = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    // With the window blur on, leave the canvas transparent so the translucent
    // glass card behind it (and the native blur under that) shows through.
    if (useAppStore.getState().bodyGlass) {
      ctx.clearRect(0, 0, cssW, cssH)
    } else {
      ctx.fillStyle = getCSSColor('--background', '#111')
      ctx.fillRect(0, 0, cssW, cssH)
    }
    if (showGridRef.current) drawDotGrid(ctx, cssW, cssH, panRef.current, zoomRef.current)

    if (!roughCanvasRef.current) roughCanvasRef.current = rough.canvas(canvas)
    const rc = roughCanvasRef.current

    ctx.save()
    ctx.translate(panRef.current.x, panRef.current.y)
    ctx.scale(zoomRef.current, zoomRef.current)

    // Bound arrows follow their shapes, whatever moved them (drag, resize, undo, load…).
    shapesRef.current = resolveBindings(shapesRef.current)

    const darkBg = useAppStore.getState().theme === 'dark'
    const ink = darkBg ? DEFAULT_COLOR_DARK : DEFAULT_COLOR_LIGHT
    for (const raw of shapesRef.current) {
      if (editingIdRef.current && raw.id === editingIdRef.current) continue
      // The label being edited is drawn by the editor overlay instead.
      const shown = raw.type === 'arrow' && raw.label && editingContainerIdRef.current === raw.id ? { ...raw, label: undefined } : raw
      const s = adaptShape(shown, darkBg, ink)
      ctx.save()
      applyRotation(ctx, s)
      drawShape(ctx, s, rc, sketchyRef.current, roughCacheRef.current)
      if ((s.type === 'rect' || s.type === 'ellipse') && s.boundText && editingContainerIdRef.current !== s.id) {
        drawBoundText(ctx, s)
      }
      ctx.restore()
      if (s.note) drawNoteBadge(ctx, s)
    }
    if (drawingRef.current) drawShape(ctx, adaptShape(drawingRef.current, darkBg, ink), rc, sketchyRef.current, roughCacheRef.current)

    // Drop cached rough drawables for shapes that no longer exist
    if (roughCacheRef.current.size) {
      const liveIds = new Set(shapesRef.current.map(sh => sh.id))
      for (const id of roughCacheRef.current.keys()) {
        if (!liveIds.has(id)) roughCacheRef.current.delete(id)
      }
    }

    // Draw dashed group bounding boxes for any visible groups
    const allGroupIds = new Set(shapesRef.current.map(s => s.groupId).filter(Boolean) as string[])
    allGroupIds.forEach(gid => {
      const members = shapesRef.current.filter(s => s.groupId === gid)
      if (members.length < 2) return
      const bs   = members.map(shapeBounds)
      const gx   = Math.min(...bs.map(b => b.x))
      const gy   = Math.min(...bs.map(b => b.y))
      const gx2  = Math.max(...bs.map(b => b.x + b.w))
      const gy2  = Math.max(...bs.map(b => b.y + b.h))
      const pad  = 10
      const groupSelected = members.some(s => selectedIdsRef.current.has(s.id))
      ctx.save()
      ctx.strokeStyle = groupSelected
        ? getCSSColor('--accent', '#a78bfa')
        : getCSSColor('--border', '#444')
      ctx.lineWidth   = (groupSelected ? 1.5 : 1) / zoomRef.current
      ctx.setLineDash([6 / zoomRef.current, 4 / zoomRef.current])
      ctx.globalAlpha = groupSelected ? 0.8 : 0.35
      ctx.strokeRect(gx - pad, gy - pad, gx2 - gx + pad * 2, gy2 - gy + pad * 2)
      ctx.restore()
    })

    // Arrow binding: highlight the shape an arrow end is about to attach to, and show
    // connection dots on the hovered shape (hidden while something is being dragged).
    {
      const z = zoomRef.current
      const accent = getCSSColor('--accent', '#a78bfa')
      const preview = bindPreviewRef.current ? shapesRef.current.find(s => s.id === bindPreviewRef.current) : undefined
      if (preview) {
        const b = shapeBounds(preview), pad = 5 / z
        ctx.save()
        applyRotation(ctx, preview)
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 3 / z
        if (preview.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(preview.cx, preview.cy, Math.abs(preview.rx) + pad, Math.abs(preview.ry) + pad, 0, 0, Math.PI * 2); ctx.stroke() }
        else { ctx.beginPath(); ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 6 / z); ctx.stroke() }
        ctx.restore()
      }
      const busy = isDraggingRef.current || resizingRef.current || rotatingRef.current || isRubberBandRef.current || isBendingRef.current
      // Not on a selected shape: its own handles (rotate, resize) sit in the same spots.
      const dotsOn = preview ?? (!busy && bindHoverRef.current && !selectedIdsRef.current.has(bindHoverRef.current)
        ? shapesRef.current.find(s => s.id === bindHoverRef.current) : undefined)
      if (dotsOn) {
        const mouse = lastMouseWorldRef.current
        ctx.save()
        ctx.lineWidth = 1.5 / z; ctx.strokeStyle = accent
        for (const d of connectionDots(dotsOn, z)) {
          const near = Math.hypot(d.x - mouse.x, d.y - mouse.y) < 10 / z
          ctx.fillStyle = near ? accent : getCSSColor('--background', '#111')
          ctx.beginPath(); ctx.arc(d.x, d.y, (near ? 5.5 : 4) / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        }
        ctx.restore()
      }
    }

    // Selection overlay
    const selShapes = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
    if (selShapes.length === 1) {
      drawSingleSelection(ctx, selShapes[0], zoomRef.current)
      // Endpoint handles: drag one onto a shape to attach it, or off to detach
      if (selShapes[0].type === 'arrow') {
        const a = selShapes[0] as ArrowShape, z = zoomRef.current
        ctx.save()
        ctx.lineWidth = 1.5 / z
        for (const [x, y, bound] of [[a.x1, a.y1, !!a.start], [a.x2, a.y2, !!a.end]] as const) {
          ctx.strokeStyle = getCSSColor('--accent', '#a78bfa')
          ctx.fillStyle = bound ? getCSSColor('--accent', '#a78bfa') : '#ffffff'
          ctx.beginPath(); ctx.arc(x, y, 5 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        }
        ctx.restore()
      }
      // Bend handle for selected arrows
      if (selShapes[0].type === 'arrow') {
        const a = selShapes[0] as ArrowShape
        const cpx = a.cpx ?? (a.x1 + a.x2) / 2
        const cpy = a.cpy ?? (a.y1 + a.y2) / 2
        const r = 6 / zoomRef.current
        ctx.save()
        // Guide line from arrow midpoint to control point (only if bent)
        if (a.cpx !== undefined) {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1 / zoomRef.current
          ctx.setLineDash([3 / zoomRef.current, 3 / zoomRef.current]); ctx.globalAlpha = 0.5
          ctx.beginPath(); ctx.moveTo((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2); ctx.lineTo(cpx, cpy); ctx.stroke()
          ctx.setLineDash([]); ctx.globalAlpha = 1
        }
        // Handle circle
        ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5 / zoomRef.current
        ctx.beginPath(); ctx.arc(cpx, cpy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.restore()
      }
    } else if (selShapes.length > 1) {
      drawMultiSelection(ctx, selShapes)
    }

    // Rubber-band
    if (isRubberBandRef.current) {
      drawRubberBand(ctx, rubberBandStartRef.current, rubberBandEndRef.current)
    }

    // Snap / alignment guides
    if (guidesRef.current.length) {
      ctx.save()
      ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 1 / zoomRef.current
      ctx.beginPath()
      for (const g of guidesRef.current) { ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2) }
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()
    minimapDrawRef.current?.()
  }, [])

  useEffect(() => { render() }, [theme, bodyGlass, render])
  useEffect(() => { document.fonts?.load(`16px ${FONT_HAND}`).then(() => render()).catch(() => {}) }, [render])
  useEffect(() => { sketchyRef.current = sketchy; render() }, [sketchy, render])
  useEffect(() => { showGridRef.current = showGrid; render() }, [showGrid, render])
  useEffect(() => { notesTargetRef.current = notesTarget }, [notesTarget])
  useEffect(() => { showNotesRef.current = showNotes }, [showNotes])

  // Seed the shape/group note draft whenever the notes panel's target changes
  useEffect(() => {
    if (notesTarget === 'global') return
    if (notesTarget.kind === 'shape') {
      const shape = shapesRef.current.find(s => s.id === notesTarget.id)
      setShapeNoteDraft(shape?.note ?? '')
    } else {
      const shape = shapesRef.current.find(s => s.groupId === notesTarget.groupId && s.note)
      setShapeNoteDraft(shape?.note ?? '')
    }
  }, [notesTarget])

  // ── Canvas sizing ────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current
    if (!container || !canvas) return
    const DPR = window.devicePixelRatio || 1
    const obs = new ResizeObserver(() => {
      const { width: w, height: h } = container.getBoundingClientRect()
      canvas.width = w * DPR; canvas.height = h * DPR
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      setCanvasNarrow(w < 1080)
      render()
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [render])

  // ── Load / save ──────────────────────────────────────────────────────────────
  // The canvas holds many drawings (see useDrawingsStore). Shapes live in
  // shapesRef; the open drawing is written to its own file, debounced, and
  // flushed whenever another drawing is opened or the view unmounts.

  const drawingsLoaded = useDrawingsStore(s => s.loaded)
  const activeDrawingId = useDrawingsStore(s => s.activeId)
  const activeDrawing = useDrawingsStore(s => s.drawings.find(d => d.id === s.activeId))
  const activeIdRef  = useRef<string | null>(null)
  const loadedIdRef  = useRef<string | null>(null)   // drawing whose data is currently in shapesRef
  const dirtyRef     = useRef(false)
  const notesRef     = useRef('')
  const [fitTick, setFitTick] = useState(0)
  const exportAfterLoadRef = useRef<string | null>(null)   // drawing the user asked to export from the list

  useEffect(() => { void useDrawingsStore.getState().init(canvasLinkedVaultPath) }, [canvasLinkedVaultPath])

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const id = loadedIdRef.current
    if (!id || !dirtyRef.current) return
    dirtyRef.current = false
    await saveDrawing(canvasLinkedVaultPath, id, { shapes: shapesRef.current, notes: notesRef.current })
    useDrawingsStore.getState().touch(id)
  }, [canvasLinkedVaultPath])

  useEffect(() => {
    useDrawingsStore.getState().registerFlush(flushSave)
    return () => useDrawingsStore.getState().registerFlush(null)
  }, [flushSave])

  useEffect(() => {
    if (!drawingsLoaded || !activeDrawingId) return
    let cancelled = false
    activeIdRef.current = activeDrawingId
    loadDrawing(canvasLinkedVaultPath, activeDrawingId).then(file => {
      if (cancelled) return
      shapesRef.current = file.shapes as Shape[]
      notesRef.current = file.notes
      setNotesContent(file.notes)
      loadedIdRef.current = activeDrawingId
      dirtyRef.current = false
      historyRef.current = []; futureRef.current = []
      roughCacheRef.current.clear()
      clearSelection(); setCanUndo(false); setCanRedo(false)
      setNotesTarget('global')
      panRef.current = { x: 0, y: 0 }; zoomRef.current = 1; setZoomState(1)
      render()
      setFitTick(t => t + 1)
      if (exportAfterLoadRef.current === activeDrawingId) { exportAfterLoadRef.current = null; setShowExport(true) }
    })
    return () => {
      cancelled = true
      // Leaving this drawing (or unmounting): write it out before its data is replaced.
      void flushSave()
      loadedIdRef.current = null
    }
  }, [drawingsLoaded, activeDrawingId, canvasLinkedVaultPath, render, clearSelection, flushSave])

  const scheduleSave = useCallback(() => {
    if (!loadedIdRef.current) return
    dirtyRef.current = true
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void flushSave() }, 1000)
  }, [flushSave])

  // ── Notes ────────────────────────────────────────────────────────────────────
  // Diagram notes are stored inside the drawing file, next to its shapes.

  const handleNotesChange = useCallback((text: string) => {
    setNotesContent(text)
    notesRef.current = text
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(scheduleSave, 600)
  }, [scheduleSave])

  // Shape/group-scoped note edits: same debounce-and-write shape as global notes above,
  // but write into the shape(s) themselves (persisted via the regular canvas.json save
  // path) rather than a separate file. Not pushed onto the undo stack — matches how
  // global notes edits aren't undo-tracked either.
  const handleShapeNoteChange = useCallback((text: string) => {
    setShapeNoteDraft(text)
    if (shapeNoteTimerRef.current) clearTimeout(shapeNoteTimerRef.current)
    shapeNoteTimerRef.current = setTimeout(() => {
      const target = notesTargetRef.current
      if (target === 'global') return
      shapesRef.current = shapesRef.current.map(s => {
        if (target.kind === 'shape') return s.id === target.id ? { ...s, note: text } : s
        return s.groupId === target.groupId ? { ...s, note: text, noteShared: true } : s
      })
      scheduleSave(); render()
    }, 600)
  }, [scheduleSave, render])

  // ── History ──────────────────────────────────────────────────────────────────

  const commit = useCallback((next: Shape[]) => {
    historyRef.current = [...historyRef.current, shapesRef.current]
    futureRef.current = []; shapesRef.current = next
    setCanUndo(true); setCanRedo(false); scheduleSave(); render()
  }, [scheduleSave, render])

  // When the theme flips, migrate any existing shapes still using the *previous*
  // theme's default ink color — so drawings made without an explicit color pick
  // stay visible instead of turning invisible against the new background color.
  // Shapes with an explicitly-picked color are left untouched. Not pushed onto
  // the undo stack — this is a display fixup, not a user edit.
  useEffect(() => {
    const prevDefault = prevDefaultColorRef.current
    prevDefaultColorRef.current = defaultColor
    if (prevDefault === defaultColor) return
    let changed = false
    const updated = shapesRef.current.map(s => {
      if (s.color === prevDefault) { changed = true; return { ...s, color: defaultColor } }
      return s
    })
    if (!changed) return
    shapesRef.current = updated
    render()
    scheduleSave()
  }, [defaultColor, render, scheduleSave])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    futureRef.current  = [shapesRef.current, ...futureRef.current]
    shapesRef.current  = historyRef.current[historyRef.current.length - 1]
    historyRef.current = historyRef.current.slice(0, -1)
    clearSelection(); setCanUndo(historyRef.current.length > 0); setCanRedo(true)
    scheduleSave(); render()
  }, [scheduleSave, render, clearSelection])

  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    historyRef.current = [...historyRef.current, shapesRef.current]
    shapesRef.current  = futureRef.current[0]
    futureRef.current  = futureRef.current.slice(1)
    clearSelection(); setCanUndo(true); setCanRedo(futureRef.current.length > 0)
    scheduleSave(); render()
  }, [scheduleSave, render, clearSelection])

  // ── Template loading ─────────────────────────────────────────────────────────

  const loadTemplate = useCallback((tpl: DiagramTemplate) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const DPR  = window.devicePixelRatio || 1
    const cssW = canvas.width  / DPR
    const cssH = canvas.height / DPR

    const rawShapes = recolorTemplateShapes(tpl.create(), defaultColor)
    const bs   = rawShapes.map(shapeBounds)
    const minX = Math.min(...bs.map(b => b.x))
    const minY = Math.min(...bs.map(b => b.y))
    const bw   = Math.max(...bs.map(b => b.x + b.w)) - minX || 1
    const bh   = Math.max(...bs.map(b => b.y + b.h)) - minY || 1

    // Offset new shapes so they don't land on top of existing content
    let dx = 0, dy = 0
    if (shapesRef.current.length > 0) {
      const existBounds = shapesRef.current.map(shapeBounds)
      const existMaxX = Math.max(...existBounds.map(b => b.x + b.w))
      dx = existMaxX + 100 - minX
      dy = -minY  // align template top to world y=0
    }

    const shapes = dx !== 0 || dy !== 0 ? offsetShapes(rawShapes, dx, dy) : rawShapes
    commit([...shapesRef.current, ...shapes])
    clearSelection()

    // Fit the newly inserted shapes into view
    const pad  = 80
    const fitX = minX + dx
    const fitY = minY + dy
    const newZoom = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh, 2)
    zoomRef.current = newZoom
    setZoomState(newZoom)
    panRef.current = {
      x: cssW / 2 - (fitX + bw / 2) * newZoom,
      y: cssH / 2 - (fitY + bh / 2) * newZoom,
    }
    render()
    // Open the category panel for the loaded template's category
    setCategoryPanel(tpl.category)
  }, [commit, clearSelection, render, defaultColor])

  // Append shapes from the category panel (no viewport pan, just append + offset)
  const addCanvasShapes = useCallback((rawNewShapes: Shape[]) => {
    if (!rawNewShapes.length) return
    const newShapes = recolorTemplateShapes(rawNewShapes, defaultColor)
    const bs   = newShapes.map(shapeBounds)
    const minX = Math.min(...bs.map(b => b.x))
    let offsetted = newShapes
    if (shapesRef.current.length > 0) {
      const existBounds = shapesRef.current.map(shapeBounds)
      const existMaxX   = Math.max(...existBounds.map(b => b.x + b.w))
      const dx          = existMaxX + 80 - minX
      offsetted = offsetShapes(newShapes, dx, 0)
    }
    commit([...shapesRef.current, ...offsetted])
    clearSelection()
    render()
  }, [commit, clearSelection, render, defaultColor])

  // ── Group / Ungroup ──────────────────────────────────────────────────────────

  const groupSelected = useCallback(() => {
    if (selectedIdsRef.current.size < 2) return
    const gid  = uid()
    commit(shapesRef.current.map(s =>
      selectedIdsRef.current.has(s.id) ? { ...s, groupId: gid } : s
    ))
  }, [commit])

  const ungroupSelected = useCallback(() => {
    if (!selectedIdsRef.current.size) return
    // Collect all groupIds referenced by the current selection
    const groupIds = new Set(
      shapesRef.current
        .filter(s => selectedIdsRef.current.has(s.id) && s.groupId)
        .map(s => s.groupId!)
    )
    if (!groupIds.size) return
    commit(shapesRef.current.map(s => {
      if (s.groupId && groupIds.has(s.groupId)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { groupId: _g, ...rest } = s
        return rest as Shape
      }
      return s
    }))
  }, [commit])

  // ── Notes: shape/group targeting ─────────────────────────────────────────────

  const openShapeNote = useCallback((id: string) => {
    const shape = shapesRef.current.find(s => s.id === id)
    if (!shape) return
    setNotesTarget(shape.groupId ? { kind: 'group', groupId: shape.groupId } : { kind: 'shape', id })
    setShowNotes(true)
  }, [])

  const openGroupNote = useCallback((groupId: string) => {
    setNotesTarget({ kind: 'group', groupId })
    setShowNotes(true)
  }, [])

  // Toolbar "Add note" action: works for a single shape, an already-uniform
  // group selection, or an ungrouped multi-selection (which it groups first,
  // so the shared note has somewhere to live — same reasoning as ⌘G elsewhere).
  const addNoteToSelection = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    if (!ids.length) return
    const shapes = shapesRef.current.filter(s => ids.includes(s.id))
    if (shapes.length === 1) { openShapeNote(shapes[0].id); return }
    const groupIds = new Set(shapes.map(s => s.groupId).filter(Boolean))
    if (groupIds.size === 1 && shapes.every(s => s.groupId)) {
      openGroupNote([...groupIds][0] as string)
      return
    }
    const gid = uid()
    commit(shapesRef.current.map(s => ids.includes(s.id) ? { ...s, groupId: gid } : s))
    openGroupNote(gid)
  }, [commit, openShapeNote, openGroupNote])

  // Promote a sticky's freeform text into a full note (one-directional, explicit —
  // triggered only by the toolbar button, never automatically). The on-canvas
  // sticky text is left as-is; from this point the two are independent.
  const promoteStickyToNote = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    if (ids.length !== 1) return
    const shape = shapesRef.current.find(s => s.id === ids[0])
    if (!shape || shape.type !== 'sticky' || shape.note) return
    const sticky = shape as StickyShape
    commit(shapesRef.current.map(s => s.id === sticky.id ? { ...s, note: sticky.text } : s))
    openShapeNote(sticky.id)
  }, [commit, openShapeNote])

  // ── Coord ────────────────────────────────────────────────────────────────────

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top  - panRef.current.y) / zoomRef.current,
    }
  }, [])

  // ── Mouse ────────────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && isSpaceRef.current)) {
      isPanningRef.current = true
      panStartRef.current  = { x: e.clientX, y: e.clientY }
      panOriginRef.current = { ...panRef.current }
      return
    }
    if (e.button !== 0) return
    // A click while a text editor is open only closes (commits) it. Letting it through
    // would start a *new* text box in the same click, and the commit that follows would
    // then save the old text at the new spot, duplicating it.
    if (textInputRef.current) { commitTextRef.current(); return }
    const wp = toWorld(e)

    if (toolRef.current === 'select') {
      // 0. Note badge — clickable regardless of current selection
      const badgeHit = shapesRef.current.find(s => s.note && Math.hypot(wp.x - noteBadgePos(s).x, wp.y - noteBadgePos(s).y) < NOTE_BADGE_RADIUS + 4 / zoomRef.current)
      if (badgeHit) { openShapeNote(badgeHit.id); return }

      // 0b. Rotation handle (single selection)
      if (selectedIdsRef.current.size === 1) {
        const rs = shapesRef.current.find(sh => selectedIdsRef.current.has(sh.id))
        if (rs) {
          const hp = rotateHandlePos(shapeBounds(rs), rs.rotation ?? 0, zoomRef.current)
          if (Math.hypot(wp.x - hp.x, wp.y - hp.y) <= 10 / zoomRef.current) {
            rotatingRef.current = rs.id; rotatePreRef.current = [...shapesRef.current]
            shapesRef.current = releaseDetached(shapesRef.current, selectedIdsRef.current)
            updateCursor('grabbing'); return
          }
        }
      }

      // 1. Resize handle (single shape's bounds, or union bounds for a multi-selection)
      if (selectedIdsRef.current.size >= 1) {
        const selShapes = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
        if (selShapes.length) {
          const bounds = selShapes.length === 1 ? shapeBounds(selShapes[0]) : unionBounds(selShapes)
          const hwp = selShapes.length === 1 ? unrotatePoint(selShapes[0], wp.x, wp.y) : wp
          const handle = getHandleAt(bounds, hwp, 10 / zoomRef.current)
          if (handle) {
            resizingRef.current          = handle
            resizeStartBoundsRef.current = bounds
            resizeStartPtRef.current     = wp
            resizePreRef.current         = [...shapesRef.current]
            shapesRef.current            = releaseDetached(shapesRef.current, selectedIdsRef.current)
            updateCursor(handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize')
            return
          }
        }
      }

      // 2. Bend handle hit (single selected arrow)
      if (selectedIdsRef.current.size === 1) {
        const [bid] = [...selectedIdsRef.current]
        const bshape = shapesRef.current.find(s => s.id === bid)
        if (bshape && bshape.type === 'arrow') {
          const a = bshape as ArrowShape
          const cpx = a.cpx ?? (a.x1 + a.x2) / 2
          const cpy = a.cpy ?? (a.y1 + a.y2) / 2
          if (Math.hypot(wp.x - cpx, wp.y - cpy) < 10 / zoomRef.current) {
            isBendingRef.current = true; bendPreRef.current = [...shapesRef.current]
            updateCursor('crosshair'); render(); return
          }
        }
      }

      // 2b. Endpoint of the selected arrow: drag to re-attach / detach
      if (selectedIdsRef.current.size === 1) {
        const [aid] = [...selectedIdsRef.current]
        const a = shapesRef.current.find(s => s.id === aid)
        if (a && a.type === 'arrow') {
          const r = 9 / zoomRef.current
          const which = Math.hypot(wp.x - a.x2, wp.y - a.y2) < r ? 'end' : Math.hypot(wp.x - a.x1, wp.y - a.y1) < r ? 'start' : null
          if (which) { endpointDragRef.current = { id: a.id, which, pre: [...shapesRef.current] }; updateCursor('crosshair'); return }
        }
      }

      // 2c. Connection dot of the hovered shape: pull a new arrow out of it
      const dotHost = bindHoverRef.current && !selectedIdsRef.current.has(bindHoverRef.current)
        ? shapesRef.current.find(s => s.id === bindHoverRef.current) : undefined
      if (dotHost) {
        const di = connectionDots(dotHost, zoomRef.current).findIndex(d => Math.hypot(d.x - wp.x, d.y - wp.y) < 10 / zoomRef.current)
        if (di >= 0) {
          isDrawingRef.current = true; startPtRef.current = wp
          drawingRef.current = {
            id: uid(), color: colorRef.current, fill: 'none', width: widthRef.current, type: 'arrow',
            x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y, start: { id: dotHost.id, ...SIDE_POINTS[di] },
          }
          setTool('arrow'); toolRef.current = 'arrow'
          render(); return
        }
      }

      // 3. Shape hit
      const hit = hitTopmost(shapesRef.current, wp.x, wp.y)
      if (hit) {
        // Expand selection to entire group if the hit shape belongs to one
        const groupIds = hit.groupId
          ? new Set(shapesRef.current.filter(s => s.groupId === hit.groupId).map(s => s.id))
          : new Set([hit.id])

        if (shiftRef.current) {
          // Shift+click: toggle entire group
          const next = new Set(selectedIdsRef.current)
          const allSelected = [...groupIds].every(id => next.has(id))
          if (allSelected) { groupIds.forEach(id => next.delete(id)) }
          else              { groupIds.forEach(id => next.add(id)) }
          setSelection(next)
        } else if (selectedIdsRef.current.has(hit.id)) {
          // Click already-selected shape: drag all selected
          preDragRef.current    = [...shapesRef.current]
          isDraggingRef.current = true; dragMovedRef.current = false
          dragOriginRef.current = wp
        } else {
          // Click unselected shape: select it (+ group mates), start drag
          setSelection(groupIds)
          preDragRef.current    = [...shapesRef.current]
          isDraggingRef.current = true; dragMovedRef.current = false
          dragOriginRef.current = wp
        }
        render(); return
      }

      // 3. Click empty space: start rubber-band (clear selection unless shift)
      if (!shiftRef.current) clearSelection()
      isRubberBandRef.current    = true
      rubberBandStartRef.current = wp
      rubberBandEndRef.current   = wp
      render(); return
    }

    if (toolRef.current === 'text') {
      const rect = containerRef.current!.getBoundingClientRect()
      setTextInput({ sx: e.clientX - rect.left, sy: e.clientY - rect.top, wx: wp.x, wy: wp.y })
      return
    }

    if (toolRef.current === 'sticky') {
      const rect = containerRef.current!.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      setTextInput({
        sx, sy, wx: wp.x, wy: wp.y, isNewSticky: true,
        boxW: STICKY_DEFAULT_W * zoomRef.current, boxH: STICKY_DEFAULT_H * zoomRef.current,
      })
      return
    }

    isDrawingRef.current = true; startPtRef.current = wp
    const base = { id: uid(), color: colorRef.current, fill: fillRef.current, width: widthRef.current }
    switch (toolRef.current) {
      case 'pen':     drawingRef.current = { ...base, type: 'path',    pts: [wp] }; break
      case 'rect':    drawingRef.current = { ...base, type: 'rect',    x: wp.x, y: wp.y, w: 0, h: 0, radius: radiusRef.current }; break
      case 'frame': {
        const n = shapesRef.current.filter(isFrame).length + 1
        drawingRef.current = { ...base, fill: 'none', width: 1.5, type: 'rect', kind: 'frame', title: `Frame ${n}`, x: wp.x, y: wp.y, w: 0, h: 0, radius: 8 }
        break
      }
      case 'ellipse': drawingRef.current = { ...base, type: 'ellipse', cx: wp.x, cy: wp.y, rx: 0, ry: 0 }; break
      case 'line':    drawingRef.current = { ...base, type: 'line',    x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }; break
      case 'arrow': {
        // Starting on (or next to) a shape attaches the arrow's tail to it
        const cand = bindingAt(shapesRef.current, wp, zoomRef.current)
        drawingRef.current = { ...base, fill: 'none', type: 'arrow', x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y, ...(cand ? { start: cand.bind } : {}) }
        break
      }
    }
  }, [toWorld, render, setSelection, clearSelection, updateCursor, openShapeNote])

  const hoverCursor = (wp: Point) => hitTopmost(shapesRef.current, wp.x, wp.y) ? 'move' : 'default'

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      panRef.current = { x: panOriginRef.current.x + e.clientX - panStartRef.current.x, y: panOriginRef.current.y + e.clientY - panStartRef.current.y }
      render(); return
    }

    const wp = toWorld(e)
    lastMouseWorldRef.current = wp

    // Rotate (shift snaps to 15°)
    if (rotatingRef.current) {
      const id = rotatingRef.current
      const target = shapesRef.current.find(sh => sh.id === id)
      if (target) {
        const b = shapeBounds(target)
        let ang = Math.atan2(wp.y - (b.y + b.h / 2), wp.x - (b.x + b.w / 2)) + Math.PI / 2
        if (shiftRef.current) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
        shapesRef.current = shapesRef.current.map(sh => sh.id === id ? { ...sh, rotation: ang } as Shape : sh)
        render()
      }
      return
    }

    // Drag an arrow endpoint: attach to whatever bindable shape is under it
    if (endpointDragRef.current) {
      const { id, which } = endpointDragRef.current
      const a = shapesRef.current.find(s => s.id === id)
      if (a && a.type === 'arrow') {
        const other = which === 'end' ? { x: a.x1, y: a.y1 } : { x: a.x2, y: a.y2 }
        const cand = bindingAt(shapesRef.current, wp, zoomRef.current, new Set([id]), other)
        bindPreviewRef.current = cand?.target.id ?? null
        const next: ArrowShape = which === 'end' ? { ...a, x2: wp.x, y2: wp.y } : { ...a, x1: wp.x, y1: wp.y }
        if (cand) next[which] = cand.bind; else delete next[which]
        shapesRef.current = shapesRef.current.map(s => s.id === id ? next : s)
      }
      render(); return
    }

    // Resize (single shape, or proportional group-resize for a multi-selection)
    if (resizingRef.current && resizeStartBoundsRef.current && selectedIdsRef.current.size >= 1) {
      const sb = resizeStartBoundsRef.current
      const dx = wp.x - resizeStartPtRef.current.x, dy = wp.y - resizeStartPtRef.current.y
      const MIN = 20
      let nb: ReturnType<typeof normalizeRect>
      switch (resizingRef.current) {
        case 'tl': nb = normalizeRect(sb.x + dx, sb.y + dy, sb.x + sb.w, sb.y + sb.h); break
        case 'tr': nb = normalizeRect(sb.x,       sb.y + dy, sb.x + sb.w + dx, sb.y + sb.h); break
        case 'bl': nb = normalizeRect(sb.x + dx,  sb.y,      sb.x + sb.w, sb.y + sb.h + dy); break
        case 'br': nb = normalizeRect(sb.x,       sb.y,      sb.x + sb.w + dx, sb.y + sb.h + dy); break
      }
      nb.w = Math.max(nb.w, MIN); nb.h = Math.max(nb.h, MIN)
      if (selectedIdsRef.current.size === 1) {
        const [id] = [...selectedIdsRef.current]
        // Pictures keep their proportions, anchored at the corner opposite the handle.
        if (shapesRef.current.find(s => s.id === id)?.type === 'image') {
          const k = Math.max(nb.w / sb.w, nb.h / sb.h)
          const nw = sb.w * k, nh = sb.h * k
          const h = resizingRef.current
          nb = {
            x: h === 'tl' || h === 'bl' ? sb.x + sb.w - nw : sb.x,
            y: h === 'tl' || h === 'tr' ? sb.y + sb.h - nh : sb.y,
            w: nw, h: nh,
          }
        }
        shapesRef.current = shapesRef.current.map(s => s.id === id ? fitContainer(applyBoundsToShape(s, nb)) : s)
      } else {
        // Proportional group resize: scale each selected shape's own bounds against the group's start bounds
        const sx = nb.w / Math.max(sb.w, 1), sy = nb.h / Math.max(sb.h, 1)
        shapesRef.current = shapesRef.current.map(s => {
          if (!selectedIdsRef.current.has(s.id)) return s
          const b = shapeBounds(s)
          const shapeNb = {
            x: nb.x + (b.x - sb.x) * sx,
            y: nb.y + (b.y - sb.y) * sy,
            w: Math.max(b.w * sx, 1),
            h: Math.max(b.h * sy, 1),
          }
          return fitContainer(applyBoundsToShape(s, shapeNb))
        })
      }
      render(); return
    }

    // Bend arrow control point
    if (isBendingRef.current && selectedIdsRef.current.size === 1) {
      const [bid] = [...selectedIdsRef.current]
      shapesRef.current = shapesRef.current.map(s =>
        s.id === bid && s.type === 'arrow' ? { ...s, cpx: wp.x, cpy: wp.y, autoBend: false } as Shape : s
      )
      render(); return
    }

    // Move selected shapes
    if (isDraggingRef.current && selectedIdsRef.current.size > 0 && preDragRef.current) {
      let dx = wp.x - dragOriginRef.current.x, dy = wp.y - dragOriginRef.current.y
      // Dead zone so a plain click (or the first click of a double-click) never nudges or adds an undo step
      if (!dragMovedRef.current && Math.hypot(dx, dy) * zoomRef.current < 3) return
      dragMovedRef.current = true
      const pre = preDragRef.current
      // A selected frame carries everything inside it
      const ids = withFrameContents(selectedIdsRef.current, pre)
      guidesRef.current = []
      if (!e.altKey) {
        const snapped = snapDrag(unionBounds(pre.filter(s => ids.has(s.id))), pre.filter(s => !ids.has(s.id)), dx, dy, 6 / zoomRef.current)
        dx = snapped.dx; dy = snapped.dy; guidesRef.current = snapped.guides
      }
      // An arrow dragged without its shapes lets go of them
      shapesRef.current = releaseDetached(pre, ids).map(s => ids.has(s.id) ? offsetShape(s, dx, dy) as Shape : s)
      render(); return
    }

    // Rubber-band
    if (isRubberBandRef.current) {
      rubberBandEndRef.current = wp
      render(); return
    }

    // Drawing
    if (isDrawingRef.current && drawingRef.current) {
      const sp = startPtRef.current, sh = shiftRef.current, d = drawingRef.current
      switch (d.type) {
        case 'path': {
          const last = (d as PathShape).pts[(d as PathShape).pts.length - 1]
          if (Math.hypot(wp.x - last.x, wp.y - last.y) > 2 / zoomRef.current)
            (d as PathShape).pts = [...(d as PathShape).pts, wp]
          break
        }
        case 'rect': {
          let w = wp.x - sp.x, h = wp.y - sp.y
          if (sh) { const s = Math.sign(w) * Math.sign(h) * Math.max(Math.abs(w), Math.abs(h)); w = s; h = s }
          ;(d as RectShape).x = Math.min(sp.x, sp.x + w); (d as RectShape).y = Math.min(sp.y, sp.y + h)
          ;(d as RectShape).w = Math.abs(w); (d as RectShape).h = Math.abs(h)
          break
        }
        case 'ellipse': {
          let rx = (wp.x - sp.x) / 2, ry = (wp.y - sp.y) / 2
          if (sh) { const m = Math.max(Math.abs(rx), Math.abs(ry)); rx = Math.sign(rx) * m; ry = Math.sign(ry) * m }
          ;(d as EllipseShape).cx = sp.x + rx; (d as EllipseShape).cy = sp.y + ry
          ;(d as EllipseShape).rx = rx; (d as EllipseShape).ry = ry
          break
        }
        case 'line':
        case 'arrow': {
          let x2 = wp.x, y2 = wp.y
          if (sh) { const dx = wp.x - sp.x, dy = wp.y - sp.y, snap = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), dist = Math.hypot(dx, dy); x2 = sp.x + dist * Math.cos(snap); y2 = sp.y + dist * Math.sin(snap) }
          ;(d as LineShape).x2 = x2; (d as LineShape).y2 = y2
          if (d.type === 'arrow') {
            // Hovering a shape with the arrow's head attaches it (highlighted), and snaps the ends
            const ar = d as ArrowShape
            const cand = bindingAt(shapesRef.current, wp, zoomRef.current, new Set(ar.start ? [ar.start.id] : []), { x: ar.x1, y: ar.y1 })
            bindPreviewRef.current = cand?.target.id ?? null
            if (cand) ar.end = cand.bind; else delete ar.end
            drawingRef.current = resolveArrow(ar, new Map(shapesRef.current.map(sh => [sh.id, sh])))
          }
          break
        }
      }
      render(); return
    }

    // Connection dots: show them on the bindable shape under the pointer (select & arrow tools)
    if (toolRef.current === 'select' || toolRef.current === 'arrow') {
      const host = bindingAt(shapesRef.current, wp, zoomRef.current)?.target
      // Keep the dots up while the pointer travels from the shape out to a dot
      const keep = bindHoverRef.current && !host
        ? shapesRef.current.find(s => s.id === bindHoverRef.current && connectionDots(s, zoomRef.current).some(d => Math.hypot(d.x - wp.x, d.y - wp.y) < 14 / zoomRef.current))
        : undefined
      const next = host?.id ?? keep?.id ?? null
      const prev = bindHoverRef.current
      bindHoverRef.current = next
      const onDot = next && !selectedIdsRef.current.has(next) ? connectionDots(shapesRef.current.find(s => s.id === next)!, zoomRef.current).some(d => Math.hypot(d.x - wp.x, d.y - wp.y) < 10 / zoomRef.current) : false
      // Repaint only while dots are (or just stopped being) on screen
      if (next || prev) render()
      if (onDot && toolRef.current === 'select') { updateCursor('crosshair'); return }
    } else if (bindHoverRef.current) {
      bindHoverRef.current = null; render()
    }

    // Cursor: handle hover for the current selection (single shape or multi-selection bounds)
    if (toolRef.current === 'select' && selectedIdsRef.current.size >= 1) {
      const selShapes = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
      if (selShapes.length === 1) {
        const shape = selShapes[0]
        // Arrow bend handle
        if (shape.type === 'arrow') {
          const a = shape as ArrowShape
          const cpx = a.cpx ?? (a.x1 + a.x2) / 2
          const cpy = a.cpy ?? (a.y1 + a.y2) / 2
          if (Math.hypot(wp.x - cpx, wp.y - cpy) < 10 / zoomRef.current) {
            updateCursor('grab'); return
          }
        }
        const rhp = rotateHandlePos(shapeBounds(shape), shape.rotation ?? 0, zoomRef.current)
        if (Math.hypot(wp.x - rhp.x, wp.y - rhp.y) <= 10 / zoomRef.current) { updateCursor('grab'); return }
        const uw = unrotatePoint(shape, wp.x, wp.y)
        const handle = getHandleAt(shapeBounds(shape), uw, 10 / zoomRef.current)
        updateCursor(handle ? (handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize') : hoverCursor(wp))
        return
      }
      if (selShapes.length > 1) {
        const handle = getHandleAt(unionBounds(selShapes), wp, 10 / zoomRef.current)
        updateCursor(handle ? (handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize') : hoverCursor(wp))
        return
      }
    }
    if (!isSpaceRef.current)
      updateCursor(toolRef.current === 'text' ? 'text' : toolRef.current === 'select' ? hoverCursor(wp) : 'crosshair')
  }, [toWorld, render, updateCursor])

  const onMouseUp = useCallback(() => {
    if (isPanningRef.current) { isPanningRef.current = false; return }

    // Finish dragging an arrow endpoint
    if (endpointDragRef.current) {
      const { pre } = endpointDragRef.current
      endpointDragRef.current = null; bindPreviewRef.current = null
      historyRef.current = [...historyRef.current, pre]
      futureRef.current = []
      setCanUndo(true); setCanRedo(false); scheduleSave(); updateCursor('default'); render()
      return
    }

    // Finish bend
    if (isBendingRef.current) {
      isBendingRef.current = false; updateCursor('default')
      if (bendPreRef.current) {
        historyRef.current = [...historyRef.current, bendPreRef.current]
        futureRef.current = []; bendPreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish rotate
    if (rotatingRef.current) {
      rotatingRef.current = null
      updateCursor('default')
      if (rotatePreRef.current) {
        historyRef.current = [...historyRef.current, rotatePreRef.current]
        futureRef.current = []; rotatePreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish resize
    if (resizingRef.current) {
      resizingRef.current = null
      updateCursor('default')
      if (resizePreRef.current) {
        historyRef.current = [...historyRef.current, resizePreRef.current]
        futureRef.current = []; resizePreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish drag
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      guidesRef.current = []
      if (preDragRef.current && dragMovedRef.current) {
        historyRef.current = [...historyRef.current, preDragRef.current]
        futureRef.current = []
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      preDragRef.current = null; dragMovedRef.current = false
      render(); return
    }

    // Finish rubber-band
    if (isRubberBandRef.current) {
      isRubberBandRef.current = false
      const p1 = rubberBandStartRef.current, p2 = rubberBandEndRef.current
      const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y)
      if (rw > 4 || rh > 4) {
        const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y)
        const directHit = shapesRef.current.filter(s => {
          const b = shapeBounds(s)
          return b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry
        })
        // Expand to include all group mates of any directly-hit shape
        const hitGroupIds = new Set(directHit.map(s => s.groupId).filter(Boolean) as string[])
        const expanded = new Set([
          ...directHit.map(s => s.id),
          ...shapesRef.current.filter(s => s.groupId && hitGroupIds.has(s.groupId)).map(s => s.id),
        ])
        if (shiftRef.current) {
          const next = new Set(selectedIdsRef.current)
          expanded.forEach(id => next.add(id))
          setSelection(next)
        } else {
          setSelection(expanded)
        }
      }
      render(); return
    }

    // Finish drawing
    if (!isDrawingRef.current || !drawingRef.current) return
    isDrawingRef.current = false
    bindPreviewRef.current = null
    const shape = drawingRef.current; drawingRef.current = null
    if (shape.type === 'path') {
      if (shape.pts.length < 2) { render(); return }
      commit([...shapesRef.current, shape]); return
    }
    const b = shapeBounds(shape)
    let final: Shape = shape
    if (b.w < 8 / zoomRef.current && b.h < 8 / zoomRef.current) {
      // A plain click drops a ready-made default-size shape centered on the cursor
      const c = startPtRef.current
      if (isFrame(shape))                final = { ...shape, x: c.x - 200, y: c.y - 140, w: 400, h: 280 }
      else if (shape.type === 'rect')    final = { ...shape, x: c.x - 70, y: c.y - 45, w: 140, h: 90 }
      else if (shape.type === 'ellipse') final = { ...shape, cx: c.x, cy: c.y, rx: 70, ry: 45 }
      else {
        // A click on a connection dot that never became a drag: back to selecting
        if (shape.type === 'arrow' && shape.start) { setTool('select'); toolRef.current = 'select' }
        render(); return
      }
    }
    // A frame goes underneath everything so the shapes it wraps stay on top and clickable
    commit(isFrame(final) ? [final, ...shapesRef.current] : [...shapesRef.current, final])
    // Like Excalidraw: after placing a shape, hand control back to the select tool with the shape selected
    setSelection(new Set([final.id]))
    setTool('select'); toolRef.current = 'select'
  }, [commit, scheduleSave, render, setSelection, updateCursor])

  // ── Text editing ─────────────────────────────────────────────────────────────

  /** Open the in-place editor for a text, sticky, or rect/ellipse label (double-click or Enter) */
  const startEdit = useCallback((shape: Shape) => {
    const zoom = zoomRef.current, pan = panRef.current
    if (shape.type === 'text') {
      setFontSize(shape.size);                      fontSizeRef.current   = shape.size
      setFontFamily(shape.fontFamily ?? FONT_HAND); fontFamilyRef.current = shape.fontFamily ?? FONT_HAND
      setBold(shape.bold ?? false);                 boldRef.current       = shape.bold ?? false
      setItalic(shape.italic ?? false);             italicRef.current     = shape.italic ?? false
      setTextAlign(shape.align ?? 'left');          textAlignRef.current  = shape.align ?? 'left'
      setColor(shape.color);                        colorRef.current      = shape.color
      // shape.y is the baseline; position the input so its visual baseline lines up
      const sx = shape.x * zoom + pan.x
      const sy = shape.y * zoom + pan.y - shape.size * zoom + Math.min(shape.size, 32)
      setTextInput({ sx, sy, wx: shape.x, wy: shape.y - shape.size, editingId: shape.id, initialValue: shape.text })
      setTool('text'); toolRef.current = 'text'
      return
    }
    if (shape.type === 'sticky') {
      const b = shapeBounds(shape)
      editPreRef.current = shapesRef.current
      setTextInput({
        sx: b.x * zoom + pan.x, sy: b.y * zoom + pan.y, wx: b.x, wy: b.y,
        stickyId: shape.id, boxW: b.w * zoom, boxH: b.h * zoom, initialValue: shape.text,
      })
      return
    }
    if (shape.type === 'arrow') {
      const bt = shape.label
      setFontSize(bt?.size ?? 14);                fontSizeRef.current   = bt?.size ?? 14
      setFontFamily(bt?.fontFamily ?? FONT_HAND); fontFamilyRef.current = bt?.fontFamily ?? FONT_HAND
      setBold(bt?.bold ?? false);                 boldRef.current       = bt?.bold ?? false
      setItalic(bt?.italic ?? false);             italicRef.current     = bt?.italic ?? false
      const mid = arrowEnds(shape).mid
      const w = 180, h = (bt?.size ?? 14) * BOUND_LINE_HEIGHT * Math.max(1, (bt?.text ?? '').split('\n').length) + 10
      setTextInput({
        sx: (mid.x - w / 2) * zoom + pan.x, sy: (mid.y - h / 2) * zoom + pan.y, wx: mid.x - w / 2, wy: mid.y - h / 2,
        containerId: shape.id, boxW: w * zoom, boxH: h * zoom, initialValue: bt?.text ?? '',
      })
      return
    }
    if (shape.type === 'rect' || shape.type === 'ellipse') {
      const bt = shape.boundText
      setFontSize(bt?.size ?? 16);                fontSizeRef.current   = bt?.size ?? 16
      setFontFamily(bt?.fontFamily ?? FONT_HAND); fontFamilyRef.current = bt?.fontFamily ?? FONT_HAND
      setBold(bt?.bold ?? false);                 boldRef.current       = bt?.bold ?? false
      setItalic(bt?.italic ?? false);             italicRef.current     = bt?.italic ?? false
      setTextAlign(bt?.align ?? 'center');        textAlignRef.current  = bt?.align ?? 'center'
      const box = containerTextBox(shape)
      editPreRef.current = shapesRef.current
      setTextInput({
        sx: box.x * zoom + pan.x, sy: box.y * zoom + pan.y, wx: box.x, wy: box.y,
        containerId: shape.id, boxW: box.w * zoom, boxH: box.h * zoom, initialValue: bt?.text ?? '',
      })
    }
  }, [])

  // Keep what's being typed inside its box: labeled shapes and stickies grow as the text wraps
  // (editor geometry is patched on the DOM node directly — re-setting textInput state would
  // re-run the focus effect and throw the caret to the end mid-typing).
  const onEditorInput = useCallback(() => {
    const el = textRef.current as HTMLDivElement | null
    if (!el || !textInput) return
    const val = el.innerText.replace(/\u200b/g, '')
    const zoom = zoomRef.current, pan = panRef.current
    if (textInput.containerId) {
      const cur = shapesRef.current.find(sh => sh.id === textInput.containerId)
      if (!cur || (cur.type !== 'rect' && cur.type !== 'ellipse')) return
      const bt: BoundText = { text: val, size: fontSizeRef.current, fontFamily: fontFamilyRef.current, bold: boldRef.current, italic: italicRef.current, color: colorRef.current }
      const b = shapeBounds(cur)
      const needed = containerNeededH(cur, bt, b.w)
      if (needed > b.h) {
        const grown = applyBoundsToShape(cur, { ...b, h: needed }) as RectShape | EllipseShape
        shapesRef.current = shapesRef.current.map(sh => sh.id === cur.id ? grown : sh)
        const box = containerTextBox(grown)
        el.style.top = `${box.y * zoom + pan.y}px`
        el.style.height = `${box.h * zoom}px`
        render()
      }
    } else if (textInput.stickyId || textInput.isNewSticky) {
      const ctx = getMeasureCtx()
      ctx.save(); ctx.font = `13px ${FONT_HAND}`
      const lines = wrapCanvasText(ctx, val, Math.max(textInput.boxW! / zoom - 16, 10))
      ctx.restore()
      const needed = (lines.length * 13 * 1.3 + 16) * zoom
      if (needed > el.offsetHeight) el.style.height = `${needed}px`
    }
  }, [textInput, render])

  // ── Frame titles ─────────────────────────────────────────────────────────────

  const startFrameTitleEdit = useCallback((f: RectShape) => {
    const zoom = zoomRef.current, pan = panRef.current, t = frameTitleBox(f)
    setFrameEdit({
      id: f.id, value: f.title ?? '',
      sx: t.x * zoom + pan.x, sy: t.y * zoom + pan.y,
      w: Math.max(160, f.w * zoom * 0.6), fontPx: Math.max(11, FRAME_TITLE_SIZE * zoom),
    })
  }, [])

  const commitFrameTitle = useCallback((value: string | null) => {
    const ed = frameEdit
    setFrameEdit(null)
    if (!ed || value === null) return
    const title = value.trim() || 'Frame'
    const cur = shapesRef.current.find(s => s.id === ed.id)
    if (!cur || !isFrame(cur) || cur.title === title) return
    commit(shapesRef.current.map(s => s.id === ed.id ? { ...s, title } as Shape : s))
  }, [frameEdit, commit])

  // ── Double-click: edit text / labels, straighten arrows, or drop new text ────

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const wp = toWorld(e)

    // Double-click a bent arrow → straighten it
    const hitArrow = [...shapesRef.current].reverse().find(
      s => s.type === 'arrow' && (s as ArrowShape).cpx !== undefined
        && Math.hypot(wp.x - (s as ArrowShape).cpx!, wp.y - (s as ArrowShape).cpy!) < 10 / zoomRef.current
    ) as ArrowShape | undefined
    if (hitArrow) {
      e.preventDefault()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cpx: _cx, cpy: _cy, ...rest } = hitArrow
      commit(shapesRef.current.map(s => s.id === hitArrow.id ? rest as Shape : s))
      return
    }

    const hit = hitTopmost(shapesRef.current, wp.x, wp.y)
    if (hit && isFrame(hit)) {
      e.preventDefault()
      setSelection(new Set([hit.id]))
      startFrameTitleEdit(hit)
      return
    }
    if (hit && (hit.type === 'text' || hit.type === 'sticky' || hit.type === 'rect' || hit.type === 'ellipse' || hit.type === 'arrow')) {
      e.preventDefault()
      setSelection(new Set([hit.id]))
      startEdit(hit)
      return
    }

    // Double-click on empty canvas → new text right there
    if (!hit && toolRef.current === 'select') {
      e.preventDefault()
      const rect = containerRef.current!.getBoundingClientRect()
      setTextInput({ sx: e.clientX - rect.left, sy: e.clientY - rect.top, wx: wp.x, wy: wp.y })
    }
  }, [toWorld, setSelection, startEdit, startFrameTitleEdit, commit])

  // ── Wheel ────────────────────────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) {
      const rect = canvasRef.current!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const oldZ = zoomRef.current, newZ = Math.max(0.1, Math.min(6, oldZ * (e.deltaY > 0 ? 0.92 : 1.08)))
      panRef.current = { x: mx - (mx - panRef.current.x) * (newZ / oldZ), y: my - (my - panRef.current.y) * (newZ / oldZ) }
      zoomRef.current = newZ; setZoomState(newZ)
    } else {
      panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
    }
    render()
  }, [render])

  const handleZoom = useCallback((delta: number) => {
    const canvas = canvasRef.current!, DPR = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    const oldZ = zoomRef.current, newZ = Math.max(0.1, Math.min(6, oldZ + delta))
    panRef.current = { x: cssW / 2 - (cssW / 2 - panRef.current.x) * (newZ / oldZ), y: cssH / 2 - (cssH / 2 - panRef.current.y) * (newZ / oldZ) }
    zoomRef.current = newZ; setZoomState(newZ); render()
  }, [render])

  // Fit the given shapes (default: everything) into the viewport, same math loadTemplate uses
  const zoomToFit = useCallback((shapes?: Shape[], maxZoom = 3) => {
    const targets = shapes ?? shapesRef.current
    if (!targets.length) return
    const canvas = canvasRef.current!, DPR = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    const b = unionBounds(targets), pad = 80
    const newZoom = Math.max(0.1, Math.min((cssW - pad * 2) / b.w, (cssH - pad * 2) / b.h, maxZoom))
    zoomRef.current = newZoom; setZoomState(newZoom)
    panRef.current = { x: cssW / 2 - (b.x + b.w / 2) * newZoom, y: cssH / 2 - (b.y + b.h / 2) * newZoom }
    render()
  }, [render])

  // ── Notes sheet width ────────────────────────────────────────────────────────

  const setNotesWidthPersist = useCallback((w: number) => {
    setNotesWidth(w)
    try { localStorage.setItem('inkwell-canvas-notes-width', String(Math.round(w))) } catch { /* ignore */ }
  }, [])

  const startNotesResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX, startW = notesWidth
    // Leave the canvas at least ~40% of the window.
    const maxW = Math.max(NOTES_MIN_W, window.innerWidth * 0.6)
    let w = startW
    setNotesResizing(true)
    const move = (ev: MouseEvent) => {
      w = Math.min(maxW, Math.max(NOTES_MIN_W, startW + (startX - ev.clientX)))
      setNotesWidth(w)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      setNotesResizing(false)
      setNotesWidthPersist(w)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [notesWidth, setNotesWidthPersist])

  // ── Minimap ──────────────────────────────────────────────────────────────────

  const toggleMinimap = useCallback(() => {
    setShowMinimap(v => {
      try { localStorage.setItem('inkwell-canvas-minimap', String(!v)) } catch { /* ignore */ }
      return !v
    })
  }, [])

  const getMinimapView = useCallback((): MinimapView | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const DPR = window.devicePixelRatio || 1
    const darkBg = useAppStore.getState().theme === 'dark'
    return {
      shapes: shapesRef.current, pan: panRef.current, zoom: zoomRef.current,
      w: canvas.width / DPR, h: canvas.height / DPR,
      darkBg, ink: darkBg ? DEFAULT_COLOR_DARK : DEFAULT_COLOR_LIGHT,
    }
  }, [])

  const centerViewOn = useCallback((p: Point) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const DPR = window.devicePixelRatio || 1
    const z = zoomRef.current
    panRef.current = { x: canvas.width / DPR / 2 - p.x * z, y: canvas.height / DPR / 2 - p.y * z }
    render()
  }, [render])

  // After a drawing loads, frame its content (never zooming in past 100%).
  useEffect(() => { if (fitTick) zoomToFit(undefined, 1) }, [fitTick, zoomToFit])

  const resetZoom = useCallback(() => {
    const canvas = canvasRef.current!, DPR = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    const oldZ = zoomRef.current, newZ = 1
    panRef.current = { x: cssW / 2 - (cssW / 2 - panRef.current.x) * (newZ / oldZ), y: cssH / 2 - (cssH / 2 - panRef.current.y) * (newZ / oldZ) }
    zoomRef.current = newZ; setZoomState(newZ); render()
  }, [render])

  // ── Layer order ──────────────────────────────────────────────────────────────

  const bringToFront = useCallback(() => {
    if (!selectedIdsRef.current.size) return
    const sel  = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
    const rest = shapesRef.current.filter(s => !selectedIdsRef.current.has(s.id))
    commit([...rest, ...sel])
  }, [commit])

  const sendToBack = useCallback(() => {
    if (!selectedIdsRef.current.size) return
    const sel  = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
    const rest = shapesRef.current.filter(s => !selectedIdsRef.current.has(s.id))
    commit([...sel, ...rest])
  }, [commit])

  // ── Clipboard (in-app) ───────────────────────────────────────────────────────

  const copySelected = useCallback(() => {
    if (!selectedIdsRef.current.size) return
    clipboardRef.current = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
  }, [])

  const pasteClipboard = useCallback(() => {
    if (!clipboardRef.current?.length) return
    const b  = unionBounds(clipboardRef.current)
    const target = lastMouseWorldRef.current
    const dx = target.x - (b.x + b.w / 2), dy = target.y - (b.y + b.h / 2)
    const idMap = new Map<string, string>()
    const fresh = clipboardRef.current.map(s => { const id = uid(); idMap.set(s.id, id); return { ...s, id } })
    const copies = offsetShapes(remapBindings(fresh, idMap), dx, dy)
    commit([...shapesRef.current, ...copies])
    setSelection(new Set(copies.map(c => c.id)))
  }, [commit, setSelection])

  // ── Images (paste / upload) ──────────────────────────────────────────────────

  const imageInputRef = useRef<HTMLInputElement>(null)
  const pasteSeenRef  = useRef(false)

  const viewCenter = useCallback((): Point => {
    const r = containerRef.current?.getBoundingClientRect()
    return {
      x: ((r?.width ?? 800) / 2 - panRef.current.x) / zoomRef.current,
      y: ((r?.height ?? 600) / 2 - panRef.current.y) / zoomRef.current,
    }
  }, [])

  /** Inserts already-built shapes so their bounding box is centered on `center`, and selects them. */
  const insertShapesAt = useCallback((shapes: Shape[], center: Point, select = true) => {
    if (!shapes.length) return
    const b = unionBounds(shapes)
    const placed = offsetShapes(shapes, center.x - (b.x + b.w / 2), center.y - (b.y + b.h / 2))
    commit([...shapesRef.current, ...placed])
    // A pasted diagram lands unselected, so it reads as separate tables/nodes and links
    // rather than one block; click any of them to pick it up.
    setSelection(select ? new Set(placed.map(s => s.id)) : new Set())
    setTool('select')
  }, [commit, setSelection])

  const addImageFiles = useCallback(async (files: File[], at?: Point) => {
    const center = at ?? viewCenter()
    const shapes = await imageFilesToShapes(files, center)
    if (!shapes.length) return
    commit([...shapesRef.current, ...shapes])
    setSelection(new Set(shapes.map(s => s.id)))
    setTool('select')
  }, [commit, setSelection, viewCenter])

  /** Excalidraw scene text (clipboard JSON or a .excalidraw file). Returns false if it isn't one. */
  const importExcalidrawText = useCallback((text: string, at?: Point): boolean => {
    const scene = parseExcalidraw(text)
    if (!scene) return false
    insertShapesAt(excalidrawToShapes(scene), at ?? viewCenter())
    return true
  }, [insertShapesAt, viewCenter])

  /** Mermaid diagram code (bare or in a ```mermaid fence). Returns false if it isn't Mermaid. */
  const importMermaidText = useCallback((text: string, at?: Point): boolean => {
    const src = extractMermaid(text)
    if (!src) return false
    const center = at ?? viewCenter()
    mermaidToShapes(src, fontFamilyRef.current)
      .then(shapes => { setImportError(null); insertShapesAt(recolorTemplateShapes(shapes, defaultColor), center, false) })
      .catch(e => {
        const msg = e instanceof Error ? e.message : String(e)
        setImportError(msg)
        setTimeout(() => setImportError(cur => (cur === msg ? null : cur)), 6000)
      })
    return true
  }, [insertShapesAt, viewCenter, defaultColor])

  /** Files from the upload button: pictures, plus .excalidraw / .json scenes. */
  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'))
    for (const f of files.filter(f => /\.(excalidraw|json)$/i.test(f.name))) {
      if (!importExcalidrawText(await f.text())) console.warn('[canvas] not an Excalidraw file:', f.name)
    }
    for (const f of files.filter(f => /\.(mmd|mermaid)$/i.test(f.name))) {
      const text = await f.text()
      if (!importMermaidText(extractMermaid(text) ? text : `flowchart TD\n${text}`)) console.warn('[canvas] not a Mermaid file:', f.name)
    }
    if (images.length) await addImageFiles(images)
  }, [addImageFiles, importExcalidrawText, importMermaidText])

  // Repaint when a freshly added/loaded picture finishes decoding.
  useEffect(() => {
    onImageReady = () => render()
    return () => { onImageReady = null }
  }, [render])

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pen', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', t: 'text', s: 'sticky', f: 'frame' }
    const down = (ev: KeyboardEvent) => {
      shiftRef.current = ev.shiftKey
      const inInput = (ev.target as Element).closest('input, textarea, .cm-editor, [contenteditable="true"]')

      if (ev.code === 'Space' && !inInput) { ev.preventDefault(); isSpaceRef.current = true; setSpacePan(true); updateCursor('grab') }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'z') { ev.preventDefault(); undo() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey  && ev.key === 'z') { ev.preventDefault(); redo() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'g') { ev.preventDefault(); groupSelected() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey  && ev.key === 'g') { ev.preventDefault(); ungroupSelected() }

      // Layer order: ⌘⇧] bring to front, ⌘⇧[ send to back
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key === ']') { ev.preventDefault(); bringToFront() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key === '[') { ev.preventDefault(); sendToBack() }

      // Clipboard: ⌘C copy, ⌘X cut, ⌘V paste
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.key === 'c') { ev.preventDefault(); copySelected() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.key === 'x') {
        ev.preventDefault()
        if (selectedIdsRef.current.size > 0) {
          copySelected()
          commit(shapesRef.current.filter(s => !selectedIdsRef.current.has(s.id)))
          clearSelection()
        }
      }
      // Paste is left to the browser's `paste` event so image data on the clipboard is
      // readable; if that event never arrives, fall back to the in-app clipboard.
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.key === 'v') {
        pasteSeenRef.current = false
        setTimeout(() => { if (!pasteSeenRef.current) pasteClipboard() }, 80)
      }

      // Zoom: Shift+1 fit all, Shift+2 fit selection, Shift+0 reset to 100%
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '1') { ev.preventDefault(); zoomToFit() }
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '2') {
        ev.preventDefault()
        const sel = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
        zoomToFit(sel.length ? sel : undefined)
      }
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '0') { ev.preventDefault(); resetZoom() }
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.code === 'KeyM') { ev.preventDefault(); toggleMinimap() }

      // Arrow-key nudge (coalesced into one undo step per burst, finalized on keyup)
      if (!inInput && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && selectedIdsRef.current.size > 0) {
        ev.preventDefault()
        const step = ev.shiftKey ? 10 : 1
        const [dx, dy] = ev.key === 'ArrowUp'   ? [0, -step]
                       : ev.key === 'ArrowDown' ? [0, step]
                       : ev.key === 'ArrowLeft' ? [-step, 0]
                       : [step, 0]
        if (!nudgePreRef.current) nudgePreRef.current = [...shapesRef.current]
        const moving = withFrameContents(selectedIdsRef.current, shapesRef.current)
        shapesRef.current = releaseDetached(shapesRef.current, moving).map(s => moving.has(s.id) ? offsetShape(s, dx, dy) as Shape : s)
        render()
      }

      if (!inInput) {
        // Delete all selected
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
          if (selectedIdsRef.current.size > 0) {
            commit(shapesRef.current.filter(s => !selectedIdsRef.current.has(s.id)))
            clearSelection()
          }
        }
        // Escape → select tool + clear
        if (ev.key === 'Escape') {
          setTextInput(null); setTool('select'); toolRef.current = 'select'
          setShowShortcuts(false)
          clearSelection(); render()
        }
        // ⌘D duplicate all selected
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'd') {
          ev.preventDefault()
          if (selectedIdsRef.current.size > 0) {
            const sel   = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
            const idMap = new Map<string, string>()
            const copies = remapBindings(sel.map(sh => { const c = duplicateShape(sh); idMap.set(sh.id, c.id); return c }), idMap)
            commit([...shapesRef.current, ...copies])
            setSelection(new Set(copies.map(c => c.id)))
          }
        }
        // ⌘A select all
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'a') {
          ev.preventDefault()
          setSelection(new Set(shapesRef.current.map(s => s.id)))
          render()
        }
        // ⌘/ toggle notes panel
        if ((ev.metaKey || ev.ctrlKey) && ev.key === '/') {
          ev.preventDefault()
          setShowNotes(v => !v)
        }
        // Enter → edit the selected shape's text (or label)
        if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey && selectedIdsRef.current.size === 1) {
          const sh = shapesRef.current.find(x => selectedIdsRef.current.has(x.id))
          if (sh && isFrame(sh)) { ev.preventDefault(); startFrameTitleEdit(sh); return }
          if (sh && (sh.type === 'text' || sh.type === 'sticky' || sh.type === 'rect' || sh.type === 'ellipse')) {
            ev.preventDefault(); startEdit(sh); return
          }
        }
        // Tool shortcuts
        const t = TOOL_KEYS[ev.key.toLowerCase()]
        if (t && !ev.metaKey && !ev.ctrlKey) setTool(t)
      }
    }
    const up = (ev: KeyboardEvent) => {
      shiftRef.current = ev.shiftKey
      if (ev.code === 'Space') {
        isSpaceRef.current = false; setSpacePan(false)
        updateCursor(toolRef.current === 'select' ? 'default' : 'crosshair')
      }
      // Finalize a nudge burst into a single undo step once the arrow key is released
      if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && nudgePreRef.current) {
        historyRef.current = [...historyRef.current, nudgePreRef.current]
        futureRef.current = []; nudgePreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
    }
    const paste = (ev: ClipboardEvent) => {
      if ((ev.target as Element | null)?.closest?.('input, textarea, .cm-editor, [contenteditable="true"]')) return
      pasteSeenRef.current = true
      // Excalidraw puts its scene on the clipboard as JSON text; prefer it over any image.
      const text = ev.clipboardData?.getData('text/plain') ?? ''
      if (text.length > 20 && importExcalidrawText(text, lastMouseWorldRef.current)) { ev.preventDefault(); return }
      if (text && importMermaidText(text, lastMouseWorldRef.current)) { ev.preventDefault(); return }
      const images = [...(ev.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
      if (images.length) { ev.preventDefault(); void addImageFiles(images, lastMouseWorldRef.current); return }
      if (clipboardRef.current?.length) { ev.preventDefault(); pasteClipboard() }
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('paste', paste)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('paste', paste) }
  }, [undo, redo, commit, render, clearSelection, setSelection, updateCursor, groupSelected, ungroupSelected, bringToFront, sendToBack, copySelected, pasteClipboard, addImageFiles, importExcalidrawText, importMermaidText, zoomToFit, resetZoom, toggleMinimap, scheduleSave, startEdit])

  // Sync editingIdRef/editingContainerIdRef so render can skip the shape/text being edited
  useEffect(() => {
    editingIdRef.current          = textInput?.editingId   ?? null
    editingContainerIdRef.current = textInput?.containerId ?? null
    render()
  }, [textInput, render])

  // Focus text input. For contentEditable divs (container/sticky text), .focus()
  // alone doesn't render a visible caret until the user types — a Selection/Range
  // has to be explicitly placed inside, unlike a plain <input>/<textarea>.
  useEffect(() => {
    if (!textInput) return
    // Two nested rAFs instead of setTimeout(0): the element needs a layout pass
    // committed (position/size from the inline styles) before focus+selection are
    // applied, or the browser can register the focus/caret before it has anything
    // laid out to paint against — leaving no visible caret until the next repaint,
    // which normally only happens on the first keystroke.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const el = textRef.current
        if (!el) return
        // Force a synchronous reflow first — WebKit (Tauri's macOS webview) can still
        // register focus/selection against stale layout even after two rAFs without
        // an explicit style read forcing it to catch up.
        void el.offsetHeight
        el.focus()
        if (el instanceof HTMLDivElement) {
          // A genuinely empty contentEditable (new text, no child nodes at all) has
          // no line box for the browser to draw a caret against — a lone zero-width
          // space gives it one without being visible or affecting the real content.
          // Stripped back out in commitText before the value is used.
          if (!el.firstChild) el.appendChild(document.createTextNode('​'))
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      })
      rafIdRef.current = raf2
    })
    rafIdRef.current = raf1
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [textInput])

  // Cursor sync with tool
  useEffect(() => {
    if (!isSpaceRef.current) updateCursor(tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair')
  }, [tool, updateCursor])

  // ── Text commit ──────────────────────────────────────────────────────────────

  const commitText = useCallback(() => {
    if (!textInput || textCommittedRef.current === textInput) return
    textCommittedRef.current = textInput
    const { editingId, containerId, stickyId, isNewSticky } = textInput
    const isDivMode = !!(containerId || stickyId || isNewSticky)
    const rawVal = isDivMode
      ? (textRef.current as HTMLDivElement | null)?.innerText
      : (textRef.current as HTMLTextAreaElement | null)?.value
    // Strip the zero-width space the focus effect seeds into empty contentEditable
    // divs so the browser has a caret to draw — never part of the real content.
    const val = rawVal?.replace(/​/g, '').trim()
    setTextInput(null)
    // Drop any live auto-grow applied while typing; the final size is recomputed below as one clean undo step
    if (editPreRef.current) { shapesRef.current = editPreRef.current; editPreRef.current = null }
    // Placing/editing text is a one-shot action: go back to select, like Excalidraw
    setTool('select'); toolRef.current = 'select'
    const size = fontSizeRef.current
    if (stickyId || isNewSticky) {
      if (!val) {
        // Empty edit of an existing sticky → delete it; empty new sticky → discard
        if (stickyId) commit(shapesRef.current.filter(s => s.id !== stickyId))
        return
      }
      const existing = stickyId ? shapesRef.current.find(s => s.id === stickyId) as StickyShape | undefined : undefined
      const w = existing?.w ?? STICKY_DEFAULT_W
      let neededH = existing?.h ?? STICKY_DEFAULT_H
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.font = `13px ${FONT_HAND}`
        const lines = wrapCanvasText(ctx, val, Math.max(w - 16, 10))
        ctx.restore()
        neededH = Math.max(neededH, lines.length * 13 * 1.3 + 16)
      }
      if (stickyId) {
        commit(shapesRef.current.map(s => s.id === stickyId ? { ...s, text: val, h: neededH } as Shape : s))
      } else {
        const id = uid()
        commit([...shapesRef.current, {
          id, type: 'sticky',
          x: textInput.wx, y: textInput.wy,
          w: STICKY_DEFAULT_W, h: neededH,
          text: val, color: DEFAULT_STICKY_COLOR, fill: 'none', width: 1,
        } as StickyShape])
        setSelection(new Set([id]))
      }
      return
    }
    if (containerId && shapesRef.current.find(s => s.id === containerId)?.type === 'arrow') {
      commit(shapesRef.current.map(s => {
        if (s.id !== containerId || s.type !== 'arrow') return s
        if (!val) { const { label: _l, ...rest } = s; void _l; return rest as Shape }
        const label: BoundText = { text: val, size, fontFamily: fontFamilyRef.current, bold: boldRef.current, italic: italicRef.current, color: s.color }
        return { ...s, label }
      }))
      return
    }
    if (containerId) {
      if (!val) {
        // Empty → strip bound text from the container
        commit(shapesRef.current.map(s => {
          if (s.id !== containerId || (s.type !== 'rect' && s.type !== 'ellipse')) return s
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { boundText: _bt, ...rest } = s
          return rest as Shape
        }))
      } else {
        commit(shapesRef.current.map(s => {
          if (s.id !== containerId || (s.type !== 'rect' && s.type !== 'ellipse')) return s
          const boundText: BoundText = {
            text: val, size, fontFamily: fontFamilyRef.current,
            bold: boldRef.current, italic: italicRef.current, color: colorRef.current,
            ...(textAlignRef.current !== 'center' ? { align: textAlignRef.current } : {}),
          }
          return fitContainer({ ...s, boundText } as RectShape | EllipseShape)
        }))
      }
      // The selection didn't change, so refresh whether it now carries text (shows the text controls).
      if (selectedIdsRef.current.has(containerId)) setSelectionHasBoundText(!!val)
      return
    }
    if (editingId) {
      // Editing an existing shape
      if (!val) {
        // Empty → delete the shape
        commit(shapesRef.current.filter(s => s.id !== editingId))
      } else {
        commit(shapesRef.current.map(s =>
          s.id === editingId
            ? { ...s, text: val, size, fontFamily: fontFamilyRef.current, bold: boldRef.current, italic: italicRef.current, color: colorRef.current, align: textAlignRef.current } as Shape
            : s
        ))
      }
    } else {
      // Creating a new shape
      if (!val) return
      const id = uid()
      commit([...shapesRef.current, {
        id, type: 'text',
        x: textInput.wx, y: textInput.wy + size,
        text: val, size, fontFamily: fontFamilyRef.current,
        bold: boldRef.current, italic: italicRef.current, align: textAlignRef.current,
        color: colorRef.current, fill: 'none', width: 1,
      } as TextShape])
      setSelection(new Set([id]))
    }
  }, [textInput, commit, setSelection])

  useEffect(() => { textInputRef.current = textInput; commitTextRef.current = commitText }, [textInput, commitText])

  // ── Toolbar handlers ─────────────────────────────────────────────────────────

  const applyToSelected = useCallback((patch: Partial<Shape>) => {
    if (selectedIdsRef.current.size === 0) return
    commit(shapesRef.current.map(s =>
      selectedIdsRef.current.has(s.id) ? { ...s, ...patch } as Shape : s
    ))
  }, [commit])

  // Font patches: TextShapes get top-level fields; rect/ellipse containers with
  // bound text get their boundText sub-object patched instead (top-level
  // fontFamily/size/bold/italic don't mean anything on those shapes).
  const applyFontPatch = useCallback((patch: Partial<Pick<BoundText, 'size' | 'fontFamily' | 'bold' | 'italic' | 'align'>>) => {
    if (selectedIdsRef.current.size === 0) return
    commit(shapesRef.current.map(s => {
      if (!selectedIdsRef.current.has(s.id)) return s
      if (s.type === 'text') return { ...s, ...patch } as Shape
      if ((s.type === 'rect' || s.type === 'ellipse') && s.boundText) return { ...s, boundText: { ...s.boundText, ...patch } } as Shape
      return s
    }))
  }, [commit])

  const handleColor      = useCallback((c: string) => { setColor(c); colorRef.current = c; if (fillRef.current !== 'none') { const t = c + '28'; setFill(t); fillRef.current = t }; applyToSelected({ color: c }) }, [applyToSelected])
  const handleFill       = useCallback((f: string) => { setFill(f); fillRef.current = f; applyToSelected({ fill: f }) }, [applyToSelected])
  const handleWidth      = useCallback((w: number) => { setStrokeWidth(w); widthRef.current = w; applyToSelected({ width: w }) }, [applyToSelected])
  const handleRadius     = useCallback((r: number) => { setRadius(r); radiusRef.current = r; applyToSelected({ radius: r } as Partial<RectShape>) }, [applyToSelected])
  const handleFontSize   = useCallback((s: number) => { setFontSize(s); fontSizeRef.current = s; applyFontPatch({ size: s }) }, [applyFontPatch])
  const handleFontFamily = useCallback((f: string) => { setFontFamily(f); fontFamilyRef.current = f; applyFontPatch({ fontFamily: f }) }, [applyFontPatch])
  const handleBold       = useCallback((b: boolean) => { setBold(b); boldRef.current = b; applyFontPatch({ bold: b }) }, [applyFontPatch])
  const handleItalic     = useCallback((i: boolean) => { setItalic(i); italicRef.current = i; applyFontPatch({ italic: i }) }, [applyFontPatch])
  const handleTextAlign  = useCallback((a: TextAlign) => { setTextAlign(a); textAlignRef.current = a; applyFontPatch({ align: a }) }, [applyFontPatch])

  const setDrawingsVisible = (v: boolean) => {
    setShowDrawings(v)
    try { localStorage.setItem('inkwell-drawings-panel', String(v)) } catch { /* ignore */ }
  }
  const setDrawingsLayoutPersist = (l: 'sidebar' | 'tabs') => {
    setDrawingsLayout(l)
    try { localStorage.setItem('inkwell-drawings-layout', l) } catch { /* ignore */ }
  }
  const exportDrawing = (id: string) => {
    if (id === useDrawingsStore.getState().activeId && loadedIdRef.current === id) setShowExport(true)
    else exportAfterLoadRef.current = id
  }

  // ── JSX ──────────────────────────────────────────────────────────────────────

  if (!vaultPath) return (
    <div className="flex-1 h-full flex items-center justify-center text-muted-foreground text-sm">
      Open a vault first.
    </div>
  )

  const selShapesForToolbar = [...selectedIds].map(id => shapesRef.current.find(s => s.id === id)).filter(Boolean) as Shape[]
  const canAddNote       = selShapesForToolbar.length > 0
  const hasNoteOnSelection = selShapesForToolbar.some(s => s.note)
  const canPromoteSticky = selShapesForToolbar.length === 1 && selShapesForToolbar[0].type === 'sticky' && !selShapesForToolbar[0].note

  const editingArrowLabel = !!textInput?.containerId && shapesRef.current.find(s => s.id === textInput.containerId)?.type === 'arrow'

  const notesPanelTitle = notesTarget === 'global'
    ? 'Diagram Notes'
    : notesTarget.kind === 'shape'
      ? `Note — ${(() => { const s = shapesRef.current.find(sh => sh.id === notesTarget.id); return s ? shapeLabel(s) : 'Shape' })()}`
      : `Note — Group (${shapesRef.current.filter(s => s.groupId === notesTarget.groupId).length} shapes)`

  return (
    <div
      className={cn('flex-1 overflow-hidden flex flex-row', bodyGlass ? 'glass-card' : 'h-full')}
      style={bodyGlass ? glassBg('background', glassOpacity, theme, 'card') : undefined}
    >

      {showDrawings && drawingsLayout === 'sidebar' && (
        <DrawingsPanel onExport={exportDrawing} onTabs={() => setDrawingsLayoutPersist('tabs')} onHide={() => setDrawingsVisible(false)} />
      )}

      {/* ── Canvas area ── */}
      <div ref={containerRef} className="relative h-full overflow-hidden flex-1">
        {/* Window drag strip — sits above canvas (z-10) but below toolbar buttons (z-20) */}
        <div className="absolute top-0 left-0 right-0 h-8 z-10" data-tauri-drag-region />

        {showDrawings && drawingsLayout === 'tabs' && (
          <DrawingsTabs onExport={exportDrawing} onSidebar={() => setDrawingsLayoutPersist('sidebar')} onHide={() => setDrawingsVisible(false)} />
        )}

        {importError && (
          <div
            role="alert"
            onClick={() => setImportError(null)}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-30 max-w-md px-3 py-2 rounded-lg border border-border bg-surface shadow-lg text-xs text-foreground cursor-pointer"
          >
            <span className="font-semibold">Couldn’t read that Mermaid diagram.</span>
            <span className="block mt-0.5 text-muted-foreground whitespace-pre-wrap line-clamp-3">{importError}</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ cursor: spacePan ? 'grab' : cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
        />

        <CanvasToolbar
          tool={tool} color={color} fill={fill} strokeWidth={strokeWidth}
          zoom={zoom} canUndo={canUndo} canRedo={canRedo}
          radius={radius} fontSize={fontSize} fontFamily={fontFamily} bold={bold} italic={italic} textAlign={textAlign}
          selectedShapeType={selectedShapeType}
          hasBoundText={selectionHasBoundText || !!textInput?.containerId}
          onTool={setTool} onColor={handleColor} onFill={handleFill} onWidth={handleWidth}
          onRadius={handleRadius} onFontSize={handleFontSize} onFontFamily={handleFontFamily}
          onBold={handleBold} onItalic={handleItalic} onTextAlign={handleTextAlign}
          onUndo={undo} onRedo={redo} onZoom={handleZoom}
          onZoomFit={() => zoomToFit()} onZoomReset={resetZoom}
          onTemplates={() => setShowTemplates(v => !v)}
          onImage={() => imageInputRef.current?.click()}
          showTemplates={showTemplates}
          sketchy={sketchy} onSketchy={() => setSketchy(v => !v)}
          showGrid={showGrid} onToggleGrid={() => setShowGrid(v => !v)}
          showMinimap={showMinimap} onToggleMinimap={toggleMinimap}
          showDrawings={showDrawings}
          onToggleDrawings={() => setDrawingsVisible(!showDrawings)}
          onExport={() => setShowExport(true)}
          canAddNote={canAddNote} hasNote={hasNoteOnSelection} canPromoteSticky={canPromoteSticky}
          onAddNote={addNoteToSelection} onPromoteSticky={promoteStickyToNote}
        />

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*,.excalidraw,.json,.mmd,.mermaid"
          multiple
          className="hidden"
          onChange={e => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void addFiles(files)
          }}
        />

        {showExport && (
          <CanvasExportDialog
            title={activeDrawing?.title ?? 'drawing'}
            shapes={shapesRef.current}
            selected={selShapesForToolbar}
            appIsDark={theme === 'dark'}
            initialSketchy={sketchy}
            paint={paintForExport}
            preload={preloadImages}
            onClose={() => setShowExport(false)}
          />
        )}

        {/* Template picker */}
        {showTemplates && (
          <CanvasTemplatesPicker
            onSelect={loadTemplate}
            onClose={() => setShowTemplates(false)}
          />
        )}

        {/* Category element panel */}
        {categoryPanel && !showTemplates && (
          <CanvasCategoryPanel
            category={categoryPanel}
            onAdd={addCanvasShapes}
            onClose={() => setCategoryPanel(null)}
          />
        )}

        {/* Shortcuts dropdown — top-right, next to the notes button */}
        <button
          onClick={() => setShowShortcuts(v => !v)}
          title="Keyboard shortcuts"
          className={`absolute top-3 right-14 z-20 w-8 h-8 flex items-center justify-center rounded-lg border transition-colors shadow-sm ${
            showShortcuts
              ? 'bg-accent text-white border-accent'
              : 'bg-surface border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Keyboard size={14} />
        </button>
        {showShortcuts && <ShortcutsPanel onClose={() => setShowShortcuts(false)} />}

        {/* Notes toggle button — top-right of canvas area */}
        <button
          onClick={() => { setNotesTarget('global'); setShowNotes(v => !v) }}
          title="Toggle diagram notes (⌘/)"
          className={`absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center rounded-lg border transition-colors shadow-sm ${
            showNotes
              ? 'bg-accent text-white border-accent'
              : 'bg-surface border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <StickyNote size={14} />
        </button>

        <CanvasMinimap
          open={showMinimap}
          raised={canvasNarrow}
          onToggle={toggleMinimap}
          getView={getMinimapView}
          onCenter={centerViewOn}
          drawRef={minimapDrawRef}
        />

        {/* Text input overlay */}
        {textInput && textInput.containerId ? (
          // contentEditable (not textarea) so flexbox can center the text both
          // horizontally and vertically inside the shape while typing.
          <div
            ref={textRef as React.RefObject<HTMLDivElement>}
            contentEditable
            suppressContentEditableWarning
            className={cn(
              'absolute bg-transparent outline-none pointer-events-auto overflow-hidden flex items-center',
              editingArrowLabel || textAlign === 'center' ? 'justify-center text-center'
                : textAlign === 'right' ? 'justify-end text-right' : 'justify-start text-left',
            )}
            style={{
              left: textInput.sx, top: textInput.sy,
              width: textInput.boxW, height: textInput.boxH,
              padding: 0, boxSizing: 'border-box',
              fontSize: fontSize * zoom, fontFamily, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal',
              color, caretColor: color, zIndex: 50, lineHeight: 1.25,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            onInput={onEditorInput}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitText() }
              if (e.key === 'Escape') { e.preventDefault(); commitText() }
            }}
            onBlur={commitText}
          >
            {textInput.initialValue ?? ''}
          </div>
        ) : textInput && (textInput.stickyId || textInput.isNewSticky) ? (
          <div
            ref={textRef as React.RefObject<HTMLDivElement>}
            contentEditable
            suppressContentEditableWarning
            className="absolute outline-none pointer-events-auto overflow-hidden rounded-md"
            style={{
              left: textInput.sx, top: textInput.sy,
              width: textInput.boxW, height: textInput.boxH,
              padding: 8 * zoom, boxSizing: 'border-box',
              fontSize: 13 * zoom, fontFamily: FONT_HAND,
              color: STICKY_TEXT_COLOR, caretColor: STICKY_TEXT_COLOR, zIndex: 50, lineHeight: 1.3,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: textInput.stickyId
                ? (shapesRef.current.find(s => s.id === textInput.stickyId) as StickyShape | undefined)?.color ?? DEFAULT_STICKY_COLOR
                : DEFAULT_STICKY_COLOR,
            }}
            onInput={onEditorInput}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitText() }
              if (e.key === 'Escape') { e.preventDefault(); commitText() }
            }}
            onBlur={commitText}
          >
            {textInput.initialValue ?? ''}
          </div>
        ) : null}
        {frameEdit && (
          <input
            autoFocus
            className="absolute bg-background/90 outline-none pointer-events-auto rounded px-1 border border-accent/50 text-foreground"
            style={{ left: frameEdit.sx - 2, top: frameEdit.sy - 2, width: frameEdit.w, fontSize: frameEdit.fontPx, fontWeight: 500, zIndex: 50 }}
            defaultValue={frameEdit.value}
            onFocus={e => e.currentTarget.select()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); commitFrameTitle(e.currentTarget.value) }
              if (e.key === 'Escape') { e.preventDefault(); commitFrameTitle(null) }
            }}
            onBlur={e => commitFrameTitle(e.currentTarget.value)}
          />
        )}
        {!textInput?.containerId && !(textInput?.stickyId || textInput?.isNewSticky) && textInput && (
          // Textarea so text can span lines: Enter commits, Shift+Enter adds a line.
          <textarea
            ref={textRef as React.RefObject<HTMLTextAreaElement>}
            className="absolute bg-transparent outline-none pointer-events-auto resize-none overflow-hidden p-0 border-0"
            rows={1}
            wrap="off"
            style={{
              left: textInput.sx, top: textInput.sy - Math.min(fontSize, 32),
              fontSize: Math.min(Math.max(14, fontSize), 32), lineHeight: TEXT_LINE_HEIGHT,
              fontFamily, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal',
              textAlign, color, caretColor: color, minWidth: 80, zIndex: 50,
            }}
            defaultValue={textInput?.initialValue ?? ''}
            onFocus={e => autosizeTextarea(e.currentTarget)}
            onInput={e => autosizeTextarea(e.currentTarget)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() }
              if (e.key === 'Escape') { e.preventDefault(); commitText() }
            }}
            onBlur={commitText}
          />
        )}
      </div>

      {/* ── Notes sheet — slides in from right, drag its left edge to resize ── */}
      <div
        className={cn('relative h-full overflow-hidden shrink-0', !notesResizing && 'transition-[width] duration-300 ease-out')}
        style={{ width: showNotes ? notesWidth : 0 }}
      >
        {showNotes && (
          <div
            onMouseDown={startNotesResize}
            onDoubleClick={() => setNotesWidthPersist(NOTES_DEFAULT_W)}
            title="Drag to resize · double-click to reset"
            className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 z-10 cursor-col-resize hover:bg-accent/40 transition-colors"
          />
        )}
        {/* Keep mounted so CodeMirror state isn't lost when toggling */}
        <div className="h-full" style={{ width: notesWidth, visibility: showNotes ? 'visible' : 'hidden' }}>
          <CanvasNotesSheet
            open={showNotes}
            title={notesPanelTitle}
            content={notesTarget === 'global' ? notesContent : shapeNoteDraft}
            onChange={notesTarget === 'global' ? handleNotesChange : handleShapeNoteChange}
            onClose={() => { setShowNotes(false); setNotesTarget('global') }}
          />
        </div>
      </div>

    </div>
  )
}
