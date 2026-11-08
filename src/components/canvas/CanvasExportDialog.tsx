import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'
import type { Shape } from './canvasTypes'
import {
  buildSvg, exportBox, pngSize, renderPng, safeFileName, saveExport, EXPORT_BG,
  type ExportBackground, type ExportFormat, type ExportOptions, type PaintFn,
} from './canvasExport'

interface Props {
  title: string
  shapes: Shape[]
  selected: Shape[]
  appIsDark: boolean
  initialSketchy: boolean
  paint: PaintFn
  preload: (shapes: Shape[]) => Promise<void>
  onClose: () => void
}

function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3 py-1 text-xs transition-colors',
            o.value === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-surface',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function CanvasExportDialog({ title, shapes, selected, appIsDark, initialSketchy, paint, preload, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [background, setBackground] = useState<ExportBackground>(appIsDark ? 'dark' : 'light')
  const [scale, setScale] = useState(2)
  const [sketchy, setSketchy] = useState(initialSketchy)
  const [scope, setScope] = useState<'all' | 'selection'>(selected.length ? 'selection' : 'all')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const target = scope === 'selection' && selected.length ? selected : shapes
  const opts: ExportOptions = useMemo(
    () => ({ background, scale, padding: 24, sketchy, appIsDark }),
    [background, scale, sketchy, appIsDark],
  )

  // The preview is always the SVG rendering — it is instant and mirrors the PNG closely.
  const preview = useMemo(() => buildSvg(target, opts), [target, opts])
  const previewUrl = useMemo(
    () => (preview ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}` : null),
    [preview],
  )

  const box = exportBox(target, opts.padding)
  const dims = box
    ? format === 'png'
      ? (() => { const p = pngSize(box, scale); return `${p.w} × ${p.h} px${p.scale < scale ? ' (scaled down to fit)' : ''}` })()
      : `${box.w} × ${box.h}`
    : 'Nothing to export'

  useEffect(() => { setStatus(null) }, [format, background, scale, sketchy, scope])

  const doExport = async () => {
    if (!box || busy) return
    setBusy(true); setStatus(null)
    try {
      const base = safeFileName(title)
      let ok = false
      if (format === 'svg') {
        const svg = buildSvg(target, opts)
        ok = !!svg && await saveExport(svg.svg, `${base}.svg`, 'svg')
      } else {
        await preload(target)
        const png = await renderPng(target, opts, paint)
        ok = !!png && await saveExport(png, `${base}.png`, 'png')
      }
      if (ok) onClose()
    } catch (e) {
      console.error(e)
      setStatus('Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const checker = background === 'transparent'
    ? { backgroundImage: 'conic-gradient(#8883 25%, transparent 0 50%, #8883 0 75%, transparent 0)', backgroundSize: '16px 16px' }
    : { background: EXPORT_BG[background] }

  return (
    <Dialog.Root open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-panel border border-border rounded-lg shadow-lg p-5 focus:outline-none"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <Dialog.Title className="text-sm font-semibold text-foreground mb-1">Export drawing</Dialog.Title>
          <Dialog.Description className="text-xs text-muted-foreground mb-4">
            Save “{title}” as a vector SVG or a PNG image.
          </Dialog.Description>

          <div className="h-52 rounded-md border border-border overflow-hidden flex items-center justify-center mb-4" style={checker}>
            {previewUrl
              ? <img src={previewUrl} alt="Export preview" className="max-w-full max-h-full object-contain" draggable={false} />
              : <span className="text-xs text-muted-foreground">This drawing is empty.</span>}
          </div>

          <div className="flex flex-col gap-3 mb-4">
            <Row label="Format">
              <Segmented value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG' }]} />
            </Row>
            <Row label="Background">
              <Segmented
                value={background} onChange={setBackground}
                options={[{ value: 'transparent', label: 'Transparent' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              />
            </Row>
            {format === 'png' && (
              <Row label="Scale">
                <Segmented value={scale} onChange={setScale} options={[1, 2, 3, 4].map(n => ({ value: n, label: `${n}×` }))} />
              </Row>
            )}
            {selected.length > 0 && (
              <Row label="Include">
                <Segmented
                  value={scope} onChange={setScope}
                  options={[{ value: 'selection', label: `Selection (${selected.length})` }, { value: 'all', label: 'Whole drawing' }]}
                />
              </Row>
            )}
            <Row label="Hand-drawn style">
              <Segmented value={sketchy ? 'on' : 'off'} onChange={v => setSketchy(v === 'on')} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
            </Row>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{status ?? dims}</span>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                disabled={!box || busy}
                onClick={doExport}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
