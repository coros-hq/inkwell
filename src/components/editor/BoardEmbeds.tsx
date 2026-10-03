import { ExternalLink, KanbanSquare, Trash2, CalendarDays, CheckSquare } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { openBoard, openTask } from '../../lib/boardRefs'
import { cn } from '../../lib/utils'
import type { BoardTask } from '../../types'

// Live board / task embeds for ```board and ```task blocks. Both read straight
// from the store, so they track the real board; clicking opens it in the Board view.

const PRIORITY_DOT: Record<BoardTask['priority'], string> = {
  high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-green-400',
}
const COLUMN_DOT: Record<string, string> = {
  blue: 'bg-blue-400', amber: 'bg-amber-400', red: 'bg-red-400',
  green: 'bg-green-400', purple: 'bg-purple-400', gray: 'bg-muted-foreground',
}

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Missing({ what, onRemove }: { what: string; onRemove?: () => void }) {
  return (
    <div className="my-3 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground font-sans">
      <span className="flex-1">{what} no longer exists.</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:text-destructive" title="Remove from note">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function TaskCardMini({ task, showColumn, onClick }: { task: BoardTask; showColumn?: string; onClick: () => void }) {
  const done = task.subtasks.filter(s => s.completed).length
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-md border border-border bg-card hover:border-accent/50 transition-colors px-2.5 py-2 flex flex-col gap-1.5"
    >
      <div className="flex items-start gap-2">
        <span className={cn('w-2 h-2 rounded-full mt-[6px] shrink-0', PRIORITY_DOT[task.priority])} />
        <span className="text-[13.5px] text-foreground leading-snug flex-1">{task.title}</span>
      </div>
      {(showColumn || task.dueDate || task.subtasks.length > 0 || task.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11.5px] text-muted-foreground">
          {showColumn && <span>{showColumn}</span>}
          {task.dueDate && <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{formatDue(task.dueDate)}</span>}
          {task.subtasks.length > 0 && <span className="flex items-center gap-1"><CheckSquare className="w-3 h-3" />{done}/{task.subtasks.length}</span>}
          {task.tags.slice(0, 3).map(t => <span key={t} className="px-1.5 rounded bg-surface">{t}</span>)}
        </div>
      )}
    </button>
  )
}

export function TaskEmbed({ taskId, onRemove }: { taskId: string; onRemove?: () => void }) {
  const task = useAppStore(s => s.boardTasks.find(t => t.id === taskId))
  const column = useAppStore(s => s.boardColumns.find(c => c.id === task?.columnId))
  const board = useAppStore(s => s.boards.find(b => b.id === task?.boardId))
  if (!task) return <Missing what="This task" onRemove={onRemove} />
  return (
    <div className="group/embed relative my-3 font-sans max-w-[460px]">
      <TaskCardMini
        task={task}
        showColumn={[board?.name, column?.name].filter(Boolean).join(' · ')}
        onClick={() => openTask(task.id)}
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove from note"
          className="absolute top-1.5 right-1.5 opacity-0 group-hover/embed:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-active"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

export function BoardEmbed({ boardId, onRemove }: { boardId: string; onRemove?: () => void }) {
  const board = useAppStore(s => s.boards.find(b => b.id === boardId))
  const columns = useAppStore(s => s.boardColumns)
  const tasks = useAppStore(s => s.boardTasks)
  if (!board) return <Missing what="This board" onRemove={onRemove} />

  const cols = board.columnIds.map(id => columns.find(c => c.id === id)).filter(Boolean) as typeof columns
  return (
    <div className="group/embed my-4 rounded-lg border border-border font-sans">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/40 rounded-t-lg">
        <KanbanSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold text-foreground flex-1 truncate">{board.name}</span>
        <button
          type="button"
          onClick={() => openBoard(board.id)}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-accent"
        >
          Open board <ExternalLink className="w-3 h-3" />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove from note"
            className="opacity-0 group-hover/embed:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-active"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto p-3">
        {cols.map(col => {
          const colTasks = col.taskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean) as BoardTask[]
          return (
            <div key={col.id} className="w-[220px] shrink-0 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 px-0.5 text-[12px] font-medium text-muted-foreground">
                <span className={cn('w-2 h-2 rounded-full', COLUMN_DOT[col.color] ?? COLUMN_DOT.gray)} />
                <span className="truncate">{col.name}</span>
                <span className="opacity-60">{colTasks.length}</span>
              </div>
              {colTasks.map(t => <TaskCardMini key={t.id} task={t} onClick={() => openTask(t.id)} />)}
            </div>
          )
        })}
        {cols.length === 0 && <div className="text-[13px] text-muted-foreground">This board has no columns.</div>}
      </div>
    </div>
  )
}
