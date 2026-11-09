import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CalendarPlus, Check, ChevronLeft, ExternalLink, Feather, ListPlus, PenLine, Pencil, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { localDay, sendWidgetAction, type WidgetAction } from '../../lib/widgetSync'

type Petal = 'note' | 'task' | 'draw' | 'event' | 'open'
type Mode = 'menu' | 'task' | 'event'

const PETALS: { id: Petal; label: string; key: string; Icon: LucideIcon }[] = [
  { id: 'note', label: 'Quick note', key: 'N', Icon: PenLine },
  { id: 'task', label: 'Add task', key: 'T', Icon: ListPlus },
  { id: 'event', label: 'Add event', key: 'E', Icon: CalendarPlus },
  { id: 'draw', label: 'New drawing', key: 'D', Icon: Pencil },
  { id: 'open', label: 'Open inkwell', key: 'O', Icon: ExternalLink },
]

// Pie geometry (viewBox units = px): a donut of equal wedges, the first centred at 12 o'clock.
const R_OUT = 140
const R_IN = 52
const GAP = 3 // visible gap between wedges
const SLICE = 360 / PETALS.length

function wedgePath(i: number): string {
  const rad = (d: number) => (d * Math.PI) / 180
  const a0 = -90 + SLICE * i - SLICE / 2
  const a1 = a0 + SLICE
  // Equal-width gaps: pad the angle by GAP px at each radius.
  const po = (GAP / 2 / R_OUT) * (180 / Math.PI)
  const pi = (GAP / 2 / R_IN) * (180 / Math.PI)
  const pt = (r: number, d: number) => `${(150 + r * Math.cos(rad(d))).toFixed(2)} ${(150 + r * Math.sin(rad(d))).toFixed(2)}`
  return [
    `M ${pt(R_OUT, a0 + po)}`,
    `A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1 - po)}`,
    `L ${pt(R_IN, a1 - pi)}`,
    `A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0 + pi)}`,
    'Z',
  ].join(' ')
}

const GLASS = 'bg-[linear-gradient(145deg,hsl(var(--foreground)/0.10),hsl(var(--foreground)/0.03))] border border-foreground/10 backdrop-blur-xl'
const FIELD = 'w-full rounded-lg border border-foreground/10 bg-foreground/[0.05] px-2.5 py-1.5 text-foreground outline-none transition-colors placeholder:text-tertiary focus:border-accent/60 focus:bg-foreground/[0.08]'

async function hideWidget() {
  try { await getCurrentWindow().hide() } catch { /* not inside Tauri */ }
}

/**
 * The quick-actions widget — a disc of shortcuts that pops up at the pointer on the
 * global ⌘⇧Space, even while inkwell only lives in the menu bar. Notes open the quick-note
 * popup; tasks and events are typed in place; drawings and "open" bring the main window up.
 * Everything that changes data is performed by the main window (see lib/widgetSync.ts).
 */
