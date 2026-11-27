import { uid, TEMPLATE_PLACEHOLDER_COLOR } from './canvasTypes'
import { shapeBounds } from './canvasTypes'
import type { Shape, Point, TextShape, ImageShape, BoundText, ArrowShape, ArrowHead } from './canvasTypes'
import { isBindable, fractionOf } from './canvasBindings'

// Turns Mermaid diagram code (pasted as text, optionally inside a ```mermaid
// fence) into canvas shapes. Mermaid lays the diagram out and renders an SVG
// off-screen; flowcharts are then read back node by node into editable rects,
// ellipses, diamonds, arrows and labels.
// Other diagram kinds (ER, class, state, sequence…) are traced generically from
// the SVG's outlines, markers and text. Charts (pie, gantt…) need their fills,
// so they land as a single picture.
//
// Shapes are stamped with TEMPLATE_PLACEHOLDER_COLOR; the caller recolours them
// to the theme's ink before inserting.

const KEYWORDS = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'gitGraph', 'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram',
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'sankey-beta', 'xychart-beta',
  'block-beta', 'packet-beta', 'architecture-beta', 'kanban', 'radar-beta', 'treemap-beta',
]

/** Returns the bare Mermaid source if `text` looks like a Mermaid diagram, else null. */
export function extractMermaid(text: string): string | null {
  let src = text.trim()
  const fence = src.match(/^(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n\1\s*$/i)
  if (fence) src = fence[2].trim()
  // Skip YAML front matter and %% comments / directives to find the diagram keyword.
  let body = src
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end < 0) return null
    body = body.slice(end + 4)
  }
  const first = body.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%'))
  if (!first) return null
  const word = first.split(/[\s;:{]/)[0]
  return KEYWORDS.includes(word) ? src : null
}

/** Render with `htmlLabels: false` so labels are SVG <text> — readable here and safe to rasterize. */
async function renderSvg(src: string): Promise<string> {
  const mermaid = (await import('mermaid')).default
  // initialize() resets the site config, so this can't leak into the editor's previews
  // (MermaidBlock re-initializes before each of its renders).
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  })
  try {
    const { svg } = await mermaid.render(`canvas-mermaid-${uid()}`, src)
    return svg
  } finally {
    document.querySelectorAll('[id^="dcanvas-mermaid-"]').forEach(n => n.remove())
  }
}

/** Mounts the SVG off-screen at 1 unit = 1 CSS px so getBoundingClientRect gives diagram coordinates. */
function mount(svgText: string): { svg: SVGSVGElement; host: HTMLDivElement } {
  const host = document.createElement('div')
  // opacity (not visibility) so computed strokes/visibility stay readable per element.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;'
  host.innerHTML = svgText
  document.body.appendChild(host)
  const svg = host.querySelector('svg') as SVGSVGElement
  const vb = svg.viewBox.baseVal
  svg.removeAttribute('style')
  if (vb && vb.width && vb.height) {
    svg.setAttribute('width', String(vb.width))
    svg.setAttribute('height', String(vb.height))
  }
  return { svg, host }
}

const FONT = 16

/** Text rows of a label element; mermaid splits wrapped/<br> lines into sibling tspans or text nodes. */
function labelLines(el: Element | null): string[] {
  if (!el) return []
  const texts = [...el.querySelectorAll('text')]
  const rows: string[] = []
  for (const t of texts.length ? texts : [el]) {
    const outer = [...t.children].filter(c => c.tagName.toLowerCase() === 'tspan')
    if (outer.length) {
      for (const row of outer) {
        const words = [...row.querySelectorAll('tspan')]
        const line = (words.length ? words.map(w => w.textContent ?? '').join(' ') : row.textContent ?? '')
        rows.push(line.replace(/\s+/g, ' ').trim())
      }
    } else {
      rows.push((t.textContent ?? '').replace(/\s+/g, ' ').trim())
    }
  }
  return rows.filter(Boolean)
}

function centeredText(lines: string[], cx: number, cy: number, font: string, size = FONT): TextShape[] {
  const lh = size * 1.25
  const top = cy - (lines.length * lh) / 2
  return lines.map((line, i) => {
    const est = Math.max(line.length * size * 0.55, 1)
    return {
      id: uid(), type: 'text', color: TEMPLATE_PLACEHOLDER_COLOR, fill: 'none', width: 1,
      x: cx - est / 2, y: top + size * 0.95 + i * lh,
      text: line, size, fontFamily: font, bold: false, italic: false,
    }
  })
}

