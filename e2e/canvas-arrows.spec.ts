import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Arrows attached to shapes (connection dots, following on move) and Mermaid paste.
// Set CANVAS_SHOTS=<dir> to also save screenshots of each step.
const SHOTS = process.env.CANVAS_SHOTS

type Shape = { id: string; type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  start?: { id: string }; end?: { id: string }; startHead?: string; endHead?: string; label?: { text: string }; text?: string; groupId?: string }

async function openCanvas(app: Page) {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.locator('canvas')).toBeVisible()
  await app.waitForTimeout(400)
}

/** Shapes of the open drawing, as saved to the (mocked) disk. */
async function savedShapes(app: Page): Promise<Shape[]> {
  await app.waitForTimeout(1300) // save is debounced by 1s
  return app.evaluate(() => {
    const e2e = (window as any).__e2e
    // Drawings live in ~/.inkwell (the mock's home) unless the canvas is linked to the vault.
    for (const dir of ['/home/e2e/Documents/.inkwell/drawings', '/home/e2e/vault/.inkwell/drawings']) {
      for (const name of e2e.list(dir) as string[]) {
        const d = JSON.parse(e2e.read(`${dir}/${name}`) ?? '{}')
        if (d.shapes?.length) return d.shapes
      }
    }
    return []
  })
}

async function shot(app: Page, name: string) { if (SHOTS) await app.screenshot({ path: `${SHOTS}/${name}.png` }) }

test('an arrow pulled from a connection dot attaches to both cards and follows a moved card', async ({ app }) => {
  await openCanvas(app)
  await app.keyboard.press('r'); await app.mouse.click(600, 300)   // 140×90 card centred here
  await app.keyboard.press('r'); await app.mouse.click(1000, 550)
  await app.keyboard.press('Escape')

  // Hover the first card so its dots show, then pull from the right-side dot onto the second card.
  await app.mouse.move(640, 300); await app.mouse.move(680, 300)
  await shot(app, 'a1-dots')
  await app.mouse.down()
  await app.mouse.move(850, 450, { steps: 8 })
  await app.mouse.move(990, 545, { steps: 8 })
  await shot(app, 'a2-dragging')
  await app.mouse.up()

  let shapes = await savedShapes(app)
  const [r1, r2] = shapes.filter(s => s.type === 'rect')
  const arrow = shapes.find(s => s.type === 'arrow')!
  expect(arrow.start?.id).toBe(r1.id)
  expect(arrow.end?.id).toBe(r2.id)
  const before = { x: arrow.x2!, y: arrow.y2! }

  // Drag the second card; the arrow's head goes with it.
  await app.keyboard.press('Escape')
  await app.mouse.move(1050, 560); await app.mouse.down()
  await app.mouse.move(800, 750, { steps: 10 }); await app.mouse.up()
  await shot(app, 'a3-moved')

  shapes = await savedShapes(app)
  const moved = shapes.find(s => s.id === arrow.id)!
  expect(moved.end?.id).toBe(r2.id)
  expect(moved.x2! - before.x).toBeLessThan(-150)
  expect(moved.y2! - before.y).toBeGreaterThan(150)
})

test('a pasted Mermaid ER diagram becomes tables joined by attached crow\'s-foot arrows', async ({ app }) => {
  await openCanvas(app)
  const er = [
    'erDiagram',
    '  CLIENTS ||--o{ BOOKINGS : makes',
    '  CLIENTS { uuid id PK',
    '    string name }',
    '  BOOKINGS { uuid id PK',
    '    uuid client_id FK }',
  ].join('\n')
  await app.mouse.move(800, 450)
  await app.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
  }, er)
  await app.waitForTimeout(800)
  await shot(app, 'b1-er')

  const shapes = await savedShapes(app)
  const tables = shapes.filter(s => s.type === 'rect')
  expect(tables).toHaveLength(2)
  const arrow = shapes.find(s => s.type === 'arrow')!
  expect(arrow.label?.text).toBe('makes')
  expect([arrow.startHead, arrow.endHead].sort()).toEqual(['one', 'zeroMany'])
  expect(tables.map(t => t.id)).toContain(arrow.start?.id)
  expect(tables.map(t => t.id)).toContain(arrow.end?.id)
  // Each table is one group: its box and its texts move together.
  const clients = shapes.find(s => s.text === 'CLIENTS')!
  expect(clients.groupId).toBeTruthy()
  expect(tables.some(t => t.groupId === clients.groupId)).toBe(true)
})
