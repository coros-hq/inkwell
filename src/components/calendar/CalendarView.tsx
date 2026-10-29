import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, CalendarDays, X } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import * as Dialog from '@radix-ui/react-dialog'
import { cn, glassBg } from '../../lib/utils'
import { DatePicker } from '../ui/DatePicker'
import { Select, type SelectOption } from '../ui/Select'
import {
  DEFAULT_DURATION_MIN,
  EVENT_COLORS,
  HOUR_PX,
  MAX_TIME_MIN,
  SNAP_MIN,
  addDays,
  diffDays,
  eventEnd,
  formatWeekRange,
  fromDateKey,
  fromMin,
  isMultiDay,
  isTimedSingle,
  layoutDay,
  packLanes,
  shiftKey,
  snapMin,
  sortAllDay,
  startOfWeek,
  timedRange,
  toDateKey,
  weekDays,
} from '../../lib/calendar'
import type { CalendarEvent } from '../../types'

// Personal weekly planner. Hours run down the left; a card with a start time sits
// in the hour grid at its time (drag to move, drag its top/bottom edge to change
// the range, drag across empty space to create one). Untimed cards live in an
// all-day row where they can be reordered, and multi-day items are bars across
// the days. Stored locally in .inkwell/calendar.json and never synced to a team vault.

