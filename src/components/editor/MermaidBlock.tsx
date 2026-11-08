import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minus, Plus, RotateCcw, X, Pencil } from 'lucide-react'

let mermaidSeq = 0

export function MermaidBlock({ source, onEdit }: { source: string; onEdit?: () => void }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
        const { svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, source.trim())
        if (!cancelled) { setSvg(svg); setError(null) }
      } catch (e) {
        document.querySelectorAll('[id^="dmermaid-"]').forEach(n => n.remove())
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [source, dark])

  if (error) {
    return (
      <div className="rounded-lg border border-border/50 p-3 text-[12px] text-muted-foreground">
        <div className="font-semibold mb-1">Mermaid error</div>
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    )
  }
  return (
    <>
      <div className="relative group">
        <div
          className="cursor-zoom-in [&_svg]:!w-full [&_svg]:!max-w-full [&_svg]:!h-auto"
          title="Click to zoom"
          onClick={() => svg && setOpen(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {onEdit && (
          <button
            onClick={onEdit}
            className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-muted-foreground hover:text-foreground"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>
      {open && createPortal(<MermaidViewer svg={svg} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function svgSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/)
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 800, h: 600 }
}

function MermaidViewer({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { w, h } = svgSize(svg)
  const fit = Math.min((window.innerWidth * 0.9) / w, (window.innerHeight * 0.85) / h)
  const [scale, setScale] = useState(fit)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const zoom = (f: number) => setScale(s => Math.min(Math.max(s * f, 0.1), 12))
  const reset = () => { setScale(fit); setPos({ x: 0, y: 0 }) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoom(1.25)
      else if (e.key === '-') zoom(0.8)
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const btn = 'p-2 rounded-md hover:bg-white/15 text-white'
  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/80 overflow-hidden select-none"
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }) }}
      onPointerUp={() => { drag.current = null }}
    >
      <div
        className="absolute left-1/2 top-1/2 rounded-lg bg-[#1c1c1c] p-4 pointer-events-none [&_svg]:!w-full [&_svg]:!h-full [&_svg]:!max-w-none"
        style={{ width: w * scale, height: h * scale, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`, boxSizing: 'content-box' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div
        className="absolute top-4 right-4 flex items-center gap-1 rounded-lg bg-black/60 p-1"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={btn} onClick={() => zoom(0.8)} title="Zoom out"><Minus size={16} /></button>
        <span className="text-white text-xs w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button className={btn} onClick={() => zoom(1.25)} title="Zoom in"><Plus size={16} /></button>
        <button className={btn} onClick={reset} title="Fit"><Maximize2 size={16} /></button>
        <button className={btn} onClick={() => { setScale(1); setPos({ x: 0, y: 0 }) }} title="100%"><RotateCcw size={16} /></button>
        <button className={btn} onClick={onClose} title="Close (Esc)"><X size={16} /></button>
      </div>
    </div>
  )
}
