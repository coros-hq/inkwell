import type { Shape } from './canvasTypes'
import { uid, TEMPLATE_PLACEHOLDER_COLOR } from './canvasTypes'
import type { TemplateCategory } from './canvasTemplates'

const C  = TEMPLATE_PLACEHOLDER_COLOR
const FN = 'Inter, system-ui, sans-serif'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function s(fields: Record<string, any>): Shape {
  return { id: uid(), color: C, fill: 'none', width: 2, ...fields } as Shape
}
function txt(x: number, y: number, text: string, bold = false, size = 13): Shape {
  return s({ type: 'text', x, y, text, size, fontFamily: FN, bold, italic: false, width: 1 })
}

export interface CategoryElement {
  id:      string
  name:    string
  hint:    string
  create:  () => Shape[]
  preview: string  // inline SVG string
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATABASE elements
// ─────────────────────────────────────────────────────────────────────────────

const DB_ELEMENTS: CategoryElement[] = [
  {
    id: 'db-entity',
    name: 'Entity Table',
    hint: 'Blank entity with 3 fields',
    preview: `<svg viewBox="0 0 80 70" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="18" rx="3" stroke-width="1.5"/>
      <text x="10" y="17" font-size="8" fill="currentColor" stroke="none" font-weight="600">Entity</text>
      <rect x="4" y="22" width="72" height="44" rx="3" stroke-width="1"/>
      <text x="10" y="36" font-size="7" fill="currentColor" stroke="none">PK  id : INT</text>
      <text x="10" y="50" font-size="7" fill="currentColor" stroke="none">field : VARCHAR</text>
      <text x="10" y="64" font-size="7" fill="currentColor" stroke="none">created_at : DATE</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: 0, y: 0, w: 170, h: 36, radius: 6, width: 2 }),
      txt(10, 24, 'Entity', true),
      s({ type: 'rect', x: 0, y: 36, w: 170, h: 96, radius: 6, width: 1.5 }),
      txt(10, 58,  'PK  id : INT',    false, 12),
      txt(10, 80,  'field : VARCHAR', false, 12),
      txt(10, 102, 'created_at : DATE', false, 12),
    ],
  },
  {
    id: 'db-relationship',
    name: 'Relationship',
    hint: '1:N annotated connector',
    preview: `<svg viewBox="0 0 80 30" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="15" x2="76" y2="15" stroke-width="1.5"/>
      <text x="4" y="12" font-size="7" fill="currentColor" stroke="none">1</text>
      <text x="68" y="12" font-size="7" fill="currentColor" stroke="none">N</text>
      <text x="32" y="12" font-size="7" fill="currentColor" stroke="none">relates</text>
    </svg>`,
    create: () => [
      s({ type: 'line', x1: 0, y1: 0, x2: 240, y2: 0, width: 1.5 }),
      txt(0,   -12, '1',      false, 12),
      txt(220, -12, 'N',      false, 12),
      txt(96,  -12, 'relates', false, 12),
    ],
  },
  {
    id: 'db-attribute',
    name: 'Attribute',
    hint: 'Oval attribute node (ER style)',
    preview: `<svg viewBox="0 0 80 36" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="18" rx="36" ry="14" stroke-width="1.5"/>
      <text x="40" y="22" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">attribute</text>
    </svg>`,
    create: () => [
      s({ type: 'ellipse', cx: 80, cy: 0, rx: 80, ry: 30, width: 1.5 }),
      txt(44, 6, 'attribute', false, 12),
    ],
  },
  {
    id: 'db-pk-attribute',
    name: 'Primary Key',
    hint: 'Underlined PK attribute oval',
    preview: `<svg viewBox="0 0 80 36" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="18" rx="36" ry="14" stroke-width="1.5"/>
      <text x="40" y="22" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="700" text-decoration="underline">PK field</text>
    </svg>`,
    create: () => [
      s({ type: 'ellipse', cx: 80, cy: 0, rx: 80, ry: 30, width: 2 }),
      txt(44, 6, 'PK  field', true, 12),
      s({ type: 'line', x1: 44, y1: 10, x2: 116, y2: 10, width: 1 }),
    ],
  },
  {
    id: 'db-junction',
    name: 'Junction Table',
    hint: 'Many-to-many bridge entity',
    preview: `<svg viewBox="0 0 80 52" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="14" rx="2" stroke-width="1.5" stroke-dasharray="3 2"/>
      <text x="10" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="600">A_B_junction</text>
      <rect x="4" y="18" width="72" height="30" rx="2" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="10" y="30" font-size="7" fill="currentColor" stroke="none">FK  a_id</text>
      <text x="10" y="42" font-size="7" fill="currentColor" stroke="none">FK  b_id</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: 0, y: 0, w: 170, h: 32, radius: 6, width: 2 }),
      txt(10, 22, 'A_B_junction', true),
      s({ type: 'rect', x: 0, y: 32, w: 170, h: 74, radius: 6, width: 1.5 }),
      txt(10, 54, 'FK  a_id : INT', false, 12),
      txt(10, 76, 'FK  b_id : INT', false, 12),
      txt(10, 98, 'created_at',     false, 12),
    ],
  },
  {
    id: 'db-note',
    name: 'DB Note',
    hint: 'Inline schema annotation',
    preview: `<svg viewBox="0 0 80 40" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="32" rx="4" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="10" y="18" font-size="7" fill="currentColor" stroke="none">// Note:</text>
      <text x="10" y="30" font-size="7" fill="currentColor" stroke="none">indexed on email</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: 0, y: 0, w: 200, h: 72, radius: 8, width: 1 }),
      txt(12, 24, '// Note:', true, 12),
      txt(12, 46, 'indexed on email', false, 12),
      txt(12, 62, 'cascades on delete', false, 12),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  DIAGRAMS elements
// ─────────────────────────────────────────────────────────────────────────────

const DIAGRAM_ELEMENTS: CategoryElement[] = [
  {
    id: 'diag-process',
    name: 'Process',
    hint: 'Standard process rectangle',
    preview: `<svg viewBox="0 0 80 40" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="72" height="24" rx="4" stroke-width="1.5"/>
      <text x="40" y="23" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">Process</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -90, y: -28, w: 180, h: 56, radius: 6, width: 2 }),
      txt(-30, 6, 'Process'),
    ],
  },
  {
    id: 'diag-decision',
    name: 'Decision',
    hint: 'Diamond decision shape',
    preview: `<svg viewBox="0 0 80 54" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M40,4 L76,27 L40,50 L4,27 Z" stroke-width="1.5"/>
      <text x="40" y="31" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">Yes / No?</text>
    </svg>`,
    create: () => {
      const W = 110, H = 60
      return [
        s({ type: 'path', pts: [{ x: 0, y: -H }, { x: W, y: 0 }, { x: 0, y: H }, { x: -W, y: 0 }, { x: 0, y: -H }], width: 2 }),
        txt(-36, 6, 'Yes / No?', false, 12),
      ]
    },
  },
  {
    id: 'diag-terminal',
    name: 'Terminal',
    hint: 'Start / End oval',
    preview: `<svg viewBox="0 0 80 36" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="18" rx="36" ry="14" stroke-width="2"/>
      <text x="40" y="22" text-anchor="middle" font-size="9" fill="currentColor" stroke="none" font-weight="600">Start</text>
    </svg>`,
    create: () => [
      s({ type: 'ellipse', cx: 0, cy: 0, rx: 90, ry: 32, width: 2 }),
      txt(-18, 6, 'Start', true),
    ],
  },
  {
    id: 'diag-connector',
    name: 'Arrow Connector',
    hint: 'Labeled directional arrow',
    preview: `<svg viewBox="0 0 80 30" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="ep-arr" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L4,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <line x1="4" y1="15" x2="70" y2="15" stroke-width="1.5" marker-end="url(#ep-arr)"/>
      <text x="30" y="11" font-size="7" fill="currentColor" stroke="none">label</text>
    </svg>`,
    create: () => [
      s({ type: 'arrow', x1: -100, y1: 0, x2: 100, y2: 0, width: 1.5 }),
      txt(-20, -12, 'label', false, 12),
    ],
  },
  {
    id: 'diag-annotation',
    name: 'Annotation',
    hint: 'Bracket note with pointer',
    preview: `<svg viewBox="0 0 80 40" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="4" x2="4" y2="36" stroke-width="1.5"/>
      <line x1="4" y1="20" x2="24" y2="20" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="26" y="24" font-size="7" fill="currentColor" stroke="none">note here</text>
    </svg>`,
    create: () => [
      s({ type: 'line', x1: 0, y1: -40, x2: 0, y2: 40, width: 1.5 }),
      s({ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0, width: 1 }),
      txt(66, 6, 'note here', false, 12),
    ],
  },
  {
    id: 'diag-swimlane',
    name: 'Swim Lane',
    hint: 'Horizontal lane divider',
    preview: `<svg viewBox="0 0 80 54" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="46" rx="4" stroke-width="1.5"/>
      <line x1="20" y1="4" x2="20" y2="50" stroke-width="1"/>
      <text x="12" y="30" text-anchor="middle" font-size="6" fill="currentColor" stroke="none" transform="rotate(-90,12,30)">Lane A</text>
      <text x="50" y="30" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">...</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -200, y: -80, w: 400, h: 160, radius: 8, width: 1.5 }),
      s({ type: 'line', x1: -200, y1: -80, x2: -200, y2: 80, width: 1 }),
      s({ type: 'rect', x: -240, y: -80, w: 40, h: 160, radius: 0, width: 1.5 }),
      txt(-234, -44, 'L', false, 11),
      txt(-234, -22, 'a', false, 11),
      txt(-234,   0, 'n', false, 11),
      txt(-234,  22, 'e', false, 11),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE elements
// ─────────────────────────────────────────────────────────────────────────────

const ARCH_ELEMENTS: CategoryElement[] = [
  {
    id: 'arch-client',
    name: 'Client',
    hint: 'Browser / Mobile client box',
    preview: `<svg viewBox="0 0 80 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="40" rx="5" stroke-width="1.5"/>
      <text x="40" y="20" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="600">Browser</text>
      <text x="40" y="34" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">/ Mobile</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -80, y: -40, w: 160, h: 80, radius: 8, width: 2 }),
      txt(-30, -6, 'Browser', true),
      txt(-22,  16, '/ Mobile', false, 11),
    ],
  },
  {
    id: 'arch-server',
    name: 'Service / API',
    hint: 'Generic service box',
    preview: `<svg viewBox="0 0 80 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="40" rx="4" stroke-width="1.5"/>
      <text x="40" y="20" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="600">Service</text>
      <text x="40" y="34" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">:8080</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -80, y: -40, w: 160, h: 80, radius: 6, width: 1.5 }),
      txt(-28, -6, 'Service', true),
      txt(-18,  16, ':8080', false, 11),
    ],
  },
  {
    id: 'arch-db',
    name: 'Database',
    hint: 'Cylinder-style database node',
    preview: `<svg viewBox="0 0 80 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="16" width="64" height="38" rx="4" stroke-width="1.5"/>
      <ellipse cx="40" cy="16" rx="32" ry="12" stroke-width="1.5"/>
      <text x="40" y="40" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">Database</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -75, y: -20, w: 150, h: 80, radius: 6, width: 1.5 }),
      s({ type: 'ellipse', cx: 0, cy: -20, rx: 75, ry: 18, width: 1.5 }),
      txt(-36, 30, 'Database', true),
    ],
  },
  {
    id: 'arch-cache',
    name: 'Cache',
    hint: 'Redis / in-memory cache node',
    preview: `<svg viewBox="0 0 80 52" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="44" rx="22" stroke-width="1.5"/>
      <text x="40" y="22" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="600">Cache</text>
      <text x="40" y="36" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">Redis</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -80, y: -36, w: 160, h: 72, radius: 36, width: 1.5 }),
      txt(-26, -4, 'Cache', true),
      txt(-20,  18, 'Redis', false, 11),
    ],
  },
  {
    id: 'arch-queue',
    name: 'Message Queue',
    hint: 'Event bus / queue shape',
    preview: `<svg viewBox="0 0 80 40" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="72" height="24" rx="2" stroke-width="1.5"/>
      <line x1="20" y1="8" x2="20" y2="32" stroke-width="1"/>
      <line x1="36" y1="8" x2="36" y2="32" stroke-width="1"/>
      <line x1="52" y1="8" x2="52" y2="32" stroke-width="1"/>
      <text x="64" y="23" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">Q</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -120, y: -30, w: 240, h: 60, radius: 4, width: 1.5 }),
      s({ type: 'line', x1: -60, y1: -30, x2: -60, y2: 30, width: 1 }),
      s({ type: 'line', x1:   0, y1: -30, x2:   0, y2: 30, width: 1 }),
      s({ type: 'line', x1:  60, y1: -30, x2:  60, y2: 30, width: 1 }),
      txt(-110, 6, 'Queue', true),
    ],
  },
  {
    id: 'arch-lb',
    name: 'Load Balancer',
    hint: 'Load balancer / gateway node',
    preview: `<svg viewBox="0 0 80 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8,24 L22,8 L58,8 L72,24 L58,40 L22,40 Z" stroke-width="1.5"/>
      <text x="40" y="20" text-anchor="middle" font-size="7" fill="currentColor" stroke="none" font-weight="600">Load</text>
      <text x="40" y="32" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">Balancer</text>
    </svg>`,
    create: () => [
      s({ type: 'path', pts: [
        { x: -80, y: 0 }, { x: -40, y: -48 }, { x: 40, y: -48 },
        { x: 80, y: 0 },  { x: 40,  y: 48  }, { x: -40, y: 48 },
        { x: -80, y: 0 },
      ], width: 2 }),
      txt(-22, -6, 'Load', true),
      txt(-30, 14, 'Balancer', true),
    ],
  },
  {
    id: 'arch-arrow-label',
    name: 'Labeled Arrow',
    hint: 'HTTP / gRPC / event connector',
    preview: `<svg viewBox="0 0 80 30" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="al-arr" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L4,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <line x1="4" y1="18" x2="70" y2="18" stroke-width="1.5" marker-end="url(#al-arr)"/>
      <text x="28" y="13" font-size="7" fill="currentColor" stroke="none">HTTP</text>
    </svg>`,
    create: () => [
      s({ type: 'arrow', x1: -110, y1: 0, x2: 110, y2: 0, width: 1.5 }),
      txt(-18, -14, 'HTTP', false, 11),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN elements
// ─────────────────────────────────────────────────────────────────────────────

const DESIGN_ELEMENTS: CategoryElement[] = [
  {
    id: 'ui-button',
    name: 'Button',
    hint: 'Primary action button',
    preview: `<svg viewBox="0 0 80 36" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="72" height="24" rx="8" stroke-width="1.5"/>
      <text x="40" y="22" text-anchor="middle" font-size="9" fill="currentColor" stroke="none" font-weight="600">Button</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -80, y: -26, w: 160, h: 52, radius: 12, width: 2 }),
      txt(-26, 6, 'Button', true),
    ],
  },
  {
    id: 'ui-input',
    name: 'Input Field',
    hint: 'Text input with label',
    preview: `<svg viewBox="0 0 80 44" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <text x="4" y="11" font-size="7" fill="currentColor" stroke="none">Label</text>
      <rect x="4" y="16" width="72" height="22" rx="4" stroke-width="1.2"/>
      <text x="10" y="30" font-size="7" fill="currentColor" stroke="none">Placeholder…</text>
    </svg>`,
    create: () => [
      txt(-90, -36, 'Label', false, 12),
      s({ type: 'rect', x: -90, y: -24, w: 280, h: 52, radius: 8, width: 1.5 }),
      txt(-78, 6, 'Placeholder…', false, 12),
    ],
  },
  {
    id: 'ui-card',
    name: 'Card',
    hint: 'Content card container',
    preview: `<svg viewBox="0 0 80 64" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="56" rx="6" stroke-width="1.5"/>
      <rect x="4" y="4" width="72" height="22" rx="6" stroke-width="1"/>
      <text x="40" y="19" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">Image</text>
      <text x="10" y="38" font-size="7" fill="currentColor" stroke="none" font-weight="600">Card Title</text>
      <text x="10" y="50" font-size="6" fill="currentColor" stroke="none">Description text…</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -130, y: -120, w: 260, h: 240, radius: 16, width: 1.5 }),
      s({ type: 'rect', x: -130, y: -120, w: 260, h: 100, radius: 16, width: 1 }),
      txt(-10, -72, 'Image', true),
      txt(-118, -4, 'Card Title', true),
      txt(-118,  20, 'Description text', false, 12),
      s({ type: 'rect', x: -118, y: 48, w: 110, h: 40, radius: 8, width: 1.5 }),
      txt(-98, 73, 'Action'),
    ],
  },
  {
    id: 'ui-badge',
    name: 'Badge / Chip',
    hint: 'Status or category pill',
    preview: `<svg viewBox="0 0 80 28" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="20" rx="10" stroke-width="1.2"/>
      <text x="40" y="17" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">Featured</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -60, y: -18, w: 120, h: 36, radius: 18, width: 1.5 }),
      txt(-30, 6, 'Badge', false, 12),
    ],
  },
  {
    id: 'ui-checkbox',
    name: 'Checkbox',
    hint: 'Checkbox with label',
    preview: `<svg viewBox="0 0 80 28" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="16" height="16" rx="3" stroke-width="1.5"/>
      <path d="M7,14 L11,18 L19,10" stroke-width="1.5" stroke-linecap="round"/>
      <text x="26" y="18" font-size="9" fill="currentColor" stroke="none">Option label</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -12, y: -12, w: 24, h: 24, radius: 4, width: 1.5 }),
      s({ type: 'path', pts: [{ x: -6, y: 2 }, { x: -1, y: 8 }, { x: 8, y: -6 }], width: 2 }),
      txt(22, 6, 'Option label', false, 13),
    ],
  },
  {
    id: 'ui-toggle',
    name: 'Toggle Switch',
    hint: 'On/Off toggle control',
    preview: `<svg viewBox="0 0 80 28" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="7" width="40" height="16" rx="8" stroke-width="1.5"/>
      <circle cx="36" cy="15" r="6" stroke-width="1.2"/>
      <text x="50" y="19" font-size="8" fill="currentColor" stroke="none">On</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -36, y: -14, w: 72, h: 28, radius: 14, width: 1.5 }),
      s({ type: 'ellipse', cx: 22, cy: 0, rx: 10, ry: 10, width: 1.5 }),
      txt(44, 6, 'On', false, 12),
    ],
  },
  {
    id: 'ui-nav',
    name: 'Nav Bar',
    hint: 'Top navigation header',
    preview: `<svg viewBox="0 0 80 28" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="20" rx="3" stroke-width="1.2"/>
      <text x="10" y="17" font-size="7" fill="currentColor" stroke="none" font-weight="600">Logo</text>
      <text x="38" y="17" font-size="6" fill="currentColor" stroke="none">Home  About</text>
      <rect x="60" y="8" width="12" height="8" rx="2" stroke-width="1"/>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -200, y: -28, w: 400, h: 56, radius: 6, width: 1.5 }),
      txt(-188, 4, 'Logo', true),
      txt(-40,  4, 'Home', false, 12),
      txt(40,   4, 'About', false, 12),
      s({ type: 'rect', x: 130, y: -16, w: 64, h: 32, radius: 8, width: 1.5 }),
      txt(140,  6, 'Sign in', false, 11),
    ],
  },
  {
    id: 'ui-modal',
    name: 'Modal / Dialog',
    hint: 'Overlay dialog container',
    preview: `<svg viewBox="0 0 80 64" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="56" rx="6" stroke-width="1.5"/>
      <line x1="4" y1="20" x2="76" y2="20" stroke-width="1"/>
      <text x="10" y="15" font-size="7" fill="currentColor" stroke="none" font-weight="600">Dialog Title</text>
      <text x="70" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">×</text>
      <text x="10" y="34" font-size="6" fill="currentColor" stroke="none">Content goes here…</text>
      <rect x="40" y="44" width="28" height="10" rx="3" stroke-width="1"/>
      <text x="54" y="52" text-anchor="middle" font-size="6" fill="currentColor" stroke="none">Confirm</text>
    </svg>`,
    create: () => [
      s({ type: 'rect', x: -160, y: -120, w: 320, h: 240, radius: 14, width: 2 }),
      s({ type: 'line', x1: -160, y1: -76, x2: 160, y2: -76, width: 1 }),
      txt(-148, -92, 'Dialog Title', true),
      txt(130, -92, '×', false, 16),
      txt(-148, -44, 'Body content goes here.', false, 12),
      txt(-148, -22, 'Supporting detail text.', false, 12),
      s({ type: 'rect', x: -148, y: 56, w: 130, h: 46, radius: 8, width: 1.5 }),
      txt(-118, 84, 'Cancel'),
      s({ type: 'rect', x: 14, y: 56, w: 130, h: 46, radius: 8, width: 2 }),
      txt(44, 84, 'Confirm', true),
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Export
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_ELEMENTS: Record<TemplateCategory, CategoryElement[]> = {
  diagrams:     DIAGRAM_ELEMENTS,
  database:     DB_ELEMENTS,
  architecture: ARCH_ELEMENTS,
  design:       DESIGN_ELEMENTS,
}
