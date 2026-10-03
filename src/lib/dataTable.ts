import { nanoid } from 'nanoid'

// ```table fenced blocks hold a small JSON spec — user-defined columns (each
// with a type) and rows of cell values, Notion-database style:
//
//   ```table
//   {
//     "title": "Reading list",
//     "columns": [
//       { "id": "c1", "name": "Title", "type": "text" },
//       { "id": "c2", "name": "Status", "type": "select",
//         "options": [{ "id": "o1", "label": "Reading", "color": "blue" }] }
//     ],
//     "rows": [
//       { "id": "r1", "cells": { "c1": "Dune", "c2": "o1" } }
//     ]
//   }
//   ```
//
// Select cells store the option id, so renaming an option updates every row.

export type ColumnType = 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'url'

export const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]

export interface SelectOption { id: string; label: string; color: string }
export type CellValue = string | number | boolean | null

export interface TableColumn {
  id: string
  name: string
  type: ColumnType
  width?: number
  options?: SelectOption[]
}

export interface TableRow {
  id: string
  cells: Record<string, CellValue>
}

export interface TableSpec {
  title?: string
  columns: TableColumn[]
  rows: TableRow[]
}

export const newId = () => nanoid(6)

const TYPE_SET = new Set<string>(COLUMN_TYPES.map(t => t.value))

export function parseTableSpec(raw: string): { spec: TableSpec } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid JSON' }
  }
  if (!data || typeof data !== 'object') return { error: 'Table spec must be an object' }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.columns)) return { error: 'Missing "columns" array' }

  const seen = new Set<string>()
  const uniq = (id: unknown) => {
    let out = typeof id === 'string' && id && !seen.has(id) ? id : newId()
    while (seen.has(out)) out = newId()
    seen.add(out)
    return out
  }

  const columns: TableColumn[] = obj.columns.map((c, i) => {
    const col = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    const type = TYPE_SET.has(col.type as string) ? (col.type as ColumnType) : 'text'
    const out: TableColumn = {
      id: uniq(col.id),
      name: typeof col.name === 'string' ? col.name : `Column ${i + 1}`,
      type,
    }
    if (typeof col.width === 'number') out.width = col.width
    if (type === 'select') {
      const opts = Array.isArray(col.options) ? col.options : []
      out.options = opts.map(o => {
        const opt = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        return {
          id: typeof opt.id === 'string' && opt.id ? opt.id : newId(),
          label: typeof opt.label === 'string' ? opt.label : '',
          color: typeof opt.color === 'string' ? opt.color : 'gray',
        }
      })
    }
    return out
  })

  const rowsIn = Array.isArray(obj.rows) ? obj.rows : []
  const rowIds = new Set<string>()
  const rows: TableRow[] = rowsIn.map(r => {
    const row = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    let id = typeof row.id === 'string' && row.id && !rowIds.has(row.id) ? row.id : newId()
    while (rowIds.has(id)) id = newId()
    rowIds.add(id)
    const cells = (row.cells && typeof row.cells === 'object' ? row.cells : {}) as Record<string, CellValue>
    return { id, cells }
  })

  const spec: TableSpec = { columns, rows }
  if (typeof obj.title === 'string' && obj.title) spec.title = obj.title
  return { spec }
}

// Pretty enough to diff and hand-edit: one column / row per line.
export function serializeTableSpec(spec: TableSpec): string {
  const lines: string[] = ['{']
  if (spec.title) lines.push(`  "title": ${JSON.stringify(spec.title)},`)
  lines.push('  "columns": [')
  lines.push(spec.columns.map(c => '    ' + JSON.stringify(c)).join(',\n'))
  lines.push('  ],')
  lines.push('  "rows": [')
  lines.push(spec.rows.map(r => '    ' + JSON.stringify(r)).join(',\n'))
  lines.push('  ]')
  lines.push('}')
  return lines.filter((l, i) => !(l === '' && lines[i - 1]?.endsWith('['))).join('\n')
}

export function tableBlock(spec: TableSpec): string {
  return '```table\n' + serializeTableSpec(spec) + '\n```'
}

export function defaultTableSpec(): TableSpec {
  const status: SelectOption[] = [
    { id: newId(), label: 'To do', color: 'gray' },
    { id: newId(), label: 'In progress', color: 'blue' },
    { id: newId(), label: 'Done', color: 'green' },
  ]
  const [name, stat, date] = [newId(), newId(), newId()]
  return {
    columns: [
      { id: name, name: 'Name', type: 'text' },
      { id: stat, name: 'Status', type: 'select', options: status },
      { id: date, name: 'Date', type: 'date' },
    ],
    rows: [1, 2, 3].map(() => ({ id: newId(), cells: {} })),
  }
}

export function cellDisplay(col: TableColumn, v: CellValue | undefined): string {
  if (v === null || v === undefined) return ''
  if (col.type === 'select') return col.options?.find(o => o.id === v)?.label ?? ''
  return String(v)
}

/** Compare two cells of the same column for sorting; empty values sort last. */
export function compareCells(col: TableColumn, a: CellValue | undefined, b: CellValue | undefined): number {
  const ea = a === null || a === undefined || a === ''
  const eb = b === null || b === undefined || b === ''
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  if (col.type === 'number') return Number(a) - Number(b)
  if (col.type === 'checkbox') return Number(!!a) - Number(!!b)
  return cellDisplay(col, a).localeCompare(cellDisplay(col, b), undefined, { numeric: true, sensitivity: 'base' })
}
