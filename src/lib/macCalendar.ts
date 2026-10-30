import { invoke } from '@tauri-apps/api/core'
import type { CalendarEvent, MacLink } from '../types'
import { addDays, toDateKey } from './calendar'

// Two-way sync with the macOS Calendar app (EventKit, via src-tauri/src/mac_calendar.rs).
// Events from the calendars the user picks are mirrored into the planner; edits to a
// mirrored event are written back, and planner events with no counterpart yet go to a
// dedicated "Inkwell" calendar. Each mirrored event remembers a signature of its content
// as of the last sync, which tells the sides apart: if Calendar's copy no longer matches
// it, Calendar changed (and wins); otherwise a differing planner copy is a local edit.

export type MacAccess = 'unsupported' | 'notDetermined' | 'authorized' | 'denied' | 'restricted'

export interface MacCalendarInfo { id: string; title: string; color: string; source: string; writable: boolean }

export interface MacCalendarConfig {
  enabled: boolean
  /** Calendars the user switched off; every other calendar (including new ones) is mirrored. */
  hiddenIds: string[]
  /** The dedicated "Inkwell" calendar, once created. */
  inkwellId: string | null
}

interface MacEventDto {
  id: string
  calendarId: string
  title: string
  notes: string
  date: string
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  color: string
  readOnly: boolean
}

export const macCalendarSupported =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /Mac/i.test(navigator.platform)

const PAST_DAYS = 90
const FUTURE_DAYS = 365

export const macStatus = () => invoke<MacAccess>('mac_calendar_status')
export const macRequestAccess = () => invoke<boolean>('mac_calendar_request_access')
export const macListCalendars = () => invoke<MacCalendarInfo[]>('mac_calendar_list')
export const macEnsureInkwellCalendar = () => invoke<MacCalendarInfo>('mac_calendar_ensure_inkwell')
export const macDeleteEvent = (id: string) => invoke<void>('mac_calendar_delete', { id })

type Content = Pick<CalendarEvent, 'title' | 'notes' | 'date' | 'endDate' | 'startTime' | 'endTime'>

/** The fields both sides store; an all-day span's end only counts when it's after the start. */
export function signature(e: Content): string {
  return JSON.stringify([
    e.title,
    e.notes ?? '',
    e.date,
    e.endDate && e.endDate > e.date ? e.endDate : '',
    e.startTime ?? '',
    e.startTime ? e.endTime ?? '' : '',
  ])
}

function contentOf(m: MacEventDto): Content {
  return {
    title: m.title,
    notes: m.notes || undefined,
    date: m.date,
    endDate: m.endDate ?? undefined,
    startTime: m.startTime ?? undefined,
    endTime: m.endTime ?? undefined,
  }
}

function linkOf(m: MacEventDto): MacLink {
  return { id: m.id, calendarId: m.calendarId, sig: signature(contentOf(m)), ...(m.readOnly && { readOnly: true }) }
}

function toDto(e: CalendarEvent, link?: MacLink): Omit<MacEventDto, 'color' | 'readOnly'> {
  return {
    id: link?.id ?? '',
    calendarId: link?.calendarId ?? '',
    title: e.title,
    notes: e.notes ?? '',
    date: e.date,
    endDate: e.endDate && e.endDate > e.date ? e.endDate : null,
    startTime: e.startTime ?? null,
    endTime: e.startTime ? e.endTime ?? null : null,
  }
}

export interface SyncUpdate { base: string; fields: Content; color?: string; mac: MacLink }

export interface SyncPlan {
  /** Planner events whose Calendar copy is gone (or whose calendar is no longer synced). */
  remove: Set<string>
  /** Existing planner events to refresh: the content they had when planned, and what to set. */
  update: Map<string, SyncUpdate>
  /** Events that exist only in Calendar so far. */
  add: Omit<CalendarEvent, 'id'>[]
  /** The "Inkwell" calendar used (it may have just been created). */
  inkwellId: string | null
  /** First problem hit on a single event; the rest of the sync still ran. */
  error: string | null
  /** What this sync saw, for the Sync button's tooltip. */
  summary: string
}

/**
 * Reconcile `events` with Calendar, writing planner-side changes to it, and describe what changes locally.
 * `commit` is called the moment an event has been written to Calendar so its link is saved at once:
 * if the sync is cut short later, the next one finds the link instead of creating the event again.
 */
