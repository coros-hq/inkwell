import { MousePointer2, Pencil, Square, Circle, Minus, MoveRight, Type, StickyNote, Undo2, Redo2, ZoomIn, ZoomOut, LayoutTemplate, Waves, FileText, Maximize2, Grid3x3 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Tool } from './canvasTypes'

// ── Config ─────────────────────────────────────────────────────────────────────

export const FONT_SANS  = 'Inter, system-ui, sans-serif'
export const FONT_SERIF = 'Georgia, Times New Roman, serif'
export const FONT_MONO  = 'JetBrains Mono, Menlo, monospace'

const TOOLS: { id: Tool; Icon: React.FC<{ size?: number }>; label: string; key: string }[] = [
  { id: 'select',  Icon: MousePointer2, label: 'Select',    key: 'V' },
  { id: 'pen',     Icon: Pencil,        label: 'Pen',       key: 'P' },
  { id: 'rect',    Icon: Square,        label: 'Rectangle', key: 'R' },
  { id: 'ellipse', Icon: Circle,        label: 'Ellipse',   key: 'E' },
  { id: 'line',    Icon: Minus,         label: 'Line',      key: 'L' },
  { id: 'arrow',   Icon: MoveRight,     label: 'Arrow',     key: 'A' },
  { id: 'text',    Icon: Type,          label: 'Text',      key: 'T' },
  { id: 'sticky',  Icon: StickyNote,    label: 'Sticky note', key: 'S' },
]

const PALETTE = [
  '#f8fafc', '#94a3b8', '#475569', '#1e293b',
  '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#60a5fa', '#a78bfa', '#f472b6', '#2dd4bf',
]

const WIDTHS: { v: number; thick: number }[] = [
  { v: 1.5, thick: 2 },
  { v: 3,   thick: 3 },
  { v: 6,   thick: 5 },
]

const FONT_SIZES = [12, 16, 24, 36] as const

