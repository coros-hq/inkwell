import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { adaptShape } from './canvasShared'
import { shapeBounds } from './canvasTypes'
import { isFrame } from './canvasFrames'
import type { Shape, Point } from './canvasTypes'

// Overview of the whole board in the bottom-right corner. The parent calls the
// draw function it receives through `drawRef` at the end of every main render,
// so the map tracks shapes, pan and zoom without extra React state.

const MAP_W = 200
const MAP_H = 136

export interface MinimapView {
  shapes: Shape[]
  pan: Point
  zoom: number
  /** Main canvas size in CSS pixels. */
  w: number
  h: number
  darkBg: boolean
  ink: string
}

interface Props {
  open: boolean
  /** Sit above the toolbar row instead of beside it (narrow canvas). */
  raised: boolean
  onToggle: () => void
  getView: () => MinimapView | null
  /** Center the main viewport on this world point. */
  onCenter: (p: Point) => void
  drawRef: React.MutableRefObject<(() => void) | null>
}

interface Xform { ox: number; oy: number; s: number }

function cssColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw ? `hsl(${raw})` : fallback
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Fit content + current viewport into the map, with a little padding. */
function computeXform(v: MinimapView): Xform {
  const vx = -v.pan.x / v.zoom, vy = -v.pan.y / v.zoom
  const vw = v.w / v.zoom, vh = v.h / v.zoom
  let x1 = vx, y1 = vy, x2 = vx + vw, y2 = vy + vh
  for (const s of v.shapes) {
    const b = shapeBounds(s)
    if (b.x < x1) x1 = b.x
    if (b.y < y1) y1 = b.y
    if (b.x + b.w > x2) x2 = b.x + b.w
    if (b.y + b.h > y2) y2 = b.y + b.h
  }
  const pad = Math.max(x2 - x1, y2 - y1) * 0.06
  x1 -= pad; y1 -= pad; x2 += pad; y2 += pad
  const s = Math.min(MAP_W / (x2 - x1), MAP_H / (y2 - y1))
  // Center the content box inside the map.
  const ox = (MAP_W - (x2 - x1) * s) / 2 - x1 * s
  const oy = (MAP_H - (y2 - y1) * s) / 2 - y1 * s
  return { ox, oy, s }
}

function drawShapes(ctx: CanvasRenderingContext2D, v: MinimapView, t: Xform) {
  const X = (x: number) => x * t.s + t.ox
  const Y = (y: number) => y * t.s + t.oy
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (const raw of v.shapes) {
    const sh = adaptShape(raw, v.darkBg, v.ink)
    ctx.lineWidth = 1
    ctx.strokeStyle = sh.color
    switch (sh.type) {
      case 'path': {
        if (sh.pts.length < 2) break
        const step = Math.max(1, Math.floor(sh.pts.length / 60))
        ctx.beginPath()
        ctx.moveTo(X(sh.pts[0].x), Y(sh.pts[0].y))
        for (let i = step; i < sh.pts.length; i += step) ctx.lineTo(X(sh.pts[i].x), Y(sh.pts[i].y))
        const last = sh.pts[sh.pts.length - 1]
        ctx.lineTo(X(last.x), Y(last.y))
        ctx.stroke()
        break
      }
      case 'line':
      case 'arrow': {
        ctx.beginPath()
        ctx.moveTo(X(sh.x1), Y(sh.y1))
        if (sh.type === 'arrow' && sh.cpx != null && sh.cpy != null) ctx.quadraticCurveTo(X(sh.cpx), Y(sh.cpy), X(sh.x2), Y(sh.y2))
        else ctx.lineTo(X(sh.x2), Y(sh.y2))
        ctx.stroke()
        break
      }
      case 'ellipse': {
        ctx.beginPath()
        ctx.ellipse(X(sh.cx), Y(sh.cy), Math.max(0.5, sh.rx * t.s), Math.max(0.5, sh.ry * t.s), 0, 0, Math.PI * 2)
        ctx.fillStyle = sh.fill !== 'none' ? sh.fill : withAlpha(sh.color, 0.18)
        ctx.fill(); ctx.stroke()
        break
      }
      default: {
        const b = shapeBounds(sh)
        const x = X(b.x), y = Y(b.y), w = Math.max(1, b.w * t.s), h = Math.max(1, b.h * t.s)
        if (sh.type === 'rect' && isFrame(sh)) {
          ctx.setLineDash([3, 2]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([])
        } else if (sh.type === 'sticky') {
          ctx.fillStyle = sh.color; ctx.fillRect(x, y, w, h)
        } else if (sh.type === 'image') {
          ctx.fillStyle = withAlpha(v.ink, 0.25); ctx.fillRect(x, y, w, h)
        } else if (sh.type === 'text') {
          ctx.fillStyle = withAlpha(sh.color, 0.6); ctx.fillRect(x, y + h * 0.25, w, Math.max(1, h * 0.5))
        } else {
          ctx.fillStyle = sh.fill !== 'none' ? sh.fill : withAlpha(sh.color, 0.18)
          ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h)
        }
      }
    }
  }
}