const MAX_SPAN_DAYS = 60
const GUTTER_PX = 52
const GRID_COLS = { gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(0, 1fr))` }
const GRID_HEIGHT = HOUR_PX * 24
const DAY_MIN = 24 * 60

interface CreateSeed { date: string; startTime?: string; endTime?: string }

// A card inside the all-day row is both a drag source and a drop target (to reorder
// before it); prefer that over the cell behind it when the pointer is over both.
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args)
  if (!hits.length) return rectIntersection(args)
  return [hits.find(h => String(h.id).startsWith('card:')) ?? hits[0]]
}

export function CalendarView() {
  const rawEvents = useAppStore(s => s.calendarEvents)
  const updateEvent = useAppStore(s => s.updateCalendarEvent)
  const bodyGlass = useAppStore(s => s.bodyGlass)
  const glassOpacity = useAppStore(s => s.glassOpacity)
  const theme = useAppStore(s => s.theme)

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [creating, setCreating] = useState<CreateSeed | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Live previews while an edge is being dragged; committed on release.
  const [resize, setResize] = useState<{ id: string; end: string } | null>(null)
  const [timeResize, setTimeResize] = useState<{ id: string; startTime: string; endTime: string } | null>(null)
  // Ghost block while dragging across empty grid space to create an event.
  const [draft, setDraft] = useState<{ key: string; start: number; end: number } | null>(null)
  const [nowMin, setNowMin] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })
  const rowRef = useRef<HTMLDivElement>(null)
  // Width the hour grid's scrollbar takes; the rows above reserve the same so columns line up.
  const [scrollbarW, setScrollbarW] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const colRefs = useRef(new Map<string, HTMLDivElement>())
  const focusId = useAppStore(s => s.calendarFocusId)
  const clearFocus = useAppStore(s => s.clearCalendarFocus)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const events = useMemo(() => {
    if (!resize && !timeResize) return rawEvents
    return rawEvents.map(e => {
      if (resize && e.id === resize.id) return { ...e, endDate: resize.end }
      if (timeResize && e.id === timeResize.id) return { ...e, startTime: timeResize.startTime, endTime: timeResize.endTime }
      return e
    })
  }, [rawEvents, resize, timeResize])

  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const weekKeys = days.map(toDateKey)
  const todayKey = toDateKey(new Date())

  const { allDay, timed, bars, weekEvents } = useMemo(() => {
    const first = weekKeys[0]
    const last = weekKeys[6]
    const allDayMap = new Map<string, CalendarEvent[]>()
    const timedMap = new Map<string, CalendarEvent[]>()
    const spanning: { event: CalendarEvent; start: number; end: number; contLeft: boolean; contRight: boolean }[] = []
    const inWeek: CalendarEvent[] = []
    const push = (map: Map<string, CalendarEvent[]>, key: string, e: CalendarEvent) => {
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    for (const e of events) {
      const end = eventEnd(e)
      if (end < first || e.date > last) continue
      inWeek.push(e)
      if (isMultiDay(e)) {
        spanning.push({
          event: e,
          start: Math.max(0, diffDays(first, e.date)),
          end: Math.min(6, diffDays(first, end)),
          contLeft: e.date < first,
          contRight: end > last,
        })
      } else if (isTimedSingle(e)) push(timedMap, e.date, e)
      else push(allDayMap, e.date, e)
    }
    return { allDay: allDayMap, timed: timedMap, bars: packLanes(spanning), weekEvents: inWeek }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, weekStart])

  const doneCount = weekEvents.filter(e => e.done).length
  const sheetEvent = events.find(e => e.id === sheetId) ?? null

  // Search asked us to show a specific event: go to its week and open it.
  useEffect(() => {
    if (!focusId) return
    const target = events.find(e => e.id === focusId)
    if (target) {
      setWeekStart(startOfWeek(fromDateKey(target.date)))
      setSheetId(target.id)
    }
    clearFocus()
  }, [focusId, events, clearFocus])

  // Open the grid near the morning (or just before the current time) instead of midnight.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = weekKeys.includes(todayKey) ? Math.max(0, nowMin - 90) : 7 * 60
    el.scrollTop = (anchor / 60) * HOUR_PX
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setScrollbarW(el.offsetWidth - el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const t = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()) }, 60_000)
    return () => clearInterval(t)
  }, [])

  const dragEvent = events.find(e => e.id === dragId) ?? null

  // ── Drop handling ───────────────────────────────────────────────────────────

  const allDayFor = (key: string, exceptId?: string) =>
    sortAllDay((allDay.get(key) ?? []).filter(e => e.id !== exceptId))

  const moveToAllDay = (ev: CalendarEvent, key: string, beforeId?: string) => {
    if (isMultiDay(ev)) {
      updateEvent(ev.id, { date: key, endDate: shiftKey(ev.endDate!, diffDays(ev.date, key)) })
      return
    }
    const list = allDayFor(key, ev.id)
    const at = beforeId ? Math.max(0, list.findIndex(e => e.id === beforeId)) : list.length
    list.splice(at, 0, ev)
    list.forEach((e, i) => {
      if (e.id === ev.id) updateEvent(e.id, { date: key, startTime: undefined, endTime: undefined, order: i })
      else if (e.order !== i) updateEvent(e.id, { order: i })
    })
  }

  const moveToGrid = (ev: CalendarEvent, key: string, topPx: number) => {
    if (isMultiDay(ev)) {
      updateEvent(ev.id, { date: key, endDate: shiftKey(ev.endDate!, diffDays(ev.date, key)) })
      return
    }
    const dur = ev.startTime ? timedRange(ev).end - timedRange(ev).start : DEFAULT_DURATION_MIN
    const start = Math.min(MAX_TIME_MIN - SNAP_MIN, Math.max(0, snapMin((topPx / HOUR_PX) * 60)))
    const end = Math.min(MAX_TIME_MIN, start + dur)
    updateEvent(ev.id, { date: key, startTime: fromMin(start), endTime: fromMin(end), order: undefined })
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    const overId = e.over ? String(e.over.id) : null
    const ev = events.find(x => x.id === e.active.id)
    if (!overId || !ev || !e.over) return
    const sep = overId.indexOf(':')
    const kind = overId.slice(0, sep)
    const rest = overId.slice(sep + 1)
    if (kind === 'card') {
      const target = events.find(x => x.id === rest)
      if (target && target.id !== ev.id) moveToAllDay(ev, target.date, target.id)
    } else if (kind === 'allday') {
      moveToAllDay(ev, rest)
    } else if (kind === 'grid') {
      // Card top = pointer minus where it was grabbed, measured against the column's live
      // position, so it stays right even if the grid auto-scrolled during the drag.
      const act = e.activatorEvent as PointerEvent
      const pointerY = act.clientY + e.delta.y
      const grabOffset = act.clientY - (e.active.rect.current.initial?.top ?? act.clientY)
      const colTop = colRefs.current.get(rest)?.getBoundingClientRect().top ?? e.over.rect.top
      moveToGrid(ev, rest, pointerY - grabOffset - colTop)
    }
  }

  // ── Edge resizing (window listeners, so a drag survives the card re-rendering) ──

  const startResize = (event: CalendarEvent, startX: number) => {
    const colWidth = ((rowRef.current?.clientWidth ?? 0) - GUTTER_PX - scrollbarW) / 7
    if (colWidth <= 0) return
    const origEnd = eventEnd(event)
    const endFor = (x: number) => {
      const delta = Math.round((x - startX) / colWidth)
      const span = Math.min(MAX_SPAN_DAYS, Math.max(0, diffDays(event.date, origEnd) + delta))
      return shiftKey(event.date, span)
    }
    let latest = origEnd
    const move = (ev: PointerEvent) => { latest = endFor(ev.clientX); setResize({ id: event.id, end: latest }) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResize(null)
      if (latest !== origEnd) updateEvent(event.id, { endDate: latest > event.date ? latest : undefined })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startTimeResize = (event: CalendarEvent, edge: 'start' | 'end', startY: number) => {
    const range = timedRange(event)
    let latest = range
    const move = (ev: PointerEvent) => {
      const delta = snapMin(((ev.clientY - startY) / HOUR_PX) * 60)
      latest = edge === 'end'
        ? { start: range.start, end: Math.min(MAX_TIME_MIN, Math.max(range.start + SNAP_MIN, range.end + delta)) }
        : { start: Math.max(0, Math.min(range.end - SNAP_MIN, range.start + delta)), end: range.end }
      setTimeResize({ id: event.id, startTime: fromMin(latest.start), endTime: fromMin(latest.end) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTimeResize(null)
      if (latest.start !== range.start || latest.end !== range.end) {
        updateEvent(event.id, { startTime: fromMin(latest.start), endTime: fromMin(latest.end) })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Drag across empty grid space to create ──────────────────────────────────

  const startCreateDrag = (key: string, e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-card]')) return
    const col = colRefs.current.get(key)
    if (!col) return
    const slotAt = (clientY: number) => {
      const y = clientY - col.getBoundingClientRect().top
      return Math.min(DAY_MIN - SNAP_MIN, Math.max(0, Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN))
    }
    const anchor = slotAt(e.clientY)
    let range = { start: anchor, end: anchor + SNAP_MIN }
    let moved = false
    const move = (ev: PointerEvent) => {
      const at = slotAt(ev.clientY)
      range = { start: Math.min(anchor, at), end: Math.max(anchor, at) + SNAP_MIN }
      moved = moved || range.end - range.start > SNAP_MIN
      setDraft({ key, ...range })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      // A plain click makes a default-length block starting at that slot.
      const end = moved ? range.end : range.start + DEFAULT_DURATION_MIN
      setCreating({ date: key, startTime: fromMin(range.start), endTime: fromMin(Math.min(MAX_TIME_MIN, end)) })
    }
    setDraft({ key, ...range })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={cn('overflow-hidden flex-1 flex flex-row min-w-0', bodyGlass ? 'glass-card' : 'bg-background')}
      style={bodyGlass ? glassBg('background', glassOpacity, theme, 'card') : undefined}
    >
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold text-foreground">{formatWeekRange(weekStart)}</h1>
          {weekEvents.length > 0 && (
            <span className="text-[12px] text-tertiary">{doneCount}/{weekEvents.length} done</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground hover:bg-surface"
            >
              Today
            </button>
            <button
              onClick={() => setWeekStart(w => addDays(w, -7))}
              title="Previous week"
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setWeekStart(w => addDays(w, 7))}
              title="Next week"
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCreating({ date: weekKeys.includes(todayKey) ? todayKey : weekKeys[0] })}
              className="ml-2 flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:opacity-90"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </button>
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragId(null)}
        >
          <div className="flex-1 flex flex-col min-h-0">
            {/* Day headers */}
            <div ref={rowRef} className="grid shrink-0" style={{ ...GRID_COLS, paddingRight: scrollbarW }}>
              <div />
              {days.map(d => {
                const key = toDateKey(d)
                return <DayHeader key={key} date={d} isToday={key === todayKey} onAdd={() => setCreating({ date: key })} />
              })}
            </div>

            {/* Multi-day bars */}
            {bars.length > 0 && (
              <div className="grid auto-rows-min gap-y-1 pb-1.5 shrink-0" style={{ ...GRID_COLS, paddingRight: scrollbarW }}>
                {bars.map(b => (
                  <div
                    key={b.event.id}
                    className="relative min-w-0 mx-2"
                    style={{ gridColumn: `${b.start + 2} / ${b.end + 3}`, gridRow: b.lane + 1 }}
                  >
                    <EventCard
                      event={b.event}
                      active={b.event.id === sheetId}
                      onOpen={() => setSheetId(b.event.id)}
                      contLeft={b.contLeft}
                      contRight={b.contRight}
                      onResizeStart={x => startResize(b.event, x)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* All-day row (reorderable) */}
            <div className="grid shrink-0 border-y border-border" style={{ ...GRID_COLS, paddingRight: scrollbarW }}>
              <div className="pt-2 pr-2 text-[10px] tracking-wide text-tertiary text-right whitespace-nowrap">all-day</div>
              {days.map(d => {
                const key = toDateKey(d)
                return (
                  <AllDayCell
                    key={key}
                    dateKey={key}
                    events={sortAllDay(allDay.get(key) ?? [])}
                    activeId={sheetId}
                    onOpen={setSheetId}
                    onResizeStart={startResize}
                  />
                )
              })}
            </div>

            {/* Hour grid */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
              <div className="grid relative" style={{ ...GRID_COLS, height: GRID_HEIGHT }}>
                <div className="relative">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="absolute right-2 text-[10.5px] text-tertiary tabular-nums leading-none"
                      style={{ top: h * HOUR_PX, transform: h === 0 ? undefined : 'translateY(-50%)' }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
                {days.map(d => {
                  const key = toDateKey(d)
                  return (
                    <GridColumn
                      key={key}
                      dateKey={key}
                      blocks={layoutDay(timed.get(key) ?? [])}
                      activeId={sheetId}
                      onOpen={setSheetId}
                      onTimeResize={startTimeResize}
                      onPointerDown={e => startCreateDrag(key, e)}
                      draft={draft?.key === key ? draft : null}
                      nowMin={key === todayKey ? nowMin : null}
                      setRef={el => { if (el) colRefs.current.set(key, el); else colRefs.current.delete(key) }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
          {/* Portaled: the glass card's backdrop-filter would otherwise become the
              containing block for the overlay's position:fixed and offset it. */}
          {createPortal(
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {dragEvent && <EventCardBody event={dragEvent} lifted />}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </div>

      {creating && (
        <CreateEventDialog
          seed={creating}
          onClose={() => setCreating(null)}
          onCreated={() => setCreating(null)}
        />
      )}
      {sheetEvent && <EventSheet key={sheetEvent.id} event={sheetEvent} onClose={() => setSheetId(null)} />}
    </div>
  )
}

function DayHeader({ date, isToday, onAdd }: { date: Date; isToday: boolean; onAdd: () => void }) {
  return (
    <div className="px-3 pt-3 pb-2 flex items-center gap-1.5 border-l border-border">
      <span className="uppercase text-[10.5px] font-semibold tracking-wider text-tertiary">
        {date.toLocaleDateString(undefined, { weekday: 'short' })}
      </span>
      <span
        className={cn(
          'text-[15px] font-semibold',
          isToday
            ? 'bg-accent text-white rounded-full min-w-6 h-6 px-1.5 inline-flex items-center justify-center'
            : 'text-foreground',
        )}
      >
        {date.getDate()}
      </span>
      <button
        onClick={onAdd}
        title="Add to this day"
        className="ml-auto w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function AllDayCell({ dateKey, events, activeId, onOpen, onResizeStart }: {
  dateKey: string
  events: CalendarEvent[]
  activeId: string | null
  onOpen: (id: string) => void
  onResizeStart: (event: CalendarEvent, startX: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday:${dateKey}` })
  return (
    <div ref={setNodeRef} className={cn('min-h-[40px] px-2 py-1.5 space-y-1.5 border-l border-border', isOver && 'bg-active/40')}>
      {events.map(ev => (
        <EventCard
          key={ev.id}
          event={ev}
          active={ev.id === activeId}
          onOpen={() => onOpen(ev.id)}
          onResizeStart={x => onResizeStart(ev, x)}
          reorderTarget
        />
      ))}
    </div>
  )
}

