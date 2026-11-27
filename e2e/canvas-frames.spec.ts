import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Frames: a titled box that moves everything inside it as one block.
// Set CANVAS_SHOTS=<dir> to also save screenshots of each step.
const SHOTS = process.env.CANVAS_SHOTS

type Shape = { id: string; type: string; kind?: string; title?: string; x: number; y: number; w: number; h: number }

async function openCanvas(app: Page) {
  await app.evaluate(() => localStorage.setItem('inkwell-canvas-enabled', 'true'))
  await app.reload()
  await app.getByText('Draw', { exact: true }).first().click()
  await expect(app.locator('canvas').first()).toBeVisible()
  await app.waitForTimeout(400)
}

async function savedShapes(app: Page): Promise<Shape[]> {
  await app.waitForTimeout(1300) // save is debounced by 1s
  return app.evaluate(() => {
    const e2e = (window as any).__e2e
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

async function drag(app: Page, from: [number, number], to: [number, number]) {
  await app.mouse.move(...from); await app.mouse.down()
  await app.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 })
  await app.mouse.move(...to, { steps: 5 }); await app.mouse.up()
}

test('a frame wraps shapes, moves them as one block, and can be renamed', async ({ app }) => {
  await openCanvas(app)
  await app.keyboard.press('r'); await app.mouse.click(600, 350)   // 140×90 cards
  await app.keyboard.press('r'); await app.mouse.click(820, 350)
  await app.keyboard.press('Escape')

  // Draw a frame around both cards
  await app.keyboard.press('f')
  await drag(app, [480, 250], [940, 460])
  await shot(app, 'frame-1-drawn')

  let shapes = await savedShapes(app)
  const frame = shapes.find(s => s.kind === 'frame')!
  expect(frame).toBeTruthy()
  expect(frame.title).toBe('Frame 1')
  expect(shapes[0].id).toBe(frame.id) // frames sit underneath their contents
  const cards = shapes.filter(s => s.type === 'rect' && s.kind !== 'frame')
  expect(cards).toHaveLength(2)

  // Drag the frame by an empty spot inside it: both cards come along
  await app.keyboard.press('Escape')
  await drag(app, [500, 440], [560, 540])
  await shot(app, 'frame-2-moved')
  shapes = await savedShapes(app)
  const moved = shapes.find(s => s.id === frame.id)!
  const dx = moved.x - frame.x, dy = moved.y - frame.y
  expect(Math.abs(dx)).toBeGreaterThan(30)
  for (const c of cards) {
    const now = shapes.find(s => s.id === c.id)!
    expect(now.x - c.x).toBeCloseTo(dx, 1)
    expect(now.y - c.y).toBeCloseTo(dy, 1)
  }

  // A card dragged on its own leaves the frame where it is
  const one = shapes.find(s => s.id === cards[0].id)!
  await app.keyboard.press('Escape')
  await drag(app, [one.x + 20 + (await canvasOffset(app)).x, one.y + 20 + (await canvasOffset(app)).y], [one.x + 60 + (await canvasOffset(app)).x, one.y + 40 + (await canvasOffset(app)).y])
  shapes = await savedShapes(app)
  expect(shapes.find(s => s.id === frame.id)!.x).toBeCloseTo(moved.x, 1)

  // Double-click the title to rename
  const f = shapes.find(s => s.id === frame.id)!
  const o = await canvasOffset(app)
  await app.mouse.dblclick(f.x + o.x + 20, f.y + o.y - 14)
  const input = app.locator('input[value="Frame 1"]')
  await expect(input).toBeVisible()
  await input.fill('Backend')
  await input.press('Enter')
  await shot(app, 'frame-3-renamed')
  shapes = await savedShapes(app)
  expect(shapes.find(s => s.id === frame.id)!.title).toBe('Backend')
})

/** Screen offset of world (0,0): the canvas starts unpanned at zoom 1, so world = canvas-local coords. */
async function canvasOffset(app: Page) {
  const b = await app.locator('canvas').first().boundingBox()
  return { x: b!.x, y: b!.y }
}
