import type { Shape, ArrowShape, BoundText, ArrowHead } from './canvasTypes'
import { uid, shapeBounds, TEMPLATE_PLACEHOLDER_COLOR } from './canvasTypes'
import type { TemplateCategory } from './canvasTemplates'
import { nodeGeometry, roundedRectPath, type NodeKind, type NodeIcon } from './canvasNodeShapes'
import { arrowEnds, headGeometry, startHeadOf, endHeadOf } from './canvasBindings'
import { BOUND_LINE_HEIGHT, ELLIPSE_TEXT_RATIO } from './canvasShared'

const C  = TEMPLATE_PLACEHOLDER_COLOR
const FN = 'Kalam, "Comic Sans MS", cursive'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function s(fields: Record<string, any>): Shape {
  return { id: uid(), color: C, fill: 'none', width: 2, ...fields } as Shape
}
function txt(x: number, y: number, text: string, bold = false, size = 13): Shape {
  return s({ type: 'text', x, y, text, size, fontFamily: FN, bold, italic: false, width: 1 })
}
function label(text: string, size = 15, bold = false): BoundText {
  return { text, size, fontFamily: FN, bold, italic: false, color: C }
}

interface NodeOpts { kind?: NodeKind; icon?: NodeIcon; radius?: number; width?: number; size?: number; bold?: boolean; x?: number; y?: number }

/** A labelled node centred on the origin (or at x/y): the label is bound, so it stays centred whatever the font. */
function node(w: number, h: number, text: string, o: NodeOpts = {}): Shape {
  return s({
    type: 'rect', x: o.x ?? -w / 2, y: o.y ?? -h / 2, w, h, radius: o.radius ?? 8, width: o.width ?? 2,
    ...(o.kind ? { kind: o.kind } : {}), ...(o.icon ? { icon: o.icon } : {}),
    ...(text ? { boundText: label(text, o.size, o.bold) } : {}),
  })
}
function oval(rx: number, ry: number, text: string, bold = false, width = 1.5): Shape {
  return s({ type: 'ellipse', cx: 0, cy: 0, rx, ry, width, boundText: label(text, 14, bold) })
}
function arrow(len: number, text: string, startHead: ArrowHead = 'none', endHead: ArrowHead = 'arrow'): Shape {
  return s({ type: 'arrow', x1: -len / 2, y1: 0, x2: len / 2, y2: 0, width: 1.5, startHead, endHead, ...(text ? { label: label(text, 13) } : {}) })
}

export interface CategoryElement {
  id:     string
  name:   string
  hint:   string
  create: () => Shape[]
}

// ─────────────────────────────────────────────────────────────────────────────
//  DIAGRAMS
// ─────────────────────────────────────────────────────────────────────────────

