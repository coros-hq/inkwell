import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileImage, FolderOpen, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useDrawingsStore } from '../../store/useDrawingsStore'
import type { DrawingMeta } from '../../lib/drawings'
import type { Folder } from '../../types'
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu'
import { TagPopover } from '../shared/TagPicker'
import { cn } from '../../lib/utils'

interface Props {
  /** Called after the drawing has been made active; the parent opens the export dialog once it is loaded. */
  onExport: (id: string) => void
}

const UNFILED = '__unfiled__'

function flattenFolders(folders: Folder[], out: Folder[] = []): Folder[] {
  for (const f of folders) { out.push(f); flattenFolders(f.children, out) }
  return out
}

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? p

function formatDate(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

type Menu =
  | { kind: 'actions'; id: string; x: number; y: number }
  | { kind: 'folders'; id: string; x: number; y: number }
  | { kind: 'tags'; id: string; x: number; y: number }

export function DrawingsPanel({ onExport }: Props) {
  const drawings = useDrawingsStore(s => s.drawings)
  const activeId = useDrawingsStore(s => s.activeId)
  const { setActive, create, rename, remove, duplicate, setFolder, setTag } = useDrawingsStore.getState()

  const vaultPath = useAppStore(s => s.vaultPath)
  const folders = useAppStore(s => s.folders)
  const tagDefs = useAppStore(s => s.tagDefs)
  const openConfirm = useAppStore(s => s.openConfirm)

  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const flatFolders = useMemo(() => flattenFolders(folders), [folders])
  const folderName = (path: string) => flatFolders.find(f => f.path === path)?.name ?? basename(path)
  const folderKnown = (path: string) => flatFolders.some(f => f.path === path)

  const allTags = useMemo(() => [...new Set(drawings.flatMap(d => d.tags))].sort(), [drawings])
  const tagColor = (t: string) => tagDefs.find(d => d.name === t)?.color ?? 'hsl(var(--accent))'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return drawings.filter(d =>
      (!q || d.title.toLowerCase().includes(q) || d.tags.some(t => t.toLowerCase().includes(q)))
      && (!tagFilter || d.tags.includes(tagFilter)))
  }, [drawings, query, tagFilter])

  const groups = useMemo(() => {
    const map = new Map<string, DrawingMeta[]>()
    for (const d of filtered) {
      const key = d.folderPath ?? UNFILED
      map.set(key, [...(map.get(key) ?? []), d])
    }
    // Unfiled first, then folders by name.
    return [...map.entries()].sort(([a], [b]) =>
      a === UNFILED ? -1 : b === UNFILED ? 1 : folderName(a).localeCompare(folderName(b)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, flatFolders])

  const startRename = (id: string) => {
    setRenamingId(id)
    requestAnimationFrame(() => renameRef.current?.select())
  }

  const confirmDelete = (d: DrawingMeta) =>
    openConfirm({
      title: `Delete “${d.title}”?`,
      description: 'This drawing and its notes will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => remove(d.id),
    })

  const menuDrawing = menu ? drawings.find(d => d.id === menu.id) : undefined

  const actionItems = (d: DrawingMeta, x: number, y: number): ContextMenuItem[] => [
    { label: 'Rename', onClick: () => startRename(d.id) },
    { label: 'Tags…', onClick: () => setMenu({ kind: 'tags', id: d.id, x, y }) },
    { label: 'Move to folder…', onClick: () => setMenu({ kind: 'folders', id: d.id, x, y }) },
    { label: 'Export…', onClick: () => { setActive(d.id); onExport(d.id) } },
    { label: 'Duplicate', onClick: () => void duplicate(d.id) },
    { label: 'Delete', destructive: true, separator: true, onClick: () => confirmDelete(d) },
  ]

  const folderItems = (d: DrawingMeta): ContextMenuItem[] => {
    const rel = (p: string) => (vaultPath && p.startsWith(vaultPath) ? p.slice(vaultPath.length).replace(/^\//, '') : p)
    const items: ContextMenuItem[] = [{ label: 'No folder', checked: d.folderPath === null, onClick: () => setFolder(d.id, null) }]
    for (const f of flatFolders) {
      items.push({ label: rel(f.path), checked: d.folderPath === f.path, onClick: () => setFolder(d.id, f.path) })
    }
    return items
  }

  return (
    <div className="w-56 shrink-0 h-full flex flex-col border-r border-border bg-panel/60 select-none">
      <div className="flex items-center justify-between px-3 pt-9 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Drawings</span>
        <button
          type="button"
          title="New drawing"
          onClick={() => { const id = create('Untitled drawing'); startRename(id) }}
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search drawings…"
            className="w-full h-7 pl-7 pr-2 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {allTags.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTagFilter(f => (f === t ? null : t))}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] transition-colors',
                  tagFilter === t ? 'bg-active text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-surface',
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tagColor(t) }} />
                {t}
                {tagFilter === t && <X className="w-2.5 h-2.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">No drawings match.</p>
        )}
        {groups.map(([key, items]) => {
          const isOpen = !collapsed.has(key)
          const showHeader = groups.length > 1 || key !== UNFILED
          return (
            <div key={key} className="mb-1">
              {showHeader && (
                <button
                  type="button"
                  onClick={() => setCollapsed(c => { const n = new Set(c); if (isOpen) n.add(key); else n.delete(key); return n })}
                  className="w-full flex items-center gap-1 px-1.5 h-6 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  title={key === UNFILED ? undefined : key}
                >
                  {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                  <FolderOpen className="w-3 h-3 shrink-0" />
                  <span className={cn('truncate', key !== UNFILED && !folderKnown(key) && 'italic opacity-70')}>
                    {key === UNFILED ? 'Unfiled' : folderName(key)}
                  </span>
                  <span className="ml-auto text-[10px] opacity-60">{items.length}</span>
                </button>
              )}
              {isOpen && items.map(d => (
                <div
                  key={d.id}
                  onClick={() => d.id !== activeId && setActive(d.id)}
                  onDoubleClick={() => startRename(d.id)}
                  onContextMenu={e => { e.preventDefault(); setMenu({ kind: 'actions', id: d.id, x: e.clientX, y: e.clientY }) }}
                  className={cn(
                    'group flex flex-col gap-0.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
                    showHeader && 'ml-3',
                    d.id === activeId ? 'bg-active' : 'hover:bg-surface',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <FileImage className={cn('w-3.5 h-3.5 shrink-0', d.id === activeId ? 'text-accent' : 'text-muted-foreground')} />
                    {renamingId === d.id ? (
                      <input
                        ref={renameRef}
                        defaultValue={d.title}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        onBlur={e => { rename(d.id, e.target.value); setRenamingId(null) }}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 min-w-0 h-5 px-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 truncate text-xs text-foreground">{d.title}</span>
                    )}
                    <button
                      type="button"
                      title="Actions"
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: 'actions', id: d.id, x: r.left, y: r.bottom + 2 }) }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 pl-5 min-h-[14px]">
                    {d.tags.slice(0, 4).map(t => (
                      <span key={t} title={t} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tagColor(t) }} />
                        {d.tags.length <= 2 ? t : ''}
                      </span>
                    ))}
                    <span className="ml-auto text-[10px] text-muted-foreground/70">{formatDate(d.updatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {menu?.kind === 'actions' && menuDrawing && (
        <ContextMenu x={menu.x} y={menu.y} items={actionItems(menuDrawing, menu.x, menu.y)} onClose={() => setMenu(m => (m?.kind === 'actions' ? null : m))} />
      )}
      {menu?.kind === 'folders' && menuDrawing && (
        <ContextMenu x={menu.x} y={menu.y} items={folderItems(menuDrawing)} onClose={() => setMenu(null)} />
      )}
      {menu?.kind === 'tags' && menuDrawing && (
        <TagPopover
          x={menu.x} y={menu.y}
          isOn={t => menuDrawing.tags.includes(t)}
          onToggle={(t, on) => setTag(menuDrawing.id, t, on)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
