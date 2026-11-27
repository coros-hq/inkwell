// Exact geometry for diagram node shapes (database cylinder, queue, decision
// diamond, cloud, …) and the small technical icons a node can carry.
//
// A node is a RectShape with an optional `kind` (its outline) and `icon` (a
// glyph drawn at its left). Everything is described as SVG path data so the
// clean canvas (Path2D), the hand-drawn renderer (roughjs .path()) and the SVG
// exporter all draw the very same outline — the sketchy look only wobbles the
// strokes, it never changes the shape.

export type NodeKind =
  | 'cylinder' | 'queue' | 'diamond' | 'hexagon' | 'parallelogram'
  | 'document' | 'cloud' | 'stack' | 'browser' | 'mobile'
  /** Titled container that moves its contents as one block (see canvasFrames). */
  | 'frame'

export type NodeIcon =
  | 'search' | 'bolt' | 'server' | 'function' | 'lock' | 'user' | 'gear'
  | 'globe' | 'box' | 'clock' | 'bell' | 'chart' | 'code' | 'mail' | 'key' | 'balance' | 'bucket'

export interface Box { x: number; y: number; w: number; h: number }

export interface NodeGeometry {
  /** Closed outline: filled, stroked, and what the fill/hachure covers. */
  outline: string
  /** Extra strokes drawn on top (cylinder rim, browser bar…), never filled. */
  details: string[]
  /** Icon strokes, drawn thinner and steadier than the outline. */
  icon: string[]
  /** Where a bound label is laid out. */
  textBox: Box
}

const n = (v: number) => +v.toFixed(2)
const PAD = 8

export function roundedRectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  if (r < 0.5) return `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`
  return `M ${n(x + r)} ${n(y)} L ${n(x + w - r)} ${n(y)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`
    + ` L ${n(x + w)} ${n(y + h - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`
    + ` L ${n(x + r)} ${n(y + h)} A ${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`
    + ` L ${n(x)} ${n(y + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)} Z`
}

