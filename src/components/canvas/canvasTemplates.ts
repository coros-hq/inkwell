import type { Shape } from './canvasTypes'
import { uid, TEMPLATE_PLACEHOLDER_COLOR } from './canvasTypes'

const C  = TEMPLATE_PLACEHOLDER_COLOR
const FN = 'Inter, system-ui, sans-serif'
const W2 = 2
const W1 = 1.5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function s(fields: Record<string, any>): Shape {
  return { id: uid(), color: C, fill: 'none', width: W2, ...fields } as Shape
}
function txt(x: number, y: number, text: string, bold = false, size = 14): Shape {
  return s({ type: 'text', x, y, text, size, fontFamily: FN, bold, italic: false, width: 1 })
}

// ─────────────────────────────────────────────────────────────────────────────
//  DIAGRAMS
// ─────────────────────────────────────────────────────────────────────────────

function makeFlowchart(): Shape[] {
  return [
    s({ type: 'ellipse', cx: 0, cy: 0, rx: 80, ry: 30, width: W2 }),
    txt(-20, 6, 'Start', true),
    s({ type: 'arrow', x1: 0, y1: 32, x2: 0, y2: 78, width: W1 }),
    s({ type: 'rect', x: -90, y: 80, w: 180, h: 56, radius: 6 }),
    txt(-28, 114, 'Step 1'),
    s({ type: 'arrow', x1: 0, y1: 138, x2: 0, y2: 182, width: W1 }),
    s({ type: 'rect', x: -90, y: 184, w: 180, h: 56, radius: 6 }),
    txt(-28, 218, 'Step 2'),
    s({ type: 'arrow', x1: 0, y1: 242, x2: 0, y2: 286, width: W1 }),
    s({ type: 'ellipse', cx: 0, cy: 316, rx: 80, ry: 30, width: W2 }),
    txt(-14, 322, 'End', true),
  ]
}

function makeMindMap(): Shape[] {
  return [
    s({ type: 'rect', x: -100, y: -35, w: 200, h: 70, radius: 10, width: 2.5 }),
    txt(-55, 4, 'Main Topic', true),
    s({ type: 'line', x1: -100, y1: -18, x2: -230, y2: -90, width: W1 }),
    s({ type: 'rect', x: -345, y: -107, w: 110, h: 38, radius: 6 }),
    txt(-332, -82, 'Topic A'),
    s({ type: 'line', x1: -100, y1: 0, x2: -230, y2: 0, width: W1 }),
    s({ type: 'rect', x: -345, y: -19, w: 110, h: 38, radius: 6 }),
    txt(-332, 6, 'Topic B'),
    s({ type: 'line', x1: -100, y1: 18, x2: -230, y2: 90, width: W1 }),
    s({ type: 'rect', x: -345, y: 71, w: 110, h: 38, radius: 6 }),
    txt(-332, 96, 'Topic C'),
    s({ type: 'line', x1: 100, y1: -18, x2: 230, y2: -90, width: W1 }),
    s({ type: 'rect', x: 235, y: -107, w: 110, h: 38, radius: 6 }),
    txt(248, -82, 'Topic D'),
    s({ type: 'line', x1: 100, y1: 0, x2: 230, y2: 0, width: W1 }),
    s({ type: 'rect', x: 235, y: -19, w: 110, h: 38, radius: 6 }),
    txt(248, 6, 'Topic E'),
    s({ type: 'line', x1: 100, y1: 18, x2: 230, y2: 90, width: W1 }),
    s({ type: 'rect', x: 235, y: 71, w: 110, h: 38, radius: 6 }),
    txt(248, 96, 'Topic F'),
  ]
}

