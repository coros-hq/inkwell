import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { CATEGORY_ELEMENTS, elementPreview, type CategoryElement } from './canvasCategoryElements'
import { TEMPLATE_CATEGORIES, type TemplateCategory } from './canvasTemplates'
import type { Shape } from './canvasTypes'
import { cn } from '../../lib/utils'

// ── Element card ──────────────────────────────────────────────────────────────

function ElementCard({
  el,
  onAdd,
}: {
  el:    CategoryElement
  onAdd: (shapes: Shape[]) => void
}) {
  const [added, setAdded] = useState(false)

  const handleAdd = () => {
    onAdd(el.create())
    setAdded(true)
    setTimeout(() => setAdded(false), 900)
  }

  return (
    <button
      onClick={handleAdd}
      title={el.hint}
      className={cn(
        'group flex flex-col gap-1.5 p-2 rounded-xl border transition-all text-left w-full',
        added
          ? 'border-accent/60 bg-accent/10'
          : 'border-border bg-background hover:bg-surface hover:border-accent/30',
      )}
    >
      {/* SVG preview */}
      <div
        className={cn(
          'w-full rounded-lg flex items-center justify-center overflow-hidden border transition-colors',
          added ? 'border-accent/40 text-accent' : 'border-border/50 text-foreground/60 group-hover:text-foreground/80',
        )}
        style={{ height: 52 }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: elementPreview(el) }}
      />
      {/* Label */}
      <div className="px-0.5">
        <p className={cn('text-[10px] font-medium leading-tight transition-colors', added ? 'text-accent' : 'text-foreground')}>
          {added ? '✓ Added' : el.name}
        </p>
      </div>
    </button>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  category: TemplateCategory
  onAdd:    (shapes: Shape[]) => void
  onClose:  () => void
}

export function CanvasCategoryPanel({ category, onAdd, onClose }: Props) {
  const [expanded,        setExpanded]        = useState(true)
  const [activeCategory,  setActiveCategory]  = useState<TemplateCategory>(category)

  const elements    = CATEGORY_ELEMENTS[activeCategory]
  const catMeta     = TEMPLATE_CATEGORIES.find(c => c.id === activeCategory)!

  return (
    <div
      className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex items-stretch"
      style={{ maxHeight: 'calc(100vh - 140px)' }}
    >
      {/* Collapse toggle strip */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex flex-col items-center justify-center gap-1 px-1 py-3 rounded-l-xl bg-panel border border-r-0 border-border text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        title={expanded ? 'Collapse panel' : 'Expand panel'}
      >
        {expanded
          ? <ChevronRight className="w-3.5 h-3.5" />
          : <ChevronLeft  className="w-3.5 h-3.5" />}
        {/* Rotated category label when collapsed */}
        {!expanded && (
          <span
            className="text-[9px] font-semibold tracking-widest uppercase text-accent mt-1"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
          >
            {catMeta.label}
          </span>
        )}
      </button>

      {/* Main panel */}
      {expanded && (
        <div
          className="flex flex-col bg-panel border border-border rounded-r-xl shadow-xl overflow-hidden"
          style={{ width: 172 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0">
            <span className="text-[10px] font-semibold text-accent tracking-wider uppercase">
              {catMeta.label}
            </span>
            <button
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded-md text-tertiary hover:text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1 px-2 pb-2 flex-shrink-0 border-b border-border">
            {TEMPLATE_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[9px] font-medium transition-colors',
                  activeCategory === cat.id
                    ? 'bg-accent/15 text-accent'
                    : 'text-tertiary hover:text-muted-foreground hover:bg-muted',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Elements grid — scrollable */}
          <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start" style={{ scrollbarWidth: 'none' }}>
            {elements.map(el => (
              <ElementCard key={el.id} el={el} onAdd={onAdd} />
            ))}
          </div>

          {/* Footer hint */}
          <div className="flex-shrink-0 px-3 py-2 border-t border-border">
            <p className="text-[9px] text-tertiary leading-tight">
              Click any element to add it to the canvas
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
