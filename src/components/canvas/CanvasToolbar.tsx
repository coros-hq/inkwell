import { useCallback, useEffect, useRef, useState } from 'react'
import { MousePointer2, Pencil, Square, Circle, Minus, MoveRight, Type, StickyNote, Frame, Undo2, Redo2, ZoomIn, ZoomOut, LayoutTemplate, ImagePlus, Waves, FileText, Maximize2, Grid3x3, PanelLeft, Download, AlignLeft, AlignCenter, AlignRight, ChevronDown, Check, Ellipsis, Scan, Map as MapIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Tool, TextAlign } from './canvasTypes'

// ── Config ─────────────────────────────────────────────────────────────────────

export const FONT_HAND  = 'Kalam, "Comic Sans MS", cursive'
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
  { id: 'frame',   Icon: Frame,         label: 'Frame',     key: 'F' },
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
  { value: FONT_HAND,  label: 'Hand'  },
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
  textAlign: TextAlign
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
  onTextAlign:  (a: TextAlign) => void
  onUndo:       () => void
  onRedo:       () => void
  onZoom:       (delta: number) => void
  onZoomFit:    () => void
  onZoomReset:  () => void
  onTemplates:  () => void
  onImage:      () => void
  showTemplates: boolean
  onSketchy:    () => void
  onToggleGrid: () => void
  showMinimap: boolean
  onToggleMinimap: () => void
  showDrawings: boolean
  onToggleDrawings: () => void
  onExport: () => void
  onAddNote:    () => void
  onPromoteSticky: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

type Menu = 'style' | 'zoom' | 'font' | 'more'

/**
 * A trigger with a panel that opens above it. Outside clicks and Escape close it
 * (a document listener, not a fixed backdrop: the toolbar is transformed, which
 * would confine a fixed element to the toolbar's own box).
 */
