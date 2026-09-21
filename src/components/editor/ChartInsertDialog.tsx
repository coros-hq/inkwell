import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BarChart3, X, Plus, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { useEditorViewRef } from './EditorViewContext'
import { parseSpec, type ChartType } from './MarkdownChart'

const TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
]

const MAX_SERIES = 8
const MAX_ROWS = 30

function defaultState() {
  return {
    title: '',
    type: 'bar' as ChartType,
    categories: ['Mon', 'Tue', 'Wed'],
    seriesLabels: ['Series 1'],
    data: [[10, 20, 15]] as number[][],
  }
}

/** Inverse of handleInsert's spec-building — hydrates the form from an
 *  existing block's parsed spec, so "Edit with chart builder" opens with
 *  that block's current data instead of the blank defaults. */
function stateFromSpec(spec: ReturnType<typeof parseSpec>) {
  const categories = spec.labels.length > 0 ? [...spec.labels] : ['Row 1']
  const isPie = spec.type === 'pie' || spec.type === 'donut'
  const datasets = spec.datasets.length > 0 ? spec.datasets : [{ data: categories.map(() => 0) }]
  return {
    title: spec.title ?? '',
    type: spec.type,
    categories,
    seriesLabels: isPie ? ['Value'] : datasets.map((d, i) => d.label ?? `Series ${i + 1}`),
    data: datasets.map(d => categories.map((_, i) => d.data[i] ?? 0)),
  }
}

