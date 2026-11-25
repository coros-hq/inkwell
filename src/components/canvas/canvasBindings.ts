import { shapeBounds, unrotatePoint } from './canvasTypes'
import type { Shape, Point, ArrowShape, ArrowBinding, ArrowHead } from './canvasTypes'

// Arrows that stay attached to shapes, like Excalidraw's bound arrows.
//
// An arrow end can be bound to a shape (rect, ellipse, sticky, image). The
// binding stores either a fixed spot on the shape (fx/fy, fractions of its
// unrotated bounds, e.g. a side's midpoint) or nothing, meaning "wherever the
// line toward the other end crosses the outline". resolveBindings() recomputes
// every bound arrow from its targets, so moving, resizing or rotating a shape
// drags its arrows along; the arrow also re-curves so it leaves and enters
// each side squarely.

/** World-space gap between a bound arrow's tip and its shape's outline. */
const GAP = 5

export const isBindable = (s: Shape) =>
  s.type === 'rect' || s.type === 'ellipse' || s.type === 'sticky' || s.type === 'image'

const center = (s: Shape): Point => { const b = shapeBounds(s); return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }

function rotateAround(p: Point, c: Point, a: number): Point {
  if (!a) return p
  const cos = Math.cos(a), sin = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}
const rotateVec = (v: Point, a: number): Point => (a ? { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) } : v)
const norm = (v: Point): Point => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l } }

/** The four side midpoints (as bound fractions): top, right, bottom, left. */
export const SIDE_POINTS: Array<{ fx: number; fy: number }> = [
  { fx: 0.5, fy: 0 }, { fx: 1, fy: 0.5 }, { fx: 0.5, fy: 1 }, { fx: 0, fy: 0.5 },
]

/** Where the four connection dots are drawn, just outside each side. */
export function connectionDots(s: Shape, zoom: number): Point[] {
  return SIDE_POINTS.map(sp => anchor(s, sp, null, 10 / zoom).p)
}

/**
 * Point on the target's outline for a binding, pushed out by `gap`, with the outward normal.
 * Unfixed bindings aim at `toward` (the arrow's other end).
 */
export function anchor(s: Shape, bind: { fx?: number; fy?: number }, toward: Point | null, gap = GAP): { p: Point; n: Point } {
  const b = shapeBounds(s), c = center(s), rot = s.rotation ?? 0
  const rx = b.w / 2, ry = b.h / 2
  // Direction from the centre in the shape's own (unrotated) frame.
  let d: Point
  if (bind.fx !== undefined && bind.fy !== undefined) {
    d = { x: (bind.fx - 0.5) * b.w, y: (bind.fy - 0.5) * b.h }
  } else {
    const t = toward ? rotateAround(toward, c, -rot) : { x: c.x + 1, y: c.y }
    d = { x: t.x - c.x, y: t.y - c.y }
  }
  if (!d.x && !d.y) d = { x: 1, y: 0 }
  let local: Point, n: Point
  if (s.type === 'ellipse') {
    const k = 1 / Math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2)
    local = { x: c.x + d.x * k, y: c.y + d.y * k }
    n = norm({ x: (local.x - c.x) / (rx * rx), y: (local.y - c.y) / (ry * ry) })
  } else {
    // Ray from the centre to the box edge; the side it exits through gives the normal.
    const kx = d.x ? rx / Math.abs(d.x) : Infinity, ky = d.y ? ry / Math.abs(d.y) : Infinity
    const k = Math.min(kx, ky)
    local = { x: c.x + d.x * k, y: c.y + d.y * k }
    n = kx < ky ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) }
  }
  const p = rotateAround({ x: local.x + n.x * gap, y: local.y + n.y * gap }, c, rot)
  return { p, n: rotateVec(n, rot) }
}

/** Fractions of the target's bounds for a world point (used to pin imported arrows where they were). */
export function fractionOf(s: Shape, p: Point): { fx: number; fy: number } {
  const b = shapeBounds(s), q = s.rotation ? unrotatePoint(s, p.x, p.y) : p
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { fx: clamp((q.x - b.x) / (b.w || 1)), fy: clamp((q.y - b.y) / (b.h || 1)) }
}

export interface BindCandidate { target: Shape; bind: ArrowBinding; p: Point }

/**
 * The shape an arrow end dropped at `wp` would attach to: the topmost bindable
 * shape within reach. Near a side's connection dot it pins to that dot,
 * otherwise it floats (aims at the other end).
 */
