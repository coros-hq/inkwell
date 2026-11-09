/**
 * Settings lives in its own native window, which is a separate webview with its
 * own JavaScript context — so it can't share the main window's zustand store.
 * Rather than keep two stores in step, the main window stays the single source
 * of truth:
 *
 *   • the settings window MIRRORS a whitelist of the main store (snapshots arrive
 *     as events and are merged into its own store, so every component keeps
 *     reading `useAppStore()` unchanged);
 *   • every store ACTION in the settings window is swapped for a proxy that asks
 *     the main window to run the real one (RPC over events) and waits for the
 *     answer. The result flows back as the next snapshot.
 */
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/useAppStore'
import { applyThemeToDom } from './restoreTheme'
import { applyAppFont } from './appFont'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const SETTINGS_LABEL = 'settings'
const MAIN_LABEL = 'main'

export const isSettingsWindow =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('settings')

const EV = {
  ready: 'inkwell:settings-ready',
  closed: 'inkwell:settings-closed',
  snapshot: 'inkwell:settings-snapshot',
  rpc: 'inkwell:settings-rpc',
  result: 'inkwell:settings-rpc-result',
} as const

type State = ReturnType<typeof useAppStore.getState>

/** The slice of the main store that Settings reads. Typed so a rename can't silently drop one. */
const MIRRORED = [
  'theme', 'themeName', 'customThemes',
  'editorFontSize', 'editorFontFamily', 'editorLineHeight', 'editorWidth',
  'vimModeEnabled', 'defaultEditorMode',
  'sidebarGlass', 'bodyGlass', 'glassOpacity',
  'canvasEnabled', 'brainstormEnabled', 'calendarEnabled', 'canvasLinkedVaultPath',
  'shortcuts', 'abbreviationTrigger', 'abbreviations',
  'vaultPath', 'sharedVault', 'syncStatus', 'syncProgress',
  'macCalendar', 'macCalendarAccess', 'macCalendars', 'macCalendarSyncing',
  'macCalendarError', 'macCalendarLastSync', 'macCalendarSummary',
] as const satisfies readonly (keyof State)[]

type Snapshot = Partial<Pick<State, (typeof MIRRORED)[number]>>

const pick = (s: State): Snapshot => Object.fromEntries(MIRRORED.map(k => [k, s[k]])) as Snapshot

interface RpcRequest { id: number; name: string; args: unknown[] }
interface RpcResult { id: number; ok: boolean; result?: unknown; error?: string }

export async function openSettingsWindow(): Promise<void> {
  if (inTauri) await invoke('open_settings_window')
}

// ── Main window ──────────────────────────────────────────────────────────────

/** Things only the main window can do (they need its vault session / dialogs). */
export type MainHandlers = Record<string, (...args: any[]) => unknown>

/** Call once in the main window. Returns a cleanup. */
export function startSettingsHost(extra: MainHandlers): () => void {
  if (!inTauri) return () => {}
  let settingsOpen = false
  let last = pick(useAppStore.getState())
  const send = (payload: Snapshot) => emitTo(SETTINGS_LABEL, EV.snapshot, payload).catch(() => {})

  const unlisten: Promise<UnlistenFn>[] = [
    listen(EV.ready, () => {
      settingsOpen = true
      last = pick(useAppStore.getState())
      send(last)
    }),
    listen(EV.closed, () => { settingsOpen = false }),
    listen<RpcRequest>(EV.rpc, async ({ payload }) => {
      const { id, name, args } = payload
      const reply = (r: Omit<RpcResult, 'id'>) => emitTo(SETTINGS_LABEL, EV.result, { id, ...r }).catch(() => {})
      try {
        const fn = extra[name] ?? (useAppStore.getState() as unknown as Record<string, unknown>)[name]
        if (typeof fn !== 'function') throw new Error(`Unknown settings action: ${name}`)
        reply({ ok: true, result: await fn(...args) })
      } catch (e) {
        reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }),
  ]

  const unsubscribe = useAppStore.subscribe(state => {
    if (!settingsOpen) return
    const next = pick(state)
    const changed: Record<string, unknown> = {}
    for (const k of MIRRORED) if (next[k] !== last[k]) changed[k] = next[k]
    last = next
    if (Object.keys(changed).length) send(changed as Snapshot)
  })

  return () => { unsubscribe(); unlisten.forEach(p => p.then(fn => fn())) }
}

// ── Settings window ──────────────────────────────────────────────────────────

let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

/** Run an action in the main window and wait for it. */
export function runInMainWindow<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    emitTo(MAIN_LABEL, EV.rpc, { id, name, args } satisfies RpcRequest).catch(e => {
      pending.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    })
  })
}

/** Call once in the settings window, before rendering. Returns a cleanup. */
export function startSettingsClient(): () => void {
  // Every store action becomes a call into the main window.
  const proxies: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(useAppStore.getState())) {
    if (typeof value === 'function') proxies[name] = (...args: unknown[]) => runInMainWindow(name, ...args)
  }
  useAppStore.setState(proxies as Partial<State>)

  const unlisten: Promise<UnlistenFn>[] = [
    listen<Snapshot>(EV.snapshot, ({ payload }) => {
      useAppStore.setState(payload as Partial<State>)
      const s = useAppStore.getState()
      if ('themeName' in payload || 'customThemes' in payload) applyThemeToDom(s.themeName, s.customThemes)
      if ('editorFontFamily' in payload) applyAppFont(s.editorFontFamily)
    }),
    listen<RpcResult>(EV.result, ({ payload }) => {
      const p = pending.get(payload.id)
      if (!p) return
      pending.delete(payload.id)
      payload.ok ? p.resolve(payload.result) : p.reject(new Error(payload.error))
    }),
  ]

  // Ask for the first snapshot only once we're listening for it.
  Promise.all(unlisten).then(() => emitTo(MAIN_LABEL, EV.ready, null)).catch(console.error)
  const tellClosed = () => { emitTo(MAIN_LABEL, EV.closed, null).catch(() => {}) }
  window.addEventListener('beforeunload', tellClosed)

  return () => {
    window.removeEventListener('beforeunload', tellClosed)
    unlisten.forEach(p => p.then(fn => fn()))
  }
}
