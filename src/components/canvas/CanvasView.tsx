import { useEffect, useRef, useState, useCallback } from 'react'
import { StickyNote } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { CanvasToolbar, FONT_SANS } from './CanvasToolbar'
import { CanvasNotesSheet } from './CanvasNotesSheet'
import { CanvasTemplatesPicker } from './CanvasTemplatesPicker'
import { CanvasCategoryPanel } from './CanvasCategoryPanel'
import type { DiagramTemplate, TemplateCategory } from './canvasTemplates'
import { uid, hitTest, shapeBounds } from './canvasTypes'
import type { Shape, Tool, Point, PathShape, RectShape, EllipseShape, LineShape, ArrowShape, TextShape } from './canvasTypes'

// ── Types ──────────────────────────────────────────────────────────────────────

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br'

// ── Pure helpers ───────────────────────────────────────────────────────────────

function getCSSColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw ? `hsl(${raw})` : fallback
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** Union bounding box of multiple shapes */
function unionBounds(shapes: Shape[]) {
  const bs = shapes.map(shapeBounds)
  const x  = Math.min(...bs.map(b => b.x))
  const y  = Math.min(...bs.map(b => b.y))
  const x2 = Math.max(...bs.map(b => b.x + b.w))
  const y2 = Math.max(...bs.map(b => b.y + b.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

/** Translate all shapes by (dx, dy) in world space */
function offsetShapes(shapes: Shape[], dx: number, dy: number): Shape[] {
  return shapes.map(s => {
    switch (s.type) {
      case 'path':    return { ...s, pts: (s as PathShape).pts.map(p => ({ x: p.x + dx, y: p.y + dy })) }
      case 'rect':    return { ...s, x: (s as RectShape).x + dx, y: (s as RectShape).y + dy }
      case 'ellipse': return { ...s, cx: (s as EllipseShape).cx + dx, cy: (s as EllipseShape).cy + dy }
      case 'line':    return { ...s, x1: (s as LineShape).x1 + dx, y1: (s as LineShape).y1 + dy, x2: (s as LineShape).x2 + dx, y2: (s as LineShape).y2 + dy }
      case 'arrow': { const a = s as ArrowShape; return { ...a, x1: a.x1+dx, y1: a.y1+dy, x2: a.x2+dx, y2: a.y2+dy, ...(a.cpx !== undefined ? { cpx: a.cpx+dx, cpy: a.cpy!+dy } : {}) } }
      case 'text':    return { ...s, x: (s as TextShape).x + dx, y: (s as TextShape).y + dy }
      default:        return s
    }
  })
}

function getHandleAt(shape: Shape, wp: Point, threshold: number): ResizeHandle | null {
  const b = shapeBounds(shape), pad = 6
  const handles: [ResizeHandle, number, number][] = [
    ['tl', b.x - pad,       b.y - pad],
    ['tr', b.x + b.w + pad, b.y - pad],
    ['bl', b.x - pad,       b.y + b.h + pad],
    ['br', b.x + b.w + pad, b.y + b.h + pad],
  ]
  for (const [h, hx, hy] of handles)
    if (Math.hypot(wp.x - hx, wp.y - hy) <= threshold) return h
  return null
}

function applyBoundsToShape(s: Shape, nb: { x: number; y: number; w: number; h: number }): Shape {
  const { x, y, w, h } = nb
  switch (s.type) {
    case 'rect':    return { ...(s as RectShape),    x, y, w, h }
    case 'ellipse': return { ...(s as EllipseShape), cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }
    case 'path': {
      const b = shapeBounds(s), sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...(s as PathShape), pts: (s as PathShape).pts.map(p => ({ x: x + (p.x - b.x) * sx, y: y + (p.y - b.y) * sy })) }
    }
    case 'line': {
      const l = s as LineShape, b = shapeBounds(s)
      const sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...l, x1: x + (l.x1 - b.x) * sx, y1: y + (l.y1 - b.y) * sy, x2: x + (l.x2 - b.x) * sx, y2: y + (l.y2 - b.y) * sy }
    }
    case 'arrow': {
      const a = s as ArrowShape, b = shapeBounds(s)
      const sx = b.w > 1 ? w / b.w : 1, sy = b.h > 1 ? h / b.h : 1
      return { ...a, x1: x + (a.x1 - b.x) * sx, y1: y + (a.y1 - b.y) * sy, x2: x + (a.x2 - b.x) * sx, y2: y + (a.y2 - b.y) * sy,
        ...(a.cpx !== undefined ? { cpx: x + (a.cpx - b.x) * sx, cpy: y + (a.cpy! - b.y) * sy } : {}) }
    }
    case 'text': {
      const t = s as TextShape, b = shapeBounds(t), scale = Math.max(w / Math.max(b.w, 1), h / Math.max(b.h, 1))
      return { ...t, x, y: y + h, size: Math.max(8, Math.round(t.size * scale)) }
    }
  }
}

function offsetShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case 'path':    return { ...(s as PathShape),    pts: (s as PathShape).pts.map(p => ({ x: p.x + dx, y: p.y + dy })) }
    case 'rect':    return { ...(s as RectShape),    x:  (s as RectShape).x  + dx, y:  (s as RectShape).y  + dy }
    case 'ellipse': return { ...(s as EllipseShape), cx: (s as EllipseShape).cx + dx, cy: (s as EllipseShape).cy + dy }
    case 'line':    return { ...(s as LineShape),    x1: (s as LineShape).x1  + dx, y1: (s as LineShape).y1  + dy, x2: (s as LineShape).x2  + dx, y2: (s as LineShape).y2  + dy }
    case 'arrow': { const a = s as ArrowShape; return { ...a, x1: a.x1+dx, y1: a.y1+dy, x2: a.x2+dx, y2: a.y2+dy, ...(a.cpx !== undefined ? { cpx: a.cpx+dx, cpy: a.cpy!+dy } : {}) } }
    case 'text':    return { ...(s as TextShape),    x:  (s as TextShape).x   + dx, y:  (s as TextShape).y   + dy }
  }
}

function duplicateShape(s: Shape): Shape {
  return offsetShape({ ...s, id: uid() }, 20, 20)
}

// ── Canvas rendering ───────────────────────────────────────────────────────────

function drawDotGrid(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, pan: Point, zoom: number) {
  if (zoom < 0.2) return
  ctx.save()
  ctx.translate(pan.x, pan.y)
  ctx.scale(zoom, zoom)
  const r      = Math.max(0.5, 0.9 / zoom)
  const step   = 24
  const startX = Math.ceil(-pan.x / zoom / step) * step
  const startY = Math.ceil(-pan.y / zoom / step) * step
  const endX   = (-pan.x + cssW) / zoom + step
  const endY   = (-pan.y + cssH) / zoom + step
  ctx.fillStyle = getCSSColor('--border', 'rgba(255,255,255,0.08)')
  for (let x = startX; x < endX; x += step)
    for (let y = startY; y < endY; y += step) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  ctx.restore()
}