export function bindingAt(shapes: Shape[], wp: Point, zoom: number, exclude: Set<string> = new Set(), toward: Point | null = null): BindCandidate | null {
  const reach = 14 / zoom
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (!isBindable(s) || exclude.has(s.id)) continue
    const q = s.rotation ? unrotatePoint(s, wp.x, wp.y) : wp
    const b = shapeBounds(s)
    if (q.x < b.x - reach || q.x > b.x + b.w + reach || q.y < b.y - reach || q.y > b.y + b.h + reach) continue
    const dots = connectionDots(s, zoom)
    const di = dots.findIndex(d => Math.hypot(d.x - wp.x, d.y - wp.y) < 16 / zoom)
    const bind: ArrowBinding = di >= 0 ? { id: s.id, ...SIDE_POINTS[di] } : { id: s.id }
    return { target: s, bind, p: anchor(s, bind, toward).p }
  }
  return null
}

/** Quadratic control point that makes the arrow leave/enter along the side normals. */
function autoControl(p1: Point, n1: Point | null, p2: Point, n2: Point | null): Point | null {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (dist < 1) return null
  if (n1 && n2) {
    // Intersection of the two normal rays, if both point forward.
    const den = n1.x * n2.y - n1.y * n2.x
    if (Math.abs(den) > 1e-3) {
      const dx = p2.x - p1.x, dy = p2.y - p1.y
      const t = (dx * n2.y - dy * n2.x) / den
      const u = (dx * n1.y - dy * n1.x) / den
      if (t > 0 && u > 0 && t < dist * 2 && u < dist * 2) return { x: p1.x + n1.x * t, y: p1.y + n1.y * t }
    }
    const a = { x: p1.x + n1.x * dist / 3, y: p1.y + n1.y * dist / 3 }
    const b = { x: p2.x + n2.x * dist / 3, y: p2.y + n2.y * dist / 3 }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const [p, n] = n1 ? [p1, n1] : n2 ? [p2, n2] : [null, null]
  if (!p || !n) return null
  return { x: p.x + n.x * dist / 3, y: p.y + n.y * dist / 3 }
}

/** Re-places one arrow from its bindings. Returns the same object when nothing is bound. */
export function resolveArrow(a: ArrowShape, byId: Map<string, Shape>): ArrowShape {
  if (!a.start && !a.end) return a
  const ts = a.start ? byId.get(a.start.id) : undefined
  const te = a.end ? byId.get(a.end.id) : undefined
  // Floating ends aim at the other end's pinned spot, or its shape's centre, or its free point.
  const pinned = (t: Shape | undefined, bnd: ArrowBinding | undefined) => (t && bnd && bnd.fx !== undefined ? anchor(t, bnd, null).p : null)
  const aimS = pinned(te, a.end) ?? (te ? center(te) : { x: a.x2, y: a.y2 })
  const aimE = pinned(ts, a.start) ?? (ts ? center(ts) : { x: a.x1, y: a.y1 })
  const s = ts && a.start ? anchor(ts, a.start, aimS) : null
  const e = te && a.end ? anchor(te, a.end, aimE) : null
  const p1 = s?.p ?? { x: a.x1, y: a.y1 }
  const p2 = e?.p ?? { x: a.x2, y: a.y2 }
  const next: ArrowShape = { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  // A deleted target just releases that end.
  if (a.start && !ts) delete next.start
  if (a.end && !te) delete next.end
  delete next.rotation
  if (a.autoBend !== false) {
    const cp = autoControl(p1, s?.n ?? null, p2, e?.n ?? null)
    if (cp && Math.abs((p2.x - p1.x) * (cp.y - p1.y) - (p2.y - p1.y) * (cp.x - p1.x)) / (Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1) > 2) {
      next.cpx = cp.x; next.cpy = cp.y
    } else {
      delete next.cpx; delete next.cpy
    }
  }
  const same = next.x1 === a.x1 && next.y1 === a.y1 && next.x2 === a.x2 && next.y2 === a.y2 && next.cpx === a.cpx && next.cpy === a.cpy
    && !!next.start === !!a.start && !!next.end === !!a.end && next.rotation === a.rotation
  return same ? a : next
}

/** Re-places every bound arrow; returns the input array untouched when nothing moved. */
export function resolveBindings(shapes: Shape[]): Shape[] {
  if (!shapes.some(s => s.type === 'arrow' && (s.start || s.end))) return shapes
  const byId = new Map(shapes.map(s => [s.id, s]))
  let changed = false
  const out = shapes.map(s => {
    if (s.type !== 'arrow') return s
    const r = resolveArrow(s, byId)
    if (r !== s) changed = true
    return r
  })
  return changed ? out : shapes
}

/** Drops the bindings of arrows in `ids` whose target is not also in `ids` (an arrow moved on its own). */
export function releaseDetached(shapes: Shape[], ids: Set<string>): Shape[] {
  let changed = false
  const out = shapes.map(s => {
    if (s.type !== 'arrow' || !ids.has(s.id) || (!s.start && !s.end)) return s
    const keepS = s.start && ids.has(s.start.id), keepE = s.end && ids.has(s.end.id)
    if (keepS === !!s.start && keepE === !!s.end) return s
    changed = true
    const n: ArrowShape = { ...s }
    if (!keepS) delete n.start
    if (!keepE) delete n.end
    return n
  })
  return changed ? out : shapes
}

/** After copying shapes with fresh ids: point bindings at the copies, or drop them if the target wasn't copied. */
export function remapBindings(copies: Shape[], idMap: Map<string, string>): Shape[] {
  return copies.map(s => {
    if (s.type !== 'arrow' || (!s.start && !s.end)) return s
    const n: ArrowShape = { ...s }
    if (s.start) { const id = idMap.get(s.start.id); if (id) n.start = { ...s.start, id }; else delete n.start }
    if (s.end) { const id = idMap.get(s.end.id); if (id) n.end = { ...s.end, id }; else delete n.end }
    return n
  })
}

// ── Arrowheads ─────────────────────────────────────────────────────────────────

export interface HeadGeometry { lines: Array<Array<[number, number]>>; circles: Array<{ x: number; y: number; r: number }> }

/**
 * Strokes for an arrowhead at `tip`, arriving with direction angle `ang`.
 * ER ends follow crow's-foot notation: one (‖), zero-or-one (o|), many (crow's foot + |), zero-or-many (o + crow's foot).
 */
export function headGeometry(kind: ArrowHead, tip: Point, ang: number, width: number): HeadGeometry {
  const g: HeadGeometry = { lines: [], circles: [] }
  if (kind === 'none') return g
  const H = Math.max(14, width * 5)
  const u = { x: Math.cos(ang), y: Math.sin(ang) }      // along the arrow, toward the tip
  const v = { x: -u.y, y: u.x }                          // across it
  const at = (back: number, side = 0): [number, number] => [tip.x - u.x * back + v.x * side, tip.y - u.y * back + v.y * side]
  if (kind === 'arrow') {
    g.lines.push([
      [tip.x - H * Math.cos(ang - Math.PI / 7), tip.y - H * Math.sin(ang - Math.PI / 7)],
      [tip.x, tip.y],
      [tip.x - H * Math.cos(ang + Math.PI / 7), tip.y - H * Math.sin(ang + Math.PI / 7)],
    ])
    return g
  }
  const k = H / 14, half = 7 * k
  const bar = (back: number) => g.lines.push([at(back, -half), at(back, half)])
  const circle = (back: number) => { const [x, y] = at(back); g.circles.push({ x, y, r: 4.5 * k }) }
  const crow = () => g.lines.push([at(0, -half), at(14 * k), at(0, half)])
  switch (kind) {
    case 'one':      bar(8 * k); bar(14 * k); break
    case 'zeroOne':  bar(8 * k); circle(19 * k); break
    case 'many':     crow(); bar(19 * k); break
    case 'zeroMany': crow(); circle(19 * k); break
  }
  return g
}

/** Point and tangent angle at each end of an arrow (the angle points out of the arrow, toward the tip). */
export function arrowEnds(a: ArrowShape) {
  const cpx = a.cpx ?? (a.x1 + a.x2) / 2, cpy = a.cpy ?? (a.y1 + a.y2) / 2
  return {
    start: { p: { x: a.x1, y: a.y1 }, ang: Math.atan2(a.y1 - cpy, a.x1 - cpx) },
    end: { p: { x: a.x2, y: a.y2 }, ang: Math.atan2(a.y2 - cpy, a.x2 - cpx) },
    mid: { x: 0.25 * a.x1 + 0.5 * cpx + 0.25 * a.x2, y: 0.25 * a.y1 + 0.5 * cpy + 0.25 * a.y2 },
  }
}

export const startHeadOf = (a: ArrowShape): ArrowHead => a.startHead ?? 'none'
export const endHeadOf = (a: ArrowShape): ArrowHead => a.endHead ?? 'arrow'
