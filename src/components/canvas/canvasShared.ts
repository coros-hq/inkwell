import { FONT_HAND } from './CanvasToolbar'
import { shapeBounds } from './canvasTypes'
import type { Shape, TextShape, BoundText, RectShape, EllipseShape } from './canvasTypes'

// Pure drawing helpers shared by the live canvas (CanvasView) and the exporters.

let measureCtx: CanvasRenderingContext2D | null = null

export function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function adaptInk(c: string, darkBg: boolean, ink: string): string {
  const rgb = parseHex(c)
  if (!rgb) return c
  const [r, g, b] = rgb
  if (Math.max(r, g, b) - Math.min(r, g, b) > 48) return c // clearly coloured: legible on both
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (darkBg ? lum < 0.28 : lum > 0.72) return ink
  return c
}

export function adaptShape(sh: Shape, darkBg: boolean, ink: string): Shape {
  if (sh.type === 'sticky' || sh.type === 'image') return sh // pastel notes carry their own fixed dark text
  const color = adaptInk(sh.color, darkBg, ink)
  const fill = sh.fill === 'none' ? sh.fill : adaptInk(sh.fill, darkBg, ink)
  let boundText: BoundText | undefined
  if ((sh.type === 'rect' || sh.type === 'ellipse') && sh.boundText) {
    const bc = adaptInk(sh.boundText.color, darkBg, ink)
    if (bc !== sh.boundText.color) boundText = { ...sh.boundText, color: bc }
  }
  if (color === sh.color && fill === sh.fill && !boundText) return sh
  return { ...sh, color, fill, ...(boundText ? { boundText } : {}) } as Shape
}

export function ctxFont(t: TextShape): string {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.fontFamily ?? FONT_HAND}`
}

/** Stable small int from a shape id, used as roughjs's seed so jitter doesn't reshuffle every re-render */
export function seedFromId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % 2 ** 31 || 1
}

export function roughOptions(s: Shape) {
  return {
    stroke: s.color,
    strokeWidth: s.width,
    fill: s.fill === 'none' ? undefined : s.fill,
    fillStyle: 'hachure' as const,
    roughness: 1,
    seed: seedFromId(s.id),
    // A single clean stroke per edge — roughjs's default second overlapping
    // pass is what creates the gap/overshoot look at corners.
    disableMultiStroke: true,
    disableMultiStrokeFill: true,
  }
}

/** Word-wrap (paragraph-aware) text to fit within maxWidth, using ctx's current font. Words wider than maxWidth are broken by character. */
export function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const breakWord = (word: string): string => {
    let chunk = ''
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) { lines.push(chunk); chunk = ch }
      else chunk += ch
    }
    return chunk
  }
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue }
    let cur = ''
    for (const w of paragraph.split(' ')) {
      const test = cur ? cur + ' ' + w : w
      if (ctx.measureText(test).width <= maxWidth) { cur = test; continue }
      if (cur) lines.push(cur)
      cur = ctx.measureText(w).width > maxWidth ? breakWord(w) : w
    }
    if (cur) lines.push(cur)
  }
  return lines
}

export function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!
  return measureCtx
}

export function boundFont(bt: BoundText): string {
  return `${bt.italic ? 'italic ' : ''}${bt.bold ? 'bold ' : ''}${bt.size}px ${bt.fontFamily}`
}

/** World-space rect that a rect/ellipse's label must stay inside */
export function containerTextBox(s: RectShape | EllipseShape) {
  const b = shapeBounds(s)
  if (s.type === 'ellipse') {
    const w = b.w * ELLIPSE_TEXT_RATIO, h = b.h * ELLIPSE_TEXT_RATIO
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }
  }
  return { x: b.x + TEXT_PAD, y: b.y + TEXT_PAD, w: Math.max(b.w - TEXT_PAD * 2, 10), h: Math.max(b.h - TEXT_PAD * 2, 10) }
}

export const STICKY_TEXT_COLOR    = '#1e293b'

export const TEXT_PAD = 8

export const ELLIPSE_TEXT_RATIO = 0.72

export const BOUND_LINE_HEIGHT = 1.25