function makeOrgChart(): Shape[] {
  return [
    s({ type: 'rect', x: -85, y: -160, w: 170, h: 50, radius: 8 }),
    txt(-15, -128, 'CEO', true),
    s({ type: 'line', x1: 0,    y1: -110, x2: 0,    y2: -80, width: W1 }),
    s({ type: 'line', x1: -150, y1:  -80, x2: 150,  y2: -80, width: W1 }),
    s({ type: 'line', x1: -150, y1:  -80, x2: -150, y2: -56, width: W1 }),
    s({ type: 'line', x1:  150, y1:  -80, x2:  150, y2: -56, width: W1 }),
    s({ type: 'rect', x: -235, y: -56, w: 170, h: 50, radius: 6, width: W1 }),
    txt(-196, -24, 'Manager A'),
    s({ type: 'rect', x: 65, y: -56, w: 170, h: 50, radius: 6, width: W1 }),
    txt(104, -24, 'Manager B'),
    s({ type: 'line', x1: -150, y1: -6,  x2: -150, y2: 24,  width: W1 }),
    s({ type: 'line', x1: -215, y1:  24, x2:  -85, y2: 24,  width: W1 }),
    s({ type: 'line', x1: -215, y1:  24, x2: -215, y2: 44,  width: W1 }),
    s({ type: 'line', x1:  -85, y1:  24, x2:  -85, y2: 44,  width: W1 }),
    s({ type: 'rect', x: -275, y: 44, w: 120, h: 44, radius: 6, width: W1 }),
    txt(-256, 72, 'Report 1'),
    s({ type: 'rect', x: -145, y: 44, w: 120, h: 44, radius: 6, width: W1 }),
    txt(-126, 72, 'Report 2'),
    s({ type: 'line', x1: 150, y1: -6, x2: 150, y2: 44, width: W1 }),
    s({ type: 'rect', x: 90, y: 44, w: 120, h: 44, radius: 6, width: W1 }),
    txt(109, 72, 'Report 3'),
  ]
}

function makeSequence(): Shape[] {
  return [
    s({ type: 'rect', x: -280, y: -140, w: 140, h: 48, radius: 6 }),
    txt(-244, -108, 'Actor A', true),
    s({ type: 'rect', x: 140, y: -140, w: 140, h: 48, radius: 6 }),
    txt(176, -108, 'Actor B', true),
    s({ type: 'line', x1: -210, y1: -92, x2: -210, y2: 200, width: 1 }),
    s({ type: 'line', x1:  210, y1: -92, x2:  210, y2: 200, width: 1 }),
    s({ type: 'arrow', x1: -210, y1: -36, x2: 210, y2: -36, width: W1 }),
    txt(-26, -46, 'Request'),
    s({ type: 'arrow', x1: 210, y1: 44, x2: -210, y2: 44, width: W1 }),
    txt(-32, 34, 'Response'),
    s({ type: 'arrow', x1: -210, y1: 124, x2: 210, y2: 124, width: W1 }),
    txt(-27, 114, 'Callback'),
  ]
}

function makeTimeline(): Shape[] {
  const milestones: { x: number; label: string; sub: string }[] = [
    { x: -270, label: 'Phase 1', sub: 'Q1 2025' },
    { x:  -90, label: 'Phase 2', sub: 'Q2 2025' },
    { x:   90, label: 'Phase 3', sub: 'Q3 2025' },
    { x:  270, label: 'Phase 4', sub: 'Q4 2025' },
  ]
  const shapes: Shape[] = [
    s({ type: 'arrow', x1: -340, y1: 0, x2: 350, y2: 0, width: W2 }),
  ]
  milestones.forEach(({ x, label, sub }, i) => {
    const above = i % 2 === 0
    shapes.push(s({ type: 'line', x1: x, y1: -14, x2: x, y2: 14, width: W1 }))
    shapes.push(s({ type: 'line', x1: x, y1: above ? -14 : 14, x2: x, y2: above ? -52 : 52, width: W1 }))
    shapes.push(txt(x - 25, above ? -60 : 72, label, true))
    shapes.push(txt(x - 28, above ? -80 : 92, sub))
  })
  return shapes
}

