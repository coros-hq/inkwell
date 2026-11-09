/**
 * The quick-actions widget (src/components/widget/QuickWidget.tsx) is its own tiny
 * window with its own JS context. Like Settings, it never touches data itself: it asks
 * the main window — which keeps running, hidden, while the app lives in the tray — to
 * do the work, and waits for an acknowledgement so a failure is shown, not swallowed.
 */
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useAppStore } from '../store/useAppStore'
import { useDrawingsStore } from '../store/useDrawingsStore'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const MAIN_LABEL = 'main'
const WIDGET_LABEL = 'widget'

export const isWidgetWindow =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('widget')

const EV = { action: 'inkwell:widget-action', result: 'inkwell:widget-result' } as const

export type WidgetAction =
  | { type: 'task'; title: string; priority: 'low' | 'medium' | 'high' }
  | { type: 'event'; title: string; date: string; startTime?: string }
  | { type: 'draw' }
  | { type: 'open' }

interface Request { id: number; action: WidgetAction }
interface Result { id: number; ok: boolean; error?: string }

// ── Widget window ────────────────────────────────────────────────────────────

let seq = 0

/** Run an action in the main window. Rejects with a readable message if it fails or main doesn't answer. */
export function sendWidgetAction(action: WidgetAction, timeoutMs = 4000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const id = ++seq
    let stop: UnlistenFn | null = null
    const timer = setTimeout(() => {
      stop?.()
      reject(new Error('Inkwell did not respond — is it still starting up?'))
    }, timeoutMs)
    listen<Result>(EV.result, ({ payload }) => {
      if (payload.id !== id) return
      clearTimeout(timer)
      stop?.()
      payload.ok ? resolve() : reject(new Error(payload.error ?? 'Something went wrong'))
    })
      .then(un => {
        stop = un
        return emitTo(MAIN_LABEL, EV.action, { id, action } satisfies Request)
      })
      .catch(e => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      })
  })
}

// ── Main window ──────────────────────────────────────────────────────────────

async function focusMain() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.show()
  await win.unminimize()
  await win.setFocus()
}

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function perform(a: WidgetAction): Promise<void> {
  const app = useAppStore.getState()
  switch (a.type) {
    case 'task': {
      const board = app.boards.find(b => b.id === app.activeBoardId) ?? app.boards[0]
      const column = board && app.boardColumns.find(c => c.id === board.columnIds[0])
      if (!board || !column) throw new Error('No board yet — open Inkwell and create one first.')
      app.createBoardTask(column.id, a.title, a.priority)
      return
    }
    case 'event': {
      if (!app.calendarEnabled) throw new Error('The calendar is turned off in Settings.')
      app.addCalendarEvent({
        title: a.title,
        date: a.date,
        ...(a.startTime ? { startTime: a.startTime } : {}),
      })
      return
    }
    case 'draw': {
      if (!app.canvasEnabled) throw new Error('The canvas is turned off in Settings.')
      const drawings = useDrawingsStore.getState()
      if (!drawings.loaded) await drawings.init(app.canvasLinkedVaultPath)
      useDrawingsStore.getState().create()
      app.setActiveView('canvas')
      await focusMain()
      return
    }
    case 'open':
      await focusMain()
      return
  }
}

/** Call once in the main window. Returns a cleanup. */
export function startWidgetHost(): () => void {
  if (!inTauri) return () => {}
  const unlisten = listen<Request>(EV.action, async ({ payload }) => {
    const reply = (r: Omit<Result, 'id'>) => emitTo(WIDGET_LABEL, EV.result, { id: payload.id, ...r }).catch(() => {})
    try {
      await perform(payload.action)
      reply({ ok: true })
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
  return () => { unlisten.then(fn => fn()) }
}