/**
 * Groups the pieces of one diagram element so they select and move as a unit:
 * a node with its texts, an edge with its markers and label, a subgraph frame.
 */
function grouper() {
  const ids = new Map<string, string>()
  const anon = new Map<Element, string>()
  const keyOfEl = (el: Element, prefix: string) => {
    if (el.id) return prefix + el.id
    if (!anon.has(el)) anon.set(el, prefix + uid())
    return anon.get(el)!
  }
  const keyOf = (el: Element): string | null => {
    const node = el.closest('g.node')
    if (node) return keyOfEl(node, 'n:')
    const label = el.closest('.edgeLabel')
    if (label) {
      const id = label.querySelector('[data-id]')?.getAttribute('data-id') ?? label.getAttribute('data-id')
      return id ? 'e:' + id : null
    }
    const edge = el.closest('[data-id]')
    if (edge && el.closest('.edgePaths, .edges')) return 'e:' + edge.getAttribute('data-id')
    const cluster = el.closest('g.cluster')
    if (cluster) return keyOfEl(cluster, 'c:')
    return null
  }
  return <T extends Shape>(shapes: T[], el: Element): T[] => {
    const key = keyOf(el)
    if (!key || !shapes.length) return shapes
    if (!ids.has(key)) ids.set(key, uid())
    const groupId = ids.get(key)!
    return shapes.map(sh => ({ ...sh, groupId }))
  }
}