const poly = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${n(x)} ${n(y)}`).join(' ') + ' Z'

/** Polygon vertices (relative to the box) for the straight-edged kinds; used by arrow binding too. */
export function kindPolygon(kind: NodeKind | undefined, w: number, h: number): [number, number][] | null {
  switch (kind) {
    case 'diamond': return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
    case 'hexagon': { const i = hexInset(w, h); return [[i, 0], [w - i, 0], [w, h / 2], [w - i, h], [i, h], [0, h / 2]] }
    case 'parallelogram': { const k = skew(w, h); return [[k, 0], [w, 0], [w - k, h], [0, h]] }
    default: return null
  }
}
const hexInset = (w: number, h: number) => Math.min(w / 4, h * 0.45)
const skew = (w: number, h: number) => Math.min(w / 4, h * 0.4)
const cylCap = (w: number, h: number) => Math.min(h / 4, Math.max(6, w * 0.13))
const queueCap = (w: number, h: number) => Math.min(w / 5, Math.max(6, h * 0.16))

// ── Icons ──────────────────────────────────────────────────────────────────────
// Drawn on a 24×24 grid (absolute M/L/A/C/Z only), then mapped into place.

const ICONS: Record<NodeIcon, string[]> = {
  search:   ['M 10.5 3 A 7.5 7.5 0 1 1 10.4 3 Z', 'M 16 16 L 21 21'],
  bolt:     ['M 13 2 L 4 14 L 12 14 L 11 22 L 20 10 L 12 10 Z'],
  server:   ['M 3 3 L 21 3 L 21 10 L 3 10 Z', 'M 3 14 L 21 14 L 21 21 L 3 21 Z', 'M 6.5 6.5 L 7.5 6.5', 'M 6.5 17.5 L 7.5 17.5', 'M 11 6.5 L 17 6.5', 'M 11 17.5 L 17 17.5'],
  function: ['M 6 3 L 9 3 C 10.5 3 11 4 11.5 5.5 L 17 21', 'M 12.5 10 L 6 21', 'M 15 21 L 19 21'],
  lock:     ['M 5 11 L 19 11 L 19 21 L 5 21 Z', 'M 8 11 L 8 7.5 A 4 4 0 0 1 16 7.5 L 16 11', 'M 12 15 L 12 17'],
  user:     ['M 12 3 A 4 4 0 1 1 11.9 3 Z', 'M 4 21 C 4 16 7.5 14 12 14 C 16.5 14 20 16 20 21'],
  gear:     ['M 12 8.5 A 3.5 3.5 0 1 1 11.9 8.5 Z', 'M 12 2 L 12 5', 'M 12 19 L 12 22', 'M 2 12 L 5 12', 'M 19 12 L 22 12', 'M 4.9 4.9 L 7 7', 'M 17 17 L 19.1 19.1', 'M 4.9 19.1 L 7 17', 'M 17 7 L 19.1 4.9'],
  globe:    ['M 12 2.5 A 9.5 9.5 0 1 1 11.9 2.5 Z', 'M 2.5 12 L 21.5 12', 'M 12 2.5 C 7.5 7 7.5 17 12 21.5', 'M 12 2.5 C 16.5 7 16.5 17 12 21.5'],
  box:      ['M 12 2.5 L 21 7 L 21 17 L 12 21.5 L 3 17 L 3 7 Z', 'M 3 7 L 12 11.5 L 21 7', 'M 12 11.5 L 12 21.5'],
  clock:    ['M 12 2.5 A 9.5 9.5 0 1 1 11.9 2.5 Z', 'M 12 6.5 L 12 12 L 16 14'],
  bell:     ['M 6 17 L 6 11 A 6 6 0 0 1 18 11 L 18 17 L 20 19 L 4 19 Z', 'M 10 21.5 L 14 21.5'],
  chart:    ['M 3 3 L 3 21 L 21 21', 'M 7 16 L 11 11 L 14 14 L 20 7'],
  code:     ['M 8 6 L 2.5 12 L 8 18', 'M 16 6 L 21.5 12 L 16 18', 'M 13.5 4 L 10.5 20'],
  mail:     ['M 2.5 5 L 21.5 5 L 21.5 19 L 2.5 19 Z', 'M 2.5 5 L 12 13 L 21.5 5'],
  key:      ['M 7.5 10 A 4.5 4.5 0 1 1 7.4 10 Z', 'M 11.5 12.5 L 21 12.5 L 21 16', 'M 17.5 12.5 L 17.5 15.5'],
  bucket:   ['M 3 6 A 9 2.5 0 0 1 21 6 A 9 2.5 0 0 1 3 6 Z', 'M 3 6 L 5.5 19.5 A 6.5 2 0 0 0 18.5 19.5 L 21 6'],
  balance:  ['M 12 3 L 12 21', 'M 4 7 L 20 7', 'M 8 21 L 16 21', 'M 4 7 L 1.5 14 C 3 16 5 16 6.5 14 Z', 'M 20 7 L 17.5 14 C 19 16 21 16 22.5 14 Z'],
}

/** Maps absolute 24-grid path data to world space (scale + offset; arc flags untouched). */
function placePath(d: string, ox: number, oy: number, s: number): string {
  const tok = d.match(/[MLACZ]|-?\d*\.?\d+/g) ?? []
  const out: string[] = []
  let i = 0
  while (i < tok.length) {
    const c = tok[i++]
    out.push(c)
    const take = (k: number) => tok.slice(i, i += k).map(Number)
    if (c === 'M' || c === 'L') { const [x, y] = take(2); out.push(`${n(ox + x * s)} ${n(oy + y * s)}`) }
    else if (c === 'C') { const v = take(6); out.push(v.map((q, j) => n(j % 2 ? oy + q * s : ox + q * s)).join(' ')) }
    else if (c === 'A') { const [rx, ry, rot, la, sw, x, y] = take(7); out.push(`${n(rx * s)} ${n(ry * s)} ${rot} ${la} ${sw} ${n(ox + x * s)} ${n(oy + y * s)}`) }
  }
  return out.join(' ')
}

export const iconSize = (h: number) => Math.max(14, Math.min(28, h * 0.42))

// ── Geometry ───────────────────────────────────────────────────────────────────

export function nodeGeometry(kind: NodeKind | undefined, icon: NodeIcon | undefined, b: Box, radius: number): NodeGeometry {
  const { x, y, w, h } = b
  const cx = x + w / 2, cy = y + h / 2
  let outline: string
  let details: string[] = []
  const iconPaths: string[] = []
  let tb: Box = { x: x + PAD, y: y + PAD, w: w - PAD * 2, h: h - PAD * 2 }

  switch (kind) {
    case 'cylinder': {
      const ry = cylCap(w, h), rx = w / 2
      outline = `M ${n(x)} ${n(y + ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)} L ${n(x + w)} ${n(y + h - ry)}`
        + ` A ${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)} Z`
      details = [`M ${n(x)} ${n(y + ry)} A ${n(rx)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}`]
      tb = { x: x + PAD, y: y + ry * 2 + 4, w: w - PAD * 2, h: h - ry * 3 - 8 }
      break
    }
    case 'queue': {
      const rx = queueCap(w, h), ry = h / 2
      outline = `M ${n(x + rx)} ${n(y)} L ${n(x + w - rx)} ${n(y)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + w - rx)} ${n(y + h)}`
        + ` L ${n(x + rx)} ${n(y + h)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx)} ${n(y)} Z`
      details = [`M ${n(x + w - rx)} ${n(y)} A ${n(rx)} ${n(ry)} 0 0 0 ${n(x + w - rx)} ${n(y + h)}`]
      tb = { x: x + rx + 4, y: y + PAD, w: w - rx * 3 - 8, h: h - PAD * 2 }
      break
    }
    case 'diamond':
      outline = poly(kindPolygon(kind, w, h)!.map(([px, py]) => [x + px, y + py]))
      tb = { x: x + w / 4, y: y + h / 4, w: w / 2, h: h / 2 }
      break
    case 'hexagon': {
      outline = poly(kindPolygon(kind, w, h)!.map(([px, py]) => [x + px, y + py]))
      const i = hexInset(w, h)
      tb = { x: x + i * 0.6, y: y + PAD, w: w - i * 1.2, h: h - PAD * 2 }
      break
    }
    case 'parallelogram': {
      outline = poly(kindPolygon(kind, w, h)!.map(([px, py]) => [x + px, y + py]))
      const k = skew(w, h)
      tb = { x: x + k, y: y + PAD, w: w - k * 2, h: h - PAD * 2 }
      break
    }
    case 'document': {
      const a = Math.min(h * 0.1, 14), y0 = y + h - a
      outline = `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y0)}`
        + ` C ${n(x + w * 0.7)} ${n(y0 - a * 2)} ${n(x + w * 0.3)} ${n(y0 + a * 2)} ${n(x)} ${n(y0)} Z`
      tb = { x: x + PAD, y: y + PAD, w: w - PAD * 2, h: h - a * 2 - PAD * 2 }
      break
    }
    case 'cloud': {
      // Scalloped outline: bumps between points on an inner ellipse, bulging outward.
      const N = 9, base = 0.8, bulge = 0.36, rx = w / 2, ry = h / 2
      const pt = (t: number, k: number) => [cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k] as const
      let d = ''
      for (let i = 0; i < N; i++) {
        const t0 = (i / N) * Math.PI * 2 - Math.PI / 2, t1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2
        const [x0, y0] = pt(t0, base), [x1, y1] = pt(t1, base)
        const [c0x, c0y] = pt(t0, base + bulge), [c1x, c1y] = pt(t1, base + bulge)
        if (!i) d = `M ${n(x0)} ${n(y0)}`
        d += ` C ${n(c0x)} ${n(c0y)} ${n(c1x)} ${n(c1y)} ${n(x1)} ${n(y1)}`
      }
      outline = d + ' Z'
      tb = { x: x + w * 0.2, y: y + h * 0.22, w: w * 0.6, h: h * 0.56 }
      break
    }
    case 'stack': {
      const o = Math.min(8, w * 0.06, h * 0.08)
      outline = roundedRectPath(x, y + 2 * o, w - 2 * o, h - 2 * o, radius)
      details = [
        `M ${n(x + o)} ${n(y + 2 * o)} L ${n(x + o)} ${n(y + o)} L ${n(x + w - o)} ${n(y + o)} L ${n(x + w - o)} ${n(y + h - o)} L ${n(x + w - 2 * o)} ${n(y + h - o)}`,
        `M ${n(x + 2 * o)} ${n(y + o)} L ${n(x + 2 * o)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h - 2 * o)} L ${n(x + w - o)} ${n(y + h - 2 * o)}`,
      ]
      tb = { x: x + PAD, y: y + 2 * o + PAD, w: w - 2 * o - PAD * 2, h: h - 2 * o - PAD * 2 }
      break
    }
    case 'browser': {
      const bar = Math.min(22, Math.max(12, h * 0.22)), r = Math.min(3, bar * 0.14)
      outline = roundedRectPath(x, y, w, h, Math.min(radius, bar / 2))
      details = [`M ${n(x)} ${n(y + bar)} L ${n(x + w)} ${n(y + bar)}`]
      for (let i = 0; i < 3; i++) {
        // Full circle as one arc from its top point back to (almost) itself
        const dx = x + bar * 0.5 + i * r * 3.2, top = y + bar / 2 - r
        iconPaths.push(`M ${n(dx)} ${n(top)} A ${n(r)} ${n(r)} 0 1 1 ${n(dx - 0.05)} ${n(top)} Z`)
      }
      tb = { x: x + PAD, y: y + bar + 4, w: w - PAD * 2, h: h - bar - 4 - PAD }
      break
    }
    case 'mobile': {
      const r = Math.min(w, h) * 0.16, top = Math.max(10, h * 0.1)
      outline = roundedRectPath(x, y, w, h, r)
      details = [
        `M ${n(cx - w * 0.12)} ${n(y + top * 0.55)} L ${n(cx + w * 0.12)} ${n(y + top * 0.55)}`,
        `M ${n(cx - w * 0.14)} ${n(y + h - top * 0.5)} L ${n(cx + w * 0.14)} ${n(y + h - top * 0.5)}`,
      ]
      tb = { x: x + PAD, y: y + top + 2, w: w - PAD * 2, h: h - top * 2 - 4 }
      break
    }
    default:
      outline = roundedRectPath(x, y, w, h, radius)
  }

  if (icon && ICONS[icon]) {
    const g = iconSize(tb.h + PAD * 2)
    // Icon sits at the left of the text box, vertically centred on it; the label shifts right.
    if (tb.w > g * 2.2) {
      const s = g / 24, ox = tb.x + 2, oy = tb.y + tb.h / 2 - g / 2
      iconPaths.push(...ICONS[icon].map(d => placePath(d, ox, oy, s)))
      tb = { ...tb, x: tb.x + g + 8, w: tb.w - g - 8 }
    } else {
      // Too narrow for side by side: icon on top, label underneath.
      const s = g / 24, ox = tb.x + tb.w / 2 - g / 2, oy = tb.y
      iconPaths.push(...ICONS[icon].map(d => placePath(d, ox, oy, s)))
      tb = { ...tb, y: tb.y + g + 4, h: tb.h - g - 4 }
    }
  }

  return { outline, details, icon: iconPaths, textBox: { x: tb.x, y: tb.y, w: Math.max(tb.w, 10), h: Math.max(tb.h, 10) } }
}

/** True when a rect must be drawn from path geometry rather than ctx.roundRect. */
export const isNodeShape = (s: { kind?: NodeKind; icon?: NodeIcon }) => !!(s.kind || s.icon)
