import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { KanbanSquare, X, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { useEditorViewRef } from './EditorViewContext'

// Picker for "/board", "/task" and the toolbar button. Boards insert as a live
// ```board embed (or a plain board:// link); tasks as a ```task card (or an
// inline task:// link).

export function BoardRefDialog() {
  const request = useAppStore(s => s.boardRefRequest)
  const close = useAppStore(s => s.closeBoardRefDialog)
  const boards = useAppStore(s => s.boards)
  const columns = useAppStore(s => s.boardColumns)
  const tasks = useAppStore(s => s.boardTasks)
  const viewRef = useEditorViewRef()

  const [kind, setKind] = useState<'board' | 'task'>('board')
  const [asLink, setAsLink] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!request) return
    setKind(request.kind)
    setQuery('')
  }, [request])

  const q = query.trim().toLowerCase()
  const boardItems = useMemo(() => boards.filter(b => b.name.toLowerCase().includes(q)), [boards, q])
  const taskItems = useMemo(() => tasks.filter(t => t.title.toLowerCase().includes(q)).slice(0, 50), [tasks, q])

  const insert = (id: string, title: string) => {
    const view = viewRef.current
    if (!view || !request) { close(); return }
    const { pos } = request
    let text: string
    if (asLink) {
      text = `[${kind === 'board' ? '▦' : '☐'} ${title.replace(/[\[\]]/g, '')}](${kind}://${id})`
    } else {
      const line = view.state.doc.lineAt(pos)
      const lead = pos !== line.from || line.text.trim().length > 0 ? '\n' : ''
      text = `${lead}\`\`\`${kind}\n${id}\n\`\`\`\n`
    }
    view.dispatch({ changes: { from: pos, to: pos, insert: text }, selection: { anchor: pos + text.length } })
    view.focus()
    close()
  }

  return (
    <Dialog.Root open={request !== null} onOpenChange={v => { if (!v) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[75vh] bg-panel border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden focus:outline-none"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <KanbanSquare className="w-4 h-4 text-foreground" />
              <Dialog.Title className="text-sm font-semibold text-foreground">Insert board or task</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 pt-4 space-y-3 shrink-0">
            <div className="flex gap-1.5">
              {(['board', 'task'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    kind === k ? 'bg-accent text-white border-accent' : 'border-border text-muted-foreground hover:text-foreground hover:border-accent/50',
                  )}
                >
                  {k === 'board' ? 'Board' : 'Task'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border border-border rounded-lg px-2.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={kind === 'board' ? 'Search boards…' : 'Search tasks…'}
                className="flex-1 bg-transparent outline-none py-2 text-sm text-foreground placeholder:text-muted-foreground/50"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={asLink} onChange={e => setAsLink(e.target.checked)} style={{ accentColor: 'hsl(var(--accent))' }} />
              Insert as inline link instead of {kind === 'board' ? 'an embedded board' : 'a task card'}
            </label>
          </div>

          <div className="overflow-y-auto flex-1 p-3 mt-1">
            {kind === 'board' && boardItems.map(b => (
              <button key={b.id} onClick={() => insert(b.id, b.name)} className="w-full text-left px-3 py-2 rounded-md hover:bg-surface flex items-center gap-2 text-sm text-foreground">
                <KanbanSquare className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{b.name}</span>
                <span className="text-[11px] text-tertiary">{tasks.filter(t => t.boardId === b.id).length} tasks</span>
              </button>
            ))}
            {kind === 'task' && taskItems.map(t => (
              <button key={t.id} onClick={() => insert(t.id, t.title)} className="w-full text-left px-3 py-2 rounded-md hover:bg-surface text-sm text-foreground">
                <div className="truncate">{t.title}</div>
                <div className="text-[11px] text-tertiary truncate">
                  {boards.find(b => b.id === t.boardId)?.name} · {columns.find(c => c.id === t.columnId)?.name}
                </div>
              </button>
            ))}
            {((kind === 'board' && !boardItems.length) || (kind === 'task' && !taskItems.length)) && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {q ? 'No matches' : kind === 'board' ? 'No boards yet — create one in the Board view.' : 'No tasks yet.'}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