function flowchartShapes(svg: SVGSVGElement, font: string): Shape[] {
  const origin = svg.getBoundingClientRect()
  const box = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }
  }
  const out: Shape[] = []
  const bound = (lines: string[]): BoundText | undefined =>
    lines.length ? { text: lines.join('\n'), size: FONT, fontFamily: font, bold: false, italic: false, color: TEMPLATE_PLACEHOLDER_COLOR } : undefined
  const ink = { color: TEMPLATE_PLACEHOLDER_COLOR, width: 2 }
  const group = grouper()
  const push = (el: Element, ...shapes: Shape[]) => out.push(...group(shapes, el))

  // Subgraphs first so they sit underneath their nodes.
  for (const c of svg.querySelectorAll('g.cluster')) {
    const rect = c.querySelector('rect')
    if (!rect) continue
    const b = box(rect)
    push(c, { id: uid(), type: 'rect', ...ink, fill: 'none', x: b.x, y: b.y, w: b.w, h: b.h, radius: 6 })
    const lines = labelLines(c.querySelector('.cluster-label, .label'))
    if (lines.length) push(c, ...centeredText(lines, b.x + b.w / 2, b.y + 16, font, 14))
  }

  const clusterCount = out.length

  // Edges become arrows (headless for plain links) so they can attach to the nodes below.
  const edges = new Map<string, ArrowShape>()
  for (const p of svg.querySelectorAll<SVGPathElement>('g.edgePaths path, path.flowchart-link')) {
    const len = p.getTotalLength?.() ?? 0
    if (!len) continue
    const m = p.getScreenCTM()
    const toWorld = (q: DOMPoint): Point => {
      const r = m ? q.matrixTransform(m) : q
      return { x: r.x - origin.left, y: r.y - origin.top }
    }
    const a = toWorld(p.getPointAtLength(0))
    const mid = toWorld(p.getPointAtLength(len / 2))
    const b = toWorld(p.getPointAtLength(len))
    const isHead = (v: string | null) => !!v && /point|arrow|cross|circle/.test(v)
    const cls = p.getAttribute('class') ?? ''
    const dashed = /edge-pattern-(dotted|dashed)|dotted-line/.test(cls)
    const thick = /edge-thickness-thick|thick-arrow/.test(cls)
    const width = thick ? 3.5 : dashed ? 1.5 : 2
    const cp = { x: 2 * mid.x - (a.x + b.x) / 2, y: 2 * mid.y - (a.y + b.y) / 2 }
    const straight = Math.abs((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) < 4 * Math.hypot(b.x - a.x, b.y - a.y)
    const arrow: ArrowShape = {
      id: uid(), type: 'arrow', ...ink, width, fill: 'none', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      startHead: isHead(p.getAttribute('marker-start')) ? 'arrow' : 'none',
      endHead: isHead(p.getAttribute('marker-end')) ? 'arrow' : 'none',
      ...(straight ? {} : { cpx: cp.x, cpy: cp.y }),
    }
    edges.set(p.getAttribute('data-id') ?? p.id ?? arrow.id, arrow)
  }

  // Nodes.
  for (const n of svg.querySelectorAll('g.node')) {
    const lines = labelLines(n.querySelector('g.label, .label') ?? n)
    const shapeEl = n.querySelector('rect.label-container, rect.basic, polygon, circle, ellipse, path.label-container, rect, path')
    if (!shapeEl) { if (lines.length) { const b = box(n); push(n, ...centeredText(lines, b.x + b.w / 2, b.y + b.h / 2, font)) } continue }
    const b = box(shapeEl)
    const tag = shapeEl.tagName.toLowerCase()
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const points = tag === 'polygon' ? (shapeEl as SVGPolygonElement).points.numberOfItems : 0
    if (tag === 'circle' || tag === 'ellipse') {
      push(n, { id: uid(), type: 'ellipse', ...ink, fill: 'none', cx, cy, rx: b.w / 2, ry: b.h / 2, ...(bound(lines) ? { boundText: bound(lines) } : {}) })
    } else if (points === 4 || points === 6) {
      // Decision diamond / hexagon: an exact node outline with its label bound inside.
      push(n, { id: uid(), type: 'rect', ...ink, fill: 'none', x: b.x, y: b.y, w: b.w, h: b.h, radius: 0, kind: points === 4 ? 'diamond' : 'hexagon', ...(bound(lines) ? { boundText: bound(lines) } : {}) })
    } else {
      const rx = Number(shapeEl.getAttribute('rx')) || 0
      const rounded = rx > 0 || /round|stadium/.test(n.getAttribute('class') ?? '')
      push(n, { id: uid(), type: 'rect', ...ink, fill: 'none', x: b.x, y: b.y, w: b.w, h: b.h, radius: rounded ? Math.min(Math.max(rx, 10), b.h / 2) : 0, ...(bound(lines) ? { boundText: bound(lines) } : {}) })
    }
  }

  // Edge labels ride on their arrow; any orphan stays free text.
  for (const l of svg.querySelectorAll('g.edgeLabel')) {
    const lines = labelLines(l)
    if (!lines.length) continue
    const id = l.querySelector('[data-id]')?.getAttribute('data-id')
    const arrow = id ? edges.get(id) : undefined
    if (arrow) { arrow.label = { text: lines.join('\n'), size: 14, fontFamily: font, bold: false, italic: false, color: TEMPLATE_PLACEHOLDER_COLOR }; continue }
    const b = box(l)
    if (!b.w && !b.h) continue
    push(l, ...centeredText(lines, b.x + b.w / 2, b.y + b.h / 2, font, 14))
  }
  const arrows = attachArrows([...edges.values()], out)
  // Arrows above subgraph frames, under the nodes — the order Mermaid draws them in.
  return [...out.slice(0, clusterCount), ...arrows, ...out.slice(clusterCount)]
}

/** Pins each arrow end to the bindable shape it touches, at the exact spot Mermaid routed it to. */
function attachArrows(arrows: ArrowShape[], shapes: Shape[], reach = 14): ArrowShape[] {
  const targets = shapes.filter(isBindable)
  const near = (p: Point) => {
    let best: Shape | null = null, bestD = reach
    for (const t of targets) {
      const b = shapeBounds(t)
      const dx = Math.max(b.x - p.x, 0, p.x - b.x - b.w), dy = Math.max(b.y - p.y, 0, p.y - b.y - b.h)
      const d = Math.hypot(dx, dy)
      // Prefer the smallest box the point touches (a node over the subgraph around it).
      if (d < bestD || (d === bestD && best && shapeBounds(t).w * shapeBounds(t).h < shapeBounds(best).w * shapeBounds(best).h)) { best = t; bestD = d }
    }
    return best
  }
  return arrows.map(a => {
    const s = near({ x: a.x1, y: a.y1 }), e = near({ x: a.x2, y: a.y2 })
    const out: ArrowShape = { ...a }
    if (s) out.start = { id: s.id, ...fractionOf(s, { x: a.x1, y: a.y1 }) }
    if (e && e !== s) out.end = { id: e.id, ...fractionOf(e, { x: a.x2, y: a.y2 }) }
    return out
  })
}