export function ChartInsertDialog() {
  const chartInsertRequest = useAppStore(s => s.chartInsertRequest)
  const closeChartInsertDialog = useAppStore(s => s.closeChartInsertDialog)
  const viewRef = useEditorViewRef()
  const open = chartInsertRequest !== null

  const [title, setTitle] = useState('')
  const [type, setType] = useState<ChartType>('bar')
  const [categories, setCategories] = useState<string[]>([])
  const [seriesLabels, setSeriesLabels] = useState<string[]>([])
  const [data, setData] = useState<number[][]>([])

  useEffect(() => {
    if (!chartInsertRequest) return
    const d = chartInsertRequest.mode === 'edit'
      ? (() => {
          try { return stateFromSpec(parseSpec(chartInsertRequest.spec)) }
          catch { return defaultState() }
        })()
      : defaultState()
    setTitle(d.title)
    setType(d.type)
    setCategories(d.categories)
    setSeriesLabels(d.seriesLabels)
    setData(d.data)
  }, [chartInsertRequest])

  const isPie = type === 'pie' || type === 'donut'

  const addRow = () => {
    if (categories.length >= MAX_ROWS) return
    setCategories(c => [...c, ''])
    setData(d => d.map(series => [...series, 0]))
  }
  const removeRow = (i: number) => {
    if (categories.length <= 1) return
    setCategories(c => c.filter((_, idx) => idx !== i))
    setData(d => d.map(series => series.filter((_, idx) => idx !== i)))
  }
  const addSeries = () => {
    if (seriesLabels.length >= MAX_SERIES) return
    setSeriesLabels(s => [...s, `Series ${s.length + 1}`])
    setData(d => [...d, categories.map(() => 0)])
  }
  const removeSeries = (s: number) => {
    if (seriesLabels.length <= 1) return
    setSeriesLabels(labels => labels.filter((_, idx) => idx !== s))
    setData(d => d.filter((_, idx) => idx !== s))
  }

  const handleInsert = () => {
    const view = viewRef.current
    if (!view || !chartInsertRequest) { closeChartInsertDialog(); return }

    const labels = categories.map((c, i) => c.trim() || `Row ${i + 1}`)
    const datasets = isPie
      ? [{ data: data[0] ?? [] }]
      : seriesLabels.map((label, s) => ({ label, data: data[s] ?? [] }))

    const spec: Record<string, unknown> = { type, labels, datasets }
    if (title.trim()) spec.title = title.trim()
    const specText = JSON.stringify(spec, null, 2)

    if (chartInsertRequest.mode === 'edit') {
      const { from, to } = chartInsertRequest
      const block = '```chart\n' + specText + '\n```'
      // No explicit selection here: the dialog only opens from a button on an
      // already-rendered (i.e. already non-overlapping) chart widget, so the
      // current selection is guaranteed to sit outside this range already —
      // CodeMirror maps it through the change automatically. Placing an
      // explicit cursor at `from + block.length` instead landed exactly on
      // the block's own boundary, which counts as "inside" it, reverting the
      // freshly-saved chart back to raw source instead of rendering it.
      view.dispatch({ changes: { from, to, insert: block } })
    } else {
      const { pos } = chartInsertRequest
      const block = '```chart\n' + specText + '\n```\n'
      view.dispatch({
        changes: { from: pos, to: pos, insert: block },
        selection: { anchor: pos + block.length },
      })
    }
    view.focus()
    closeChartInsertDialog()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) closeChartInsertDialog() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[600px] max-h-[85vh] bg-panel border border-border rounded-xl shadow-2xl',
            'flex flex-col overflow-hidden focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-foreground" />
              <Dialog.Title className="text-sm font-semibold text-foreground">
                {chartInsertRequest?.mode === 'edit' ? 'Edit Chart' : 'Insert Chart'}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto flex-1">
            <div className="p-5 space-y-4">

              {/* Chart type */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Chart type</label>
                <div className="flex gap-1.5">
                  {TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setType(opt.value)}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        type === opt.value
                          ? 'bg-accent text-white border-accent'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-accent/50',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Title (optional)</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Weekly Sales"
                  className="w-full px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-foreground placeholder:text-tertiary focus:outline-none focus:border-accent/50"
                />
              </div>

              {/* Data grid */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Data</label>
                  {!isPie && (
                    <button
                      onClick={addSeries}
                      disabled={seriesLabels.length >= MAX_SERIES}
                      className="flex items-center gap-1 text-[11px] text-accent hover:opacity-80 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Plus className="w-3 h-3" /> Series
                    </button>
                  )}
                </div>

                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-surface/60">
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-[30%]">Label</th>
                        {(isPie ? [seriesLabels[0] ?? 'Value'] : seriesLabels).map((label, s) => (
                          <th key={s} className="px-2 py-1 font-medium">
                            <div className="flex items-center gap-1">
                              <input
                                value={isPie ? 'Value' : label}
                                disabled={isPie}
                                onChange={e => setSeriesLabels(ls => ls.map((l, idx) => idx === s ? e.target.value : l))}
                                className="w-full min-w-0 px-1.5 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-accent/50 focus:outline-none text-foreground disabled:text-muted-foreground"
                              />
                              {!isPie && seriesLabels.length > 1 && (
                                <button onClick={() => removeSeries(s)} className="shrink-0 text-muted-foreground hover:text-destructive">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((cat, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-b-0">
                          <td className="px-2 py-1">
                            <input
                              value={cat}
                              placeholder={`Row ${i + 1}`}
                              onChange={e => setCategories(c => c.map((v, idx) => idx === i ? e.target.value : v))}
                              className="w-full min-w-0 px-1.5 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-accent/50 focus:outline-none text-foreground placeholder:text-tertiary"
                            />
                          </td>
                          {(isPie ? [data[0]?.[i] ?? 0] : data.map(series => series[i] ?? 0)).map((val, s) => (
                            <td key={s} className="px-2 py-1">
                              <input
                                type="number"
                                value={val}
                                onChange={e => {
                                  const n = e.target.value === '' ? 0 : Number(e.target.value)
                                  setData(d => d.map((series, sIdx) => sIdx === s ? series.map((v, idx) => idx === i ? n : v) : series))
                                }}
                                className="w-full min-w-0 px-1.5 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-accent/50 focus:outline-none text-foreground"
                              />
                            </td>
                          ))}
                          <td className="px-1">
                            {categories.length > 1 && (
                              <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={addRow}
                  disabled={categories.length >= MAX_ROWS}
                  className="flex items-center gap-1 text-[11px] text-accent hover:opacity-80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Plus className="w-3 h-3" /> Row
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Dialog.Close asChild>
                  <button className="flex-1 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleInsert}
                  className="flex-1 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 transition-colors"
                >
                  {chartInsertRequest?.mode === 'edit' ? 'Save Changes' : 'Insert Chart'}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