const FONT_FAMILIES = [
  { value: FONT_SANS,  label: 'Sans'  },
  { value: FONT_SERIF, label: 'Serif' },
  { value: FONT_MONO,  label: 'Mono'  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function VDivider() {
  return <div className="w-px h-5 bg-border mx-1 shrink-0" />
}

function Btn({
  active, onClick, title, children, className,
}: {
  active?: boolean; onClick?: () => void; title?: string; children: React.ReactNode; className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center rounded-lg transition-colors shrink-0',
        active ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  tool: Tool
  color: string
  fill: string
  strokeWidth: number
  zoom: number
  canUndo: boolean
  canRedo: boolean
  radius: number
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  selectedShapeType: string | null
  hasBoundText: boolean
  sketchy: boolean
  showGrid: boolean
  canAddNote: boolean
  hasNote: boolean
  canPromoteSticky: boolean
  onTool:       (t: Tool) => void
  onColor:      (c: string) => void
  onFill:       (f: string) => void
  onWidth:      (w: number) => void
  onRadius:     (r: number) => void
  onFontSize:   (s: number) => void
  onFontFamily: (f: string) => void
  onBold:       (b: boolean) => void
  onItalic:     (b: boolean) => void
  onUndo:       () => void
  onRedo:       () => void
  onZoom:       (delta: number) => void
  onTemplates:  () => void
  showTemplates: boolean
  onSketchy:    () => void
  onToggleGrid: () => void
  onAddNote:    () => void
  onPromoteSticky: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CanvasToolbar(p: Props) {
  const isSticky = p.tool === 'sticky' || p.selectedShapeType === 'sticky'
  const fillable = p.tool === 'rect' || p.tool === 'ellipse'
               || p.selectedShapeType === 'rect' || p.selectedShapeType === 'ellipse'
  const fillOn   = p.fill !== 'none'
  const showRect = p.tool === 'rect' || p.selectedShapeType === 'rect'
  const showText = p.tool === 'text' || p.selectedShapeType === 'text' || p.hasBoundText
  const showNoteActions = p.canAddNote || p.canPromoteSticky

  const rowCls = 'flex flex-row items-center gap-0.5 bg-surface border border-border rounded-2xl px-3 py-2 shadow-xl select-none'

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5">

      {/* ── Context row ── */}
      {(showRect || showText || showNoteActions) && (
        <div className={rowCls}>

          {showNoteActions && (
            <>
              {p.canAddNote && (
                <Btn onClick={p.onAddNote} title={p.hasNote ? 'Edit note' : 'Add note'} className="px-2 h-7 gap-1.5">
                  <FileText size={12} />
                  <span className="text-[10px] font-medium">{p.hasNote ? 'Edit note' : 'Add note'}</span>
                </Btn>
              )}
              {p.canPromoteSticky && (
                <Btn onClick={p.onPromoteSticky} title="Expand to full note" className="px-2 h-7 gap-1.5">
                  <Maximize2 size={12} />
                  <span className="text-[10px] font-medium">Expand to note</span>
                </Btn>
              )}
              {(showRect || showText) && <VDivider />}
            </>
          )}

          {showRect && (
            <>
              <span className="text-[9px] text-muted-foreground mr-1">corner</span>
              <button
                onClick={() => p.onRadius(Math.max(0, p.radius - 4))}
                className="w-6 h-6 text-base leading-none text-muted-foreground hover:bg-muted rounded transition-colors flex items-center justify-center"
              >−</button>
              <span className="text-[10px] text-foreground tabular-nums w-5 text-center">{p.radius}</span>
              <button
                onClick={() => p.onRadius(Math.min(60, p.radius + 4))}
                className="w-6 h-6 text-base leading-none text-muted-foreground hover:bg-muted rounded transition-colors flex items-center justify-center"
              >+</button>
            </>
          )}

          {showText && (
            <>
              {/* Size presets */}
              <span className="text-[9px] text-muted-foreground mr-1">size</span>
              {FONT_SIZES.map(s => (
                <Btn key={s} active={p.fontSize === s} onClick={() => p.onFontSize(s)}
                  className="w-8 h-7 text-[10px] font-medium">
                  {s}
                </Btn>
              ))}
              <VDivider />
              {/* Font family */}
              {FONT_FAMILIES.map(({ value, label }) => (
                <Btn key={value} active={p.fontFamily === value} onClick={() => p.onFontFamily(value)}
                  className="px-2 h-7 text-[10px]" title={label}>
                  <span style={{ fontFamily: value }}>{label}</span>
                </Btn>
              ))}
              <VDivider />
              {/* Bold / Italic */}
              <Btn active={p.bold} onClick={() => p.onBold(!p.bold)} className="w-7 h-7 text-sm font-bold">B</Btn>
              <Btn active={p.italic} onClick={() => p.onItalic(!p.italic)} className="w-7 h-7 text-sm italic"><em>I</em></Btn>
            </>
          )}
        </div>
      )}

      {/* ── Main toolbar row ── */}
      <div className={rowCls}>

        {/* Tools */}
        {TOOLS.map(({ id, Icon, label, key }) => (
          <Btn key={id} active={p.tool === id} onClick={() => p.onTool(id)}
            title={`${label} · ${key}`} className="w-8 h-8">
            <Icon size={14} />
          </Btn>
        ))}

        <VDivider />

        {/* Color palette — 2 rows × 6 cols */}
        <div className="grid grid-rows-2 grid-flow-col gap-[5px] px-0.5">
          {PALETTE.map(c => (
            <button
              key={c}
              title={c}
              onClick={() => p.onColor(c)}
              className={cn(
                'w-3.5 h-3.5 rounded-full border-[1.5px] transition-transform hover:scale-125 shrink-0',
                p.color === c ? 'border-accent scale-[1.15]' : 'border-transparent',
              )}
              style={{ background: c }}
            />
          ))}
        </div>

        {!isSticky && (
          <>
            {/* Fill toggle */}
            <button
              onClick={() => p.onFill(fillOn ? 'none' : p.color + '28')}
              title={fillOn ? 'Remove fill' : 'Add fill'}
              className={cn(
                'h-6 px-1.5 text-[10px] font-medium rounded transition-colors ml-1 shrink-0',
                fillOn ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-muted',
                !fillable && 'opacity-25 pointer-events-none',
              )}
            >
              fill
            </button>

            <VDivider />

            {/* Stroke widths */}
            {WIDTHS.map(({ v, thick }) => (
              <button
                key={v}
                onClick={() => p.onWidth(v)}
                title={`${v}px`}
                className={cn(
                  'w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
                  p.strokeWidth === v ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <div
                  className="rounded-full"
                  style={{
                    width:      20,
                    height:     thick,
                    background: p.strokeWidth === v ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                  }}
                />
              </button>
            ))}

            <VDivider />
          </>
        )}

        {/* Undo / Redo */}
        <button
          onClick={p.onUndo} disabled={!p.canUndo} title="Undo ⌘Z"
          className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
            p.canUndo ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-muted-foreground opacity-25 cursor-not-allowed')}
        ><Undo2 size={14} /></button>
        <button
          onClick={p.onRedo} disabled={!p.canRedo} title="Redo ⌘⇧Z"
          className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
            p.canRedo ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-muted-foreground opacity-25 cursor-not-allowed')}
        ><Redo2 size={14} /></button>

        <VDivider />

        {/* Zoom */}
        <button onClick={() => p.onZoom(0.15)} title="Zoom in ⌘+"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors shrink-0">
          <ZoomIn size={14} />
        </button>
        <span className="text-[9px] text-muted-foreground tabular-nums w-8 text-center shrink-0">
          {Math.round(p.zoom * 100)}%
        </span>
        <button onClick={() => p.onZoom(-0.15)} title="Zoom out ⌘-"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors shrink-0">
          <ZoomOut size={14} />
        </button>

        <VDivider />

        {/* Sketchy (hand-drawn) style toggle */}
        <button
          onClick={p.onSketchy}
          title="Sketchy style"
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
            p.sketchy
              ? 'bg-accent text-white'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Waves size={14} />
        </button>

        {/* Grid toggle */}
        <button
          onClick={p.onToggleGrid}
          title={p.showGrid ? 'Hide grid' : 'Show grid'}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
            p.showGrid
              ? 'bg-accent text-white'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Grid3x3 size={14} />
        </button>

        {/* Templates */}
        <button
          onClick={p.onTemplates}
          title="Templates"
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
            p.showTemplates
              ? 'bg-accent text-white'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <LayoutTemplate size={14} />
        </button>
      </div>
    </div>
  )
}
