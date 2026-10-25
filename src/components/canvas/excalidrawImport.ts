import { uid } from './canvasTypes'
import type { Shape, Point, BoundText, ImageShape, TextShape } from './canvasTypes'
import { FONT_HAND, FONT_SANS, FONT_MONO } from './CanvasToolbar'

// Converts Excalidraw scenes (what its "copy" puts on the clipboard, and the
// contents of a .excalidraw file) into this canvas's shapes. Excalidraw has
// element kinds this canvas doesn't (diamonds, elbow arrows, frames); those are
// approximated with the closest shape rather than dropped.

/* eslint-disable @typescript-eslint/no-explicit-any */
type ExEl = Record<string, any>
export interface ExcalidrawScene { elements: ExEl[]; files: Record<string, { dataURL?: string }> }

/** Returns the scene if `text` is Excalidraw clipboard/file JSON, else null. */
export function parseExcalidraw(text: string): ExcalidrawScene | null {
  const t = text.trim()
  if (!t.startsWith('{') || !t.includes('"elements"')) return null
  try {
    const data = JSON.parse(t)
    const type = typeof data?.type === 'string' ? data.type : ''
    if (!type.startsWith('excalidraw') || !Array.isArray(data.elements)) return null
    return { elements: data.elements, files: data.files ?? {} }
  } catch {
    return null
  }
}

const fontFor = (family: number | undefined) =>
  family === 2 || family === 6 || family === 8 ? FONT_SANS : family === 3 || family === 4 ? FONT_MONO : FONT_HAND

const strokeOf = (e: ExEl) => (e.strokeColor && e.strokeColor !== 'transparent' ? e.strokeColor : '#1e1e1e')
const fillOf = (e: ExEl) => (!e.backgroundColor || e.backgroundColor === 'transparent' ? 'none' : e.backgroundColor)

function base(e: ExEl, groups: Map<string, string>) {
  const outer = Array.isArray(e.groupIds) && e.groupIds.length ? e.groupIds[e.groupIds.length - 1] : null
  let groupId: string | undefined
  if (outer) {
    if (!groups.has(outer)) groups.set(outer, uid())
    groupId = groups.get(outer)
  }
  return {
    id: uid(),
    color: strokeOf(e),
    fill: fillOf(e),
    width: Math.max(1, Number(e.strokeWidth) || 2),
    ...(groupId ? { groupId } : {}),
  }
}

function absPoints(e: ExEl): Point[] {
  return (e.points ?? []).map((p: [number, number]) => ({ x: e.x + p[0], y: e.y + p[1] }))
}

/** Lines of text as separate single-line text shapes (this canvas's text shape is one line). */
function textShapes(e: ExEl, text: string, box: { x: number; y: number; w: number; align: string }, g: Map<string, string>): TextShape[] {
  const size = Number(e.fontSize) || 20
  const bold = false
  return text.split('\n').map((line, i) => {
    const est = Math.max(line.length * size * 0.55, 1)
    const x = box.align === 'center' ? box.x + (box.w - est) / 2 : box.align === 'right' ? box.x + box.w - est : box.x
    return {
      ...base(e, g), type: 'text', fill: 'none',
      color: e.strokeColor && e.strokeColor !== 'transparent' ? e.strokeColor : '#1e1e1e',
      x, y: box.y + size * 0.95 + i * size * 1.25,
      text: line, size, fontFamily: fontFor(e.fontFamily), bold, italic: false,
    } as TextShape
  })
}

