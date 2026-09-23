import { useMemo, useState } from 'react'
import { Code2 } from 'lucide-react'
import { ContextMenu } from '../shared/ContextMenu'
import { cn } from '../../lib/utils'

// ─── Chart code-block support ────────────────────────────────────────────────
// ```chart fenced blocks hold a small Chart.js-shaped JSON spec:
//
//   ```chart
//   {
//     "type": "bar",
//     "title": "Weekly sales",
//     "labels": ["Mon", "Tue", "Wed"],
//     "datasets": [
//       { "label": "Sales", "data": [10, 20, 15] },
//       { "label": "Costs", "data": [5, 8, 6] }
//     ]
//   }
//   ```
//
// Supported `type`: "bar", "line", "area", "pie", "donut".

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut'

export interface ChartDataset {
  label?: string
  data: number[]
}

export interface ChartSpec {
  type: ChartType
  title?: string
  labels: string[]
  datasets: ChartDataset[]
}

// Fixed categorical order — validated for CVD-safe adjacent contrast in both
// themes (see dataviz skill palette). Never cycled or reassigned by rank.
const SERIES_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]
const MAX_SERIES = SERIES_COLORS.length

/**
 * A raw newline inside a JSON string value is illegal (e.g. a wrapped
 * "title" that broke across two lines when typed or pasted). Collapse any
 * run of whitespace found *inside* a string literal into a single space
 * before parsing, so word-wrapped text doesn't produce a hard parse error.
 * Newlines between tokens (already legal JSON whitespace) are untouched.
 */
function normalizeWrappedStrings(raw: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    if (ch === '\n' || ch === '\r') {
      while (i + 1 < raw.length && /\s/.test(raw[i + 1])) i++
      out += ' '
      continue
    }
    out += ch
  }
  return out
}

export function parseSpec(raw: string): ChartSpec {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    try {
      json = JSON.parse(normalizeWrappedStrings(raw))
    } catch {
      throw new Error('Invalid JSON')
    }
  }
  if (typeof json !== 'object' || json === null) throw new Error('Chart spec must be an object')
  const obj = json as Record<string, unknown>

  const type = String(obj.type ?? '').toLowerCase() as ChartType
  if (!['bar', 'line', 'area', 'pie', 'donut'].includes(type)) {
    throw new Error(`Unknown chart type "${obj.type}" — use bar, line, area, pie, or donut`)
  }
  if (!Array.isArray(obj.labels) || obj.labels.length === 0) throw new Error('"labels" must be a non-empty array')
  if (!Array.isArray(obj.datasets) || obj.datasets.length === 0) throw new Error('"datasets" must be a non-empty array')

  const datasets: ChartDataset[] = obj.datasets.map((d, i) => {
    if (typeof d !== 'object' || d === null || !Array.isArray((d as Record<string, unknown>).data)) {
      throw new Error(`datasets[${i}] must have a "data" array`)
    }
    const rec = d as Record<string, unknown>
    return { label: typeof rec.label === 'string' ? rec.label : undefined, data: (rec.data as unknown[]).map(Number) }
  })

  return {
    type,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    labels: (obj.labels as unknown[]).map(String),
    datasets,
  }
}

/** Rounds a bar-chart max up to a clean tick step (0 / 1,000 / 2,000 style). */
function niceMax(max: number): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 0.25 }
  const rawStep = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude
  return { max: step * 4, step }
}

function formatTick(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString() : String(Math.round(n * 100) / 100)
}

/** Rounded-top, square-bottom bar path (6px radius, grows from the baseline). */
function barPath(x: number, yTop: number, width: number, yBase: number): string {
  const r = Math.min(6, width / 2, Math.max(0, yBase - yTop))
  if (yBase - yTop <= 0) return ''
  return `M${x},${yBase} L${x},${yTop + r} A${r},${r} 0 0 1 ${x + r},${yTop} L${x + width - r},${yTop} A${r},${r} 0 0 1 ${x + width},${yTop + r} L${x + width},${yBase} Z`
}

/** A soft colored glow per series, keyed to that series' own color — a thin neon halo, not a shadow. */
function ChartDefs({ ids }: { ids: string[] }) {
  return (
    <defs>
      {ids.map((color, i) => (
        <filter key={i} id={`chart-glow-${i}`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={color} floodOpacity="0.55" />
        </filter>
      ))}
    </defs>
  )
}

type Tooltip = { x: number; y: number; text: string } | null

function TooltipLayer({ tip }: { tip: Tooltip }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 px-2 py-1 rounded-md text-[11px] whitespace-nowrap shadow-sm border border-border bg-panel text-foreground"
      style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -130%)' }}
    >
      {tip.text}
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-3 not-prose">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />
          {it.label}
        </div>
      ))}
    </div>
  )
}

