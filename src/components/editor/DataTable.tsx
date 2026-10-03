import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownAZ, ArrowUpAZ, ArrowLeft, ArrowRight, Check, Code2, Plus, Trash2, X,
  Type, Hash, ListFilter, CheckSquare, Calendar, Link2,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { PALETTE, chipStyle } from '../../lib/palette'
import {
  COLUMN_TYPES, compareCells, newId, parseTableSpec, serializeTableSpec,
  type CellValue, type ColumnType, type TableColumn, type TableSpec,
} from '../../lib/dataTable'

// Interactive, Notion-style table rendered from a ```table block. The spec
// string is the source of truth: every committed edit serializes the new spec
// and hands it to `onChange` (the editor writes it back into the document).
// Without `onChange` the table is read-only (export, no owning note).

interface DataTableProps {
  spec: string
  onChange?: (next: string) => void
  onEditAsText?: () => void
}

const TYPE_ICONS: Record<ColumnType, typeof Type> = {
  text: Type, number: Hash, select: ListFilter, checkbox: CheckSquare, date: Calendar, url: Link2,
}

const DEFAULT_COL_WIDTH = 180
const MIN_COL_WIDTH = 80

// ── Popover ────────────────────────────────────────────────────────────────
// Portaled to <body> so it escapes the table's horizontal-scroll container
// (and the CodeMirror widget DOM when rendered inside the editor).

function Popover({ anchor, onClose, children, width = 220 }: {
  anchor: HTMLElement
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const h = ref.current?.offsetHeight ?? 0
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    setPos({ top, left })
  }, [anchor, width])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, zIndex: 100 }}
      className="bg-card border border-border rounded-lg shadow-lg shadow-black/10 p-1 text-[13px] text-foreground font-sans"
    >
      {children}
    </div>,
    document.body,
  )
}

function MenuItem({ icon: Icon, children, onClick, danger, active }: {
  icon?: typeof Type
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-active transition-colors',
        danger && 'text-destructive',
        active && 'bg-active',
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">{children}</span>
      {active && <Check className="w-3.5 h-3.5 text-accent" />}
    </button>
  )
}

// ── Cells ──────────────────────────────────────────────────────────────────

/** Text-like input that commits on blur / Enter and reverts on Escape, so the
 *  document (and the widget hosting this table) isn't rewritten per keystroke. */
function CommitInput({ value, onCommit, type = 'text', align, placeholder, disabled }: {
  value: string
  onCommit: (v: string) => void
  type?: string
  align?: 'right'
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft !== value) onCommit(draft) }
  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
        e.stopPropagation()
      }}
      className={cn(
        'w-full h-full bg-transparent outline-none px-2.5 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:bg-active/60',
        align === 'right' && 'text-right tabular-nums',
        disabled && 'cursor-default',
      )}
    />
  )
}

function SelectCell({ column, value, readOnly, onChange, onUpdateColumn }: {
  column: TableColumn
  value: CellValue | undefined
  readOnly: boolean
  onChange: (v: CellValue) => void
  onUpdateColumn: (c: TableColumn) => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const options = column.options ?? []
  const current = options.find(o => o.id === value)
  const close = useCallback(() => { setOpen(false); setQuery('') }, [])

  const q = query.trim()
  const filtered = options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
  const exact = options.some(o => o.label.toLowerCase() === q.toLowerCase())

  const create = () => {
    if (!q || exact) return
    const opt = { id: newId(), label: q, color: PALETTE[1 + (options.length % (PALETTE.length - 1))].name }
    onUpdateColumn({ ...column, options: [...options, opt] })
    onChange(opt.id)
    close()
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={readOnly}
        onClick={() => setOpen(o => !o)}
        className="w-full h-full min-h-[38px] px-2.5 py-1.5 flex items-center text-left hover:bg-active/60 disabled:hover:bg-transparent disabled:cursor-default"
      >
        {current && (
          <span className="px-2 py-0.5 rounded text-[12.5px] font-medium truncate" style={chipStyle(current.color)}>
            {current.label}
          </span>
        )}
      </button>
      {open && btnRef.current && (
        <Popover anchor={btnRef.current} onClose={close}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (filtered.length && !exact && !q) return
                if (exact) {
                  const hit = options.find(o => o.label.toLowerCase() === q.toLowerCase())!
                  onChange(hit.id); close()
                } else create()
              }
              e.stopPropagation()
            }}
            placeholder="Search or create an option…"
            className="w-full bg-transparent outline-none px-2 py-1.5 mb-1 border-b border-border placeholder:text-muted-foreground/50"
          />
          <div className="max-h-56 overflow-y-auto">
            {filtered.map(o => (
              <div key={o.id} className="group flex items-center gap-1 rounded-md hover:bg-active px-1">
                <button
                  type="button"
                  onClick={() => { onChange(o.id); close() }}
                  className="flex-1 flex items-center py-1.5 px-1 text-left min-w-0"
                >
                  <span className="px-2 py-0.5 rounded text-[12.5px] font-medium truncate" style={chipStyle(o.color)}>{o.label}</span>
                </button>
                <OptionColorButton
                  color={o.color}
                  onPick={color => onUpdateColumn({ ...column, options: options.map(x => x.id === o.id ? { ...x, color } : x) })}
                  onDelete={() => onUpdateColumn({ ...column, options: options.filter(x => x.id !== o.id) })}
                />
              </div>
            ))}
            {q && !exact && (
              <MenuItem icon={Plus} onClick={create}>Create “{q}”</MenuItem>
            )}
            {!filtered.length && !q && (
              <div className="px-2 py-1.5 text-muted-foreground">Type to create an option</div>
            )}
          </div>
          {current && (
            <div className="border-t border-border mt-1 pt-1">
              <MenuItem icon={X} onClick={() => { onChange(null); close() }}>Clear</MenuItem>
            </div>
          )}
        </Popover>
      )}
    </>
  )
}