export function excalidrawToShapes(scene: ExcalidrawScene): Shape[] {
  const els = scene.elements.filter(e => e && !e.isDeleted)
  const byId = new Map<string, ExEl>(els.map(e => [e.id, e]))
  const groups = new Map<string, string>()
  const out: Shape[] = []

  for (const e of els) {
    const rot = e.angle ? { rotation: e.angle as number } : {}
    switch (e.type) {
      case 'rectangle':
      case 'ellipse': {
        const label = els.find(t => t.type === 'text' && t.containerId === e.id)
        const boundText: BoundText | undefined = label
          ? { text: String(label.text ?? ''), size: Number(label.fontSize) || 20, fontFamily: fontFor(label.fontFamily), bold: false, italic: false, color: strokeOf(label) }
          : undefined
        const common = { ...base(e, groups), ...rot, ...(boundText ? { boundText } : {}) }
        if (e.type === 'rectangle') {
          out.push({ ...common, type: 'rect', x: e.x, y: e.y, w: e.width, h: e.height, radius: e.roundness ? Math.min(24, Math.min(e.width, e.height) * 0.2) : 0 })
        } else {
          out.push({ ...common, type: 'ellipse', cx: e.x + e.width / 2, cy: e.y + e.height / 2, rx: e.width / 2, ry: e.height / 2 })
        }
        break
      }
      case 'diamond': {
        // No diamond shape here: draw its outline as a closed path, rotated by hand.
        const cx = e.x + e.width / 2, cy = e.y + e.height / 2
        const a = e.angle || 0, cos = Math.cos(a), sin = Math.sin(a)
        const rotate = (p: Point): Point => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos })
        const top = { x: cx, y: e.y }, right = { x: e.x + e.width, y: cy }, bottom = { x: cx, y: e.y + e.height }, left = { x: e.x, y: cy }
        out.push({ ...base(e, groups), type: 'path', fill: 'none', pts: [top, right, bottom, left, top].map(rotate) })
        const label = els.find(t => t.type === 'text' && t.containerId === e.id)
        if (label) out.push(...textShapes(label, String(label.text ?? ''), { x: e.x, y: cy - ((Number(label.fontSize) || 20) * 1.25 * String(label.text ?? '').split('\n').length) / 2, w: e.width, align: 'center' }, groups))
        break
      }
      case 'line':
      case 'arrow': {
        const pts = absPoints(e)
        if (pts.length < 2) break
        const b = base(e, groups)
        const isArrow = e.type === 'arrow'
        const headAtEnd = isArrow && !!e.endArrowhead
        const headAtStart = isArrow && !!e.startArrowhead
        if (pts.length > 3) {
          // Elbow / multi-segment: keep the route as a polyline (no head).
          out.push({ ...b, type: 'path', fill: 'none', pts })
        } else if (isArrow && (headAtEnd || headAtStart)) {
          const p = headAtEnd ? pts : [...pts].reverse()
          const first = p[0], last = p[p.length - 1]
          const arrow: Shape = { ...b, type: 'arrow', fill: 'none', x1: first.x, y1: first.y, x2: last.x, y2: last.y }
          if (p.length === 3) {
            // A curved arrow passes through its middle point; recover the quadratic control point.
            arrow.cpx = 2 * p[1].x - (first.x + last.x) / 2
            arrow.cpy = 2 * p[1].y - (first.y + last.y) / 2
          }
          out.push(arrow)
        } else {
          out.push({ ...b, type: 'line', fill: 'none', x1: pts[0].x, y1: pts[0].y, x2: pts[pts.length - 1].x, y2: pts[pts.length - 1].y })
        }
        const label = els.find(t => t.type === 'text' && t.containerId === e.id)
        if (label) {
          const mid = pts[Math.floor(pts.length / 2)]
          const size = Number(label.fontSize) || 20
          out.push(...textShapes(label, String(label.text ?? ''), { x: mid.x - label.width / 2, y: mid.y - size * 0.6, w: label.width, align: 'center' }, groups))
        }
        break
      }
      case 'freedraw': {
        const pts = absPoints(e)
        if (pts.length) out.push({ ...base(e, groups), type: 'path', fill: 'none', pts })
        break
      }
      case 'text': {
        if (e.containerId && byId.has(e.containerId)) {
          const host = byId.get(e.containerId)!
          // Labels of rectangles, ellipses, diamonds and arrows were handled with their host.
          if (['rectangle', 'ellipse', 'diamond', 'arrow', 'line'].includes(host.type)) break
        }
        out.push(...textShapes(e, String(e.text ?? ''), { x: e.x, y: e.y, w: e.width, align: e.textAlign ?? 'left' }, groups))
        break
      }
      case 'image': {
        const src = e.fileId ? scene.files[e.fileId]?.dataURL : undefined
        if (!src) break
        out.push({ ...base(e, groups), ...rot, type: 'image', fill: 'none', x: e.x, y: e.y, w: e.width, h: e.height, src } as ImageShape)
        break
      }
      case 'frame':
      case 'magicframe': {
        out.push({ ...base(e, groups), type: 'rect', fill: 'none', x: e.x, y: e.y, w: e.width, h: e.height, radius: 6 })
        if (e.name) out.push(...textShapes({ ...e, fontSize: 16, fontFamily: 2 }, String(e.name), { x: e.x, y: e.y - 24, w: e.width, align: 'left' }, groups))
        break
      }
      default:
        break // embeddables, iframes and other unsupported kinds
    }
  }
  return out
}