function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide"></th>
            {spec.datasets.map((d, i) => (
              <th key={i} className="px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {d.label ?? `Series ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.labels.map((label, li) => (
            <tr key={li} className="border-b border-border/50">
              <td className="px-2 py-1.5 text-foreground">{label}</td>
              {spec.datasets.map((d, di) => (
                <td key={di} className="px-2 py-1.5 text-foreground">{d.data[li] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const W = 640
const PAD = { top: 12, right: 16, bottom: 28, left: 40 }

function CartesianChart({ spec }: { spec: ChartSpec }) {
  const H = 260
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const [tip, setTip] = useState<Tooltip>(null)

  const datasets = spec.datasets.slice(0, MAX_SERIES)
  const allValues = datasets.flatMap(d => d.data)
  const dataMax = Math.max(0, ...allValues)
  const dataMin = Math.min(0, ...allValues)
  const { max: yMax, step } = niceMax(Math.max(dataMax, -dataMin))
  const yMin = dataMin < 0 ? -yMax : 0
  const yRange = yMax - yMin || 1
  const yToPx = (v: number) => PAD.top + plotH - ((v - yMin) / yRange) * plotH
  const baselinePx = yToPx(0)

  const ticks: number[] = []
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) ticks.push(v)

  const n = spec.labels.length
  const bandW = plotW / n

  return (
    <div className="relative not-prose">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={spec.title ?? `${spec.type} chart`}>
        <ChartDefs ids={datasets.map((_, di) => SERIES_COLORS[di])} />
        {/* gridlines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yToPx(t)} y2={yToPx(t)} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={PAD.left - 8} y={yToPx(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
              {formatTick(t)}
            </text>
          </g>
        ))}

        {/* x labels */}
        {spec.labels.map((label, i) => (
          <text key={i} x={PAD.left + bandW * (i + 0.5)} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
            {label}
          </text>
        ))}

        {spec.type === 'bar' ? (
          datasets.map((d, di) => {
            const groupW = Math.min(24, (bandW * 0.7) / datasets.length)
            const gap = 2
            const totalW = groupW * datasets.length + gap * (datasets.length - 1)
            return d.data.map((v, li) => {
              const x = PAD.left + bandW * li + (bandW - totalW) / 2 + di * (groupW + gap)
              const yTop = yToPx(Math.max(v, 0))
              const yBottom = yToPx(Math.min(v, 0))
              const top = v >= 0 ? yTop : baselinePx
              const base = v >= 0 ? baselinePx : yBottom
              return (
                <path
                  key={`${di}-${li}`}
                  d={barPath(x, top, groupW, base)}
                  fill={SERIES_COLORS[di]}
                  filter={`url(#chart-glow-${di})`}
                  onMouseEnter={e => {
                    const r = (e.target as SVGElement).getBoundingClientRect()
                    const parent = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
                    setTip({ x: r.left + r.width / 2 - parent.left, y: r.top - parent.top, text: `${d.label ?? ''} · ${spec.labels[li]}: ${formatTick(v)}` })
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              )
            })
          })
        ) : (
          datasets.map((d, di) => {
            const points = d.data.map((v, li) => [PAD.left + bandW * (li + 0.5), yToPx(v)] as const)
            const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
            const areaPath = spec.type === 'area'
              ? `${linePath} L${points[points.length - 1][0]},${baselinePx} L${points[0][0]},${baselinePx} Z`
              : null
            return (
              <g key={di}>
                {areaPath && <path d={areaPath} fill={SERIES_COLORS[di]} opacity={0.1} stroke="none" />}
                <path d={linePath} fill="none" stroke={SERIES_COLORS[di]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" filter={`url(#chart-glow-${di})`} />
                {points.map(([x, y], li) => (
                  <circle
                    key={li}
                    cx={x} cy={y} r={4}
                    fill={SERIES_COLORS[di]}
                    stroke="hsl(var(--panel))"
                    strokeWidth={2}
                    onMouseEnter={e => {
                      const parent = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
                      setTip({ x: x * (parent.width / W) + parent.left - parent.left, y: y * (parent.height / H), text: `${d.label ?? ''} · ${spec.labels[li]}: ${formatTick(d.data[li])}` })
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
                ))}
              </g>
            )
          })
        )}
      </svg>
      <TooltipLayer tip={tip} />
    </div>
  )
}

function PieChart({ spec, donut }: { spec: ChartSpec; donut: boolean }) {
  const size = 220
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4
  const innerR = donut ? r * 0.6 : 0
  const [tip, setTip] = useState<Tooltip>(null)

  const data = spec.datasets[0]?.data ?? []
  const total = data.reduce((a, b) => a + b, 0) || 1

  let angle = -Math.PI / 2
  const slices = data.map((v, i) => {
    const frac = v / total
    const start = angle
    const end = angle + frac * Math.PI * 2
    angle = end
    return { start, end, frac, v, color: SERIES_COLORS[i % MAX_SERIES], label: spec.labels[i] ?? '' }
  })

  const arcPoint = (a: number, radius: number) => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const

  return (
    <div className="relative not-prose flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={spec.title ?? 'pie chart'}>
        <ChartDefs ids={slices.map(s => s.color)} />
        {slices.map((s, i) => {
          const [x1, y1] = arcPoint(s.start, r)
          const [x2, y2] = arcPoint(s.end, r)
          const large = s.end - s.start > Math.PI ? 1 : 0
          const d = innerR > 0
            ? (() => {
                const [ix1, iy1] = arcPoint(s.end, innerR)
                const [ix2, iy2] = arcPoint(s.start, innerR)
                return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${large} 0 ${ix2},${iy2} Z`
              })()
            : `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`
          const mid = (s.start + s.end) / 2
          const [lx, ly] = arcPoint(mid, r * 0.72)
          return (
            <g key={i}>
              <path
                d={d}
                fill={s.color}
                stroke="hsl(var(--panel))"
                strokeWidth={2}
                onMouseEnter={e => {
                  const parent = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
                  setTip({ x: lx * (parent.width / size), y: ly * (parent.height / size), text: `${s.label}: ${formatTick(s.v)} (${Math.round(s.frac * 100)}%)` })
                }}
                onMouseLeave={() => setTip(null)}
              />
              {s.frac >= 0.08 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: '#fff', fontWeight: 600 }}>
                  {Math.round(s.frac * 100)}%
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <TooltipLayer tip={tip} />
    </div>
  )
}

interface EditMenuProps {
  onEditAsText?: () => void
  onEditWithDialog?: () => void
  className: string
}

/** Hover-revealed "Edit source" button — offers raw-markdown editing and the
 *  visual chart-builder dialog, since either can be more convenient depending
 *  on the change (a typo in a label vs. reshaping the whole data grid). */
function EditSourceMenu({ onEditAsText, onEditWithDialog, className }: EditMenuProps) {
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  if (!onEditAsText && !onEditWithDialog) return null

  return (
    <>
      <button
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenuAnchor({ x: r.left, y: r.bottom + 4 })
        }}
        title="Edit chart source"
        className={className}
      >
        <Code2 className="w-3 h-3" /> Edit source
      </button>
      {menuAnchor && (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          onClose={() => setMenuAnchor(null)}
          items={[
            ...(onEditWithDialog ? [{ label: 'Edit with chart builder', onClick: onEditWithDialog }] : []),
            ...(onEditAsText ? [{ label: 'Edit as Markdown', onClick: onEditAsText }] : []),
          ]}
        />
      )}
    </>
  )
}

interface MarkdownChartProps {
  spec: string
  /** Reveals the raw ```chart source in place, editable directly. */
  onEditAsText?: () => void
  /** Reopens the chart-builder dialog, pre-filled with this block's current data. */
  onEditWithDialog?: () => void
  /**
   * Drops the outer vertical margin. Used when mounted as a CodeMirror block
   * widget (ChartWidget) — the widget's own wrapper element supplies that
   * spacing as padding instead, since a *child's* CSS margin never counts
   * toward the parent's own measured height (it just collapses through),
   * which left CodeMirror's line-height accounting short by that margin and
   * misplaced clicks/cursor navigation on every line after the widget.
   */
  bare?: boolean
}

export function MarkdownChart({ spec: raw, onEditAsText, onEditWithDialog, bare }: MarkdownChartProps) {
  const [showTable, setShowTable] = useState(false)
  const parsed = useMemo(() => {
    try {
      return { spec: parseSpec(raw), error: null as string | null }
    } catch (e) {
      return { spec: null, error: e instanceof Error ? e.message : 'Invalid chart spec' }
    }
  }, [raw])

  if (parsed.error || !parsed.spec) {
    return (
      <div className={cn('group relative not-prose text-[13px] text-destructive border border-destructive/30 bg-destructive/5 rounded-lg px-3 py-2', !bare && 'my-3')}>
        Chart error: {parsed.error}
        <EditSourceMenu
          onEditAsText={onEditAsText}
          onEditWithDialog={onEditWithDialog}
          className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] px-2 py-1 rounded-md bg-panel border border-border text-muted-foreground hover:text-foreground"
        />
      </div>
    )
  }

  const spec = parsed.spec
  const isPie = spec.type === 'pie' || spec.type === 'donut'
  const legendItems = isPie
    ? spec.labels.map((label, i) => ({ label, color: SERIES_COLORS[i % MAX_SERIES] }))
    : spec.datasets.map((d, i) => ({ label: d.label ?? `Series ${i + 1}`, color: SERIES_COLORS[i % MAX_SERIES] }))

  return (
    <div className={cn('group relative not-prose border border-border/50 rounded-lg p-4 bg-surface/30', !bare && 'my-4')}>
      <EditSourceMenu
        onEditAsText={onEditAsText}
        onEditWithDialog={onEditWithDialog}
        className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] px-2 py-1 rounded-md bg-panel border border-border text-muted-foreground hover:text-foreground"
      />
      {spec.title && <div className="text-[13px] font-medium text-foreground mb-3 text-center">{spec.title}</div>}
      {isPie
        ? <PieChart spec={spec} donut={spec.type === 'donut'} />
        : <CartesianChart spec={spec} />}
      <Legend items={legendItems} />
      <div className="flex justify-center mt-2">
        <button
          onClick={() => setShowTable(v => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTable ? 'Hide data table' : 'Show data table'}
        </button>
      </div>
      {showTable && <DataTable spec={spec} />}
    </div>
  )
}
