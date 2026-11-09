import { test, expect } from './fixtures'

test.describe('windows titlebar', () => {
  test.use({ platform: 'Win32' })

  test('renders the app titlebar with window controls', async ({ app }) => {
    const bar = app.getByTestId('titlebar')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('inkwell')
    for (const name of ['Minimize', 'Maximize', 'Close']) {
      await expect(bar.getByRole('button', { name })).toBeVisible()
    }
    // The titlebar sits above the whole app, not over it.
    const box = await bar.boundingBox()
    expect(box?.y).toBe(0)
    await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
  })

  test('controls call the window API', async ({ app }) => {
    const bar = app.getByTestId('titlebar')
    const calls = () => app.evaluate(() => (window as any).__e2e.windowCalls() as string[])

    await bar.getByRole('button', { name: 'Minimize' }).click()
    await bar.getByRole('button', { name: 'Maximize' }).click()
    await bar.getByRole('button', { name: 'Close' }).click()
    await expect.poll(calls).toEqual(['minimize', 'toggle_maximize', 'close'])
  })
})

test('no custom titlebar on other platforms', async ({ app }) => {
  await expect(app.getByText('Groceries', { exact: true }).first()).toBeVisible()
  await expect(app.getByTestId('titlebar')).toHaveCount(0)
})