function OptionColorButton({ color, onPick, onDelete }: {
  color: string
  onPick: (c: string) => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button
        ref={ref}
        type="button"
        title="Option color"
        onClick={() => setOpen(o => !o)}
        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:bg-border/60"
      >
        <span className="w-3 h-3 rounded-full" style={{ background: PALETTE.find(c => c.name === color)?.hex }} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} onClose={close} width={180}>
          <div className="grid grid-cols-4 gap-1 p-1">
            {PALETTE.map(c => (
              <button
                key={c.name}
                type="button"
                title={c.label}
                onClick={() => { onPick(c.name); close() }}
                className={cn('w-8 h-8 rounded-md flex items-center justify-center hover:ring-2 ring-border', c.name === color && 'ring-2 ring-accent')}
              >
                <span className="w-4 h-4 rounded-full" style={{ background: c.hex }} />
              </button>
            ))}
          </div>
          <div className="border-t border-border mt-1 pt-1">
            <MenuItem icon={Trash2} danger onClick={() => { onDelete(); close() }}>Delete option</MenuItem>
          </div>
        </Popover>
      )}
    </>
  )
}

// ── Column header ──────────────────────────────────────────────────────────

function ColumnHeader({ column, index, count, readOnly, onUpdate, onDelete, onMove, onSort, onResize }: {
  column: TableColumn
  index: number
  count: number
  readOnly: boolean
  onUpdate: (c: TableColumn) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onSort: (dir: 1 | -1) => void
  onResize: (w: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const Icon = TYPE_ICONS[column.type]

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const th = ref.current?.parentElement
    if (!th) return
    const startX = e.clientX
    const startW = th.getBoundingClientRect().width
    const move = (ev: PointerEvent) => {
      th.style.width = `${Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX)}px`
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onResize(Math.round(Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} className="relative h-full">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen(o => !o)}
        className="w-full h-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[12px] font-medium text-muted-foreground hover:bg-active/60 disabled:hover:bg-transparent disabled:cursor-default"
      >
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="truncate">{column.name || 'Untitled'}</span>
      </button>
      {!readOnly && (
        <div
          onPointerDown={startResize}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-accent/40"
        />
      )}
      {open && ref.current && (
        <Popover anchor={ref.current} onClose={close} width={230}>
          <input
            autoFocus
            defaultValue={column.name}
            onBlur={e => { if (e.target.value !== column.name) onUpdate({ ...column, name: e.target.value }) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); close() }
              e.stopPropagation()
            }}
            className="w-full bg-transparent outline-none px-2 py-1.5 mb-1 border-b border-border font-medium"
          />
          <div className="px-2 pt-1 pb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Type</div>
          {COLUMN_TYPES.map(t => (
            <MenuItem
              key={t.value}
              icon={TYPE_ICONS[t.value]}
              active={t.value === column.type}
              onClick={() => {
                if (t.value === column.type) return
                onUpdate({
                  ...column,
                  type: t.value,
                  options: t.value === 'select' ? (column.options ?? []) : undefined,
                })
              }}
            >
              {t.label}
            </MenuItem>
          ))}
          <div className="border-t border-border my-1" />
          <MenuItem icon={ArrowUpAZ} onClick={() => { onSort(1); close() }}>Sort ascending</MenuItem>
          <MenuItem icon={ArrowDownAZ} onClick={() => { onSort(-1); close() }}>Sort descending</MenuItem>
          {index > 0 && <MenuItem icon={ArrowLeft} onClick={() => { onMove(-1); close() }}>Move left</MenuItem>}
          {index < count - 1 && <MenuItem icon={ArrowRight} onClick={() => { onMove(1); close() }}>Move right</MenuItem>}
          <div className="border-t border-border my-1" />
          <MenuItem icon={Trash2} danger onClick={() => { onDelete(); close() }}>Delete column</MenuItem>
        </Popover>
      )}
    </div>
  )
}

