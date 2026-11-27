import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Text alignment (standalone multi-line text and text inside shapes) and the compact toolbar.
// Set CANVAS_SHOTS=<dir> to also save screenshots of each step.
const SHOTS = process.env.CANVAS_SHOTS

type Shape = { id: string; type: string; text?: string; align?: string; boundText?: { text: string; align?: string } }

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

test('standalone text spans lines and takes an alignment', async ({ app }) => {
  await openCanvas(app)
  await app.keyboard.press('t'); await app.mouse.click(600, 300)
  await app.waitForTimeout(150) // the editor takes focus after two frames
  await app.keyboard.type('Database')
  await app.keyboard.press('Shift+Enter')
  await app.keyboard.type('Postgres 16')
  await app.keyboard.press('Enter')

  await app.getByTitle('Align right').click()
  await shot(app, 'align-1-text-right')
  const t = (await savedShapes(app)).find(s => s.type === 'text')!
  expect(t.text).toBe('Database\nPostgres 16')
  expect(t.align).toBe('right')
})

test('text inside a shape can be left-aligned', async ({ app }) => {
  await openCanvas(app)
  await app.keyboard.press('r'); await app.mouse.click(600, 350)
  await app.keyboard.press('Escape')
  await app.mouse.dblclick(600, 350)
  await app.waitForTimeout(150)
  await app.keyboard.type('Search server')
  await app.keyboard.press('Escape')

  await app.mouse.click(560, 330)
  await app.getByTitle('Align left').click()
  await shot(app, 'align-2-shape-left')
  const r = (await savedShapes(app)).find(s => s.type === 'rect')!
  expect(r.boundText?.text).toBe('Search server')
  expect(r.boundText?.align).toBe('left')
})

test('colors, stroke and view options live in popovers', async ({ app }) => {
  await openCanvas(app)
  await app.getByTitle('Color & stroke').click()
  await expect(app.getByTitle('#f87171')).toBeVisible()
  await expect(app.getByTitle('Stroke 3px')).toBeVisible()
  await shot(app, 'toolbar-1-style')
  await app.getByTitle('#f87171').click()
  await app.mouse.click(10, 10)
  await expect(app.getByTitle('#f87171')).toHaveCount(0)

  await app.getByTitle('More', { exact: true }).click()
  for (const name of [/Sketchy style/, /Grid/, /Minimap/, /Drawings list/, /Export SVG/]) {
    await expect(app.getByRole('button', { name })).toBeVisible()
  }
  await shot(app, 'toolbar-2-more')
})