function makeVenn(): Shape[] {
  return [
    s({ type: 'ellipse', cx: -75, cy: 0, rx: 175, ry: 130, width: W2 }),
    s({ type: 'ellipse', cx:  75, cy: 0, rx: 175, ry: 130, width: W2 }),
    txt(-196, 6, 'Set A', true),
    txt( 148, 6, 'Set B', true),
    txt( -16, 6, 'Both'),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATABASE
// ─────────────────────────────────────────────────────────────────────────────

function makeERDiagram(): Shape[] {
  const shapes: Shape[] = []
  const ROW = 22

  const addEntity = (x: number, y: number, name: string, attrs: string[]) => {
    shapes.push(s({ type: 'rect', x, y, w: 175, h: 36, radius: 6, width: W2 }))
    shapes.push(txt(x + 10, y + 24, name, true))
    const bodyH = attrs.length * ROW + 14
    shapes.push(s({ type: 'rect', x, y: y + 36, w: 175, h: bodyH, radius: 6, width: W1 }))
    attrs.forEach((attr, i) => {
      shapes.push(txt(x + 10, y + 36 + 14 + i * ROW, attr, false, 12))
    })
  }

  addEntity(-340, -120, 'User', ['PK  id : INT', 'name : VARCHAR', 'email : VARCHAR', 'created_at : DATE'])
  addEntity(80,   -120, 'Order', ['PK  id : INT', 'FK  user_id : INT', 'total : DECIMAL', 'status : ENUM'])

  // Relationship
  shapes.push(s({ type: 'line', x1: -165, y1: -84, x2: 80, y2: -84, width: W1 }))
  shapes.push(txt(-155, -98, '1', false, 11))
  shapes.push(txt(62,   -98, 'N', false, 11))
  shapes.push(txt(-60,  -98, 'places', false, 11))

  return shapes
}

function makeSchemaTable(): Shape[] {
  const shapes: Shape[] = []
  const COL_WIDTHS = [100, 130, 110, 110]
  const TOTAL_W    = COL_WIDTHS.reduce((a, b) => a + b, 0)  // 450
  const ROW_H      = 28
  const SX         = -225
  const SY         = -160

  // Table title bar
  shapes.push(s({ type: 'rect', x: SX, y: SY, w: TOTAL_W, h: 38, radius: 6, width: W2 }))
  shapes.push(txt(SX + 10, SY + 25, 'users', true))

  // Header row
  const headers = ['Column', 'Type', 'Default', 'Constraints']
  let cx = SX
  shapes.push(s({ type: 'rect', x: SX, y: SY + 38, w: TOTAL_W, h: ROW_H, radius: 0, width: W1 }))
  headers.forEach((h, i) => {
    shapes.push(txt(cx + 6, SY + 38 + 19, h, true, 11))
    cx += COL_WIDTHS[i]
  })

  // Data rows
  const rows = [
    ['id',         'INT',          'AUTO',       'PK NOT NULL'],
    ['username',   'VARCHAR(50)',  '—',          'NOT NULL'],
    ['email',      'VARCHAR(120)', '—',          'UNIQUE NOT NULL'],
    ['avatar_url', 'TEXT',         'NULL',       '—'],
    ['role',       'ENUM',         "'user'",     'NOT NULL'],
    ['created_at', 'TIMESTAMP',    'NOW()',       'NOT NULL'],
  ]
  rows.forEach((row, ri) => {
    const ry = SY + 38 + ROW_H * (ri + 1)
    shapes.push(s({ type: 'rect', x: SX, y: ry, w: TOTAL_W, h: ROW_H, radius: 0, width: 0.8 }))
    let cx2 = SX
    row.forEach((cell, ci) => {
      shapes.push(txt(cx2 + 6, ry + 19, cell, ci === 0, 11))
      cx2 += COL_WIDTHS[ci]
    })
  })

  return shapes
}

function makeDataFlow(): Shape[] {
  const shapes: Shape[] = []

  // External entity (client)
  shapes.push(s({ type: 'rect', x: -340, y: -32, w: 120, h: 64, radius: 6, width: W2 }))
  shapes.push(txt(-330, -2, 'Client', true))
  shapes.push(txt(-330, 18, '(Browser)', false, 11))

  shapes.push(s({ type: 'arrow', x1: -220, y1: 0, x2: -140, y2: 0, width: W1 }))
  shapes.push(txt(-200, -12, 'HTTP', false, 11))

  // Process
  shapes.push(s({ type: 'ellipse', cx: -60, cy: 0, rx: 80, ry: 38, width: W2 }))
  shapes.push(txt(-88, -6, 'API Handler', true))
  shapes.push(txt(-56, 14, '1.0', false, 11))

  shapes.push(s({ type: 'arrow', x1: 20, y1: 0, x2: 100, y2: 0, width: W1 }))
  shapes.push(txt(36, -12, 'query', false, 11))

  // Data store (DFD open rectangle)
  shapes.push(s({ type: 'line', x1: 100, y1: -28, x2: 260, y2: -28, width: W2 }))
  shapes.push(s({ type: 'line', x1: 100, y1:  28, x2: 260, y2:  28, width: W2 }))
  shapes.push(s({ type: 'line', x1: 100, y1: -28, x2: 100, y2:  28, width: W1 }))
  shapes.push(txt(112, 6, 'D1 · Database'))

  // Secondary store (cache)
  shapes.push(s({ type: 'arrow', x1: -60, y1: 38, x2: -60, y2: 100, width: W1 }))
  shapes.push(s({ type: 'line', x1: -160, y1: 100, x2: 40, y2: 100, width: W2 }))
  shapes.push(s({ type: 'line', x1: -160, y1: 148, x2: 40,  y2: 148, width: W2 }))
  shapes.push(s({ type: 'line', x1: -160, y1: 100, x2: -160, y2: 148, width: W1 }))
  shapes.push(txt(-148, 130, 'D2 · Redis Cache'))

  return shapes
}

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────

function makeSystemDesign(): Shape[] {
  const shapes: Shape[] = []

  // Client
  shapes.push(s({ type: 'rect', x: -420, y: -36, w: 110, h: 72, radius: 8, width: W2 }))
  shapes.push(txt(-408, -4, 'Browser', true))
  shapes.push(txt(-406, 16, '/ Mobile', false, 11))
  shapes.push(s({ type: 'arrow', x1: -310, y1: 0, x2: -240, y2: 0, width: W1 }))

  // Load Balancer
  shapes.push(s({ type: 'rect', x: -240, y: -36, w: 130, h: 72, radius: 8, width: W2 }))
  shapes.push(txt(-232, -4, 'Load', true))
  shapes.push(txt(-232, 16, 'Balancer', true))

  // Branch lines
  shapes.push(s({ type: 'line', x1: -110, y1: 0, x2: -70, y2: 0, width: W1 }))
  shapes.push(s({ type: 'line', x1: -70,  y1: -55, x2: -70, y2: 55, width: W1 }))
  shapes.push(s({ type: 'arrow', x1: -70, y1: -55, x2: -10, y2: -55, width: W1 }))
  shapes.push(s({ type: 'arrow', x1: -70, y1:  55, x2: -10, y2:  55, width: W1 }))

  // API Servers
  shapes.push(s({ type: 'rect', x: -10, y: -90, w: 140, h: 56, radius: 6, width: W1 }))
  shapes.push(txt(2, -58, 'API Server 1'))
  shapes.push(s({ type: 'rect', x: -10, y:  27, w: 140, h: 56, radius: 6, width: W1 }))
  shapes.push(txt(2, 59, 'API Server 2'))

  // Merge to DB
  shapes.push(s({ type: 'line', x1: 130, y1: -62, x2: 180, y2: -62, width: W1 }))
  shapes.push(s({ type: 'line', x1: 130, y1:  55, x2: 180, y2:  55, width: W1 }))
  shapes.push(s({ type: 'line', x1: 180, y1: -62, x2: 180, y2:  55, width: W1 }))
  shapes.push(s({ type: 'arrow', x1: 180, y1: 0, x2: 230, y2: 0, width: W1 }))

  // Database (cylinder-like)
  shapes.push(s({ type: 'rect', x: 230, y: -44, w: 130, h: 88, radius: 6, width: W2 }))
  shapes.push(s({ type: 'ellipse', cx: 295, cy: -44, rx: 65, ry: 16, width: W1 }))
  shapes.push(txt(242, 10, 'PostgreSQL', true))

  // Cache side
  shapes.push(s({ type: 'arrow', x1: 70, y1: -62, x2: 70, y2: -140, width: W1 }))
  shapes.push(s({ type: 'rect', x: -10, y: -190, w: 140, h: 50, radius: 6, width: W1 }))
  shapes.push(txt(2, -158, 'Redis Cache'))

  return shapes
}

function makeComponentTree(): Shape[] {
  const shapes: Shape[] = []
  const W = 120, H = 40

  const box = (cx: number, y: number, label: string, bold = false) => {
    shapes.push(s({ type: 'rect', x: cx - W/2, y, w: W, h: H, radius: 8, width: W1 }))
    shapes.push(txt(cx - label.length * 3.6, y + 26, label, bold))
  }
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    shapes.push(s({ type: 'line', x1, y1, x2, y2, width: 1 }))

  // L0 — root
  box(0, -200, '<App />', true)

  // L0 → L1 branch
  line(0, -160, 0, -138)
  line(-220, -138, 220, -138)
  line(-220, -138, -220, -120)
  line(0,    -138, 0,    -120)
  line(220,  -138, 220,  -120)

  // L1
  box(-220, -120, '<Router />')
  box(0,    -120, '<Layout />')
  box(220,  -120, '<Providers />')

  // L1 Layout → L2
  line(0, -80, 0, -58)
  line(-140, -58, 140, -58)
  line(-140, -58, -140, -40)
  line(0,    -58, 0,    -40)
  line(140,  -58, 140,  -40)

  // L2
  box(-140, -40, '<NavBar />')
  box(0,     -40, '<Page />')
  box(140,  -40, '<Footer />')

  // L2 Page → L3
  line(0, 0, 0, 22)
  line(-90, 22, 90, 22)
  line(-90, 22, -90, 40)
  line(90,  22, 90,  40)

  // L3
  box(-90, 40, '<Hero />')
  box(90,  40, '<Cards />')

  return shapes
}

function makeAPIFlow(): Shape[] {
  const shapes: Shape[] = []
  const STEP_H = 78
  const steps = [
    { label: 'HTTP Request',    sub: 'GET /api/users/:id' },
    { label: 'Auth Middleware', sub: 'Verify JWT token'   },
    { label: 'Rate Limiter',    sub: '100 req / min'      },
    { label: 'Route Handler',   sub: 'Business logic'     },
    { label: 'DB Query',        sub: 'SELECT * FROM users WHERE id = ?' },
    { label: 'HTTP Response',   sub: '200 OK · application/json' },
  ]

  steps.forEach(({ label, sub }, i) => {
    const y = i * STEP_H - (steps.length - 1) * STEP_H / 2
    const edge = i === 0 || i === steps.length - 1
    shapes.push(s({ type: 'rect', x: -170, y: y - 26, w: 340, h: 52, radius: 10, width: edge ? W2 : W1 }))
    shapes.push(txt(-158, y - 4,  label, true))
    shapes.push(txt(-158, y + 16, sub, false, 11))
    if (i < steps.length - 1)
      shapes.push(s({ type: 'arrow', x1: 0, y1: y + 26, x2: 0, y2: y + STEP_H - 26, width: W1 }))
  })

  return shapes
}

function makeBrainstorm(): Shape[] {
  const shapes: Shape[] = []

  shapes.push(s({ type: 'rect', x: -90, y: -34, w: 180, h: 68, radius: 34, width: W2 }))
  shapes.push(txt(-46, 6, 'Central Idea', true))

  const nodes = [
    { cx: -260, cy: -160, label: 'Concept A' },
    { cx:   60, cy: -180, label: 'Concept B' },
    { cx:  240, cy:  -20, label: 'Concept C' },
    { cx:  100, cy:  160, label: 'Concept D' },
    { cx: -220, cy:  150, label: 'Concept E' },
    { cx: -340, cy:   20, label: 'Concept F' },
  ]

  nodes.forEach(({ cx, cy, label }) => {
    shapes.push(s({ type: 'ellipse', cx, cy, rx: 75, ry: 30, width: W1 }))
    shapes.push(txt(cx - label.length * 3.6, cy + 6, label, false, 12))
    // Line from center ellipse edge toward each node
    const angle = Math.atan2(cy, cx)
    const ex    = Math.cos(angle) * 90,  ey = Math.sin(angle) * 34
    const nx    = cx - Math.cos(angle) * 75, ny = cy - Math.sin(angle) * 30
    shapes.push(s({ type: 'line', x1: ex, y1: ey, x2: nx, y2: ny, width: 1 }))
  })

  return shapes
}

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN / UI
// ─────────────────────────────────────────────────────────────────────────────

function makeUIFrame(): Shape[] {
  const shapes: Shape[] = []

  // Phone shell
  shapes.push(s({ type: 'rect', x: -160, y: -300, w: 320, h: 600, radius: 32, width: W2 }))

  // Status bar area
  shapes.push(s({ type: 'line', x1: -160, y1: -254, x2: 160, y2: -254, width: 0.5 }))
  shapes.push(txt(-30, -268, '9:41', false, 11))
  shapes.push(txt(90,  -268, '●●●', false, 9))

  // Top nav / header
  shapes.push(s({ type: 'rect', x: -160, y: -254, w: 320, h: 56, radius: 0, width: 0.5 }))
  shapes.push(txt(-36, -220, 'Home', true))

  // Content cards
  for (let i = 0; i < 3; i++) {
    const y = -188 + i * 118
    shapes.push(s({ type: 'rect', x: -136, y, w: 272, h: 100, radius: 12, width: W1 }))
    // image thumb
    shapes.push(s({ type: 'rect', x: -124, y: y + 10, w: 70, h: 56, radius: 8, width: 0.5 }))
    // text lines
    shapes.push(txt(-40, y + 32, `Item Title ${i + 1}`, true, 12))
    shapes.push(txt(-40, y + 52, 'Subtitle / description', false, 10))
    shapes.push(txt(-40, y + 70, '→ View details', false, 10))
  }

  // Bottom nav
  shapes.push(s({ type: 'line', x1: -160, y1: 170, x2: 160, y2: 170, width: 0.5 }))
  shapes.push(txt(-120, 208, 'Home',    false, 11))
  shapes.push(txt(-24,  208, 'Search',  false, 11))
  shapes.push(txt(64,   208, 'Profile', false, 11))

  return shapes
}

function makeButtonStates(): Shape[] {
  const shapes: Shape[] = []

  // Section title
  shapes.push(txt(-56, -110, 'Button States', true))

  const variants = [
    { x: -220, label: 'Default',  bold: false },
    { x:    0, label: 'Primary',  bold: true  },
    { x:  220, label: 'Disabled', bold: false },
  ]

  variants.forEach(({ x, label, bold }, i) => {
    shapes.push(s({ type: 'rect', x: x - 80, y: -50, w: 160, h: 52, radius: 12, width: i === 1 ? W2 : W1 }))
    shapes.push(txt(x - label.length * 4, -17, label, bold))
    // State chip
    shapes.push(s({ type: 'rect', x: x - 44, y: 24, w: 88, h: 24, radius: 12, width: 0.5 }))
    shapes.push(txt(x - 36, 40, label, false, 10))
  })

  // Annotations
  shapes.push(txt(-290, 72, 'border + text', false, 10))
  shapes.push(txt(-56,  72, 'filled accent', false, 10))
  shapes.push(txt(148,  72, 'muted / 40%',  false, 10))

  // Size variations below
  shapes.push(txt(-56, 108, 'Size variants', true))
  const sizes = [
    { x: -180, w: 100, h: 36, label: 'Small',  r: 8  },
    { x:  -40, w: 130, h: 46, label: 'Medium', r: 10 },
    { x:  110, w: 160, h: 56, label: 'Large',  r: 12 },
  ]
  sizes.forEach(({ x, w, h, label, r }) => {
    shapes.push(s({ type: 'rect', x, y: 118, w, h, radius: r, width: W1 }))
    shapes.push(txt(x + w/2 - label.length * 3.5, 118 + h/2 + 5, label))
  })

  return shapes
}

function makeInputForm(): Shape[] {
  const shapes: Shape[] = []
  const FW = 340

  shapes.push(txt(-100, -250, 'Create Account', true))
  shapes.push(txt(-FW/2 + 0, -226, 'Sign up for a free account', false, 12))

  const fields = [
    { label: 'Full Name',    placeholder: 'John Doe',            y: -190 },
    { label: 'Email',        placeholder: 'john@example.com',    y:  -96 },
    { label: 'Password',     placeholder: '••••••••••',          y:   -2 },
  ]

  fields.forEach(({ label, placeholder, y }) => {
    shapes.push(txt(-FW/2, y - 14, label, false, 12))
    shapes.push(s({ type: 'rect', x: -FW/2, y, w: FW, h: 52, radius: 10, width: W1 }))
    shapes.push(txt(-FW/2 + 14, y + 32, placeholder, false, 12))
  })

  // Helper text
  shapes.push(txt(-FW/2, 68, 'Min. 8 characters with numbers', false, 10))

  // Submit
  shapes.push(s({ type: 'rect', x: -FW/2, y: 96, w: FW, h: 54, radius: 12, width: W2 }))
  shapes.push(txt(-70, 130, 'Create Account', true))

  // Divider + SSO
  shapes.push(s({ type: 'line', x1: -FW/2,    y1: 168, x2: -30, y2: 168, width: 0.5 }))
  shapes.push(s({ type: 'line', x1: 30,        y1: 168, x2: FW/2, y2: 168, width: 0.5 }))
  shapes.push(txt(-22, 173, 'or', false, 11))
  shapes.push(s({ type: 'rect', x: -FW/2, y: 182, w: FW, h: 52, radius: 10, width: W1 }))
  shapes.push(txt(-62, 214, 'Continue with Google', false, 12))

  // Footer
  shapes.push(txt(-92, 258, 'Already have an account?  Sign in', false, 11))

  return shapes
}

function makeCardComponent(): Shape[] {
  const shapes: Shape[] = []

  // Card shell
  shapes.push(s({ type: 'rect', x: -200, y: -260, w: 400, h: 520, radius: 20, width: W2 }))

  // Image area
  shapes.push(s({ type: 'rect', x: -200, y: -260, w: 400, h: 200, radius: 20, width: W1 }))
  shapes.push(txt(-24, -162, 'Image', true))
  // Diagonal lines to indicate placeholder
  shapes.push(s({ type: 'line', x1: -200, y1: -260, x2: 200, y2: -60, width: 0.4 }))
  shapes.push(s({ type: 'line', x1: 200,  y1: -260, x2: -200, y2: -60, width: 0.4 }))

  // Badge
  shapes.push(s({ type: 'rect', x: -186, y: -48, w: 90, h: 28, radius: 14, width: W1 }))
  shapes.push(txt(-178, -28, 'Featured', false, 11))

  // Category + date
  shapes.push(txt(-186, 10, 'DESIGN', true, 10))
  shapes.push(txt(90,   10, 'Jan 15, 2025', false, 10))

  // Title
  shapes.push(txt(-186, 44, 'Card Component Title', true))

  // Body text
  shapes.push(txt(-186, 72, 'Short description of the content', false, 12))
  shapes.push(txt(-186, 92, 'displayed inside this card block.', false, 12))

  // Divider
  shapes.push(s({ type: 'line', x1: -186, y1: 114, x2: 186, y2: 114, width: 0.5 }))

  // Stat pills
  const stats = ['12 Likes', '4 Comments', '2 Shares']
  stats.forEach((st, i) => {
    shapes.push(s({ type: 'rect', x: -186 + i * 110, y: 124, w: 100, h: 28, radius: 14, width: 0.5 }))
    shapes.push(txt(-182 + i * 110, 143, st, false, 11))
  })

  // CTA button
  shapes.push(s({ type: 'rect', x: -186, y: 170, w: 182, h: 50, radius: 10, width: W1 }))
  shapes.push(txt(-142, 200, 'Read More →'))
  shapes.push(s({ type: 'rect', x: 4, y: 170, w: 182, h: 50, radius: 10, width: W2 }))
  shapes.push(txt(26, 200, 'Save to Bookmarks'))

  return shapes
}

// ─────────────────────────────────────────────────────────────────────────────
//  Registry
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateCategory = 'diagrams' | 'database' | 'architecture' | 'design'

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; emoji: string }[] = [
  { id: 'diagrams',     label: 'Diagrams',     emoji: '◇' },
  { id: 'database',     label: 'Database',     emoji: '⊡' },
  { id: 'architecture', label: 'Architecture', emoji: '⊕' },
  { id: 'design',       label: 'Design',       emoji: '▣' },
]

export interface DiagramTemplate {
  id:          string
  name:        string
  description: string
  category:    TemplateCategory
  create:      () => Shape[]
}

export const TEMPLATES: DiagramTemplate[] = [
  // Diagrams
  { id: 'flowchart', name: 'Flowchart',   description: 'Start · steps · end with arrows',   category: 'diagrams',     create: makeFlowchart  },
  { id: 'mindmap',   name: 'Mind Map',    description: 'Central topic with 6 branches',      category: 'diagrams',     create: makeMindMap    },
  { id: 'orgchart',  name: 'Org Chart',   description: '3-level hierarchy with reports',     category: 'diagrams',     create: makeOrgChart   },
  { id: 'sequence',  name: 'Sequence',    description: '2 actors · request / response',      category: 'diagrams',     create: makeSequence   },
  { id: 'timeline',  name: 'Timeline',    description: '4 milestones on a horizontal axis',  category: 'diagrams',     create: makeTimeline   },
  { id: 'venn',      name: 'Venn Diagram',description: '2 overlapping sets with labels',     category: 'diagrams',     create: makeVenn       },
  // Database
  { id: 'er',        name: 'ER Diagram',  description: '2 entities · 1:N relationship',      category: 'database',     create: makeERDiagram  },
  { id: 'schema',    name: 'Table Schema',description: 'SQL table with typed columns',       category: 'database',     create: makeSchemaTable},
  { id: 'dataflow',  name: 'Data Flow',   description: 'Client → process → store (DFD)',     category: 'database',     create: makeDataFlow   },
  // Architecture
  { id: 'sysdesign', name: 'System Design',   description: 'Client · LB · servers · DB',   category: 'architecture', create: makeSystemDesign  },
  { id: 'comptree',  name: 'Component Tree',  description: 'React-style component hierarchy',category: 'architecture', create: makeComponentTree },
  { id: 'apiflow',   name: 'API Flow',         description: 'Request lifecycle, 6 steps',    category: 'architecture', create: makeAPIFlow       },
  { id: 'brainstorm',name: 'Brainstorm',       description: 'Central idea with 6 concepts',  category: 'architecture', create: makeBrainstorm    },
  // Design
  { id: 'uiframe',   name: 'UI Frame',     description: 'Mobile wireframe with nav + cards', category: 'design',       create: makeUIFrame       },
  { id: 'buttons',   name: 'Button States',description: 'Default · primary · disabled sizes',category: 'design',       create: makeButtonStates  },
  { id: 'form',      name: 'Input Form',   description: 'Labels · fields · submit button',   category: 'design',       create: makeInputForm     },
  { id: 'card',      name: 'Card Component',description: 'Image · badge · text · CTA',      category: 'design',       create: makeCardComponent },
]