function Popover({ open, onClose, trigger, children, className, alignEnd }: {
  open: boolean; onClose: () => void; trigger: React.ReactNode; children: React.ReactNode; className?: string; alignEnd?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) onClose() }
    const key  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key) }
  }, [open, onClose])
  return (
    <div ref={wrapRef} className="relative">
      {trigger}
      {open && (
        <div className={cn(
          'absolute bottom-full mb-2.5 z-40 bg-surface border border-border rounded-xl shadow-2xl p-2',
          alignEnd ? '-right-2' : 'left-1/2 -translate-x-1/2',
          className,
        )}>
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, hint, active, onClick }: { icon: React.ReactNode; label: string; hint?: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2 h-8 rounded-lg text-[12px] text-foreground/90 hover:bg-muted transition-colors"
    >
      <span className="w-4 flex justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <kbd className="text-[10px] text-muted-foreground font-mono">{hint}</kbd>}
      <span className="w-3.5 flex justify-center text-accent">{active && <Check size={13} />}</span>
    </button>
  )
}

const ALIGNS: { id: TextAlign; Icon: React.FC<{ size?: number }>; label: string }[] = [
  { id: 'left',   Icon: AlignLeft,   label: 'Align left' },
  { id: 'center', Icon: AlignCenter, label: 'Align center' },
  { id: 'right',  Icon: AlignRight,  label: 'Align right' },
]

export function CanvasToolbar(p: Props) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const toggle = (m: Menu) => setMenu(cur => cur === m ? null : m)
  const close = useCallback(() => setMenu(null), [])

  const isSticky = p.tool === 'sticky' || p.selectedShapeType === 'sticky'
  const fillable = p.tool === 'rect' || p.tool === 'ellipse'
               || p.selectedShapeType === 'rect' || p.selectedShapeType === 'ellipse'
  const fillOn   = p.fill !== 'none'
  const showRect = p.tool === 'rect' || p.selectedShapeType === 'rect'
  const showText = p.tool === 'text' || p.selectedShapeType === 'text' || p.hasBoundText
  const showNoteActions = p.canAddNote || p.canPromoteSticky
  const fontLabel = FONT_FAMILIES.find(f => f.value === p.fontFamily)?.label ?? 'Font'

  const rowCls = 'flex flex-row items-center gap-0.5 bg-surface border border-border rounded-2xl px-2 py-1.5 shadow-xl select-none'
  const iconBtn = 'w-8 h-8'

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5">

      {/* ── Context row: options for the active tool / selection ── */}
      {(showRect || showText || showNoteActions) && (
        <div className={rowCls}>

          {showNoteActions && (
            <>
              {p.canAddNote && (
                <Btn onClick={p.onAddNote} title={p.hasNote ? 'Edit note' : 'Add note'} className={iconBtn}>
                  <FileText size={14} />
                </Btn>
              )}
              {p.canPromoteSticky && (
                <Btn onClick={p.onPromoteSticky} title="Expand to full note" className={iconBtn}>
                  <Maximize2 size={14} />
                </Btn>
              )}
              {(showRect || showText) && <VDivider />}
            </>
          )}

          {showRect && (
            <>
              <span className="text-[10px] text-muted-foreground px-1">corner</span>
              <button
                onClick={() => p.onRadius(Math.max(0, p.radius - 4))}
                className="w-6 h-6 text-base leading-none text-muted-foreground hover:bg-muted rounded transition-colors flex items-center justify-center"
              >−</button>
              <span className="text-[10px] text-foreground tabular-nums w-5 text-center">{p.radius}</span>
              <button
                onClick={() => p.onRadius(Math.min(60, p.radius + 4))}
                className="w-6 h-6 text-base leading-none text-muted-foreground hover:bg-muted rounded transition-colors flex items-center justify-center"
              >+</button>
              {showText && <VDivider />}
            </>
          )}

          {showText && (
            <>
              {/* Font family */}
              <Popover open={menu === 'font'} onClose={close} className="w-36" trigger={
                <Btn active={menu === 'font'} onClick={() => toggle('font')} title="Font" className="h-8 px-2 gap-1 text-[11px]">
                  <span style={{ fontFamily: p.fontFamily }}>{fontLabel}</span>
                  <ChevronDown size={11} />
                </Btn>
              }>
                  {FONT_FAMILIES.map(({ value, label }) => (
                    <MenuItem key={value} icon={null} label={label} active={p.fontFamily === value}
                      onClick={() => { p.onFontFamily(value); close() }} />
                  ))}
              </Popover>
              <VDivider />
              {/* Size presets */}
              {FONT_SIZES.map(s => (
                <Btn key={s} active={p.fontSize === s} onClick={() => p.onFontSize(s)} title={`${s}px`}
                  className="w-7 h-8 text-[11px] font-medium tabular-nums">
                  {s}
                </Btn>
              ))}
              <VDivider />
              <Btn active={p.bold} onClick={() => p.onBold(!p.bold)} title="Bold" className="w-8 h-8 text-sm font-bold">B</Btn>
              <Btn active={p.italic} onClick={() => p.onItalic(!p.italic)} title="Italic" className="w-8 h-8 text-sm italic"><em>I</em></Btn>
              <VDivider />
              {ALIGNS.map(({ id, Icon, label }) => (
                <Btn key={id} active={p.textAlign === id} onClick={() => p.onTextAlign(id)} title={label} className={iconBtn}>
                  <Icon size={14} />
                </Btn>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Main toolbar row ── */}
      <div className={rowCls}>

        {/* Tools */}
        {TOOLS.map(({ id, Icon, label, key }) => (
          <Btn key={id} active={p.tool === id} onClick={() => p.onTool(id)}
            title={`${label} · ${key}`} className={iconBtn}>
            <Icon size={14} />
          </Btn>
        ))}

        <VDivider />

        {/* Style: color, fill, stroke width */}
        <Popover open={menu === 'style'} onClose={close} className="w-[188px]" trigger={
          <Btn active={menu === 'style'} onClick={() => toggle('style')} title="Color & stroke" className={iconBtn}>
            <span
              className="w-4 h-4 rounded-full border-2 border-white/20"
              style={{ background: fillOn ? p.color : 'transparent', boxShadow: `inset 0 0 0 2.5px ${p.color}` }}
            />
          </Btn>
        }>
            <div className="grid grid-cols-6 gap-1.5 p-1">
              {PALETTE.map(c => (
                <button
                  key={c}
                  title={c}
                  onClick={() => p.onColor(c)}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                    p.color === c ? 'border-accent' : 'border-transparent',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
            {!isSticky && (
              <>
                <div className="h-px bg-border my-1.5" />
                <div className="flex items-center gap-0.5 px-0.5">
                  {WIDTHS.map(({ v, thick }) => (
                    <button
                      key={v}
                      onClick={() => p.onWidth(v)}
                      title={`Stroke ${v}px`}
                      className={cn(
                        'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
                        p.strokeWidth === v ? 'bg-muted' : 'hover:bg-muted',
                      )}
                    >
                      <div className="rounded-full" style={{
                        width: 18, height: thick,
                        background: p.strokeWidth === v ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                      }} />
                    </button>
                  ))}
                  <button
                    onClick={() => p.onFill(fillOn ? 'none' : p.color + '28')}
                    disabled={!fillable}
                    title={fillable ? (fillOn ? 'Remove fill' : 'Add fill') : 'Fill works on rectangles and ellipses'}
                    className={cn(
                      'ml-auto h-7 px-2.5 text-[11px] font-medium rounded-lg transition-colors',
                      fillOn ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-muted',
                      !fillable && 'opacity-30 cursor-not-allowed',
                    )}
                  >
                    Fill
                  </button>
                </div>
              </>
            )}
        </Popover>

        <VDivider />

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

        {/* Zoom */}
        <Popover open={menu === 'zoom'} onClose={close} className="w-48" trigger={
          <Btn active={menu === 'zoom'} onClick={() => toggle('zoom')} title="Zoom" className="h-8 px-1.5 min-w-[44px] text-[11px] tabular-nums">
            {Math.round(p.zoom * 100)}%
          </Btn>
        }>
            <MenuItem icon={<ZoomIn size={13} />}    label="Zoom in"     hint="⌘+" onClick={() => p.onZoom(0.15)} />
            <MenuItem icon={<ZoomOut size={13} />}   label="Zoom out"    hint="⌘-" onClick={() => p.onZoom(-0.15)} />
            <MenuItem icon={<Scan size={13} />}      label="Fit all"     hint="⇧1" onClick={() => { p.onZoomFit(); close() }} />
            <MenuItem icon={<Maximize2 size={13} />} label="Reset 100%"  hint="⇧0" onClick={() => { p.onZoomReset(); close() }} />
        </Popover>

        <VDivider />

        {/* Insert */}
        <Btn onClick={p.onImage} title="Add image or Excalidraw file · or paste" className={iconBtn}>
          <ImagePlus size={14} />
        </Btn>
        <Btn active={p.showTemplates} onClick={p.onTemplates} title="Templates" className={iconBtn}>
          <LayoutTemplate size={14} />
        </Btn>

        {/* View & file options */}
        <Popover open={menu === 'more'} onClose={close} className="w-56" alignEnd trigger={
          <Btn active={menu === 'more'} onClick={() => toggle('more')} title="More" className={iconBtn}>
            <Ellipsis size={14} />
          </Btn>
        }>
            <MenuItem icon={<Waves size={13} />}     label="Sketchy style"  active={p.sketchy}      onClick={p.onSketchy} />
            <MenuItem icon={<Grid3x3 size={13} />}   label="Grid"           active={p.showGrid}     onClick={p.onToggleGrid} />
            <MenuItem icon={<MapIcon size={13} />}   label="Minimap"        hint="⇧M" active={p.showMinimap} onClick={p.onToggleMinimap} />
            <MenuItem icon={<PanelLeft size={13} />} label="Drawings list"  active={p.showDrawings} onClick={p.onToggleDrawings} />
            <div className="h-px bg-border my-1" />
            <MenuItem icon={<Download size={13} />}  label="Export SVG / PNG…" onClick={() => { p.onExport(); close() }} />
        </Popover>
      </div>
    </div>
  )
}