// ── Generic SVG → shapes (ER, class, state, sequence, requirement, C4…) ─────────
//
// Reads every stroked outline and every text label off the rendered SVG, in
// document order. Fills are dropped (the canvas draws outlines, like Excalidraw),
// row backgrounds of ER tables are skipped so entities read as one box with a
// header rule, and SVG markers (arrowheads, crow's feet, circles) are traced
// into strokes at each line end.

/** Layout is spread out a little so the hand-drawn font (wider than Mermaid's) still fits. */
const SPREAD = 1.25

type Ctx = { origin: DOMRect; k: number; font: string; svg: SVGSVGElement; scratch: SVGPathElement }

function visibleStroke(el: Element): number {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return 0
  const stroke = cs.stroke
  if (!stroke || stroke === 'none' || /rgba\(.*,\s*0\)$/.test(stroke) || stroke === 'transparent') return 0
  if (Number(cs.strokeOpacity) === 0) return 0
  return parseFloat(cs.strokeWidth) || 0
}

function darkFill(el: Element): boolean {
  const m = getComputedStyle(el).fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/)
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return false
  return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 90
}

const ink = (sw: number) => ({ color: TEMPLATE_PLACEHOLDER_COLOR, width: Math.max(1, Math.min(4, sw * 1.4)), fill: 'none' })

/** Element-local point → canvas world point. */
function worldOf(el: SVGGraphicsElement, c: Ctx) {
  const m = el.getScreenCTM()
  return (x: number, y: number): Point => {
    const p = new DOMPoint(x, y)
    const r = m ? p.matrixTransform(m) : p
    return { x: (r.x - c.origin.left) * c.k, y: (r.y - c.origin.top) * c.k }
  }
}

/** Splits path data at each moveto and samples every subpath into world points. */
function samplePath(d: string, toWorld: (x: number, y: number) => Point, c: Ctx): Point[][] {
  const subs = d.match(/[Mm][^Mm]*/g) ?? []
  let lastAbs: [number, number] = [0, 0]
  const out: Point[][] = []
  for (let sub of subs) {
    // Relative moveto would lose its anchor once split; rebase it on the previous subpath's end.
    if (sub[0] === 'm') {
      const n = sub.slice(1).trim().split(/[\s,]+/).map(Number)
      sub = `M${lastAbs[0] + n[0]},${lastAbs[1] + n[1]}` + sub.slice(1).replace(/^\s*[-\d.eE]+[\s,]+[-\d.eE]+/, '')
    }
    c.scratch.setAttribute('d', sub)
    const len = c.scratch.getTotalLength()
    const end = c.scratch.getPointAtLength(len)
    lastAbs = [end.x, end.y]
    if (!len) continue
    // Pure polylines keep their exact corners; curves are sampled.
    const pts: Point[] = []
    if (!/[CcQqSsTtAa]/.test(sub)) {
      const nums = sub.match(/[MLHVZmlhvz]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []
      let cmd = 'M', x = 0, y = 0, sx = 0, sy = 0
      for (let i = 0; i < nums.length;) {
        if (/[a-z]/i.test(nums[i])) { cmd = nums[i++]; if (/z/i.test(cmd)) { x = sx; y = sy; pts.push(toWorld(x, y)) } continue }
        const rel = cmd === cmd.toLowerCase()
        const C = cmd.toUpperCase()
        if (C === 'H') { x = (rel ? x : 0) + Number(nums[i++]) }
        else if (C === 'V') { y = (rel ? y : 0) + Number(nums[i++]) }
        else { x = (rel ? x : 0) + Number(nums[i++]); y = (rel ? y : 0) + Number(nums[i++]) }
        if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L' }
        pts.push(toWorld(x, y))
      }
    } else {
      const steps = Math.min(60, Math.max(8, Math.ceil(len / 6)))
      for (let i = 0; i <= steps; i++) { const q = c.scratch.getPointAtLength((len * i) / steps); pts.push(toWorld(q.x, q.y)) }
    }
    if (pts.length >= 2) out.push(pts)
  }
  return out
}

/** Inserts points every few px so a straight segment can be cut part-way. */
function densify(strokes: Point[][]): Point[][] {
  return strokes.map(pts => pts.flatMap((p, i) => {
    if (i === 0) return [p]
    const a = pts[i - 1], n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 3)
    return Array.from({ length: n }, (_, j) => ({ x: a.x + ((p.x - a.x) * (j + 1)) / n, y: a.y + ((p.y - a.y) * (j + 1)) / n }))
  }))
}