function GridColumn({ dateKey, blocks, activeId, onOpen, onTimeResize, onPointerDown, draft, nowMin, setRef }: {
  dateKey: string
  blocks: ReturnType<typeof layoutDay>
  activeId: string | null
  onOpen: (id: string) => void
  onTimeResize: (event: CalendarEvent, edge: 'start' | 'end', startY: number) => void
  onPointerDown: (e: React.PointerEvent) => void
  draft: { start: number; end: number } | null
  nowMin: number | null
  setRef: (el: HTMLDivElement | null) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `grid:${dateKey}` })
  return (
    <div
      ref={el => { setNodeRef(el); setRef(el) }}
      onPointerDown={onPointerDown}
      className={cn('relative border-l border-border cursor-cell', isOver && 'bg-active/30')}
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, hsl(var(--border)) ${HOUR_PX - 1}px, hsl(var(--border)) ${HOUR_PX}px)`,
      }}
    >
      {blocks.map(b => (
        <TimedCard
          key={b.event.id}
          block={b}
          active={b.event.id === activeId}
          onOpen={() => onOpen(b.event.id)}
          onResizeStart={(edge, y) => onTimeResize(b.event, edge, y)}
        />
      ))}
      {draft && (
        <div
          className="absolute left-1 right-1 rounded-md bg-accent/25 border border-accent/60 pointer-events-none text-[11px] text-accent px-1.5 py-0.5"
          style={{ top: (draft.start / 60) * HOUR_PX, height: ((draft.end - draft.start) / 60) * HOUR_PX - 1 }}
        >
          {fromMin(draft.start)} – {fromMin(Math.min(draft.end, DAY_MIN))}
        </div>
      )}
      {nowMin != null && (
        <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX }}>
          <div className="h-px bg-red-500" />
          <div className="absolute -left-1 -top-[3px] w-1.5 h-1.5 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  )
}

function TimedCard({ block, active, onOpen, onResizeStart }: {
  block: ReturnType<typeof layoutDay>[number]
  active: boolean
  onOpen: () => void
  onResizeStart: (edge: 'start' | 'end', startY: number) => void
}) {
  const { event, start, end, col, cols } = block
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: event.id })
  const height = ((end - start) / 60) * HOUR_PX - 2
  const grip = (edge: 'start' | 'end') => (
    <div
      onPointerDown={e => { e.stopPropagation(); e.preventDefault(); onResizeStart(edge, e.clientY) }}
      title={edge === 'end' ? 'Drag to change the end time' : 'Drag to change the start time'}
      className={cn('absolute left-0 right-0 h-2 cursor-ns-resize z-10', edge === 'end' ? 'bottom-0' : 'top-0')}
    />
  )
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-card
      onClick={onOpen}
      className={cn('absolute cursor-grab touch-none', isDragging && 'opacity-30')}
      style={{
        top: (start / 60) * HOUR_PX + 1,
        height,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
      }}
    >
      <EventCardBody event={event} active={active} fill compact={height < 44} />
      {grip('start')}
      {grip('end')}
    </div>
  )
}

function EventCard({ event, active, onOpen, contLeft, contRight, onResizeStart, reorderTarget }: {
  event: CalendarEvent
  active: boolean
  onOpen: () => void
  contLeft?: boolean
  contRight?: boolean
  onResizeStart: (startX: number) => void
  reorderTarget?: boolean
}) {
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({ id: event.id })
  // All-day cards double as drop targets so another card can be dropped before them.
  const { setNodeRef: setDrop } = useDroppable({ id: `card:${event.id}`, disabled: !reorderTarget })

  return (
    <div className="relative group/card" ref={setDrop}>
      <div
        ref={setDrag}
        {...attributes}
        {...listeners}
        data-card
        onClick={onOpen}
        className={cn('cursor-grab touch-none', isDragging && 'opacity-30')}
      >
        <EventCardBody event={event} active={active} contLeft={contLeft} contRight={contRight} />
      </div>
      {!contRight && (
        <div
          onPointerDown={e => {
            e.stopPropagation()
            e.preventDefault()
            onResizeStart(e.clientX)
          }}
          title="Drag to stretch across days"
          className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize flex items-center justify-center opacity-0 group-hover/card:opacity-100"
        >
          <span className="w-0.5 h-4 rounded-full bg-foreground/40" />
        </div>
      )}
    </div>
  )
}

/** The card visuals, shared by grid cards, all-day cards, multi-day bars and the lifted drag copy. */
function EventCardBody({ event, active, lifted, contLeft, contRight, fill, compact }: {
  event: CalendarEvent
  active?: boolean
  lifted?: boolean
  contLeft?: boolean
  contRight?: boolean
  fill?: boolean
  compact?: boolean
}) {
  const update = useAppStore(s => s.updateCalendarEvent)
  const color = event.color ?? EVENT_COLORS[0]
  const tint = `color-mix(in srgb, ${color} 20%, transparent)`
  // Follows the theme's foreground (dark on light, light on dark), tinted toward the event color.
  const ink = `color-mix(in srgb, ${color} 30%, hsl(var(--foreground)))`
  const time = event.startTime ? `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}` : null

  return (
    <div
      className={cn(
        'rounded-lg border flex gap-2 items-start overflow-hidden transition-[box-shadow,transform,background-color]',
        compact ? 'px-2 py-0.5' : 'px-2.5 py-2',
        (fill || lifted) && 'h-full',
        contLeft && 'rounded-l-none',
        contRight && 'rounded-r-none',
        event.done && 'opacity-60',
        lifted
          ? 'cursor-grabbing shadow-2xl rotate-2 scale-105'
          : cn('hover:shadow-sm', active && 'ring-2 ring-offset-1 ring-offset-transparent'),
      )}
      style={{
        // The lifted copy floats over other content, so it gets an opaque base under the tint.
        backgroundColor: lifted ? 'hsl(var(--panel))' : undefined,
        backgroundImage: `linear-gradient(${tint}, ${tint})`,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        color: ink,
        ['--tw-ring-color' as string]: color,
      }}
    >
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); update(event.id, { done: !event.done }) }}
        title={event.done ? 'Mark as not done' : 'Mark as done'}
        className={cn(
          'mt-[1px] w-4 h-4 shrink-0 rounded-full border-[1.5px] flex items-center justify-center transition-colors',
          compact && 'w-3.5 h-3.5 mt-[3px]',
          event.done ? 'border-transparent text-white' : 'border-current opacity-70 hover:opacity-100',
        )}
        style={event.done ? { background: color } : undefined}
      >
        {event.done && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium leading-snug', compact ? 'text-[11.5px] truncate' : 'text-[12.5px] break-words', event.done && 'line-through')}>
          {event.title || 'Untitled'}
          {compact && time && <span className="ml-1.5 font-normal opacity-75">{event.startTime}</span>}
        </p>
        {!compact && time && <p className="text-[11px] mt-0.5 opacity-75">{time}</p>}
      </div>
    </div>
  )
}

const fieldCls = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-tertiary outline-none focus:border-accent disabled:opacity-40'

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest font-semibold text-tertiary mb-1.5">{children}</p>
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      {EVENT_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label="Set color"
          className={cn('w-5 h-5 rounded-full transition-transform', value === c ? 'ring-2 ring-offset-2 ring-offset-panel ring-foreground/70 scale-110' : 'hover:scale-110')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

function DateField({ dateKey, onChange }: { dateKey: string; onChange: (key: string) => void }) {
  return (
    <DatePicker
      value={fromDateKey(dateKey).toISOString()}
      onChange={iso => iso && onChange(toDateKey(new Date(iso)))}
    />
  )
}

/** Optional last day for multi-day events; never earlier than the start. */
function EndDateField({ startKey, endKey, onChange }: {
  startKey: string
  endKey?: string
  onChange: (key: string | undefined) => void
}) {
  return (
    <DatePicker
      value={endKey ? fromDateKey(endKey).toISOString() : null}
      placeholder="Single day"
      onChange={iso => {
        const key = iso ? toDateKey(new Date(iso)) : undefined
        onChange(key && key > startKey ? key : undefined)
      }}
    />
  )
}

// Radix Select can't use an empty string as an item value, hence the sentinel.
const NO_TIME = 'none'
const TIME_STEP_MIN = 15
const TIME_SLOTS = Array.from({ length: (24 * 60) / TIME_STEP_MIN }, (_, i) => {
  const m = i * TIME_STEP_MIN
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})

function timeOptions(first: { label: string }, slots: string[], current?: string): SelectOption[] {
  // A time saved off the 15-minute grid still has to show up as selected.
  const all = current && !slots.includes(current) ? [...slots, current].sort() : slots
  return [{ value: NO_TIME, label: first.label }, ...all.map(t => ({ value: t, label: t }))]
}

function TimeFields({ start, end, onChange }: {
  start?: string
  end?: string
  onChange: (patch: { startTime?: string; endTime?: string }) => void
}) {
  const triggerCls = 'px-2.5 py-1.5 text-[13px] rounded-md'
  return (
    <div className="flex items-center gap-2">
      <Select
        value={start ?? NO_TIME}
        options={timeOptions({ label: 'All day' }, TIME_SLOTS, start)}
        onChange={v => {
          const startTime = v === NO_TIME ? undefined : v
          // The end must stay after the start; drop it if the start moved past it.
          onChange({ startTime, endTime: startTime && end && end > startTime ? end : undefined })
        }}
        className={triggerCls}
      />
      <span className="text-tertiary text-xs">–</span>
      <Select
        value={end ?? NO_TIME}
        disabled={!start}
        options={timeOptions({ label: 'No end' }, TIME_SLOTS.filter(t => !start || t > start), end)}
        onChange={v => onChange({ startTime: start, endTime: v === NO_TIME ? undefined : v })}
        className={triggerCls}
      />
    </div>
  )
}

function CreateEventDialog({ seed, onClose, onCreated }: {
  seed: CreateSeed
  onClose: () => void
  onCreated: () => void
}) {
  const addEvent = useAppStore(s => s.addCalendarEvent)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(seed.date)
  const [endDate, setEndDate] = useState<string | undefined>()
  const [time, setTime] = useState<{ startTime?: string; endTime?: string }>({ startTime: seed.startTime, endTime: seed.endTime })
  const [color, setColor] = useState<string>(EVENT_COLORS[0])
  const [notes, setNotes] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    addEvent({ title: title.trim(), date, endDate, color, notes: notes.trim() || undefined, ...time })
    onCreated()
  }

  return (
    <Dialog.Root open onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-panel border border-border rounded-lg shadow-lg p-5 focus:outline-none"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <Dialog.Title className="text-sm font-semibold text-foreground mb-3">New event</Dialog.Title>
          <Dialog.Description className="sr-only">Add an event or task to your week.</Dialog.Description>
          <form onSubmit={submit} className="space-y-3.5">
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What are you planning?"
              className={cn(fieldCls, 'h-9')}
            />
            <div>
              <Label>Date</Label>
              <DateField
                dateKey={date}
                onChange={key => {
                  // Keep the length of a multi-day event when its start moves.
                  if (endDate) setEndDate(shiftKey(endDate, diffDays(date, key)))
                  setDate(key)
                }}
              />
            </div>
            <div>
              <Label>Ends (optional)</Label>
              <EndDateField startKey={date} endKey={endDate} onChange={setEndDate} />
            </div>
            <div>
              <Label>Time (optional)</Label>
              <TimeFields start={time.startTime} end={time.endTime} onChange={setTime} />
            </div>
            <div>
              <Label>Notes</Label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={cn(fieldCls, 'resize-none')} />
            </div>
            <div>
              <Label>Color</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function EventSheet({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const update = useAppStore(s => s.updateCalendarEvent)
  const remove = useAppStore(s => s.deleteCalendarEvent)
  const openConfirm = useAppStore(s => s.openConfirm)
  const color = event.color ?? EVENT_COLORS[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleDelete = () =>
    openConfirm({
      title: `Delete "${event.title}"?`,
      description: 'This removes the event from your calendar.',
      confirmLabel: 'Delete event',
      destructive: true,
      onConfirm: () => { remove(event.id); onClose() },
    })

  // Docked beside the week (not an overlay): nothing renders behind it, so it
  // stays transparent and simply shows the calendar card's own glass.
  return (
    <aside
      className="w-[380px] max-w-[45%] shrink-0 border-l border-border flex flex-col"
      aria-label="Event details"
    >
      <div className="flex items-start gap-3 p-4 border-b border-border shrink-0" style={{ borderTop: `3px solid ${color}` }}>
        <button
          onClick={() => update(event.id, { done: !event.done })}
          title={event.done ? 'Mark as not done' : 'Mark as done'}
          className={cn(
            'mt-1 w-4 h-4 shrink-0 rounded border flex items-center justify-center',
            event.done ? 'bg-accent border-accent text-white' : 'border-tertiary hover:border-accent',
          )}
        >
          {event.done && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
        <textarea
          value={event.title}
          onChange={e => update(event.id, { title: e.target.value.replace(/\n/g, ' ') })}
          rows={2}
          aria-label="Title"
          className={cn(
            'flex-1 min-w-0 resize-none bg-transparent text-[15px] font-semibold outline-none',
            event.done ? 'line-through text-muted-foreground' : 'text-foreground',
          )}
        />
        <button
          onClick={handleDelete}
          title="Delete event"
          aria-label="Delete event"
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div>
          <Label>Date</Label>
          <DateField
            dateKey={event.date}
            onChange={date =>
              update(event.id, {
                date,
                endDate: event.endDate ? shiftKey(event.endDate, diffDays(event.date, date)) : undefined,
              })
            }
          />
        </div>
        <div>
          <Label>Ends</Label>
          <EndDateField startKey={event.date} endKey={event.endDate} onChange={endDate => update(event.id, { endDate })} />
        </div>
        <div>
          <Label>Time</Label>
          <TimeFields start={event.startTime} end={event.endTime} onChange={patch => update(event.id, patch)} />
        </div>
        <div>
          <Label>Notes</Label>
          <textarea
            value={event.notes ?? ''}
            onChange={e => update(event.id, { notes: e.target.value || undefined })}
            placeholder="Add details…"
            rows={8}
            className={cn(fieldCls, 'resize-none')}
          />
        </div>
        <div>
          <Label>Color</Label>
          <ColorPicker value={color} onChange={c => update(event.id, { color: c })} />
        </div>
      </div>
    </aside>
  )
}