export function CanvasMinimap({ open, raised, onToggle, getView, onCenter, drawRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const xformRef  = useRef<Xform | null>(null)
  // While dragging, keep the scale fixed so the map doesn't shift under the pointer.
  const frozenRef = useRef<Xform | null>(null)
  const rafRef    = useRef(0)

  const paint = useCallback(() => {
    rafRef.current = 0
    const canvas = canvasRef.current
    const v = getView()
    if (!canvas || !v) return
    const DPR = window.devicePixelRatio || 1
    if (canvas.width !== MAP_W * DPR) { canvas.width = MAP_W * DPR; canvas.height = MAP_H * DPR }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    ctx.clearRect(0, 0, MAP_W, MAP_H)

    const t = frozenRef.current ?? computeXform(v)
    xformRef.current = t
    drawShapes(ctx, v, t)

    // Current viewport
    const accent = cssColor('--accent', '#60a5fa')
    const rx = (-v.pan.x / v.zoom) * t.s + t.ox, ry = (-v.pan.y / v.zoom) * t.s + t.oy
    const rw = (v.w / v.zoom) * t.s, rh = (v.h / v.zoom) * t.s
    ctx.save()
    ctx.globalAlpha = 0.12; ctx.fillStyle = accent; ctx.fillRect(rx, ry, rw, rh)
    ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 1.5
    ctx.strokeRect(rx + 0.75, ry + 0.75, Math.max(2, rw - 1.5), Math.max(2, rh - 1.5))
    ctx.restore()
  }, [getView])

  // Coalesce redraws to one per frame — the main canvas renders on every mouse move.
  useEffect(() => {
    if (!open) { drawRef.current = null; return }
    drawRef.current = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(paint) }
    paint()
    return () => {
      drawRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [open, paint, drawRef])

  const centerAt = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current, t = xformRef.current
    if (!canvas || !t) return
    const r = canvas.getBoundingClientRect()
    onCenter({ x: (e.clientX - r.left - t.ox) / t.s, y: (e.clientY - r.top - t.oy) / t.s })
  }

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    frozenRef.current = xformRef.current
    centerAt(e)
    const move = (ev: MouseEvent) => centerAt(ev)
    const up = () => {
      frozenRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      paint()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!open) return null

  return (
    <div
      className={cn('absolute right-4 z-20 rounded-xl border border-border bg-surface/95 shadow-xl overflow-hidden select-none group', raised ? 'bottom-20' : 'bottom-4')}
      onWheel={e => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas-minimap"
        className="block cursor-pointer"
        style={{ width: MAP_W, height: MAP_H }}
        onMouseDown={onMouseDown}
      />
      <button
        onClick={onToggle}
        title="Hide minimap (⇧M)"
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md bg-surface/90 border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={11} />
      </button>
    </div>
  )
}
