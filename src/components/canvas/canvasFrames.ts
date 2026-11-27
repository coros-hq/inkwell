import { shapeBounds } from './canvasTypes'
import type { Shape, RectShape } from './canvasTypes'

// Frames: titled containers that hold a block of shapes together.
//
// A frame is a RectShape with kind 'frame' and a `title`. Membership is
// geometric: whatever sits entirely inside the frame belongs to it, so dropping
// a shape in adds it and dragging it out removes it — no ids to keep in sync.
// Moving a frame (drag or arrow keys) carries its contents along.

export const FRAME_TITLE_SIZE = 14
export const FRAME_TITLE_FONT = `500 ${FRAME_TITLE_SIZE}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
const TITLE_GAP = 6

export const isFrame = (s: Shape): s is RectShape & { kind: 'frame' } => s.type === 'rect' && s.kind === 'frame'

export const frameTitle = (f: RectShape) => f.title?.trim() || 'Frame'

/** World-space box of the title above the frame's top-left corner (also its click target). */
export function frameTitleBox(f: RectShape) {
  const b = shapeBounds(f)
  const w = Math.min(Math.max(frameTitle(f).length * FRAME_TITLE_SIZE * 0.58 + 8, 48), Math.max(b.w, 48))
  const h = FRAME_TITLE_SIZE * 1.4
  return { x: b.x, y: b.y - TITLE_GAP - h, w, h }
}

/** Shapes lying entirely inside the frame. */
export function frameChildren(frame: RectShape, shapes: Shape[]): Shape[] {
  const f = shapeBounds(frame), e = 0.5
  return shapes.filter(s => {
    if (s.id === frame.id) return false
    const b = shapeBounds(s)
    return b.x >= f.x - e && b.y >= f.y - e && b.x + b.w <= f.x + f.w + e && b.y + b.h <= f.y + f.h + e
  })
}

/** The ids plus everything inside any selected frame (nested frames included), for moving as one block. */
export function withFrameContents(ids: Set<string>, shapes: Shape[]): Set<string> {
  const out = new Set(ids)
  const queue = shapes.filter(s => ids.has(s.id) && isFrame(s)) as RectShape[]
  while (queue.length) {
    const f = queue.pop()!
    for (const c of frameChildren(f, shapes)) {
      if (out.has(c.id)) continue
      out.add(c.id)
      if (isFrame(c)) queue.push(c)
    }
  }
  return out
}

/** Frames are UI furniture: always crisp (never sketchy), muted border, title above. */
export function drawFrame(ctx: CanvasRenderingContext2D, f: RectShape) {
  const b = shapeBounds(f)
  ctx.save()
  if (f.fill !== 'none') {
    ctx.fillStyle = f.fill
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, f.radius ?? 8); ctx.fill()
  }
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = f.color; ctx.lineWidth = f.width
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, f.radius ?? 8); ctx.stroke()
  ctx.globalAlpha = 0.85
  const t = frameTitleBox(f)
  ctx.font = FRAME_TITLE_FONT; ctx.fillStyle = f.color
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
  ctx.beginPath(); ctx.rect(t.x, t.y - 4, Math.max(b.w, t.w), t.h + 8); ctx.clip()
  ctx.fillText(frameTitle(f), t.x + 2, b.y - TITLE_GAP)
  ctx.restore()
}

export function frameToSvg(f: RectShape, esc: (v: string) => string, num: (n: number) => number): string {
  const b = shapeBounds(f)
  return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${f.radius ?? 8}" fill="${f.fill === 'none' ? 'none' : esc(f.fill)}" stroke="${esc(f.color)}" stroke-opacity="0.55" stroke-width="${f.width}"/>`
    + `<text x="${num(b.x + 2)}" y="${num(b.y - TITLE_GAP)}" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="500" font-size="${FRAME_TITLE_SIZE}" fill="${esc(f.color)}" fill-opacity="0.85">${esc(frameTitle(f))}</text>`
}
