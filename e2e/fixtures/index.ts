import { test as base, expect, type Page } from '@playwright/test'
import { installTauriMock } from './tauriMock'

export const VAULT = '/home/e2e/vault'

export const SEED_FILES: Record<string, string> = {
  [`${VAULT}/Welcome.md`]: '# Welcome\n\nHello from the e2e vault.\n',
  [`${VAULT}/Groceries.md`]: '# Groceries\n\n- milk\n- eggs\n',
  [`${VAULT}/Projects/Roadmap.md`]: '# Roadmap\n\nShip the e2e suite.\n',
  [`${VAULT}/.inkwell/boards.json`]: JSON.stringify({
    version: 1,
    boards: [{ id: 'board-1', name: 'Sprint', columnIds: ['col-1', 'col-2', 'col-3', 'col-4'] }],
    boardColumns: [
      { id: 'col-1', boardId: 'board-1', name: 'To Do', color: 'blue', taskIds: [] },
      { id: 'col-2', boardId: 'board-1', name: 'In Progress', color: 'amber', taskIds: [] },
      { id: 'col-3', boardId: 'board-1', name: 'In Review', color: 'red', taskIds: [] },
      { id: 'col-4', boardId: 'board-1', name: 'Done', color: 'green', taskIds: [] },
    ],
    boardTasks: [],
  }),
  '/home/e2e/Pictures/wall.png': 'not-really-a-png',
}

/** Helpers over the in-memory disk that the mock exposes on `window.__e2e`. */
export class Disk {
  constructor(private page: Page) {}
  read(path: string) { return this.page.evaluate((p) => (window as any).__e2e.read(p) as string | null, path) }
  bytes(path: string) { return this.page.evaluate((p) => (window as any).__e2e.bytes(p) as number[] | null, path) }
  exists(path: string) { return this.page.evaluate((p) => (window as any).__e2e.exists(p) as boolean, path) }
  list(dir: string) { return this.page.evaluate((p) => (window as any).__e2e.list(p) as string[], dir) }
}

export const test = base.extend<{
  app: Page
  disk: Disk
  platform: string | undefined
  portableRoot: string | undefined
  /** Clicks Settings in the main window and returns the separate Settings window it opens. */
  openSettings: () => Promise<Page>
}>({
  platform: [undefined, { option: true }],
  portableRoot: [undefined, { option: true }],
  app: async ({ page, context, platform, portableRoot }, use) => {
    // Context-level, so the Settings window (a second page) gets the same Tauri mock.
    await context.addInitScript(installTauriMock, { vaultPath: VAULT, files: SEED_FILES, platform, portableRoot })
    await page.goto('/')
    await use(page)
  },
  disk: async ({ app }, use) => use(new Disk(app)),
  openSettings: async ({ app }, use) =>
    use(async () => {
      const [settings] = await Promise.all([
        app.waitForEvent('popup'),
        app.getByText('Settings', { exact: true }).first().click(),
      ])
      await settings.waitForLoadState()
      // The window announces itself and receives its first snapshot from the main window.
      await settings.getByRole('button', { name: 'Themes' }).waitFor()
      return settings
    }),
})

export { expect }