function bbox(pts: Point[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Turns a set of sampled strokes into the simplest shapes: a rect, straight lines, or paths. */
function strokesToShapes(strokes: Point[][], sw: number, c: Ctx): Shape[] {
  if (!strokes.length) return []
  const all = strokes.flat()
  const b = bbox(all)
  const tol = 1.5 * c.k
  const onBorder = (p: Point) => Math.abs(p.x - b.x) < tol || Math.abs(p.x - b.x - b.w) < tol || Math.abs(p.y - b.y) < tol || Math.abs(p.y - b.y - b.h) < tol
  // Rough.js draws each rectangle edge twice; any outline that hugs its own box is a rectangle.
  if (b.w > 4 && b.h > 4 && all.length >= 4 && all.every(onBorder)) {
    const sides = [all.some(p => Math.abs(p.x - b.x) < tol), all.some(p => Math.abs(p.x - b.x - b.w) < tol), all.some(p => Math.abs(p.y - b.y) < tol), all.some(p => Math.abs(p.y - b.y - b.h) < tol)]
    const spans = (pred: (p: Point) => boolean, axis: 'x' | 'y', span: number) => { const v = all.filter(pred).map(p => p[axis]); return v.length > 1 && Math.max(...v) - Math.min(...v) > span * 0.8 }
    if (sides.every(Boolean)
      && spans(p => Math.abs(p.y - b.y) < tol, 'x', b.w) && spans(p => Math.abs(p.y - b.y - b.h) < tol, 'x', b.w)
      && spans(p => Math.abs(p.x - b.x) < tol, 'y', b.h) && spans(p => Math.abs(p.x - b.x - b.w) < tol, 'y', b.h)) {
      return [{ id: uid(), type: 'rect', ...ink(sw), x: b.x, y: b.y, w: b.w, h: b.h, radius: 0 }]
    }
  }
  const out: Shape[] = []
  for (const pts of strokes) {
    const a = pts[0], z = pts[pts.length - 1]
    const L = Math.hypot(z.x - a.x, z.y - a.y)
    const straight = L > 0.5 && pts.every(p => Math.abs((z.x - a.x) * (p.y - a.y) - (z.y - a.y) * (p.x - a.x)) / L < tol)
    if (straight) out.push({ id: uid(), type: 'line', ...ink(sw), x1: a.x, y1: a.y, x2: z.x, y2: z.y })
    else out.push({ id: uid(), type: 'path', ...ink(sw), pts })
  }
  return out
}

function elementStrokes(el: SVGGraphicsElement, c: Ctx, toWorld = worldOf(el, c)): Point[][] {
  const tag = el.tagName.toLowerCase()
  const num = (a: string) => Number(el.getAttribute(a)) || 0
  if (tag === 'path') return samplePath(el.getAttribute('d') ?? '', toWorld, c)
  if (tag === 'line') return [[toWorld(num('x1'), num('y1')), toWorld(num('x2'), num('y2'))]]
  if (tag === 'rect') {
    const x = num('x'), y = num('y'), w = num('width'), h = num('height')
    if (!w || !h) return []
    return [[toWorld(x, y), toWorld(x + w, y), toWorld(x + w, y + h), toWorld(x, y + h), toWorld(x, y)]]
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = [...(el as SVGPolygonElement).points].map(p => toWorld(p.x, p.y))
    if (tag === 'polygon' && pts.length) pts.push(pts[0])
    return pts.length >= 2 ? [pts] : []
  }
  return []
}

function ellipseShape(el: SVGGraphicsElement, sw: number, c: Ctx, toWorld = worldOf(el, c), filled = false): Shape | null {
  const n = (a: string) => Number(el.getAttribute(a)) || 0
  const rx = el.tagName.toLowerCase() === 'circle' ? n('r') : n('rx')
  const ry = el.tagName.toLowerCase() === 'circle' ? n('r') : n('ry')
  if (!rx || !ry) return null
  const ctr = toWorld(n('cx'), n('cy'))
  const edge = toWorld(n('cx') + rx, n('cy')), edgeY = toWorld(n('cx'), n('cy') + ry)
  return {
    id: uid(), type: 'ellipse', ...ink(sw), ...(filled ? { fill: TEMPLATE_PLACEHOLDER_COLOR } : {}),
    cx: ctr.x, cy: ctr.y, rx: Math.hypot(edge.x - ctr.x, edge.y - ctr.y), ry: Math.hypot(edgeY.x - ctr.x, edgeY.y - ctr.y),
  }
}

/** Traces a marker (arrowhead, crow's foot…) at one end of a path, the way the browser places it. */
function markerShapes(path: SVGPathElement, which: 'start' | 'end', c: Ctx): Shape[] {
  const ref = path.getAttribute(`marker-${which}`)?.match(/url\(#(.+)\)/)?.[1]
  const marker = ref ? c.svg.querySelector<SVGMarkerElement>(`marker[id="${CSS.escape(ref)}"]`) : null
  if (!marker) return []
  const len = path.getTotalLength()
  if (!len) return []
  const toPath = worldOf(path, c)
  const at = which === 'start' ? 0 : len
  const eps = Math.min(1, len / 4)
  const p0 = path.getPointAtLength(which === 'start' ? 0 : len - eps), p1 = path.getPointAtLength(which === 'start' ? eps : len)
  const anchor = path.getPointAtLength(at)
  const angle = marker.getAttribute('orient') === 'auto-start-reverse' && which === 'start'
    ? Math.atan2(p0.y - p1.y, p0.x - p1.x)
    : Math.atan2(p1.y - p0.y, p1.x - p0.x)
  const units = marker.getAttribute('markerUnits') ?? 'strokeWidth'
  let scale = units === 'strokeWidth' ? (parseFloat(getComputedStyle(path).strokeWidth) || 1) : 1
  const vb = marker.viewBox.baseVal
  const refX = Number(marker.getAttribute('refX')) || 0, refY = Number(marker.getAttribute('refY')) || 0
  if (vb && vb.width && vb.height) scale *= (Number(marker.getAttribute('markerWidth')) || 3) / vb.width
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const toWorld = (x: number, y: number) => {
    const dx = (x - refX) * scale, dy = (y - refY) * scale
    return toPath(anchor.x + dx * cos - dy * sin, anchor.y + dx * sin + dy * cos)
  }
  const sw = parseFloat(getComputedStyle(path).strokeWidth) || 1
  // Mermaid lets half of some markers (ER crow's feet) run under the node box, whose fill
  // hides it. Outlines have no fill, so keep only the part on the line's side of the anchor.
  const erMarker = /(^|\s)er(\s|$)/.test(marker.getAttribute('class') ?? '') || /_er-/.test(marker.id)
  const keep = (x: number) => !erMarker || (which === 'end' ? x <= refX + 0.5 : x >= refX - 0.5)
  const local = (x: number, y: number): Point => ({ x, y })
  const out: Shape[] = []
  for (const child of marker.querySelectorAll<SVGGraphicsElement>('path, line, polygon, polyline, rect, circle, ellipse')) {
    const tag = child.tagName.toLowerCase()
    if (tag === 'circle' || tag === 'ellipse') {
      if (!keep(Number(child.getAttribute('cx')) || 0)) continue
      const e = ellipseShape(child, sw, c, toWorld, darkFill(child))
      if (e) out.push(e)
      continue
    }
    for (const pts of elementStrokes(child, c, local)) {
      let run: Point[] = []
      const flush = () => { if (run.length >= 2) out.push(...strokesToShapes([run.map(q => toWorld(q.x, q.y))], sw, c)); run = [] }
      for (const q of pts) { if (keep(q.x)) run.push(q); else flush() }
      flush()
    }
  }
  return out
}

function textShapesOf(el: SVGTextElement, c: Ctx): TextShape[] {
  const lines = labelLines(el)
  if (!lines.length) return []
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return []
  const cs = getComputedStyle(el)
  const size = Math.round((parseFloat(cs.fontSize) || FONT) * Math.min(c.k, 1.15))
  const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold'
  const anchor = el.getAttribute('text-anchor') ?? el.querySelector('tspan')?.getAttribute('text-anchor') ?? cs.textAnchor
  const left = (r.left - c.origin.left) * c.k, top = (r.top - c.origin.top) * c.k
  const w = r.width * c.k, h = r.height * c.k
  const lh = h / lines.length
  return lines.map((line, i) => {
    const est = line.length * size * 0.55
    const x = anchor === 'middle' ? left + w / 2 - est / 2 : anchor === 'end' ? left + w - est : left
    return {
      id: uid(), type: 'text', color: TEMPLATE_PLACEHOLDER_COLOR, fill: 'none', width: 1,
      x, y: top + i * lh + lh / 2 + size * 0.35, text: line, size, fontFamily: c.font, bold, italic: false,
    }
  })
}

function genericShapes(svg: SVGSVGElement, font: string): Shape[] {
  const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.appendChild(scratch)
  const c: Ctx = { origin: svg.getBoundingClientRect(), k: SPREAD, font, svg, scratch }
  const out: Shape[] = []
  const labels: Shape[] = []
  const group = grouper()
  const er = /^er$/i.test(svg.getAttribute('aria-roledescription') ?? '')
  const erEdges: SVGPathElement[] = []
  const erLabels = new Map<string, string>()
  const entityBoxes: Shape[] = []
  try {
    const gaps = [...svg.querySelectorAll('.edgeLabel text')].map(t => {
      const r = t.getBoundingClientRect(), pad = 4
      return { x: (r.left - c.origin.left - pad) * c.k, y: (r.top - c.origin.top - pad) * c.k, w: (r.width + pad * 2) * c.k, h: (r.height + pad * 2) * c.k }
    }).filter(g => g.w > 10 * c.k)
    const els = svg.querySelectorAll<SVGGraphicsElement>('path, line, rect, polygon, polyline, circle, ellipse, text')
    for (const el of els) {
      if (el === scratch || el.closest('defs, marker, clipPath, mask, pattern, symbol')) continue
      // ER relationships become attached arrows (built below), labels included.
      if (er && el.closest('.edgePaths, .edgeLabel')) {
        if (el.tagName.toLowerCase() === 'path' && el.closest('.edgePaths')) erEdges.push(el as SVGPathElement)
        else if (el.tagName.toLowerCase() === 'text') {
          const id = el.closest('.edgeLabel')?.querySelector('[data-id]')?.getAttribute('data-id')
          if (id) erLabels.set(id, labelLines(el).join('\n'))
        }
        continue
      }
      if (el.tagName.toLowerCase() === 'text') {
        // Nested <text> inside a label group is visited on its own; skip text that is only whitespace.
        labels.push(...group(textShapesOf(el as SVGTextElement, c), el))
        continue
      }
      // ER tables: drop the per-row boxes; a single rule under the title replaces them.
      const entity = el.closest('g.node')
      if (entity?.querySelector('[class*="row-rect"]') && !el.closest('.outer-path')) continue
      if (el.closest('.label, .edgeLabel') && el.tagName.toLowerCase() === 'rect') continue
      const sw = visibleStroke(el)
      const tag = el.tagName.toLowerCase()
      if (tag === 'circle' || tag === 'ellipse') {
        const filled = darkFill(el)
        if (!sw && !filled) continue
        const e = ellipseShape(el, sw || 1, c, undefined, filled)
        if (e) out.push(...group([e], el))
        continue
      }
      if (!sw) continue
      if (tag === 'path' && el.closest('.edgePaths, .edges')) {
        // Leave a gap where an edge label sits on the line, like Mermaid's label background does.
        const runs: Point[][] = []
        for (const pts of densify(elementStrokes(el, c))) {
          let run: Point[] = []
          for (const q of pts) { if (gaps.some(g => q.x > g.x && q.x < g.x + g.w && q.y > g.y && q.y < g.y + g.h)) { if (run.length >= 2) runs.push(run); run = [] } else run.push(q) }
          if (run.length >= 2) runs.push(run)
        }
        out.push(...group(runs.flatMap(r => strokesToShapes([r], sw, c)), el))
      } else {
        const made = group(strokesToShapes(elementStrokes(el, c), sw, c), el)
        if (er && el.closest('.outer-path')) entityBoxes.push(...made.filter(m => m.type === 'rect'))
        out.push(...made)
      }
      if (tag === 'path') {
        out.push(...group([...markerShapes(el as SVGPathElement, 'start', c), ...markerShapes(el as SVGPathElement, 'end', c)], el))
      } else if (tag === 'line') {
        // Sequence diagrams put arrowheads on <line> messages; reuse the path tracer via a twin path.
        const twin = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        const n = (a: string) => el.getAttribute(a) ?? '0'
        twin.setAttribute('d', `M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`)
        for (const a of ['marker-start', 'marker-end', 'transform']) { const v = el.getAttribute(a); if (v) twin.setAttribute(a, v) }
        twin.setAttribute('style', `stroke-width:${getComputedStyle(el).strokeWidth}`)
        el.parentNode?.insertBefore(twin, el)
        out.push(...markerShapes(twin, 'start', c), ...markerShapes(twin, 'end', c))
        twin.remove()
      }
    }
    // ER header rule: a line across the entity at the top of its first attribute row.
    for (const node of svg.querySelectorAll<SVGGraphicsElement>('g.node')) {
      const rows = [...node.querySelectorAll('[class*="row-rect"]')]
      if (!rows.length) continue
      const nb = (node.querySelector('.outer-path') ?? node).getBoundingClientRect(), first = rows.map(r => r.getBoundingClientRect().top)
      const y = (Math.min(...first) - c.origin.top) * c.k
      const x1 = (nb.left - c.origin.left) * c.k, x2 = (nb.right - c.origin.left) * c.k
      out.push(...group([{ id: uid(), type: 'line', ...ink(1.3), x1, y1: y, x2, y2: y } as Shape], node))
    }
    if (er) {
      const arrows: ArrowShape[] = []
      for (const p of erEdges) {
        const len = p.getTotalLength()
        if (!len) continue
        const w = worldOf(p, c)
        const at = (d: number) => { const q = p.getPointAtLength(d); return w(q.x, q.y) }
        const a = at(0), b = at(len)
        const id = p.getAttribute('data-id') ?? ''
        const text = erLabels.get(id)
        arrows.push({
          id: uid(), type: 'arrow', color: TEMPLATE_PLACEHOLDER_COLOR, fill: 'none', width: 1.5,
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          startHead: erHead(p.getAttribute('marker-start')), endHead: erHead(p.getAttribute('marker-end')),
          ...(text ? { label: { text, size: 14, fontFamily: font, bold: false, italic: false, color: TEMPLATE_PLACEHOLDER_COLOR } } : {}),
        })
      }
      out.unshift(...attachArrows(arrows, entityBoxes, 20 * c.k))
    }
  } finally {
    scratch.remove()
  }
  return [...out, ...labels]
}

/** Mermaid ER marker id → crow's-foot end. */
function erHead(marker: string | null): ArrowHead {
  if (!marker) return 'none'
  if (/zeroOrMore/.test(marker)) return 'zeroMany'
  if (/oneOrMore/.test(marker)) return 'many'
  if (/zeroOrOne/.test(marker)) return 'zeroOne'
  if (/onlyOne/.test(marker)) return 'one'
  return 'arrow'
}

/** Diagram kinds that depend on fills/colour (charts) and so stay pictures. */
const PICTURE_KINDS = /pie|gantt|xychart|quadrant|sankey|radar|treemap|packet|gitGraph|journey|timeline|mindmap|kanban/i

/** SVG → PNG data URL (WebKit won't always paint an SVG image into a canvas cleanly). */
async function rasterize(svgText: string, w: number, h: number): Promise<string> {
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText)
  try {
    const img = new Image()
    img.src = svgUrl
    await img.decode()
    const scale = 2
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } catch {
    return svgUrl
  }
}

/**
 * Converts Mermaid source to shapes in diagram coordinates (top-left near 0,0).
 * Throws with Mermaid's message when the code doesn't parse.
 */
export async function mermaidToShapes(src: string, font: string): Promise<Shape[]> {
  const svgText = await renderSvg(src)
  const { svg, host } = mount(svgText)
  try {
    const kind = svg.getAttribute('aria-roledescription') ?? ''
    if (/flowchart/.test(kind) && svg.querySelector('g.node')) {
      const shapes = flowchartShapes(svg, font)
      if (shapes.length) return shapes
    }
    if (!PICTURE_KINDS.test(kind)) {
      const shapes = genericShapes(svg, font)
      if (shapes.length > 1) return shapes
    }
    const r = svg.getBoundingClientRect()
    const w = r.width || 400, h = r.height || 300
    const src = await rasterize(new XMLSerializer().serializeToString(svg), w, h)
    const img: ImageShape = { id: uid(), type: 'image', color: TEMPLATE_PLACEHOLDER_COLOR, fill: 'none', width: 1, x: 0, y: 0, w, h, src }
    return [img]
  } finally {
    host.remove()
  }
}