export async function planSync(
  events: CalendarEvent[],
  cfg: MacCalendarConfig,
  commit: (id: string, update: SyncUpdate) => void,
): Promise<SyncPlan> {
  const mine = cfg.inkwellId ?? (await macEnsureInkwellCalendar()).id
  const hidden = new Set(cfg.hiddenIds)
  const all = await macListCalendars()
  const synced = new Set([mine, ...all.filter(c => !hidden.has(c.id)).map(c => c.id)])
  const now = new Date()
  const from = toDateKey(addDays(now, -PAST_DAYS))
  const to = toDateKey(addDays(now, FUTURE_DAYS))

  const remote = await invoke<MacEventDto[]>('mac_calendar_fetch', { start: from, end: to, calendarIds: [...synced] })
  const byId = new Map(remote.map(m => [m.id, m]))
  const seen = new Set<string>()
  const outside = remote.filter(m => m.calendarId !== mine).length
  const summary = `Read ${remote.length} event(s) (${outside} from your other calendars) across ${synced.size} calendar(s)`
  console.info(`[mac-calendar] ${summary}, ${from} → ${to}`)
  const plan: SyncPlan = { remove: new Set(), update: new Map(), add: [], inkwellId: mine, error: null, summary }
  const fail = (e: unknown) => { plan.error ??= String(e) }

  // Clean up copies left by earlier syncs: identical events linked into the Inkwell calendar collapse to one.
  const keep = new Map<string, string>()
  const dupes = new Set<string>()
  for (const e of events) {
    if (e.mac?.calendarId !== mine) continue
    const key = signature(e)
    if (keep.has(key)) dupes.add(e.id)
    else keep.set(key, e.id)
  }
  for (const e of events) {
    if (!dupes.has(e.id)) continue
    plan.remove.add(e.id)
    seen.add(e.mac!.id)
    await macDeleteEvent(e.mac!.id).catch(fail)
  }

  // Inkwell-calendar events nothing links to yet (left behind by an interrupted sync), by content.
  const linked = new Set(events.filter(e => e.mac).map(e => e.mac!.id))
  const orphans = new Map<string, MacEventDto[]>()
  for (const m of remote) {
    if (m.calendarId !== mine || linked.has(m.id)) continue
    const key = signature(contentOf(m))
    orphans.set(key, [...(orphans.get(key) ?? []), m])
  }

  const refresh = (e: CalendarEvent, m: MacEventDto) => {
    plan.update.set(e.id, { base: signature(e), fields: contentOf(m), color: m.color, mac: linkOf(m) })
  }

  for (const e of events) {
    if (dupes.has(e.id)) continue
    const link = e.mac
    if (!link) {
      try {
        // Planner-only event: adopt the identical Calendar copy if one exists, else create it.
        const adopted = orphans.get(signature(e))?.shift()
        const saved = adopted ?? await invoke<MacEventDto>('mac_calendar_upsert', { event: { ...toDto(e), calendarId: mine } })
        seen.add(saved.id)
        commit(e.id, { base: signature(e), fields: contentOf(saved), mac: linkOf(saved) })
      } catch (err) { fail(err) }
      continue
    }
    if (!synced.has(link.calendarId)) { plan.remove.add(e.id); continue }
    const m = byId.get(link.id)
    if (!m) {
      // Only a deletion if it falls in the fetched window.
      if (e.date >= from && e.date <= to) plan.remove.add(e.id)
      continue
    }
    seen.add(m.id)
    if (signature(contentOf(m)) !== link.sig) refresh(e, m)
    else if (!link.readOnly && signature(e) !== link.sig) {
      try {
        const saved = await invoke<MacEventDto>('mac_calendar_upsert', { event: toDto(e, link) })
        commit(e.id, { base: signature(e), fields: contentOf(saved), mac: linkOf(saved) })
      } catch (err) { fail(err) }
    } else if (m.readOnly !== !!link.readOnly) plan.update.set(e.id, { base: signature(e), fields: contentOf(m), mac: linkOf(m) })
  }

  for (const m of remote) {
    if (seen.has(m.id)) continue
    plan.add.push({ ...contentOf(m), done: false, color: m.color, mac: linkOf(m) })
  }
  return plan
}

/** Planner events that mirror other calendars (not the "Inkwell" one) — dropped when syncing is turned off. */
export function isImported(e: CalendarEvent, inkwellId: string | null): boolean {
  return !!e.mac && e.mac.calendarId !== inkwellId
}
