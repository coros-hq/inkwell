export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'sticky'

export interface Point { x: number; y: number }

interface Base {
  id: string
  color: string
  fill: string
  width: number
  rotation?: number   // radians, clockwise, around the shape's bounds center
  groupId?: string   // shapes sharing the same groupId are treated as one group
  note?: string       // markdown note content attached to this shape (edited via the full notes panel)
  noteShared?: boolean // true if `note` is replicated across every member of groupId
}

export interface BoundText { text: string; size: number; fontFamily: string; bold: boolean; italic: boolean; color: string }

export interface PathShape    extends Base { type: 'path';    pts: Point[] }
export interface RectShape    extends Base { type: 'rect';    x: number; y: number; w: number; h: number; radius: number; boundText?: BoundText }
export interface EllipseShape extends Base { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; boundText?: BoundText }
export interface LineShape    extends Base { type: 'line';    x1: number; y1: number; x2: number; y2: number }
export interface ArrowShape   extends Base { type: 'arrow';   x1: number; y1: number; x2: number; y2: number; cpx?: number; cpy?: number }
export interface TextShape    extends Base {
  type: 'text'
  x: number; y: number
  text: string
  size: number
  fontFamily: string
  bold: boolean
  italic: boolean
}
export interface StickyShape  extends Base { type: 'sticky';  x: number; y: number; w: number; h: number; text: string }

/** Pasted/uploaded picture. `src` is a data URL so the canvas file stays self-contained. */
export interface ImageShape   extends Base { type: 'image';   x: number; y: number; w: number; h: number; src: string }

export type Shape = PathShape | RectShape | EllipseShape | LineShape | ArrowShape | TextShape | StickyShape | ImageShape

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

// Shapes created from templates/category elements are stamped with this
// placeholder color at definition time (the modules that define them have no
// notion of the current theme) — callers must remap it to the live default
// stroke color right before inserting the shapes onto the canvas.
export const TEMPLATE_PLACEHOLDER_COLOR = '#f8fafc'

export function recolorTemplateShapes(shapes: Shape[], color: string): Shape[] {
  return shapes.map(sh => sh.color === TEMPLATE_PLACEHOLDER_COLOR ? { ...sh, color } : sh)
}

export function shapeBounds(s: Shape): { x: number; y: number; w: number; h: number } {
  switch (s.type) {
    case 'path': {
      if (!s.pts.length) return { x: 0, y: 0, w: 0, h: 0 }
      const xs = s.pts.map(p => p.x), ys = s.pts.map(p => p.y)
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }
    }
    case 'rect':
    case 'sticky':
    case 'image':
      return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w) || 1, h: Math.abs(s.h) || 1 }
    case 'ellipse':
      return { x: s.cx - Math.abs(s.rx), y: s.cy - Math.abs(s.ry), w: Math.abs(s.rx) * 2 || 1, h: Math.abs(s.ry) * 2 || 1 }
    case 'line': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2)
      return { x, y, w: Math.abs(s.x2 - s.x1) || 1, h: Math.abs(s.y2 - s.y1) || 1 }
    }
    case 'arrow': {
      const a = s as ArrowShape
      const xs = [a.x1, a.x2], ys = [a.y1, a.y2]
      if (a.cpx !== undefined) { xs.push(a.cpx); ys.push(a.cpy!) }
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }
    }
    case 'text':
      return { x: s.x, y: s.y - s.size, w: Math.max(s.text.length * s.size * 0.55, 20), h: s.size * 1.3 }
  }
}

/** Maps a world point into the shape's unrotated frame (identity when the shape isn't rotated) */
export function unrotatePoint(s: Shape, px: number, py: number): Point {
  if (!s.rotation) return { x: px, y: py }
  const b = shapeBounds(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const c = Math.cos(-s.rotation), sn = Math.sin(-s.rotation)
  const dx = px - cx, dy = py - cy
  return { x: cx + dx * c - dy * sn, y: cy + dx * sn + dy * c }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function distToPolyline(px: number, py: number, pts: Point[]): number {
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y)
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y))
  return d
}

/** Precise hit test: strokes hit near the line, ellipses use the real curve, boxes use their bounds. */
export function hitTest(s: Shape, px: number, py: number): boolean {
  if (s.rotation) { const q = unrotatePoint(s, px, py); px = q.x; py = q.y }
  const tol = Math.max(8, s.width * 2)
  switch (s.type) {
    case 'path':
      return s.pts.length > 0 && distToPolyline(px, py, s.pts) <= tol
    case 'line':
      return distToSegment(px, py, s.x1, s.y1, s.x2, s.y2) <= tol
    case 'arrow': {
      const cx = s.cpx ?? (s.x1 + s.x2) / 2, cy = s.cpy ?? (s.y1 + s.y2) / 2
      const pts: Point[] = []
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, u = 1 - t
        pts.push({ x: u * u * s.x1 + 2 * u * t * cx + t * t * s.x2, y: u * u * s.y1 + 2 * u * t * cy + t * t * s.y2 })
      }
      return distToPolyline(px, py, pts) <= tol
    }
    case 'ellipse': {
      const rx = Math.abs(s.rx) + tol, ry = Math.abs(s.ry) + tol
      const nx = (px - s.cx) / rx, ny = (py - s.cy) / ry
      return nx * nx + ny * ny <= 1
    }
    default: {
      const b = shapeBounds(s)
      return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol
    }
  }
}

/** Empty (unfilled, unlabeled) rect/ellipse: only its outline counts as a hit, so shapes inside stay clickable */
function isHollowContainer(s: Shape): boolean {
  return (s.type === 'rect' || s.type === 'ellipse') && s.fill === 'none' && !s.boundText
}

function nearOutline(s: Shape, px: number, py: number): boolean {
  const tol = Math.max(8, s.width * 2)
  if (s.type === 'ellipse') {
    const rx = Math.abs(s.rx) - tol, ry = Math.abs(s.ry) - tol
    if (rx <= 0 || ry <= 0) return true
    const nx = (px - s.cx) / rx, ny = (py - s.cy) / ry
    return nx * nx + ny * ny >= 1
  }
  const b = shapeBounds(s)
  return !(px > b.x + tol && px < b.x + b.w - tol && py > b.y + tol && py < b.y + b.h - tol)
}

/**
 * Topmost shape under the point. Hollow containers only win by their outline,
 * but if nothing else is under the cursor they still grab from the inside —
 * so frames never swallow what's inside them, yet remain easy to drag.
 */
export function hitTopmost(shapes: Shape[], px: number, py: number): Shape | null {
  let interior: Shape | null = null
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (!hitTest(s, px, py)) continue
    const q = unrotatePoint(s, px, py)
    if (isHollowContainer(s) && !nearOutline(s, q.x, q.y)) { interior ??= s; continue }
    return s
  }
  return interior
}
