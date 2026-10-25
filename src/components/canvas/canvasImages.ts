import { uid } from './canvasTypes'
import type { ImageShape } from './canvasTypes'

// Images are embedded in the canvas file as data URLs, so large photos are
// downscaled first to keep canvas.json (rewritten on every edit) small.
const MAX_PIXELS = 1600
const MAX_WORLD_WIDTH = 480
const PASSTHROUGH_BYTES = 600 * 1024

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = url
  })
}

async function toEmbeddedImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const original = await readAsDataUrl(file)
  const img = await loadImage(original)
  const scale = Math.min(1, MAX_PIXELS / Math.max(img.naturalWidth, img.naturalHeight))
  // Small files, SVGs and GIFs (animation/vector) go through untouched.
  if ((scale === 1 && file.size <= PASSTHROUGH_BYTES) || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return { src: original, w: img.naturalWidth, h: img.naturalHeight }
  }
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const jpeg = file.type === 'image/jpeg'
  return { src: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.88), w, h }
}

/**
 * Turns image files into canvas shapes centered on `center` (world space),
 * fanned out slightly when several arrive at once. Files that fail to decode
 * are skipped.
 */
export async function imageFilesToShapes(files: File[], center: { x: number; y: number }): Promise<ImageShape[]> {
  const out: ImageShape[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    try {
      const { src, w, h } = await toEmbeddedImage(file)
      const dw = Math.min(w, MAX_WORLD_WIDTH)
      const dh = (h / w) * dw
      const o = out.length * 24
      out.push({
        id: uid(), type: 'image', color: '#000000', fill: 'none', width: 1,
        x: center.x - dw / 2 + o, y: center.y - dh / 2 + o, w: dw, h: dh, src,
      })
    } catch (e) {
      console.error('[canvas] image skipped:', e)
    }
  }
  return out
}
