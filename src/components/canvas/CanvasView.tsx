import { useEffect, useRef, useState, useCallback } from 'react'
import { StickyNote, Keyboard, X } from 'lucide-react'
import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import type { Drawable } from 'roughjs/bin/core'
import { useAppStore } from '../../store/useAppStore'
import { CanvasToolbar, FONT_HAND } from './CanvasToolbar'
import { CanvasNotesSheet } from './CanvasNotesSheet'
import { CanvasTemplatesPicker } from './CanvasTemplatesPicker'
import { CanvasCategoryPanel } from './CanvasCategoryPanel'
import type { DiagramTemplate, TemplateCategory } from './canvasTemplates'
import { uid, hitTest, hitTopmost, shapeBounds, recolorTemplateShapes, unrotatePoint } from './canvasTypes'
import type { Shape, Tool, Point, PathShape, RectShape, EllipseShape, LineShape, ArrowShape, TextShape, BoundText, StickyShape } from './canvasTypes'

// ── Types ──────────────────────────────────────────────────────────────────────

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br'
type NotesTarget = 'global' | { kind: 'shape'; id: string } | { kind: 'group'; groupId: string }

// ── Pure helpers ───────────────────────────────────────────────────────────────

function getCSSColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw ? `hsl(${raw})` : fallback
}

// ── Theme-adaptive ink ─────────────────────────────────────────────────────────
// Shapes keep whatever colour they were saved with, but a near-neutral colour
// that would vanish against the current canvas (near-white on the light theme,
// near-black on the dark one) is swapped for the theme's ink at draw time only.
// Saved data is never rewritten, so the same drawing reads well in both themes.

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function adaptInk(c: string, darkBg: boolean, ink: string): string {
  const rgb = parseHex(c)
  if (!rgb) return c
  const [r, g, b] = rgb
  if (Math.max(r, g, b) - Math.min(r, g, b) > 48) return c // clearly coloured: legible on both
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (darkBg ? lum < 0.28 : lum > 0.72) return ink
  return c
}

function adaptShape(sh: Shape, darkBg: boolean, ink: string): Shape {
  if (sh.type === 'sticky') return sh // pastel notes carry their own fixed dark text
  const color = adaptInk(sh.color, darkBg, ink)
  const fill = sh.fill === 'none' ? sh.fill : adaptInk(sh.fill, darkBg, ink)
  let boundText: BoundText | undefined
  if ((sh.type === 'rect' || sh.type === 'ellipse') && sh.boundText) {
    const bc = adaptInk(sh.boundText.color, darkBg, ink)
    if (bc !== sh.boundText.color) boundText = { ...sh.boundText, color: bc }
  }
  if (color === sh.color && fill === sh.fill && !boundText) return sh
  return { ...sh, color, fill, ...(boundText ? { boundText } : {}) } as Shape
}

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

