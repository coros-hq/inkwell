export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'sticky'

export interface Point { x: number; y: number }

interface Base {
  id: string
  color: string
  fill: string
  width: number
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

export type Shape = PathShape | RectShape | EllipseShape | LineShape | ArrowShape | TextShape | StickyShape

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

export function hitTest(s: Shape, px: number, py: number): boolean {
  const b   = shapeBounds(s)
  const pad = Math.max(10, s.width * 2)
  return px >= b.x - pad && px <= b.x + b.w + pad
      && py >= b.y - pad && py <= b.y + b.h + pad
}