const DIAGRAM_ELEMENTS: CategoryElement[] = [
  { id: 'diag-process',  name: 'Process',        hint: 'Process step',             create: () => [node(180, 64, 'Process', { radius: 6 })] },
  { id: 'diag-decision', name: 'Decision',       hint: 'Yes / no branch',          create: () => [node(180, 110, 'Yes / No?', { kind: 'diamond' })] },
  { id: 'diag-terminal', name: 'Start / End',    hint: 'Terminator pill',          create: () => [node(160, 56, 'Start', { radius: 28 })] },
  { id: 'diag-io',       name: 'Input / Output', hint: 'Data in or out',           create: () => [node(190, 64, 'Input', { kind: 'parallelogram' })] },
  { id: 'diag-document', name: 'Document',       hint: 'Document / report',        create: () => [node(170, 90, 'Document', { kind: 'document' })] },
  { id: 'diag-store',    name: 'Data Store',     hint: 'Stored data',              create: () => [node(140, 100, 'Data', { kind: 'cylinder' })] },
  { id: 'diag-connector', name: 'Arrow',         hint: 'Labeled directional arrow', create: () => [arrow(200, 'label')] },
  {
    id: 'diag-annotation', name: 'Annotation', hint: 'Bracket note with pointer',
    create: () => [
      s({ type: 'line', x1: 0, y1: -40, x2: 0, y2: 40, width: 1.5 }),
      s({ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0, width: 1 }),
      txt(66, 5, 'note here', false, 13),
    ],
  },
  {
    id: 'diag-swimlane', name: 'Swim Lane', hint: 'Horizontal lane with header',
    create: () => [
      node(70, 160, 'Lane A', { x: -240, y: -80, radius: 0, width: 1.5 }),
      node(400, 160, '', { x: -170, y: -80, radius: 0, width: 1.5 }),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const DB_ELEMENTS: CategoryElement[] = [
  { id: 'db-database', name: 'Database', hint: 'Cylinder database', create: () => [node(140, 110, 'Database', { kind: 'cylinder' })] },
  {
    id: 'db-entity', name: 'Entity Table', hint: 'Entity with 3 fields',
    create: () => [
      node(180, 38, 'Entity', { x: 0, y: 0, radius: 0, bold: true }),
      s({ type: 'rect', x: 0, y: 38, w: 180, h: 92, radius: 0, width: 1.5 }),
      txt(12, 62,  'PK  id : INT',      false, 13),
      txt(12, 88,  'name : VARCHAR',    false, 13),
      txt(12, 114, 'created_at : DATE', false, 13),
    ],
  },
  {
    id: 'db-junction', name: 'Junction Table', hint: 'Many-to-many bridge',
    create: () => [
      node(180, 38, 'A_B', { x: 0, y: 0, radius: 0, bold: true }),
      s({ type: 'rect', x: 0, y: 38, w: 180, h: 66, radius: 0, width: 1.5 }),
      txt(12, 62, 'FK  a_id : INT', false, 13),
      txt(12, 88, 'FK  b_id : INT', false, 13),
    ],
  },
  { id: 'db-one-many',  name: 'One to Many',  hint: "Crow's-foot 1:N", create: () => [arrow(220, 'has', 'one', 'many')] },
  { id: 'db-many-many', name: 'Many to Many', hint: "Crow's-foot N:M", create: () => [arrow(220, '', 'many', 'many')] },
  { id: 'db-zero-one',  name: 'Optional 1:1', hint: "Crow's-foot 1:0..1", create: () => [arrow(220, '', 'one', 'zeroOne')] },
  { id: 'db-relationship', name: 'Relationship', hint: 'ER (Chen) relationship', create: () => [node(150, 90, 'relates', { kind: 'diamond', width: 1.5 })] },
  { id: 'db-attribute',  name: 'Attribute',   hint: 'ER attribute oval', create: () => [oval(80, 30, 'attribute')] },
  { id: 'db-pk-attribute', name: 'Key Attribute', hint: 'ER primary key oval', create: () => [oval(80, 30, 'id', true, 2)] },
  { id: 'db-note', name: 'DB Note', hint: 'Schema annotation', create: () => [node(200, 80, 'Note: indexed on email', { kind: 'document', width: 1.5, size: 13 })] },
]

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────

const ARCH_ELEMENTS: CategoryElement[] = [
  { id: 'arch-client',   name: 'Web Client',     hint: 'Browser / web app',          create: () => [node(180, 110, 'Web App', { kind: 'browser', radius: 6 })] },
  { id: 'arch-mobile',   name: 'Mobile App',     hint: 'Phone client',               create: () => [node(96, 160, 'Mobile', { kind: 'mobile' })] },
  { id: 'arch-user',     name: 'User',           hint: 'Person / actor',             create: () => [node(150, 64, 'User', { icon: 'user', radius: 32 })] },
  { id: 'arch-server',   name: 'Service / API',  hint: 'Backend service',            create: () => [node(180, 72, 'API Service', { icon: 'code' })] },
  { id: 'arch-gateway',  name: 'API Gateway',    hint: 'Edge / gateway',             create: () => [node(190, 80, 'API Gateway', { kind: 'hexagon' })] },
  { id: 'arch-lb',       name: 'Load Balancer',  hint: 'Distributes traffic',        create: () => [node(190, 72, 'Load Balancer', { icon: 'balance' })] },
  { id: 'arch-db',       name: 'Database',       hint: 'SQL / NoSQL database',       create: () => [node(150, 120, 'Database\nPostgres', { kind: 'cylinder' })] },
  { id: 'arch-cache',    name: 'Cache',          hint: 'Redis / in-memory cache',    create: () => [node(180, 72, 'Cache\nRedis', { icon: 'bolt', radius: 36 })] },
  { id: 'arch-search',   name: 'Search',         hint: 'Search index',               create: () => [node(200, 72, 'Search\nElasticsearch', { icon: 'search' })] },
  { id: 'arch-queue',    name: 'Message Queue',  hint: 'Queue / topic / stream',     create: () => [node(220, 72, 'Queue', { kind: 'queue' })] },
  { id: 'arch-storage',  name: 'Object Storage', hint: 'S3 / blob bucket',           create: () => [node(180, 72, 'Storage\nS3', { icon: 'bucket' })] },
  { id: 'arch-cdn',      name: 'CDN / Internet', hint: 'Cloud, CDN or internet',     create: () => [node(200, 120, 'CDN', { kind: 'cloud' })] },
  { id: 'arch-fn',       name: 'Function',       hint: 'Serverless function',        create: () => [node(170, 72, 'Function', { icon: 'function' })] },
  { id: 'arch-worker',   name: 'Worker',         hint: 'Background worker / job',    create: () => [node(170, 72, 'Worker', { icon: 'gear' })] },
  { id: 'arch-vm',       name: 'Server / VM',    hint: 'Host machine',               create: () => [node(170, 72, 'Server', { icon: 'server', radius: 4 })] },
  { id: 'arch-container', name: 'Container',     hint: 'Docker / pod',               create: () => [node(170, 72, 'Container', { icon: 'box' })] },
  { id: 'arch-replicas', name: 'Replicas',       hint: 'Scaled instances',           create: () => [node(180, 84, 'Service ×3', { kind: 'stack', radius: 6 })] },
  { id: 'arch-auth',     name: 'Auth',           hint: 'Identity / auth service',    create: () => [node(160, 72, 'Auth', { icon: 'lock' })] },
  { id: 'arch-scheduler', name: 'Scheduler',     hint: 'Cron / scheduled jobs',      create: () => [node(170, 72, 'Scheduler', { icon: 'clock' })] },
  { id: 'arch-notify',   name: 'Notifications',  hint: 'Push / pub-sub',             create: () => [node(190, 72, 'Notifications', { icon: 'bell' })] },
  { id: 'arch-email',    name: 'Email',          hint: 'Mail provider',              create: () => [node(160, 72, 'Email', { icon: 'mail' })] },
  { id: 'arch-analytics', name: 'Analytics',     hint: 'Metrics / warehouse',        create: () => [node(180, 72, 'Analytics', { icon: 'chart' })] },
  { id: 'arch-secrets',  name: 'Secrets',        hint: 'Vault / KMS',                create: () => [node(160, 72, 'Secrets', { icon: 'key' })] },
  { id: 'arch-external', name: 'External API',   hint: 'Third-party service',        create: () => [node(180, 72, 'Stripe', { icon: 'globe' })] },
  {
    id: 'arch-boundary', name: 'Boundary', hint: 'VPC / region / subnet frame',
    create: () => [
      s({ type: 'rect', x: -200, y: -130, w: 400, h: 260, radius: 12, width: 1.5 }),
      txt(-186, -106, 'VPC', true, 14),
    ],
  },
  { id: 'arch-arrow-label', name: 'Labeled Arrow', hint: 'HTTP / gRPC / event connector', create: () => [arrow(220, 'HTTP')] },
]

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN
// ─────────────────────────────────────────────────────────────────────────────

const DESIGN_ELEMENTS: CategoryElement[] = [
  { id: 'ui-button', name: 'Button', hint: 'Primary action button', create: () => [node(160, 52, 'Button', { radius: 12, bold: true })] },
  {
    id: 'ui-input', name: 'Input Field', hint: 'Text input with label',
    create: () => [
      txt(-140, -34, 'Label', false, 13),
      s({ type: 'rect', x: -140, y: -24, w: 280, h: 52, radius: 8, width: 1.5 }),
      txt(-126, 7, 'Placeholder…', false, 13),
    ],
  },
  {
    id: 'ui-card', name: 'Card', hint: 'Content card container',
    create: () => [
      s({ type: 'rect', x: -130, y: -120, w: 260, h: 240, radius: 16, width: 1.5 }),
      node(260, 100, 'Image', { x: -130, y: -120, radius: 16, width: 1 }),
      txt(-114, 6, 'Card Title', true, 15),
      txt(-114, 30, 'Description text', false, 13),
      node(110, 40, 'Action', { x: -114, y: 52, radius: 8, width: 1.5, size: 14 }),
    ],
  },
  { id: 'ui-badge', name: 'Badge / Chip', hint: 'Status or category pill', create: () => [node(120, 36, 'Badge', { radius: 18, width: 1.5, size: 13 })] },
  {
    id: 'ui-checkbox', name: 'Checkbox', hint: 'Checkbox with label',
    create: () => [
      s({ type: 'rect', x: -12, y: -12, w: 24, h: 24, radius: 4, width: 1.5 }),
      s({ type: 'path', pts: [{ x: -6, y: 1 }, { x: -1, y: 6 }, { x: 7, y: -6 }], width: 2 }),
      txt(22, 5, 'Option label', false, 14),
    ],
  },
  {
    id: 'ui-toggle', name: 'Toggle Switch', hint: 'On/Off toggle control',
    create: () => [
      s({ type: 'rect', x: -36, y: -14, w: 72, h: 28, radius: 14, width: 1.5 }),
      s({ type: 'ellipse', cx: 22, cy: 0, rx: 10, ry: 10, width: 1.5 }),
      txt(46, 5, 'On', false, 14),
    ],
  },
  {
    id: 'ui-nav', name: 'Nav Bar', hint: 'Top navigation header',
    create: () => [
      s({ type: 'rect', x: -200, y: -28, w: 400, h: 56, radius: 6, width: 1.5 }),
      txt(-186, 5, 'Logo', true, 15),
      txt(-40, 5, 'Home', false, 13),
      txt(30, 5, 'About', false, 13),
      node(72, 34, 'Sign in', { x: 118, y: -17, radius: 8, width: 1.5, size: 12 }),
    ],
  },
  {
    id: 'ui-modal', name: 'Modal / Dialog', hint: 'Overlay dialog container',
    create: () => [
      s({ type: 'rect', x: -160, y: -120, w: 320, h: 240, radius: 14, width: 2 }),
      s({ type: 'line', x1: -160, y1: -76, x2: 160, y2: -76, width: 1 }),
      txt(-144, -92, 'Dialog Title', true, 15),
      txt(134, -92, '×', false, 18),
      txt(-144, -44, 'Body content goes here.', false, 13),
      txt(-144, -22, 'Supporting detail text.', false, 13),
      node(130, 46, 'Cancel', { x: -144, y: 56, radius: 8, width: 1.5, size: 14 }),
      node(130, 46, 'Confirm', { x: 14, y: 56, radius: 8, width: 2, size: 14, bold: true }),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Previews — drawn from the element's real shapes, so the card matches the canvas
// ─────────────────────────────────────────────────────────────────────────────

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (v: number) => +v.toFixed(2)

function textLines(bt: BoundText, cx: number, cy: number): string {
  const lines = bt.text.split('\n'), lh = bt.size * BOUND_LINE_HEIGHT
  const y0 = cy - (lines.length * lh) / 2 + lh / 2
  return lines.map((l, i) =>
    `<text x="${r2(cx)}" y="${r2(y0 + i * lh)}" font-size="${bt.size}" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none"${bt.bold ? ' font-weight="600"' : ''}>${esc(l)}</text>`,
  ).join('')
}

function previewSvg(shapes: Shape[]): string {
  const bs = shapes.map(shapeBounds)
  const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y))
  const w = Math.max(...bs.map(b => b.x + b.w)) - x, h = Math.max(...bs.map(b => b.y + b.h)) - y
  const pad = Math.max(w, h) * 0.08 + 6
  const k = Math.max(w, h) / 90 // keeps strokes ~1.3px however large the element is
  const body = shapes.map(sh => {
    const sw = r2(Math.max(0.6, Math.min(sh.width, 2)) * k * 0.75)
    const st = `stroke="currentColor" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"`
    switch (sh.type) {
      case 'rect': {
        const b = shapeBounds(sh)
        const g = nodeGeometry(sh.kind, sh.icon, b, sh.radius ?? 0)
        const outline = sh.kind || sh.icon ? g.outline : roundedRectPath(b.x, b.y, b.w, b.h, sh.radius ?? 0)
        const tb = g.textBox
        return `<path d="${outline}" ${st}/>` + [...g.details, ...g.icon].map(d => `<path d="${d}" ${st}/>`).join('')
          + (sh.boundText?.text ? textLines(sh.boundText, tb.x + tb.w / 2, tb.y + tb.h / 2) : '')
      }
      case 'ellipse':
        return `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${Math.abs(sh.rx)}" ry="${Math.abs(sh.ry)}" ${st}/>`
          + (sh.boundText?.text ? textLines({ ...sh.boundText, size: Math.min(sh.boundText.size, sh.ry * 2 * ELLIPSE_TEXT_RATIO) }, sh.cx, sh.cy) : '')
      case 'line':
        return `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" ${st}/>`
      case 'path':
        return `<path d="${sh.pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')}" ${st}/>`
      case 'arrow': {
        const a = sh as ArrowShape, ends = arrowEnds(a)
        const heads = [headGeometry(startHeadOf(a), ends.start.p, ends.start.ang, a.width), headGeometry(endHeadOf(a), ends.end.p, ends.end.ang, a.width)]
        return `<path d="M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}" ${st}/>`
          + heads.map(hd => hd.lines.map(l => `<path d="${l.map(([px, py], i) => `${i ? 'L' : 'M'} ${r2(px)} ${r2(py)}`).join(' ')}" ${st}/>`).join('')
            + hd.circles.map(c => `<circle cx="${r2(c.x)}" cy="${r2(c.y)}" r="${r2(c.r)}" ${st}/>`).join('')).join('')
          + (a.label?.text ? textLines(a.label, ends.mid.x, ends.mid.y - a.label.size * 0.8) : '')
      }
      case 'text':
        return `<text x="${sh.x}" y="${sh.y}" font-size="${sh.size}" fill="currentColor" stroke="none"${sh.bold ? ' font-weight="600"' : ''}>${esc(sh.text)}</text>`
      default:
        return ''
    }
  }).join('')
  return `<svg viewBox="${r2(x - pad)} ${r2(y - pad)} ${r2(w + pad * 2)} ${r2(h + pad * 2)}" width="100%" height="100%" font-family="ui-sans-serif, system-ui, sans-serif" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}

const previewCache = new Map<string, string>()

/** Card preview for an element, built once from the shapes it inserts. */
export function elementPreview(el: CategoryElement): string {
  let svg = previewCache.get(el.id)
  if (!svg) { svg = previewSvg(el.create()); previewCache.set(el.id, svg) }
  return svg
}

// ─────────────────────────────────────────────────────────────────────────────
//  Export
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_ELEMENTS: Record<TemplateCategory, CategoryElement[]> = {
  diagrams:     DIAGRAM_ELEMENTS,
  database:     DB_ELEMENTS,
  architecture: ARCH_ELEMENTS,
  design:       DESIGN_ELEMENTS,
}
