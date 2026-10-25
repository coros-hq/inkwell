import type { CalendarEvent } from '../types'

// Days are plain local YYYY-MM-DD strings, so events never shift across
// timezones or DST changes the way ISO timestamps would.

export const EVENT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'] as const

export function toDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() + n)
  return r
}

/** Monday of the week containing `d` (matches the DatePicker's ISO week). */
export function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7))
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6)
  const sameMonth = weekStart.getMonth() === end.getMonth()
  const start = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const last = end.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
  return `${start} – ${last}, ${end.getFullYear()}`
}

export function diffDays(fromKey: string, toKey: string): number {
  return Math.round((fromDateKey(toKey).getTime() - fromDateKey(fromKey).getTime()) / 86_400_000)
}

/** Last day the event covers (inclusive). */
export function eventEnd(e: CalendarEvent): string {
  return e.endDate && e.endDate > e.date ? e.endDate : e.date
}

export function isMultiDay(e: CalendarEvent): boolean {
  return eventEnd(e) > e.date
}

export function shiftKey(key: string, days: number): string {
  return toDateKey(addDays(fromDateKey(key), days))
}

/** Greedy lane packing for multi-day bars: bars that overlap never share a lane. */
export function packLanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const laneEnds: number[] = []
  return sorted.map(item => {
    let lane = laneEnds.findIndex(end => end < item.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = item.end
    return { ...item, lane }
  })
}

// ── Time grid ─────────────────────────────────────────────────────────────────

export const HOUR_PX = 56
export const SNAP_MIN = 15
export const DEFAULT_DURATION_MIN = 60
const DAY_MIN = 24 * 60
/** Latest start/end a timed event can have (the last 15-minute slot of the day). */
export const MAX_TIME_MIN = DAY_MIN - SNAP_MIN

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function fromMin(min: number): string {
  const m = Math.min(MAX_TIME_MIN, Math.max(0, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function snapMin(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN
}

/** Start/end minutes of a timed event; a missing end shows as a default-length block. */
export function timedRange(e: CalendarEvent): { start: number; end: number } {
  const start = toMin(e.startTime!)
  const end = e.endTime ? toMin(e.endTime) : start + DEFAULT_DURATION_MIN
  return { start, end: Math.min(DAY_MIN, Math.max(end, start + SNAP_MIN)) }
}

/** A single-day event with a start time lives in the hour grid; everything else in the all-day area. */
export function isTimedSingle(e: CalendarEvent): boolean {
  return !!e.startTime && !isMultiDay(e)
}

/** All-day cards in the user's order (events without an order keep their creation order, after ordered ones). */
export function sortAllDay(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.order ?? Infinity) - (b.e.order ?? Infinity) || a.i - b.i)
    .map(x => x.e)
}

export interface DayBlock { event: CalendarEvent; start: number; end: number; col: number; cols: number }

/** Side-by-side layout for overlapping timed events: each cluster of overlaps shares the width evenly. */
export function layoutDay(events: CalendarEvent[]): DayBlock[] {
  const items = events
    .map(event => ({ event, ...timedRange(event) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out: DayBlock[] = []
  let cluster: DayBlock[] = []
  let clusterEnd = -1
  let colEnds: number[] = []
  const flush = () => {
    cluster.forEach(b => { b.cols = colEnds.length })
    out.push(...cluster)
    cluster = []; colEnds = []
  }
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush()
    let col = colEnds.findIndex(end => end <= it.start)
    if (col === -1) col = colEnds.length
    colEnds[col] = it.end
    clusterEnd = Math.max(clusterEnd, it.end)
    cluster.push({ ...it, col, cols: 1 })
  }
  flush()
  return out
}