// ── Table ──────────────────────────────────────────────────────────────────

export function DataTable({ spec: raw, onChange, onEditAsText }: DataTableProps) {
  const readOnly = !onChange
  const parsed = useMemo(() => parseTableSpec(raw), [raw])
  const [spec, setSpec] = useState<TableSpec | null>('spec' in parsed ? parsed.spec : null)
  // Tracks what we last wrote so the echo of our own change coming back down
  // as `raw` doesn't reset local state (and, in the editor, can't loop).
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    if (!('spec' in parsed)) return
    if (lastWritten.current !== null && serializeTableSpec(parsed.spec) === lastWritten.current) return
    setSpec(parsed.spec)
  }, [parsed])

  const commit = useCallback((next: TableSpec) => {
    setSpec(next)
    const text = serializeTableSpec(next)
    lastWritten.current = text
    onChange?.(text)
  }, [onChange])

  if ('error' in parsed && !spec) {
    return (
      <div className="my-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px]">
        <div className="font-medium text-destructive mb-1">Couldn’t read this table</div>
        <div className="text-muted-foreground font-mono text-[12px] mb-2">{parsed.error}</div>
        {onEditAsText && (
          <button type="button" onClick={onEditAsText} className="text-accent hover:underline">Edit as text</button>
        )}
      </div>
    )
  }
  if (!spec) return null

  const setColumn = (c: TableColumn) =>
    commit({ ...spec, columns: spec.columns.map(x => x.id === c.id ? c : x) })

  const setCell = (rowId: string, colId: string, v: CellValue) =>
    commit({ ...spec, rows: spec.rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: v } } : r) })

  const addColumn = () => {
    const n = spec.columns.length + 1
    commit({ ...spec, columns: [...spec.columns, { id: newId(), name: `Column ${n}`, type: 'text' }] })
  }

  const deleteColumn = (id: string) =>
    commit({
      ...spec,
      columns: spec.columns.filter(c => c.id !== id),
      rows: spec.rows.map(r => {
        const { [id]: _drop, ...cells } = r.cells
        return { ...r, cells }
      }),
    })

  const moveColumn = (index: number, dir: -1 | 1) => {
    const cols = [...spec.columns]
    const j = index + dir
    if (j < 0 || j >= cols.length) return
    ;[cols[index], cols[j]] = [cols[j], cols[index]]
    commit({ ...spec, columns: cols })
  }

  const sortBy = (col: TableColumn, dir: 1 | -1) =>
    commit({
      ...spec,
      rows: [...spec.rows].sort((a, b) => {
        const ea = a.cells[col.id] == null || a.cells[col.id] === ''
        const eb = b.cells[col.id] == null || b.cells[col.id] === ''
        // Empty cells stay last in both directions.
        if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
        return dir * compareCells(col, a.cells[col.id], b.cells[col.id])
      }),
    })

  const addRow = () => commit({ ...spec, rows: [...spec.rows, { id: newId(), cells: {} }] })
  const deleteRow = (id: string) => commit({ ...spec, rows: spec.rows.filter(r => r.id !== id) })

  const hasNumbers = spec.columns.some(c => c.type === 'number')

  const renderCell = (col: TableColumn, rowId: string, v: CellValue | undefined) => {
    switch (col.type) {
      case 'checkbox':
        return (
          <div className="h-full min-h-[38px] px-2.5 flex items-center">
            <input
              type="checkbox"
              checked={v === true}
              disabled={readOnly}
              onChange={e => setCell(rowId, col.id, e.target.checked)}
              className="w-[15px] h-[15px] rounded cursor-pointer"
              style={{ accentColor: 'hsl(var(--accent))' }}
            />
          </div>
        )
      case 'select':
        return (
          <SelectCell
            column={col}
            value={v}
            readOnly={readOnly}
            onChange={nv => setCell(rowId, col.id, nv)}
            onUpdateColumn={setColumn}
          />
        )
      case 'number':
        return (
          <CommitInput
            value={v == null ? '' : String(v)}
            align="right"
            disabled={readOnly}
            onCommit={s => {
              const n = Number(s)
              setCell(rowId, col.id, s.trim() === '' ? null : Number.isFinite(n) ? n : null)
            }}
          />
        )
      case 'date':
        return (
          <CommitInput type="date" value={typeof v === 'string' ? v : ''} disabled={readOnly} onCommit={s => setCell(rowId, col.id, s || null)} />
        )
      case 'url': {
        const s = typeof v === 'string' ? v : ''
        return readOnly && s ? (
          <a href={s} target="_blank" rel="noreferrer" className="block px-2.5 py-2 text-[14px] text-accent underline underline-offset-2 truncate">{s}</a>
        ) : (
          <CommitInput value={s} placeholder="https://" disabled={readOnly} onCommit={nv => setCell(rowId, col.id, nv)} />
        )
      }
      default:
        return <CommitInput value={v == null ? '' : String(v)} disabled={readOnly} onCommit={nv => setCell(rowId, col.id, nv)} />
    }
  }

  return (
    <div className="inkwell-data-table group/table my-4 font-sans" data-inkwell-table>
      {(spec.title || !readOnly) && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            {readOnly ? (
              <div className="text-[15px] font-semibold text-foreground">{spec.title}</div>
            ) : (
              <input
                defaultValue={spec.title ?? ''}
                key={spec.title ?? ''}
                placeholder="Untitled table"
                onBlur={e => { if (e.target.value !== (spec.title ?? '')) commit({ ...spec, title: e.target.value || undefined }) }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation() }}
                className="w-full bg-transparent outline-none text-[15px] font-semibold text-foreground placeholder:text-muted-foreground/40"
              />
            )}
          </div>
          {onEditAsText && !readOnly && (
            <button
              type="button"
              title="Edit as text"
              onClick={onEditAsText}
              className="opacity-0 group-hover/table:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded hover:bg-active"
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', minWidth: '100%' }}>
          <colgroup>
            {!readOnly && <col style={{ width: 28 }} />}
            {spec.columns.map(c => <col key={c.id} style={{ width: c.width ?? DEFAULT_COL_WIDTH }} />)}
            {!readOnly && <col style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-surface/40">
              {!readOnly && <th />}
              {spec.columns.map((c, i) => (
                <th key={c.id} className="p-0 font-normal border-r border-border/60 last:border-r-0 align-stretch" style={{ width: c.width ?? DEFAULT_COL_WIDTH }}>
                  <ColumnHeader
                    column={c}
                    index={i}
                    count={spec.columns.length}
                    readOnly={readOnly}
                    onUpdate={setColumn}
                    onDelete={() => deleteColumn(c.id)}
                    onMove={dir => moveColumn(i, dir)}
                    onSort={dir => sortBy(c, dir)}
                    onResize={w => setColumn({ ...c, width: w })}
                  />
                </th>
              ))}
              {!readOnly && (
                <th className="p-0 font-normal">
                  <button
                    type="button"
                    title="Add column"
                    onClick={addColumn}
                    className="w-full h-full min-h-[34px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-active/60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map(row => (
              <tr key={row.id} className="group/row border-b border-border/60 last:border-b-0">
                {!readOnly && (
                  <td className="p-0 align-middle">
                    <button
                      type="button"
                      title="Delete row"
                      onClick={() => deleteRow(row.id)}
                      className="opacity-0 group-hover/row:opacity-100 w-full flex items-center justify-center text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
                {spec.columns.map(c => (
                  <td key={c.id} className="p-0 border-r border-border/60 last:border-r-0 align-middle">
                    {renderCell(c, row.id, row.cells[c.id])}
                  </td>
                ))}
                {!readOnly && <td />}
              </tr>
            ))}
            {!readOnly && (
              <tr>
                <td colSpan={spec.columns.length + 2} className="p-0">
                  <button
                    type="button"
                    onClick={addRow}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-active/60"
                  >
                    <Plus className="w-3.5 h-3.5" /> New row
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          {hasNumbers && spec.rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-surface/40">
                {!readOnly && <td />}
                {spec.columns.map(c => {
                  const sum = c.type === 'number'
                    ? spec.rows.reduce((s, r) => s + (typeof r.cells[c.id] === 'number' ? (r.cells[c.id] as number) : 0), 0)
                    : null
                  return (
                    <td key={c.id} className="px-2.5 py-1.5 text-right text-[12px] text-muted-foreground tabular-nums">
                      {sum !== null && <>Sum <span className="text-foreground">{Math.round(sum * 1e6) / 1e6}</span></>}
                    </td>
                  )
                })}
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