function ctxFont(t: TextShape): string {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.fontFamily ?? FONT_SANS}`
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save()
  ctx.strokeStyle = s.color; ctx.fillStyle = s.fill === 'none' ? 'transparent' : s.fill
  ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  switch (s.type) {
    case 'path': {
      const { pts } = s as PathShape
      if (pts.length < 2) break
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.stroke(); break
    }
    case 'rect': {
      const r = s as RectShape
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.radius ?? 3)
      if (s.fill !== 'none') ctx.fill(); ctx.stroke(); break
    }
    case 'ellipse': {
      const e = s as EllipseShape
      ctx.beginPath(); ctx.ellipse(e.cx, e.cy, Math.max(1, Math.abs(e.rx)), Math.max(1, Math.abs(e.ry)), 0, 0, Math.PI * 2)
      if (s.fill !== 'none') ctx.fill(); ctx.stroke(); break
    }
    case 'line': {
      const l = s as LineShape
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); break
    }
    case 'arrow': {
      const a = s as ArrowShape
      if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 1) break
      const cpx = a.cpx ?? (a.x1 + a.x2) / 2
      const cpy = a.cpy ?? (a.y1 + a.y2) / 2
      // Tangent at endpoint = direction from CP → endpoint
      const angle = Math.atan2(a.y2 - cpy, a.x2 - cpx)
      const H = Math.max(14, a.width * 5)
      // Shaft: quadratic bezier, ending slightly before tip so head fits
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1)
      ctx.quadraticCurveTo(cpx, cpy, a.x2 - H * 0.8 * Math.cos(angle), a.y2 - H * 0.8 * Math.sin(angle))
      ctx.stroke()
      // Arrowhead
      ctx.fillStyle = a.color; ctx.strokeStyle = a.color; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(a.x2, a.y2)
      ctx.lineTo(a.x2 - H * Math.cos(angle - Math.PI / 6), a.y2 - H * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(a.x2 - H * Math.cos(angle + Math.PI / 6), a.y2 - H * Math.sin(angle + Math.PI / 6))
      ctx.closePath(); ctx.fill(); ctx.stroke(); break
    }
    case 'text': {
      const t = s as TextShape; ctx.font = ctxFont(t); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); break
    }
  }
  ctx.restore()
}

/** Single-shape selection: dashed box + corner resize handles */
function drawSingleSelection(ctx: CanvasRenderingContext2D, s: Shape) {
  const b = shapeBounds(s), pad = 6
  ctx.save()
  if (s.type !== 'text') {
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
    ctx.setLineDash([])
  }
  const corners: [number, number][] = [
    [b.x - pad, b.y - pad], [b.x + b.w + pad, b.y - pad],
    [b.x - pad, b.y + b.h + pad], [b.x + b.w + pad, b.y + b.h + pad],
  ]
  corners.forEach(([cx, cy]) => {
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke()
  })
  ctx.restore()
}

/** Multi-shape selection: dashed box around union bounds, no handles */
function drawMultiSelection(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  if (shapes.length < 2) return
  const b = unionBounds(shapes), pad = 6
  ctx.save()
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
  ctx.setLineDash([])
  ctx.restore()
}

/** Rubber-band selection rectangle */
function drawRubberBand(ctx: CanvasRenderingContext2D, p1: Point, p2: Point) {
  const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y)
  const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y)
  ctx.save()
  ctx.fillStyle = 'rgba(96, 165, 250, 0.08)'; ctx.fillRect(rx, ry, rw, rh)
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1; ctx.setLineDash([4, 3])
  ctx.strokeRect(rx, ry, rw, rh)
  ctx.setLineDash([])
  ctx.restore()
}

// ── Disk I/O ───────────────────────────────────────────────────────────────────
// Canvas data is stored globally (~/.inkwell/canvas.json) by default, independent
// of whichever vault happens to be open. If the user links the canvas to a
// specific vault (linkedVaultPath), it's stored at
// {linkedVaultPath}/.inkwell/canvas.json instead, regardless of the open vault.

const canvasPath = (vp: string) => `${vp}/.inkwell/canvas.json`

async function loadCanvas(linkedVaultPath: string | null): Promise<Shape[]> {
  if (!linkedVaultPath) {
    const { readGlobalCanvasFile } = await import('../../lib/vault')
    return (await readGlobalCanvasFile()) as Shape[]
  }
  try { return JSON.parse(await (await import('@tauri-apps/plugin-fs')).readTextFile(canvasPath(linkedVaultPath))) }
  catch { return [] }
}
async function saveCanvas(linkedVaultPath: string | null, shapes: Shape[]) {
  if (!linkedVaultPath) {
    const { writeGlobalCanvasFile } = await import('../../lib/vault')
    return writeGlobalCanvasFile(shapes)
  }
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    await mkdir(`${linkedVaultPath}/.inkwell`, { recursive: true })
    await writeTextFile(canvasPath(linkedVaultPath), JSON.stringify(shapes))
  } catch (e) { console.error('[canvas] save failed:', e) }
}

// ── CanvasView ─────────────────────────────────────────────────────────────────

// Default ink color must contrast with the canvas background, which follows the
// app theme — near-white ink is invisible on the light theme's white canvas.
const DEFAULT_COLOR_DARK  = '#ffffff'
const DEFAULT_COLOR_LIGHT = '#000000'
const DEFAULT_WIDTH  = 2
const DEFAULT_RADIUS = 8

export function CanvasView() {
  const { vaultPath, theme, canvasLinkedVaultPath } = useAppStore()
  const defaultColor = theme === 'light' ? DEFAULT_COLOR_LIGHT : DEFAULT_COLOR_DARK

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef      = useRef<HTMLInputElement>(null)

  // ── React state ──────────────────────────────────────────────────────────────
  const [tool,              setTool]              = useState<Tool>('pen')
  const [color,             setColor]             = useState(defaultColor)
  const [fill,              setFill]              = useState('none')
  const [strokeWidth,       setStrokeWidth]       = useState(DEFAULT_WIDTH)
  const [radius,            setRadius]            = useState(DEFAULT_RADIUS)
  const [fontSize,          setFontSize]          = useState(16)
  const [fontFamily,        setFontFamily]        = useState(FONT_SANS)
  const [bold,              setBold]              = useState(false)
  const [italic,            setItalic]            = useState(false)
  const [zoom,              setZoomState]         = useState(1)
  const [canUndo,           setCanUndo]           = useState(false)
  const [canRedo,           setCanRedo]           = useState(false)
  // Multi-selection: a Set of shape ids
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [selectedShapeType, setSelectedShapeType] = useState<string | null>(null)
  const [textInput,         setTextInput]         = useState<{ sx: number; sy: number; wx: number; wy: number; editingId?: string; initialValue?: string } | null>(null)
  const [spacePan,          setSpacePan]          = useState(false)
  const [cursor,            setCursorState]       = useState<string>('crosshair')
  const [showNotes,         setShowNotes]         = useState(false)
  const [notesContent,      setNotesContent]      = useState('')
  const [showTemplates,     setShowTemplates]     = useState(false)
  const [categoryPanel,     setCategoryPanel]     = useState<TemplateCategory | null>(null)

  // ── Canvas content refs ──────────────────────────────────────────────────────
  const shapesRef      = useRef<Shape[]>([])
  const historyRef     = useRef<Shape[][]>([])
  const futureRef      = useRef<Shape[][]>([])
  const selectedIdsRef = useRef<Set<string>>(new Set())   // mirrors selectedIds state
  const drawingRef     = useRef<Shape | null>(null)

  // ── View refs ────────────────────────────────────────────────────────────────
  const panRef  = useRef<Point>({ x: 0, y: 0 })
  const zoomRef = useRef(1)

  // ── Tool pref refs ───────────────────────────────────────────────────────────
  const toolRef        = useRef<Tool>('pen')
  const colorRef       = useRef(defaultColor)
  const fillRef        = useRef('none')
  const widthRef       = useRef(DEFAULT_WIDTH)
  const radiusRef      = useRef(DEFAULT_RADIUS)
  const fontSizeRef    = useRef(16)
  const fontFamilyRef  = useRef(FONT_SANS)
  const boldRef        = useRef(false)
  const italicRef      = useRef(false)

  // ── Interaction refs ─────────────────────────────────────────────────────────
  const isDrawingRef    = useRef(false)
  const startPtRef      = useRef<Point>({ x: 0, y: 0 })
  const isPanningRef    = useRef(false)
  const panStartRef     = useRef<Point>({ x: 0, y: 0 })
  const panOriginRef    = useRef<Point>({ x: 0, y: 0 })
  const isSpaceRef      = useRef(false)
  const shiftRef        = useRef(false)
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag (move selected)
  const isDraggingRef   = useRef(false)
  const dragOriginRef   = useRef<Point>({ x: 0, y: 0 })
  const preDragRef      = useRef<Shape[] | null>(null)

  // Rubber-band selection
  const isRubberBandRef    = useRef(false)
  const rubberBandStartRef = useRef<Point>({ x: 0, y: 0 })
  const rubberBandEndRef   = useRef<Point>({ x: 0, y: 0 })

  // Editing text shape id (hidden from canvas while input is open)
  const editingIdRef         = useRef<string | null>(null)

  // Resize (single selection only)
  const resizingRef          = useRef<ResizeHandle | null>(null)
  const resizeStartBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const resizeStartPtRef     = useRef<Point>({ x: 0, y: 0 })
  const resizePreRef         = useRef<Shape[] | null>(null)
  const cursorRef            = useRef<string>('crosshair')

  // Arrow bend (control point drag)
  const isBendingRef  = useRef(false)
  const bendPreRef    = useRef<Shape[] | null>(null)

  // Sync tool pref refs
  useEffect(() => { toolRef.current       = tool       }, [tool])
  useEffect(() => { colorRef.current      = color      }, [color])
  useEffect(() => { fillRef.current       = fill       }, [fill])
  useEffect(() => { widthRef.current      = strokeWidth }, [strokeWidth])
  useEffect(() => { radiusRef.current     = radius     }, [radius])
  useEffect(() => { fontSizeRef.current   = fontSize   }, [fontSize])
  useEffect(() => { fontFamilyRef.current = fontFamily }, [fontFamily])
  useEffect(() => { boldRef.current       = bold       }, [bold])
  useEffect(() => { italicRef.current     = italic     }, [italic])

  // Re-pick a legible default ink color when the app theme flips, but only if
  // the user hasn't picked their own color — otherwise a manual pick would get
  // silently overwritten every time the theme toggles.
  const prevDefaultColorRef = useRef(defaultColor)
  useEffect(() => {
    if (color === prevDefaultColorRef.current && color !== defaultColor) {
      setColor(defaultColor)
    }
    // prevDefaultColorRef itself is advanced below, once shapes have also been migrated
  }, [defaultColor]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateCursor = useCallback((c: string) => {
    if (c !== cursorRef.current) { cursorRef.current = c; setCursorState(c) }
  }, [])

  // ── Selection helpers ────────────────────────────────────────────────────────

  const setSelection = useCallback((ids: Set<string>) => {
    selectedIdsRef.current = ids
    setSelectedIds(new Set(ids))
  }, [])

  const clearSelection = useCallback(() => {
    selectedIdsRef.current = new Set()
    setSelectedIds(new Set())
    setSelectedShapeType(null)
  }, [])

  // When selection changes, sync toolbar to the single selected shape (if any)
  useEffect(() => {
    if (selectedIds.size !== 1) { setSelectedShapeType(null); return }
    const id    = [...selectedIds][0]
    const shape = shapesRef.current.find(s => s.id === id)
    if (!shape) { setSelectedShapeType(null); return }
    setSelectedShapeType(shape.type)
    setColor(shape.color);       colorRef.current = shape.color
    setFill(shape.fill);         fillRef.current  = shape.fill
    setStrokeWidth(shape.width); widthRef.current = shape.width
    if (shape.type === 'rect') {
      const r = (shape as RectShape).radius ?? DEFAULT_RADIUS; setRadius(r); radiusRef.current = r
    }
    if (shape.type === 'text') {
      const t = shape as TextShape
      const sz = t.size ?? 16;             setFontSize(sz);   fontSizeRef.current   = sz
      const ff = t.fontFamily ?? FONT_SANS; setFontFamily(ff); fontFamilyRef.current = ff
      const b  = t.bold ?? false;           setBold(b);        boldRef.current       = b
      const it = t.italic ?? false;         setItalic(it);     italicRef.current     = it
    }
  }, [selectedIds])

  // ── Render ───────────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx  = canvas.getContext('2d')!
    const DPR  = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    ctx.fillStyle = getCSSColor('--background', '#111')
    ctx.fillRect(0, 0, cssW, cssH)
    drawDotGrid(ctx, cssW, cssH, panRef.current, zoomRef.current)

    ctx.save()
    ctx.translate(panRef.current.x, panRef.current.y)
    ctx.scale(zoomRef.current, zoomRef.current)

    for (const s of shapesRef.current) {
      if (editingIdRef.current && s.id === editingIdRef.current) continue
      drawShape(ctx, s)
    }
    if (drawingRef.current) drawShape(ctx, drawingRef.current)

    // Draw dashed group bounding boxes for any visible groups
    const allGroupIds = new Set(shapesRef.current.map(s => s.groupId).filter(Boolean) as string[])
    allGroupIds.forEach(gid => {
      const members = shapesRef.current.filter(s => s.groupId === gid)
      if (members.length < 2) return
      const bs   = members.map(shapeBounds)
      const gx   = Math.min(...bs.map(b => b.x))
      const gy   = Math.min(...bs.map(b => b.y))
      const gx2  = Math.max(...bs.map(b => b.x + b.w))
      const gy2  = Math.max(...bs.map(b => b.y + b.h))
      const pad  = 10
      const groupSelected = members.some(s => selectedIdsRef.current.has(s.id))
      ctx.save()
      ctx.strokeStyle = groupSelected
        ? getCSSColor('--accent', '#a78bfa')
        : getCSSColor('--border', '#444')
      ctx.lineWidth   = (groupSelected ? 1.5 : 1) / zoomRef.current
      ctx.setLineDash([6 / zoomRef.current, 4 / zoomRef.current])
      ctx.globalAlpha = groupSelected ? 0.8 : 0.35
      ctx.strokeRect(gx - pad, gy - pad, gx2 - gx + pad * 2, gy2 - gy + pad * 2)
      ctx.restore()
    })

    // Selection overlay
    const selShapes = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
    if (selShapes.length === 1) {
      drawSingleSelection(ctx, selShapes[0])
      // Bend handle for selected arrows
      if (selShapes[0].type === 'arrow') {
        const a = selShapes[0] as ArrowShape
        const cpx = a.cpx ?? (a.x1 + a.x2) / 2
        const cpy = a.cpy ?? (a.y1 + a.y2) / 2
        const r = 6 / zoomRef.current
        ctx.save()
        // Guide line from arrow midpoint to control point (only if bent)
        if (a.cpx !== undefined) {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1 / zoomRef.current
          ctx.setLineDash([3 / zoomRef.current, 3 / zoomRef.current]); ctx.globalAlpha = 0.5
          ctx.beginPath(); ctx.moveTo((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2); ctx.lineTo(cpx, cpy); ctx.stroke()
          ctx.setLineDash([]); ctx.globalAlpha = 1
        }
        // Handle circle
        ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5 / zoomRef.current
        ctx.beginPath(); ctx.arc(cpx, cpy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.restore()
      }
    } else if (selShapes.length > 1) {
      drawMultiSelection(ctx, selShapes)
    }

    // Rubber-band
    if (isRubberBandRef.current) {
      drawRubberBand(ctx, rubberBandStartRef.current, rubberBandEndRef.current)
    }

    ctx.restore()
  }, [])

  useEffect(() => { render() }, [theme, render])

  // ── Canvas sizing ────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current
    if (!container || !canvas) return
    const DPR = window.devicePixelRatio || 1
    const obs = new ResizeObserver(() => {
      const { width: w, height: h } = container.getBoundingClientRect()
      canvas.width = w * DPR; canvas.height = h * DPR
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      render()
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [render])

  // ── Load / save ──────────────────────────────────────────────────────────────

  useEffect(() => {
    loadCanvas(canvasLinkedVaultPath).then(shapes => {
      shapesRef.current = shapes; historyRef.current = []; futureRef.current = []
      clearSelection(); setCanUndo(false); setCanRedo(false); render()
    })
  }, [canvasLinkedVaultPath, render, clearSelection])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveCanvas(canvasLinkedVaultPath, shapesRef.current), 1000)
  }, [canvasLinkedVaultPath])

  // ── Notes load / save ────────────────────────────────────────────────────────
  // Same global-by-default / linked-vault-if-set model as the canvas shapes above.

  useEffect(() => {
    if (canvasLinkedVaultPath) {
      import('@tauri-apps/plugin-fs').then(({ readTextFile }) =>
        readTextFile(`${canvasLinkedVaultPath}/.inkwell/canvas-notes.md`).then(setNotesContent).catch(() => setNotesContent(''))
      )
    } else {
      import('../../lib/vault').then(({ readGlobalCanvasNotes }) =>
        readGlobalCanvasNotes().then(setNotesContent)
      )
    }
  }, [canvasLinkedVaultPath])

  const handleNotesChange = useCallback((text: string) => {
    setNotesContent(text)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      if (canvasLinkedVaultPath) {
        const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
        await mkdir(`${canvasLinkedVaultPath}/.inkwell`, { recursive: true })
        await writeTextFile(`${canvasLinkedVaultPath}/.inkwell/canvas-notes.md`, text)
      } else {
        const { writeGlobalCanvasNotes } = await import('../../lib/vault')
        await writeGlobalCanvasNotes(text)
      }
    }, 600)
  }, [canvasLinkedVaultPath])

  // ── History ──────────────────────────────────────────────────────────────────

  const commit = useCallback((next: Shape[]) => {
    historyRef.current = [...historyRef.current, shapesRef.current]
    futureRef.current = []; shapesRef.current = next
    setCanUndo(true); setCanRedo(false); scheduleSave(); render()
  }, [scheduleSave, render])

  // When the theme flips, migrate any existing shapes still using the *previous*
  // theme's default ink color — so drawings made without an explicit color pick
  // stay visible instead of turning invisible against the new background color.
  // Shapes with an explicitly-picked color are left untouched. Not pushed onto
  // the undo stack — this is a display fixup, not a user edit.
  useEffect(() => {
    const prevDefault = prevDefaultColorRef.current
    prevDefaultColorRef.current = defaultColor
    if (prevDefault === defaultColor) return
    let changed = false
    const updated = shapesRef.current.map(s => {
      if (s.color === prevDefault) { changed = true; return { ...s, color: defaultColor } }
      return s
    })
    if (!changed) return
    shapesRef.current = updated
    render()
    scheduleSave()
  }, [defaultColor, render, scheduleSave])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    futureRef.current  = [shapesRef.current, ...futureRef.current]
    shapesRef.current  = historyRef.current[historyRef.current.length - 1]
    historyRef.current = historyRef.current.slice(0, -1)
    clearSelection(); setCanUndo(historyRef.current.length > 0); setCanRedo(true)
    scheduleSave(); render()
  }, [scheduleSave, render, clearSelection])

  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    historyRef.current = [...historyRef.current, shapesRef.current]
    shapesRef.current  = futureRef.current[0]
    futureRef.current  = futureRef.current.slice(1)
    clearSelection(); setCanUndo(true); setCanRedo(futureRef.current.length > 0)
    scheduleSave(); render()
  }, [scheduleSave, render, clearSelection])

  // ── Template loading ─────────────────────────────────────────────────────────

  const loadTemplate = useCallback((tpl: DiagramTemplate) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const DPR  = window.devicePixelRatio || 1
    const cssW = canvas.width  / DPR
    const cssH = canvas.height / DPR

    const rawShapes = tpl.create()
    const bs   = rawShapes.map(shapeBounds)
    const minX = Math.min(...bs.map(b => b.x))
    const minY = Math.min(...bs.map(b => b.y))
    const bw   = Math.max(...bs.map(b => b.x + b.w)) - minX || 1
    const bh   = Math.max(...bs.map(b => b.y + b.h)) - minY || 1

    // Offset new shapes so they don't land on top of existing content
    let dx = 0, dy = 0
    if (shapesRef.current.length > 0) {
      const existBounds = shapesRef.current.map(shapeBounds)
      const existMaxX = Math.max(...existBounds.map(b => b.x + b.w))
      dx = existMaxX + 100 - minX
      dy = -minY  // align template top to world y=0
    }

    const shapes = dx !== 0 || dy !== 0 ? offsetShapes(rawShapes, dx, dy) : rawShapes
    commit([...shapesRef.current, ...shapes])
    clearSelection()

    // Fit the newly inserted shapes into view
    const pad  = 80
    const fitX = minX + dx
    const fitY = minY + dy
    const newZoom = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh, 2)
    zoomRef.current = newZoom
    setZoomState(newZoom)
    panRef.current = {
      x: cssW / 2 - (fitX + bw / 2) * newZoom,
      y: cssH / 2 - (fitY + bh / 2) * newZoom,
    }
    render()
    // Open the category panel for the loaded template's category
    setCategoryPanel(tpl.category)
  }, [commit, clearSelection, render])

  // Append shapes from the category panel (no viewport pan, just append + offset)
  const addCanvasShapes = useCallback((newShapes: Shape[]) => {
    if (!newShapes.length) return
    const bs   = newShapes.map(shapeBounds)
    const minX = Math.min(...bs.map(b => b.x))
    let offsetted = newShapes
    if (shapesRef.current.length > 0) {
      const existBounds = shapesRef.current.map(shapeBounds)
      const existMaxX   = Math.max(...existBounds.map(b => b.x + b.w))
      const dx          = existMaxX + 80 - minX
      offsetted = offsetShapes(newShapes, dx, 0)
    }
    commit([...shapesRef.current, ...offsetted])
    clearSelection()
    render()
  }, [commit, clearSelection, render])

  // ── Group / Ungroup ──────────────────────────────────────────────────────────

  const groupSelected = useCallback(() => {
    if (selectedIdsRef.current.size < 2) return
    const gid  = uid()
    commit(shapesRef.current.map(s =>
      selectedIdsRef.current.has(s.id) ? { ...s, groupId: gid } : s
    ))
  }, [commit])

  const ungroupSelected = useCallback(() => {
    if (!selectedIdsRef.current.size) return
    // Collect all groupIds referenced by the current selection
    const groupIds = new Set(
      shapesRef.current
        .filter(s => selectedIdsRef.current.has(s.id) && s.groupId)
        .map(s => s.groupId!)
    )
    if (!groupIds.size) return
    commit(shapesRef.current.map(s => {
      if (s.groupId && groupIds.has(s.groupId)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { groupId: _g, ...rest } = s
        return rest as Shape
      }
      return s
    }))
  }, [commit])

  // ── Coord ────────────────────────────────────────────────────────────────────

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top  - panRef.current.y) / zoomRef.current,
    }
  }, [])

  // ── Mouse ────────────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && isSpaceRef.current)) {
      isPanningRef.current = true
      panStartRef.current  = { x: e.clientX, y: e.clientY }
      panOriginRef.current = { ...panRef.current }
      return
    }
    if (e.button !== 0) return
    const wp = toWorld(e)

    if (toolRef.current === 'select') {
      // 1. Resize handle (only for single selection)
      if (selectedIdsRef.current.size === 1) {
        const [id]  = [...selectedIdsRef.current]
        const shape = shapesRef.current.find(s => s.id === id)
        if (shape) {
          const handle = getHandleAt(shape, wp, 10 / zoomRef.current)
          if (handle) {
            resizingRef.current          = handle
            resizeStartBoundsRef.current = shapeBounds(shape)
            resizeStartPtRef.current     = wp
            resizePreRef.current         = [...shapesRef.current]
            updateCursor(handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize')
            return
          }
        }
      }

      // 2. Bend handle hit (single selected arrow)
      if (selectedIdsRef.current.size === 1) {
        const [bid] = [...selectedIdsRef.current]
        const bshape = shapesRef.current.find(s => s.id === bid)
        if (bshape && bshape.type === 'arrow') {
          const a = bshape as ArrowShape
          const cpx = a.cpx ?? (a.x1 + a.x2) / 2
          const cpy = a.cpy ?? (a.y1 + a.y2) / 2
          if (Math.hypot(wp.x - cpx, wp.y - cpy) < 10 / zoomRef.current) {
            isBendingRef.current = true; bendPreRef.current = [...shapesRef.current]
            updateCursor('crosshair'); render(); return
          }
        }
      }

      // 3. Shape hit
      const hit = [...shapesRef.current].reverse().find(s => hitTest(s, wp.x, wp.y)) ?? null
      if (hit) {
        // Expand selection to entire group if the hit shape belongs to one
        const groupIds = hit.groupId
          ? new Set(shapesRef.current.filter(s => s.groupId === hit.groupId).map(s => s.id))
          : new Set([hit.id])

        if (shiftRef.current) {
          // Shift+click: toggle entire group
          const next = new Set(selectedIdsRef.current)
          const allSelected = [...groupIds].every(id => next.has(id))
          if (allSelected) { groupIds.forEach(id => next.delete(id)) }
          else              { groupIds.forEach(id => next.add(id)) }
          setSelection(next)
        } else if (selectedIdsRef.current.has(hit.id)) {
          // Click already-selected shape: drag all selected
          preDragRef.current    = [...shapesRef.current]
          isDraggingRef.current = true
          dragOriginRef.current = wp
        } else {
          // Click unselected shape: select it (+ group mates), start drag
          setSelection(groupIds)
          preDragRef.current    = [...shapesRef.current]
          isDraggingRef.current = true
          dragOriginRef.current = wp
        }
        render(); return
      }

      // 3. Click empty space: start rubber-band (clear selection unless shift)
      if (!shiftRef.current) clearSelection()
      isRubberBandRef.current    = true
      rubberBandStartRef.current = wp
      rubberBandEndRef.current   = wp
      render(); return
    }

    if (toolRef.current === 'text') {
      const rect = containerRef.current!.getBoundingClientRect()
      setTextInput({ sx: e.clientX - rect.left, sy: e.clientY - rect.top, wx: wp.x, wy: wp.y })
      return
    }

    isDrawingRef.current = true; startPtRef.current = wp
    const base = { id: uid(), color: colorRef.current, fill: fillRef.current, width: widthRef.current }
    switch (toolRef.current) {
      case 'pen':     drawingRef.current = { ...base, type: 'path',    pts: [wp] }; break
      case 'rect':    drawingRef.current = { ...base, type: 'rect',    x: wp.x, y: wp.y, w: 0, h: 0, radius: radiusRef.current }; break
      case 'ellipse': drawingRef.current = { ...base, type: 'ellipse', cx: wp.x, cy: wp.y, rx: 0, ry: 0 }; break
      case 'line':    drawingRef.current = { ...base, type: 'line',    x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }; break
      case 'arrow':   drawingRef.current = { ...base, type: 'arrow',   x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }; break
    }
  }, [toWorld, render, setSelection, clearSelection, updateCursor])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      panRef.current = { x: panOriginRef.current.x + e.clientX - panStartRef.current.x, y: panOriginRef.current.y + e.clientY - panStartRef.current.y }
      render(); return
    }

    const wp = toWorld(e)

    // Resize (single selection)
    if (resizingRef.current && resizeStartBoundsRef.current && selectedIdsRef.current.size === 1) {
      const sb = resizeStartBoundsRef.current
      const dx = wp.x - resizeStartPtRef.current.x, dy = wp.y - resizeStartPtRef.current.y
      const MIN = 20
      let nb: ReturnType<typeof normalizeRect>
      switch (resizingRef.current) {
        case 'tl': nb = normalizeRect(sb.x + dx, sb.y + dy, sb.x + sb.w, sb.y + sb.h); break
        case 'tr': nb = normalizeRect(sb.x,       sb.y + dy, sb.x + sb.w + dx, sb.y + sb.h); break
        case 'bl': nb = normalizeRect(sb.x + dx,  sb.y,      sb.x + sb.w, sb.y + sb.h + dy); break
        case 'br': nb = normalizeRect(sb.x,       sb.y,      sb.x + sb.w + dx, sb.y + sb.h + dy); break
      }
      nb.w = Math.max(nb.w, MIN); nb.h = Math.max(nb.h, MIN)
      const [id] = [...selectedIdsRef.current]
      shapesRef.current = shapesRef.current.map(s => s.id === id ? applyBoundsToShape(s, nb) as Shape : s)
      render(); return
    }

    // Bend arrow control point
    if (isBendingRef.current && selectedIdsRef.current.size === 1) {
      const [bid] = [...selectedIdsRef.current]
      shapesRef.current = shapesRef.current.map(s =>
        s.id === bid && s.type === 'arrow' ? { ...s, cpx: wp.x, cpy: wp.y } as Shape : s
      )
      render(); return
    }

    // Move selected shapes
    if (isDraggingRef.current && selectedIdsRef.current.size > 0) {
      const dx = wp.x - dragOriginRef.current.x, dy = wp.y - dragOriginRef.current.y
      dragOriginRef.current = wp
      shapesRef.current = shapesRef.current.map(s =>
        selectedIdsRef.current.has(s.id) ? offsetShape(s, dx, dy) as Shape : s
      )
      render(); return
    }

    // Rubber-band
    if (isRubberBandRef.current) {
      rubberBandEndRef.current = wp
      render(); return
    }

    // Drawing
    if (isDrawingRef.current && drawingRef.current) {
      const sp = startPtRef.current, sh = shiftRef.current, d = drawingRef.current
      switch (d.type) {
        case 'path': {
          const last = (d as PathShape).pts[(d as PathShape).pts.length - 1]
          if (Math.hypot(wp.x - last.x, wp.y - last.y) > 2 / zoomRef.current)
            (d as PathShape).pts = [...(d as PathShape).pts, wp]
          break
        }
        case 'rect': {
          let w = wp.x - sp.x, h = wp.y - sp.y
          if (sh) { const s = Math.sign(w) * Math.sign(h) * Math.max(Math.abs(w), Math.abs(h)); w = s; h = s }
          ;(d as RectShape).x = Math.min(sp.x, sp.x + w); (d as RectShape).y = Math.min(sp.y, sp.y + h)
          ;(d as RectShape).w = Math.abs(w); (d as RectShape).h = Math.abs(h)
          break
        }
        case 'ellipse': {
          let rx = (wp.x - sp.x) / 2, ry = (wp.y - sp.y) / 2
          if (sh) { const m = Math.max(Math.abs(rx), Math.abs(ry)); rx = Math.sign(rx) * m; ry = Math.sign(ry) * m }
          ;(d as EllipseShape).cx = sp.x + rx; (d as EllipseShape).cy = sp.y + ry
          ;(d as EllipseShape).rx = rx; (d as EllipseShape).ry = ry
          break
        }
        case 'line':
        case 'arrow': {
          let x2 = wp.x, y2 = wp.y
          if (sh) { const dx = wp.x - sp.x, dy = wp.y - sp.y, snap = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), dist = Math.hypot(dx, dy); x2 = sp.x + dist * Math.cos(snap); y2 = sp.y + dist * Math.sin(snap) }
          ;(d as LineShape).x2 = x2; (d as LineShape).y2 = y2
          break
        }
      }
      render(); return
    }

    // Cursor: handle hover for single selection
    if (toolRef.current === 'select' && selectedIdsRef.current.size === 1) {
      const [id] = [...selectedIdsRef.current]
      const shape = shapesRef.current.find(s => s.id === id)
      if (shape) {
        // Arrow bend handle
        if (shape.type === 'arrow') {
          const a = shape as ArrowShape
          const cpx = a.cpx ?? (a.x1 + a.x2) / 2
          const cpy = a.cpy ?? (a.y1 + a.y2) / 2
          if (Math.hypot(wp.x - cpx, wp.y - cpy) < 10 / zoomRef.current) {
            updateCursor('grab'); return
          }
        }
        const handle = getHandleAt(shape, wp, 10 / zoomRef.current)
        updateCursor(handle ? (handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize') : 'default')
        return
      }
    }
    if (!isSpaceRef.current)
      updateCursor(toolRef.current === 'text' ? 'text' : toolRef.current === 'select' ? 'default' : 'crosshair')
  }, [toWorld, render, updateCursor])

  const onMouseUp = useCallback(() => {
    if (isPanningRef.current) { isPanningRef.current = false; return }

    // Finish bend
    if (isBendingRef.current) {
      isBendingRef.current = false; updateCursor('default')
      if (bendPreRef.current) {
        historyRef.current = [...historyRef.current, bendPreRef.current]
        futureRef.current = []; bendPreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish resize
    if (resizingRef.current) {
      resizingRef.current = null
      updateCursor('default')
      if (resizePreRef.current) {
        historyRef.current = [...historyRef.current, resizePreRef.current]
        futureRef.current = []; resizePreRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish drag
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      if (preDragRef.current) {
        historyRef.current = [...historyRef.current, preDragRef.current]
        futureRef.current = []; preDragRef.current = null
        setCanUndo(true); setCanRedo(false); scheduleSave()
      }
      return
    }

    // Finish rubber-band
    if (isRubberBandRef.current) {
      isRubberBandRef.current = false
      const p1 = rubberBandStartRef.current, p2 = rubberBandEndRef.current
      const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y)
      if (rw > 4 || rh > 4) {
        const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y)
        const directHit = shapesRef.current.filter(s => {
          const b = shapeBounds(s)
          return b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry
        })
        // Expand to include all group mates of any directly-hit shape
        const hitGroupIds = new Set(directHit.map(s => s.groupId).filter(Boolean) as string[])
        const expanded = new Set([
          ...directHit.map(s => s.id),
          ...shapesRef.current.filter(s => s.groupId && hitGroupIds.has(s.groupId)).map(s => s.id),
        ])
        if (shiftRef.current) {
          const next = new Set(selectedIdsRef.current)
          expanded.forEach(id => next.add(id))
          setSelection(next)
        } else {
          setSelection(expanded)
        }
      }
      render(); return
    }

    // Finish drawing
    if (!isDrawingRef.current || !drawingRef.current) return
    isDrawingRef.current = false
    const shape = drawingRef.current; drawingRef.current = null
    const b = shapeBounds(shape)
    if (shape.type !== 'path' && shape.type !== 'text' && b.w < 3 / zoomRef.current && b.h < 3 / zoomRef.current) { render(); return }
    commit([...shapesRef.current, shape])
  }, [commit, scheduleSave, render, setSelection, updateCursor])

  // ── Double-click: edit existing text shape ───────────────────────────────────

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const wp = toWorld(e)

    // Double-click a bent arrow → straighten it
    const hitArrow = [...shapesRef.current].reverse().find(
      s => s.type === 'arrow' && (s as ArrowShape).cpx !== undefined && hitTest(s, wp.x, wp.y)
    ) as ArrowShape | undefined
    if (hitArrow) {
      e.preventDefault()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cpx: _cx, cpy: _cy, ...rest } = hitArrow
      commit(shapesRef.current.map(s => s.id === hitArrow.id ? rest as Shape : s))
      return
    }

    const hit = [...shapesRef.current].reverse().find(
      s => s.type === 'text' && hitTest(s, wp.x, wp.y)
    ) as TextShape | undefined
    if (!hit) return
    e.preventDefault()

    // Sync toolbar settings to the shape
    setFontSize(hit.size);                          fontSizeRef.current   = hit.size
    setFontFamily(hit.fontFamily ?? FONT_SANS);     fontFamilyRef.current = hit.fontFamily ?? FONT_SANS
    setBold(hit.bold ?? false);                     boldRef.current       = hit.bold ?? false
    setItalic(hit.italic ?? false);                 italicRef.current     = hit.italic ?? false
    setColor(hit.color);                            colorRef.current      = hit.color

    // Convert world position to container-relative screen coords
    // hit.y is baseline; position input so its visual baseline lines up
    const sx          = hit.x * zoomRef.current + panRef.current.x
    const syBaseline  = hit.y * zoomRef.current + panRef.current.y
    const screenSize  = hit.size * zoomRef.current
    const sy          = syBaseline - screenSize + Math.min(hit.size, 32)

    setTextInput({ sx, sy, wx: hit.x, wy: hit.y - hit.size, editingId: hit.id, initialValue: hit.text })
    setTool('text'); toolRef.current = 'text'
  }, [toWorld])

  // ── Wheel ────────────────────────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) {
      const rect = canvasRef.current!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const oldZ = zoomRef.current, newZ = Math.max(0.1, Math.min(6, oldZ * (e.deltaY > 0 ? 0.92 : 1.08)))
      panRef.current = { x: mx - (mx - panRef.current.x) * (newZ / oldZ), y: my - (my - panRef.current.y) * (newZ / oldZ) }
      zoomRef.current = newZ; setZoomState(newZ)
    } else {
      panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
    }
    render()
  }, [render])

  const handleZoom = useCallback((delta: number) => {
    const canvas = canvasRef.current!, DPR = window.devicePixelRatio || 1
    const cssW = canvas.width / DPR, cssH = canvas.height / DPR
    const oldZ = zoomRef.current, newZ = Math.max(0.1, Math.min(6, oldZ + delta))
    panRef.current = { x: cssW / 2 - (cssW / 2 - panRef.current.x) * (newZ / oldZ), y: cssH / 2 - (cssH / 2 - panRef.current.y) * (newZ / oldZ) }
    zoomRef.current = newZ; setZoomState(newZ); render()
  }, [render])

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pen', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', t: 'text' }
    const down = (ev: KeyboardEvent) => {
      shiftRef.current = ev.shiftKey
      const inInput = (ev.target as Element).closest('input, textarea, .cm-editor')

      if (ev.code === 'Space' && !inInput) { ev.preventDefault(); isSpaceRef.current = true; setSpacePan(true); updateCursor('grab') }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'z') { ev.preventDefault(); undo() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey  && ev.key === 'z') { ev.preventDefault(); redo() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'g') { ev.preventDefault(); groupSelected() }
      if (!inInput && (ev.metaKey || ev.ctrlKey) && ev.shiftKey  && ev.key === 'g') { ev.preventDefault(); ungroupSelected() }

      if (!inInput) {
        // Delete all selected
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
          if (selectedIdsRef.current.size > 0) {
            commit(shapesRef.current.filter(s => !selectedIdsRef.current.has(s.id)))
            clearSelection()
          }
        }
        // Escape → select tool + clear
        if (ev.key === 'Escape') {
          setTextInput(null); setTool('select'); toolRef.current = 'select'
          clearSelection(); render()
        }
        // ⌘D duplicate all selected
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'd') {
          ev.preventDefault()
          if (selectedIdsRef.current.size > 0) {
            const sel   = shapesRef.current.filter(s => selectedIdsRef.current.has(s.id))
            const copies = sel.map(duplicateShape)
            commit([...shapesRef.current, ...copies])
            setSelection(new Set(copies.map(c => c.id)))
          }
        }
        // ⌘A select all
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'a') {
          ev.preventDefault()
          setSelection(new Set(shapesRef.current.map(s => s.id)))
          render()
        }
        // ⌘/ toggle notes panel
        if ((ev.metaKey || ev.ctrlKey) && ev.key === '/') {
          ev.preventDefault()
          setShowNotes(v => !v)
        }
        // Tool shortcuts
        const t = TOOL_KEYS[ev.key.toLowerCase()]
        if (t && !ev.metaKey && !ev.ctrlKey) setTool(t)
      }
    }
    const up = (ev: KeyboardEvent) => {
      shiftRef.current = ev.shiftKey
      if (ev.code === 'Space') {
        isSpaceRef.current = false; setSpacePan(false)
        updateCursor(toolRef.current === 'select' ? 'default' : 'crosshair')
      }
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [undo, redo, commit, render, clearSelection, setSelection, updateCursor])

  // Sync editingIdRef so render can skip the shape being edited
  useEffect(() => {
    editingIdRef.current = textInput?.editingId ?? null
    render()
  }, [textInput, render])

  // Focus text input
  useEffect(() => {
    if (textInput) { const id = setTimeout(() => textRef.current?.focus(), 0); return () => clearTimeout(id) }
  }, [textInput])

  // Cursor sync with tool
  useEffect(() => {
    if (!isSpaceRef.current) updateCursor(tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair')
  }, [tool, updateCursor])

  // ── Text commit ──────────────────────────────────────────────────────────────

  const commitText = useCallback(() => {
    if (!textInput) return
    const val = textRef.current?.value?.trim()
    const { editingId } = textInput
    setTextInput(null)
    const size = fontSizeRef.current
    if (editingId) {
      // Editing an existing shape
      if (!val) {
        // Empty → delete the shape
        commit(shapesRef.current.filter(s => s.id !== editingId))
      } else {
        commit(shapesRef.current.map(s =>
          s.id === editingId
            ? { ...s, text: val, size, fontFamily: fontFamilyRef.current, bold: boldRef.current, italic: italicRef.current, color: colorRef.current } as Shape
            : s
        ))
      }
    } else {
      // Creating a new shape
      if (!val) return
      commit([...shapesRef.current, {
        id: uid(), type: 'text',
        x: textInput.wx, y: textInput.wy + size,
        text: val, size, fontFamily: fontFamilyRef.current,
        bold: boldRef.current, italic: italicRef.current,
        color: colorRef.current, fill: 'none', width: 1,
      } as TextShape])
    }
  }, [textInput, commit])

  // ── Toolbar handlers ─────────────────────────────────────────────────────────

  const applyToSelected = useCallback((patch: Partial<Shape>) => {
    if (selectedIdsRef.current.size === 0) return
    commit(shapesRef.current.map(s =>
      selectedIdsRef.current.has(s.id) ? { ...s, ...patch } as Shape : s
    ))
  }, [commit])

  const handleColor      = useCallback((c: string) => { setColor(c); colorRef.current = c; if (fillRef.current !== 'none') { const t = c + '28'; setFill(t); fillRef.current = t }; applyToSelected({ color: c }) }, [applyToSelected])
  const handleFill       = useCallback((f: string) => { setFill(f); fillRef.current = f; applyToSelected({ fill: f }) }, [applyToSelected])
  const handleWidth      = useCallback((w: number) => { setStrokeWidth(w); widthRef.current = w; applyToSelected({ width: w }) }, [applyToSelected])
  const handleRadius     = useCallback((r: number) => { setRadius(r); radiusRef.current = r; applyToSelected({ radius: r } as Partial<RectShape>) }, [applyToSelected])
  const handleFontSize   = useCallback((s: number) => { setFontSize(s); fontSizeRef.current = s; applyToSelected({ size: s } as Partial<TextShape>) }, [applyToSelected])
  const handleFontFamily = useCallback((f: string) => { setFontFamily(f); fontFamilyRef.current = f; applyToSelected({ fontFamily: f } as Partial<TextShape>) }, [applyToSelected])
  const handleBold       = useCallback((b: boolean) => { setBold(b); boldRef.current = b; applyToSelected({ bold: b } as Partial<TextShape>) }, [applyToSelected])
  const handleItalic     = useCallback((i: boolean) => { setItalic(i); italicRef.current = i; applyToSelected({ italic: i } as Partial<TextShape>) }, [applyToSelected])

  // ── JSX ──────────────────────────────────────────────────────────────────────

  if (!vaultPath) return (
    <div className="flex-1 h-full flex items-center justify-center text-muted-foreground text-sm">
      Open a vault first.
    </div>
  )

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-row">

      {/* ── Canvas area ── */}
      <div ref={containerRef} className="relative h-full overflow-hidden flex-1">
        {/* Window drag strip — sits above canvas (z-10) but below toolbar buttons (z-20) */}
        <div className="absolute top-0 left-0 right-0 h-8 z-10" data-tauri-drag-region />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ cursor: spacePan ? 'grab' : cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
        />

        <CanvasToolbar
          tool={tool} color={color} fill={fill} strokeWidth={strokeWidth}
          zoom={zoom} canUndo={canUndo} canRedo={canRedo}
          radius={radius} fontSize={fontSize} fontFamily={fontFamily} bold={bold} italic={italic}
          selectedShapeType={selectedShapeType}
          onTool={setTool} onColor={handleColor} onFill={handleFill} onWidth={handleWidth}
          onRadius={handleRadius} onFontSize={handleFontSize} onFontFamily={handleFontFamily}
          onBold={handleBold} onItalic={handleItalic}
          onUndo={undo} onRedo={redo} onZoom={handleZoom}
          onTemplates={() => setShowTemplates(v => !v)}
          showTemplates={showTemplates}
        />

        {/* Template picker */}
        {showTemplates && (
          <CanvasTemplatesPicker
            onSelect={loadTemplate}
            onClose={() => setShowTemplates(false)}
          />
        )}

        {/* Category element panel */}
        {categoryPanel && !showTemplates && (
          <CanvasCategoryPanel
            category={categoryPanel}
            onAdd={addCanvasShapes}
            onClose={() => setCategoryPanel(null)}
          />
        )}

        {/* Notes toggle button — top-right of canvas area */}
        <button
          onClick={() => setShowNotes(v => !v)}
          title="Toggle diagram notes (⌘/)"
          className={`absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center rounded-lg border transition-colors shadow-sm ${
            showNotes
              ? 'bg-accent text-white border-accent'
              : 'bg-surface border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <StickyNote size={14} />
        </button>

        {/* Text input overlay */}
        {textInput && (
          <input
            ref={textRef}
            className="absolute bg-transparent outline-none pointer-events-auto"
            style={{
              left: textInput.sx, top: textInput.sy - Math.min(fontSize, 32),
              fontSize: Math.min(Math.max(14, fontSize), 32),
              fontFamily, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal',
              color, caretColor: color, borderBottom: `1.5px solid ${color}`, minWidth: 80, zIndex: 50,
            }}
            defaultValue={textInput?.initialValue ?? ''}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitText() }; if (e.key === 'Escape') setTextInput(null) }}
            onBlur={commitText}
          />
        )}
      </div>

      {/* ── Notes sheet — slides in from right ── */}
      <div
        className="h-full overflow-hidden transition-all duration-300 ease-out shrink-0"
        style={{ width: showNotes ? '50%' : 0 }}
      >
        {/* Keep mounted so CodeMirror state isn't lost when toggling */}
        <div className="h-full" style={{ width: '100%', visibility: showNotes ? 'visible' : 'hidden' }}>
          <CanvasNotesSheet
            content={notesContent}
            onChange={handleNotesChange}
            onClose={() => setShowNotes(false)}
          />
        </div>
      </div>

    </div>
  )
}