export function QuickWidget() {
  const [mode, setMode] = useState<Mode>('menu')
  const [open, setOpen] = useState(false)       // drives the petal fan-out animation
  const [hover, setHover] = useState<Petal | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [date, setDate] = useState(localDay())
  const [time, setTime] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setMode('menu'); setHover(null); setBusy(false); setDone(false); setError(null)
    setTitle(''); setPriority('medium'); setDate(localDay()); setTime('')
    setOpen(false)
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)))
  }, [])

  // Each time the shortcut brings the window up, start from a clean menu.
  useEffect(() => {
    reset()
    const un = listen('inkwell:widget-shown', reset)
    return () => { un.then(fn => fn()) }
  }, [reset])

  useEffect(() => { if (mode !== 'menu') titleRef.current?.focus() }, [mode])

  const run = async (action: WidgetAction) => {
    setBusy(true); setError(null)
    try {
      await sendWidgetAction(action)
      setDone(true)
      setTimeout(hideWidget, action.type === 'task' || action.type === 'event' ? 700 : 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const choose = (p: Petal) => {
    setError(null)
    if (p === 'note') { void invoke('open_quick_note'); void hideWidget() }
    else if (p === 'task' || p === 'event') setMode(p)
    else if (p === 'draw') void run({ type: 'draw' })
    else void run({ type: 'open' })
  }

  const submit = () => {
    const t = title.trim()
    if (!t || busy) return
    if (mode === 'task') void run({ type: 'task', title: t, priority })
    else if (mode === 'event') void run({ type: 'event', title: t, date: date || localDay(), startTime: time || undefined })
  }

  // Keyboard: letters pick a petal, Esc steps back and then dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode === 'menu') void hideWidget(); else reset()
        return
      }
      if (mode !== 'menu' || e.metaKey || e.ctrlKey || e.altKey) return
      const p = PETALS.find(x => x.key.toLowerCase() === e.key.toLowerCase())
      if (p) { e.preventDefault(); choose(p.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const hovered = hover ? PETALS.find(p => p.id === hover)! : null

  return (
    // The window is a transparent square; a click on the empty corners dismisses it.
    <div
      className="relative flex h-screen w-screen select-none items-center justify-center text-foreground"
      onMouseDown={e => { if (e.target === e.currentTarget) void hideWidget() }}
    >
      <style>{`
        @keyframes widget-pop { from { opacity: 0; transform: scale(.92) translateY(6px) } to { opacity: 1; transform: none } }
        @keyframes widget-glow { 0%,100% { opacity: .55 } 50% { opacity: .9 } }
        @media (prefers-reduced-motion: reduce) { .widget-anim { animation: none !important; transition: none !important } }
      `}</style>

      {/* Ambient accent glow behind the disc */}
      <div
        className={cn('widget-anim pointer-events-none absolute h-[290px] w-[290px] rounded-full blur-3xl transition-opacity duration-500', open ? 'opacity-100' : 'opacity-0')}
        style={{ background: 'radial-gradient(circle, hsl(var(--accent) / 0.32), transparent 68%)', animation: 'widget-glow 4s ease-in-out infinite' }}
      />

      {/* Frosted backing disc (clicks on it do nothing; only the empty corners dismiss) */}
      <div
        className={cn(
          'widget-anim absolute h-[296px] w-[296px] rounded-full backdrop-blur-2xl',
          'transition-all duration-300 ease-[cubic-bezier(.2,.9,.3,1.2)]',
          open ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
        style={{
          background: 'radial-gradient(circle at 30% 18%, hsl(var(--foreground) / 0.10), hsl(var(--background) / 0.82) 60%)',
          boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.14), inset 0 0 0 1px hsl(var(--foreground) / 0.09), 0 24px 60px -14px rgba(0,0,0,0.6)',
        }}
      />

      {mode === 'menu' ? (
        <>
          {/* The pie: one wedge per action */}
          <svg viewBox="0 0 300 300" className="absolute h-[300px] w-[300px]" role="menu" aria-label="Quick actions">
            {PETALS.map(({ id, label }, i) => {
              const active = hover === id
              const mid = (-90 + SLICE * i) * (Math.PI / 180)
              const push = active ? 7 : 0
              return (
                <g
                  key={id}
                  className="widget-anim"
                  style={{
                    transformOrigin: '150px 150px',
                    transform: open ? 'scale(1)' : 'scale(0.6)',
                    opacity: open ? 1 : 0,
                    transition: 'transform .35s cubic-bezier(.2,.9,.3,1.2), opacity .25s ease-out',
                    transitionDelay: open ? `${i * 45}ms` : '0ms',
                  }}
                >
                  <g
                    style={{
                      transform: `translate(${Math.cos(mid) * push}px, ${Math.sin(mid) * push}px)`,
                      transition: 'transform .18s ease-out',
                    }}
                  >
                    <path
                      d={wedgePath(i)}
                      role="menuitem"
                      tabIndex={0}
                      aria-label={label}
                      onClick={() => { if (!busy) choose(id) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) choose(id) } }}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(h => (h === id ? null : h))}
                      onFocus={() => setHover(id)}
                      onBlur={() => setHover(h => (h === id ? null : h))}
                      className="cursor-pointer outline-none"
                      style={{
                        fill: active ? 'hsl(var(--accent) / 0.26)' : 'hsl(var(--foreground) / 0.07)',
                        stroke: active ? 'hsl(var(--accent) / 0.7)' : 'hsl(var(--foreground) / 0.12)',
                        strokeWidth: 1,
                        filter: active ? 'drop-shadow(0 0 10px hsl(var(--accent) / 0.45))' : 'none',
                        transition: 'fill .18s, stroke .18s, filter .18s',
                      }}
                    />
                  </g>
                </g>
              )
            })}
          </svg>

          {/* Wedge icons, laid over the pie at each wedge's middle */}
          {PETALS.map(({ id, Icon }, i) => {
            const mid = (-90 + SLICE * i) * (Math.PI / 180)
            const active = hover === id
            const r = (R_IN + R_OUT) / 2 + (active ? 7 : 0)
            return (
              <div
                key={id}
                className={cn(
                  'widget-anim pointer-events-none absolute transition-[transform,opacity,color] duration-200',
                  active ? 'text-accent' : 'text-foreground/75',
                  open ? 'opacity-100' : 'opacity-0',
                )}
                style={{ transform: `translate(${Math.cos(mid) * r}px, ${Math.sin(mid) * r}px) scale(${active ? 1.15 : 1})`, transitionDelay: open && !hover ? `${i * 45 + 80}ms` : '0ms' }}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </div>
            )
          })}


          {/* Centre: brand mark by default, the hovered action's name and key otherwise */}
          <div
            className="absolute flex h-[92px] w-[92px] flex-col items-center justify-center gap-1 rounded-full text-center"
            style={{
              background: 'radial-gradient(circle at 35% 25%, hsl(var(--foreground) / 0.10), hsl(var(--background) / 0.7))',
              boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.14), inset 0 0 0 1px hsl(var(--foreground) / 0.10)',
            }}
          >
            {done ? (
              <Check className="h-7 w-7 text-green-500" />
            ) : hovered ? (
              <>
                <hovered.Icon className="h-5 w-5 text-accent" strokeWidth={1.75} />
                <span className="px-1 text-[12px] font-semibold leading-tight tracking-tight">{hovered.label}</span>
                <kbd className="rounded border border-foreground/15 bg-foreground/[0.06] px-1.5 text-[9px] font-medium text-muted-foreground">{hovered.key}</kbd>
              </>
            ) : (
              <>
                <Feather className="h-6 w-6 text-accent" strokeWidth={1.5} />
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Capture</span>
              </>
            )}
          </div>
          {error && (
            <div className="widget-anim absolute bottom-4 left-1/2 w-[240px] -translate-x-1/2 rounded-lg border border-red-400/30 bg-background/90 px-3 py-1.5 text-center text-[11px] text-red-400 backdrop-blur-xl" style={{ animation: 'widget-pop .2s ease-out' }}>
              {error}
            </div>
          )}
        </>
      ) : (
        <form
          onSubmit={e => { e.preventDefault(); submit() }}
          className={cn(GLASS, 'widget-anim relative z-10 flex w-[262px] flex-col gap-3 rounded-[22px] bg-background/85 p-4')}
          style={{
            animation: 'widget-pop .22s cubic-bezier(.2,.9,.3,1.2)',
            boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.14), 0 22px 50px -12px rgba(0,0,0,0.65), 0 0 40px -10px hsl(var(--accent) / 0.35)',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              aria-label="Back"
              className="-ml-1 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
              {mode === 'task' ? <ListPlus className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}
            </span>
            <span className="text-[13px] font-semibold tracking-tight">{mode === 'task' ? 'New task' : 'New event'}</span>
          </div>
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={mode === 'task' ? 'What needs doing?' : 'Event title'}
            className={cn(FIELD, 'text-sm')}
          />
          {mode === 'task' ? (
            <div className="flex gap-1 rounded-lg bg-foreground/[0.05] p-0.5">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-all',
                    priority === p ? 'bg-foreground/15 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-1.5">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={cn(FIELD, 'min-w-0 flex-1 text-[11px]')} />
              <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Start time (optional)" className={cn(FIELD, 'w-[88px] text-[11px]')} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className={cn('truncate text-[10px]', error ? 'text-red-400' : 'text-tertiary')}>
              {error ?? (mode === 'task' ? 'First column of your board' : 'No time = all-day')}
            </span>
            <button
              type="submit"
              disabled={!title.trim() || busy || done}
              style={!done ? { boxShadow: '0 6px 18px -6px hsl(var(--accent) / 0.7)' } : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
                done ? 'bg-green-500/20 text-green-500' : 'bg-accent text-accent-foreground hover:brightness-110',
                (!title.trim() || busy) && !done && 'pointer-events-none opacity-40',
              )}
            >
              {done && <Check className="h-3.5 w-3.5" />}
              {done ? 'Added' : busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          <div className="-mb-1 text-center text-[9px] text-tertiary">↵ to add · Esc to go back</div>
        </form>
      )}
    </div>
  )
}