function ctxFont(t: TextShape): string {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.fontFamily ?? FONT_HAND}`
}

/** Stable small int from a shape id, used as roughjs's seed so jitter doesn't reshuffle every re-render */
function seedFromId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % 2 ** 31 || 1
}

function roughOptions(s: Shape) {
  return {
    stroke: s.color,
    strokeWidth: s.width,
    fill: s.fill === 'none' ? undefined : s.fill,
    fillStyle: 'hachure' as const,
    roughness: 1,
    seed: seedFromId(s.id),
    // A single clean stroke per edge — roughjs's default second overlapping
    // pass is what creates the gap/overshoot look at corners.
    disableMultiStroke: true,
    disableMultiStrokeFill: true,
  }
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

const STICKY_TEXT_COLOR    = '#1e293b'
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
      if (useRough) {
        cachedRoughDraw(rc, roughCache, s, () => [rc.generator.rectangle(r.x, r.y, r.w, r.h, roughOptions(s))])
        break
      }
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.radius ?? 3)
      if (s.fill !== 'none') ctx.fill(); ctx.stroke(); break
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
      // Tangent at endpoint = direction from CP → endpoint
      const angle = Math.atan2(a.y2 - cpy, a.x2 - cpx)
      const H = Math.max(14, a.width * 5)
      const headP1: [number, number] = [a.x2 - H * Math.cos(angle - Math.PI / 7), a.y2 - H * Math.sin(angle - Math.PI / 7)]
      const headP2: [number, number] = [a.x2 - H * Math.cos(angle + Math.PI / 7), a.y2 - H * Math.sin(angle + Math.PI / 7)]
      // Open "V" head like Excalidraw: shaft runs to the tip, two strokes form the head
      if (useRough) {
        cachedRoughDraw(rc, roughCache, s, () => [
          rc.generator.path(`M ${a.x1} ${a.y1} Q ${cpx} ${cpy}, ${a.x2} ${a.y2}`, { ...roughOptions(s), fill: undefined }),
          rc.generator.linearPath([headP1, [a.x2, a.y2], headP2], { ...roughOptions(s), fill: undefined }),
        ])
        break
      }
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1)
      ctx.quadraticCurveTo(cpx, cpy, a.x2, a.y2)
      ctx.moveTo(headP1[0], headP1[1]); ctx.lineTo(a.x2, a.y2); ctx.lineTo(headP2[0], headP2[1])
      ctx.stroke(); break
    }
    case 'text': {
      const t = s as TextShape; ctx.font = ctxFont(t); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); break
    }
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

/** Word-wrap (paragraph-aware) text to fit within maxWidth, using ctx's current font. Words wider than maxWidth are broken by character. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const breakWord = (word: string): string => {
    let chunk = ''
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) { lines.push(chunk); chunk = ch }
      else chunk += ch
    }
    return chunk
  }
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue }
    let cur = ''
    for (const w of paragraph.split(' ')) {
      const test = cur ? cur + ' ' + w : w
      if (ctx.measureText(test).width <= maxWidth) { cur = test; continue }
      if (cur) lines.push(cur)
      cur = ctx.measureText(w).width > maxWidth ? breakWord(w) : w
    }
    if (cur) lines.push(cur)
  }
  return lines
}

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!
  return measureCtx
}

const TEXT_PAD = 8
// An ellipse's text lives in the rectangle inscribed in it (~1/√2 of each axis), not its full bounding box
const ELLIPSE_TEXT_RATIO = 0.72
const BOUND_LINE_HEIGHT = 1.25

function boundFont(bt: BoundText): string {
  return `${bt.italic ? 'italic ' : ''}${bt.bold ? 'bold ' : ''}${bt.size}px ${bt.fontFamily}`
}

/** World-space rect that a rect/ellipse's label must stay inside */
function containerTextBox(s: RectShape | EllipseShape) {
  const b = shapeBounds(s)
  if (s.type === 'ellipse') {
    const w = b.w * ELLIPSE_TEXT_RATIO, h = b.h * ELLIPSE_TEXT_RATIO
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }
  }
  return { x: b.x + TEXT_PAD, y: b.y + TEXT_PAD, w: Math.max(b.w - TEXT_PAD * 2, 10), h: Math.max(b.h - TEXT_PAD * 2, 10) }
}

/** Shape height needed so `bt.text`, wrapped to width `w`, fits inside the container */
function containerNeededH(s: RectShape | EllipseShape, bt: BoundText, w: number): number {
  const ctx = getMeasureCtx()
  ctx.save(); ctx.font = boundFont(bt)
  const innerW = s.type === 'ellipse' ? w * ELLIPSE_TEXT_RATIO : w - TEXT_PAD * 2
  const lines = wrapCanvasText(ctx, bt.text, Math.max(innerW, 10))
  ctx.restore()
  const textH = lines.length * bt.size * BOUND_LINE_HEIGHT
  return s.type === 'ellipse' ? textH / ELLIPSE_TEXT_RATIO + 4 : textH + TEXT_PAD * 2
}

/** Grow a labeled rect/ellipse just enough that its text never spills out of it */
function fitContainer(s: Shape): Shape {
  if ((s.type !== 'rect' && s.type !== 'ellipse') || !s.boundText) return s
  const b = shapeBounds(s)
  const needed = containerNeededH(s, s.boundText, b.w)
  return needed > b.h ? applyBoundsToShape(s, { ...b, h: needed }) : s
}

/** Text bound to a rect/ellipse container: centered, wrapped inside the container's text box */
function drawBoundText(ctx: CanvasRenderingContext2D, s: RectShape | EllipseShape) {
  const bt = s.boundText
  if (!bt) return
  const box = containerTextBox(s)
  ctx.save()
  ctx.font = boundFont(bt)
  ctx.fillStyle = bt.color
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const lines  = wrapCanvasText(ctx, bt.text, box.w)
  const lineH  = bt.size * BOUND_LINE_HEIGHT
  let y = box.y + box.h / 2 - (lines.length * lineH) / 2 + lineH / 2
  for (const line of lines) { ctx.fillText(line, box.x + box.w / 2, y); y += lineH }
  ctx.restore()
}

const SHAPE_TYPE_LABELS: Record<Shape['type'], string> = {
  path: 'Path', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', text: 'Text', sticky: 'Sticky note',
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

// ── Disk I/O ───────────────────────────────────────────────────────────────────
// Canvas data is stored globally (~/.inkwell/canvas.json) by default, independent
// of whichever vault happens to be open. If the user links the canvas to a
// specific vault (linkedVaultPath), it's stored at
// {linkedVaultPath}/.inkwell/canvas.json instead, regardless of the open vault.

const canvasPath = (vp: string) => `${vp}/.inkwell/canvas.json`

async function loadCanvas(linkedVaultPath: string | null): Promise<Shape[]> {
  if (!linkedVaultPath) {
    const { readGlobalCanvasFile } = await import('../../lib/vault')
    return (await readGlobalCanvasFile()) as Shape[]
  }
  try { return JSON.parse(await (await import('@tauri-apps/plugin-fs')).readTextFile(canvasPath(linkedVaultPath))) }
  catch { return [] }
}
async function saveCanvas(linkedVaultPath: string | null, shapes: Shape[]) {
  if (!linkedVaultPath) {
    const { writeGlobalCanvasFile } = await import('../../lib/vault')
    return writeGlobalCanvasFile(shapes)
  }
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    await mkdir(`${linkedVaultPath}/.inkwell`, { recursive: true })
    await writeTextFile(canvasPath(linkedVaultPath), JSON.stringify(shapes))
  } catch (e) { console.error('[canvas] save failed:', e) }
}

// ── CanvasView ─────────────────────────────────────────────────────────────────

// Default ink color must contrast with the canvas background, which follows the
// app theme — near-white ink is invisible on the light theme's white canvas.
const DEFAULT_COLOR_DARK  = '#f3ede2'
const DEFAULT_COLOR_LIGHT = '#1e1b18'
const DEFAULT_WIDTH  = 2
const DEFAULT_RADIUS = 8

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'], ['P', 'Pen'], ['R', 'Rectangle'], ['E', 'Ellipse'],
      ['L', 'Line'], ['A', 'Arrow'], ['T', 'Text'], ['Esc', 'Back to select'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Space + drag', 'Pan'], ['⌘/Ctrl + scroll', 'Zoom'],
      ['⇧1', 'Zoom to fit all'], ['⇧2', 'Zoom to fit selection'], ['⇧0', 'Reset zoom'],
      ['Double-click', 'Edit text (standalone or inside a shape)'],
    ],
  },
  {
    title: 'Selection',
    items: [
      ['⌘/Ctrl + A', 'Select all'], ['⇧ + click', 'Add/remove from selection'],
      ['Delete / Backspace', 'Delete selected'], ['Arrow keys', 'Nudge (⇧ for 10px)'],
      ['⌘/Ctrl + D', 'Duplicate'], ['⌘/Ctrl + C / X / V', 'Copy / cut / paste'],
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

export function CanvasView() {
  const { vaultPath, theme, canvasLinkedVaultPath } = useAppStore()
  const defaultColor = theme === 'light' ? DEFAULT_COLOR_LIGHT : DEFAULT_COLOR_DARK

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef      = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>(null)
  const rafIdRef      = useRef<number | null>(null)

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
  const [zoom,              setZoomState]         = useState(1)
  const [canUndo,           setCanUndo]           = useState(false)
  const [canRedo,           setCanRedo]           = useState(false)
  // Multi-selection: a Set of shape ids
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [selectedShapeType, setSelectedShapeType] = useState<string | null>(null)
  const [selectionHasBoundText, setSelectionHasBoundText] = useState(false)
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
  const [showGrid,          setShowGrid]          = useState(true)
  const [showShortcuts,     setShowShortcuts]     = useState(false)

  // ── Canvas content refs ──────────────────────────────────────────────────────
  const shapesRef       = useRef<Shape[]>([])
  const sketchyRef       = useRef(true)
  const showGridRef      = useRef(true)
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
    }
    if ((shape.type === 'rect' || shape.type === 'ellipse') && shape.boundText) {
      const bt = shape.boundText
      setSelectionHasBoundText(true)
      setFontSize(bt.size);       fontSizeRef.current   = bt.size
      setFontFamily(bt.fontFamily); fontFamilyRef.current = bt.fontFamily
      setBold(bt.bold);           boldRef.current       = bt.bold
      setItalic(bt.italic);       italicRef.current     = bt.italic
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
    ctx.fillStyle = getCSSColor('--background', '#111')
    ctx.fillRect(0, 0, cssW, cssH)
    if (showGridRef.current) drawDotGrid(ctx, cssW, cssH, panRef.current, zoomRef.current)

    if (!roughCanvasRef.current) roughCanvasRef.current = rough.canvas(canvas)
    const rc = roughCanvasRef.current

    ctx.save()
    ctx.translate(panRef.current.x, panRef.current.y)
    ctx.scale(zoomRef.current, zoomRef.current)

    const darkBg = useAppStore.getState().theme === 'dark'
    const ink = darkBg ? DEFAULT_COLOR_DARK : DEFAULT_COLOR_LIGHT
    for (const raw of shapesRef.current) {
      if (editingIdRef.current && raw.id === editingIdRef.current) continue
      const s = adaptShape(raw, darkBg, ink)
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

    // Selection overlay
    const selShapes = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
    if (selShapes.length === 1) {
      drawSingleSelection(ctx, selShapes[0], zoomRef.current)
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
  }, [])

  useEffect(() => { render() }, [theme, render])
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
      render()
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [render])

  // ── Load / save ──────────────────────────────────────────────────────────────

  useEffect(() => {
    loadCanvas(canvasLinkedVaultPath).then(shapes => {
      shapesRef.current = shapes; historyRef.current = []; futureRef.current = []
      clearSelection(); setCanUndo(false); setCanRedo(false); render()
    })
  }, [canvasLinkedVaultPath, render, clearSelection])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveCanvas(canvasLinkedVaultPath, shapesRef.current), 1000)
  }, [canvasLinkedVaultPath])

  // ── Notes load / save ────────────────────────────────────────────────────────
  // Same global-by-default / linked-vault-if-set model as the canvas shapes above.

  useEffect(() => {
    if (canvasLinkedVaultPath) {
      import('@tauri-apps/plugin-fs').then(({ readTextFile }) =>
        readTextFile(`${canvasLinkedVaultPath}/.inkwell/canvas-notes.md`).then(setNotesContent).catch(() => setNotesContent(''))
      )
    } else {
      import('../../lib/vault').then(({ readGlobalCanvasNotes }) =>
        readGlobalCanvasNotes().then(setNotesContent)
      )
    }
  }, [canvasLinkedVaultPath])

  const handleNotesChange = useCallback((text: string) => {
    setNotesContent(text)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      if (canvasLinkedVaultPath) {
        const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
        await mkdir(`${canvasLinkedVaultPath}/.inkwell`, { recursive: true })
        await writeTextFile(`${canvasLinkedVaultPath}/.inkwell/canvas-notes.md`, text)
      } else {
        const { writeGlobalCanvasNotes } = await import('../../lib/vault')
        await writeGlobalCanvasNotes(text)
      }
    }, 600)
  }, [canvasLinkedVaultPath])

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
      case 'ellipse': drawingRef.current = { ...base, type: 'ellipse', cx: wp.x, cy: wp.y, rx: 0, ry: 0 }; break
      case 'line':    drawingRef.current = { ...base, type: 'line',    x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }; break
      case 'arrow':   drawingRef.current = { ...base, type: 'arrow',   x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }; break
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
        s.id === bid && s.type === 'arrow' ? { ...s, cpx: wp.x, cpy: wp.y } as Shape : s
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
      const ids = selectedIdsRef.current
      guidesRef.current = []
      if (!e.altKey) {
        const snapped = snapDrag(unionBounds(pre.filter(s => ids.has(s.id))), pre.filter(s => !ids.has(s.id)), dx, dy, 6 / zoomRef.current)
        dx = snapped.dx; dy = snapped.dy; guidesRef.current = snapped.guides
      }
      shapesRef.current = pre.map(s => ids.has(s.id) ? offsetShape(s, dx, dy) as Shape : s)
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
          break
        }
      }
      render(); return
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
      if (shape.type === 'rect')         final = { ...shape, x: c.x - 70, y: c.y - 45, w: 140, h: 90 }
      else if (shape.type === 'ellipse') final = { ...shape, cx: c.x, cy: c.y, rx: 70, ry: 45 }
      else { render(); return }
    }
    commit([...shapesRef.current, final])
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
    if (shape.type === 'rect' || shape.type === 'ellipse') {
      const bt = shape.boundText
      setFontSize(bt?.size ?? 16);                fontSizeRef.current   = bt?.size ?? 16
      setFontFamily(bt?.fontFamily ?? FONT_HAND); fontFamilyRef.current = bt?.fontFamily ?? FONT_HAND
      setBold(bt?.bold ?? false);                 boldRef.current       = bt?.bold ?? false
      setItalic(bt?.italic ?? false);             italicRef.current     = bt?.italic ?? false
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

  // ── Double-click: edit text / labels, straighten arrows, or drop new text ────

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const wp = toWorld(e)

    // Double-click a bent arrow → straighten it
    const hitArrow = [...shapesRef.current].reverse().find(
      s => s.type === 'arrow' && (s as ArrowShape).cpx !== undefined && hitTest(s, wp.x, wp.y)
    ) as ArrowShape | undefined
    if (hitArrow) {
      e.preventDefault()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cpx: _cx, cpy: _cy, ...rest } = hitArrow
      commit(shapesRef.current.map(s => s.id === hitArrow.id ? rest as Shape : s))
      return
    }

    const hit = hitTopmost(shapesRef.current, wp.x, wp.y)
    if (hit && (hit.type === 'text' || hit.type === 'sticky' || hit.type === 'rect' || hit.type === 'ellipse')) {
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
  }, [toWorld, setSelection, startEdit, commit])

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
  const zoomToFit = useCallback((shapes?: Shape[]) => {
    const targets = shapes ?? shapesRef.current
    if (!targets.length) return
    const canvas = canvasRef.current!, DPR = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    const b = unionBounds(targets), pad = 80
    const newZoom = Math.max(0.1, Math.min((cssW - pad * 2) / b.w, (cssH - pad * 2) / b.h, 3))
    zoomRef.current = newZoom; setZoomState(newZoom)
    panRef.current = { x: cssW / 2 - (b.x + b.w / 2) * newZoom, y: cssH / 2 - (b.y + b.h / 2) * newZoom }
    render()
  }, [render])

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
    const copies = offsetShapes(clipboardRef.current.map(s => ({ ...s, id: uid() })), dx, dy)
    commit([...shapesRef.current, ...copies])
    setSelection(new Set(copies.map(c => c.id)))
  }, [commit, setSelection])

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pen', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', t: 'text', s: 'sticky' }
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
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.key === 'v') { ev.preventDefault(); pasteClipboard() }

      // Zoom: Shift+1 fit all, Shift+2 fit selection, Shift+0 reset to 100%
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '1') { ev.preventDefault(); zoomToFit() }
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '2') {
        ev.preventDefault()
        const sel = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
        zoomToFit(sel.length ? sel : undefined)
      }
      if (!inInput && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && ev.key === '0') { ev.preventDefault(); resetZoom() }

      // Arrow-key nudge (coalesced into one undo step per burst, finalized on keyup)
      if (!inInput && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && selectedIdsRef.current.size > 0) {
        ev.preventDefault()
        const step = ev.shiftKey ? 10 : 1
        const [dx, dy] = ev.key === 'ArrowUp'   ? [0, -step]
                       : ev.key === 'ArrowDown' ? [0, step]
                       : ev.key === 'ArrowLeft' ? [-step, 0]
                       : [step, 0]
        if (!nudgePreRef.current) nudgePreRef.current = [...shapesRef.current]
        shapesRef.current = shapesRef.current.map(s => selectedIdsRef.current.has(s.id) ? offsetShape(s, dx, dy) as Shape : s)
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
            const copies = sel.map(duplicateShape)
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
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [undo, redo, commit, render, clearSelection, setSelection, updateCursor, groupSelected, ungroupSelected, bringToFront, sendToBack, copySelected, pasteClipboard, zoomToFit, resetZoom, scheduleSave, startEdit])

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
    if (!textInput) return
    const { editingId, containerId, stickyId, isNewSticky } = textInput
    const isDivMode = !!(containerId || stickyId || isNewSticky)
    const rawVal = isDivMode
      ? (textRef.current as HTMLDivElement | null)?.innerText
      : (textRef.current as HTMLInputElement | null)?.value
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
          }
          return fitContainer({ ...s, boundText } as RectShape | EllipseShape)
        }))
      }
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
            ? { ...s, text: val, size, fontFamily: fontFamilyRef.current, bold: boldRef.current, italic: italicRef.current, color: colorRef.current } as Shape
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
        bold: boldRef.current, italic: italicRef.current,
        color: colorRef.current, fill: 'none', width: 1,
      } as TextShape])
      setSelection(new Set([id]))
    }
  }, [textInput, commit, setSelection])

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
  const applyFontPatch = useCallback((patch: Partial<Pick<BoundText, 'size' | 'fontFamily' | 'bold' | 'italic'>>) => {
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

  const notesPanelTitle = notesTarget === 'global'
    ? 'Diagram Notes'
    : notesTarget.kind === 'shape'
      ? `Note — ${(() => { const s = shapesRef.current.find(sh => sh.id === notesTarget.id); return s ? shapeLabel(s) : 'Shape' })()}`
      : `Note — Group (${shapesRef.current.filter(s => s.groupId === notesTarget.groupId).length} shapes)`

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-row">

      {/* ── Canvas area ── */}
      <div ref={containerRef} className="relative h-full overflow-hidden flex-1">
        {/* Window drag strip — sits above canvas (z-10) but below toolbar buttons (z-20) */}
        <div className="absolute top-0 left-0 right-0 h-8 z-10" data-tauri-drag-region />
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
          radius={radius} fontSize={fontSize} fontFamily={fontFamily} bold={bold} italic={italic}
          selectedShapeType={selectedShapeType}
          hasBoundText={selectionHasBoundText || !!textInput?.containerId}
          onTool={setTool} onColor={handleColor} onFill={handleFill} onWidth={handleWidth}
          onRadius={handleRadius} onFontSize={handleFontSize} onFontFamily={handleFontFamily}
          onBold={handleBold} onItalic={handleItalic}
          onUndo={undo} onRedo={redo} onZoom={handleZoom}
          onTemplates={() => setShowTemplates(v => !v)}
          showTemplates={showTemplates}
          sketchy={sketchy} onSketchy={() => setSketchy(v => !v)}
          showGrid={showGrid} onToggleGrid={() => setShowGrid(v => !v)}
          canAddNote={canAddNote} hasNote={hasNoteOnSelection} canPromoteSticky={canPromoteSticky}
          onAddNote={addNoteToSelection} onPromoteSticky={promoteStickyToNote}
        />

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
        {showShortcuts && (
          <>
            {/* Click-outside backdrop */}
            <div className="fixed inset-0 z-20" onClick={() => setShowShortcuts(false)} />
            <div className="absolute top-14 right-14 z-30 w-80 max-h-[70vh] flex flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0 border-b border-border">
                <p className="text-sm font-semibold text-foreground">Keyboard shortcuts</p>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Groups — scrollable */}
              <div className="overflow-y-auto px-4 py-3">
                {SHORTCUT_GROUPS.map(group => (
                  <div key={group.title} className="mb-4 last:mb-0">
                    <div className="text-[10px] font-semibold text-accent tracking-wider uppercase mb-2">{group.title}</div>
                    <div className="flex flex-col gap-1.5">
                      {group.items.map(([keys, label]) => (
                        <div key={label} className="flex items-center justify-between gap-3">
                          <span className="text-[12px] text-foreground/90">{label}</span>
                          <kbd className="shrink-0 px-1.5 py-0.5 rounded-md border border-border bg-muted text-foreground/70 font-mono text-[10px] shadow-sm">{keys}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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

        {/* Text input overlay */}
        {textInput && textInput.containerId ? (
          // contentEditable (not textarea) so flexbox can center the text both
          // horizontally and vertically inside the shape while typing.
          <div
            ref={textRef as React.RefObject<HTMLDivElement>}
            contentEditable
            suppressContentEditableWarning
            className="absolute bg-transparent outline-none pointer-events-auto overflow-hidden flex items-center justify-center text-center"
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
        ) : textInput && (
          <input
            ref={textRef as React.RefObject<HTMLInputElement>}
            className="absolute bg-transparent outline-none pointer-events-auto"
            style={{
              left: textInput.sx, top: textInput.sy - Math.min(fontSize, 32),
              fontSize: Math.min(Math.max(14, fontSize), 32),
              fontFamily, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal',
              color, caretColor: color, minWidth: 80, zIndex: 50,
            }}
            defaultValue={textInput?.initialValue ?? ''}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitText() }; if (e.key === 'Escape') { e.preventDefault(); commitText() } }}
            onBlur={commitText}
          />
        )}
      </div>

      {/* ── Notes sheet — slides in from right ── */}
      <div
        className="h-full overflow-hidden transition-all duration-300 ease-out shrink-0"
        style={{ width: showNotes ? '50%' : 0 }}
      >
        {/* Keep mounted so CodeMirror state isn't lost when toggling */}
        <div className="h-full" style={{ width: '100%', visibility: showNotes ? 'visible' : 'hidden' }}>
          <CanvasNotesSheet
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
