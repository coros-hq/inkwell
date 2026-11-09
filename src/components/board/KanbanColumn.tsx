import { useState, useRef } from 'react'
import { Plus, GripVertical, MoreHorizontal } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import { TaskCard } from './TaskCard'
import { ContextMenu } from '../shared/ContextMenu'
import { cn } from '../../lib/utils'
import type { BoardColumn, BoardTask } from '../../types'

// ─── Color dot ────────────────────────────────────────────────────────────────

const COLOR_DOT: Record<string, string> = {
  blue:   'bg-blue-400',
  amber:  'bg-amber-400',
  red:    'bg-red-400',
  green:  'bg-green-400',
  purple: 'bg-purple-400',
  gray:   'bg-muted-foreground',
}

// ─── Drop indicator line ──────────────────────────────────────────────────────

function InsertLine() {
  return <div className="h-0.5 rounded-full bg-accent mx-1 my-0.5 shrink-0" />
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  column: BoardColumn
  /** The board has a wallpaper: give the column a frosted backing so text stays readable. */
  onWallpaper?: boolean
  tasks: BoardTask[]
  isDraggingTask: boolean
  isDraggingColumn: boolean
  activeDragTaskId: string | null
  activeDragColumnId: string | null
  dropIndicator: {
    type: string
    taskId?: string
    columnId?: string
    afterColumnId?: string | null
  } | null
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

export function KanbanColumn({
  column,
  onWallpaper,
  tasks,
  isDraggingTask,
  isDraggingColumn,
  activeDragTaskId,
  activeDragColumnId,
  dropIndicator,
}: KanbanColumnProps) {
  const { createBoardTask, renameBoardColumn, deleteBoardColumn, openConfirm } = useAppStore()
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(column.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Draggable column header
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
  })

  // Droppable column end zone (for task append)
  const { setNodeRef: setDropRef, isOver: isColOver } = useDroppable({
    id: `col-end:${column.id}`,
    data: { type: 'col-end', columnId: column.id },
  })

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return
    createBoardTask(column.id, newTaskTitle.trim())
    setNewTaskTitle('')
    // Keep the input open for rapid entry
  }

  const handleRename = () => {
    if (editName.trim() && editName !== column.name) {
      renameBoardColumn(column.id, editName.trim())
    } else {
      setEditName(column.name)
    }
    setEditing(false)
  }

  const handleDeleteColumn = () => {
    openConfirm({
      title: `Delete "${column.name}"?`,
      description: `This will delete the column and all ${tasks.length} task${tasks.length !== 1 ? 's' : ''} in it.`,
      confirmLabel: 'Delete column',
      destructive: true,
      onConfirm: () => deleteBoardColumn(column.id),
    })
  }

  const isColDragOver = dropIndicator?.type === 'col-end' && dropIndicator.columnId === column.id
  const isThisColumnDragging = activeDragColumnId === column.id
  const colDotColor = COLOR_DOT[column.color] ?? COLOR_DOT.gray

  return (
    <div
      className={cn(
        'w-[260px] shrink-0 flex flex-col mx-1.5',
        onWallpaper && 'rounded-xl border border-border/60 bg-background/85 p-2 backdrop-blur-md',
        isDragging && 'opacity-20 pointer-events-none scale-[0.98] transition-transform',
      )}
    >
      {/* ── Column header ─────────────────────────────────────────────────── */}
      <div
        ref={setDragRef}
        className={cn(
          'flex items-center gap-2 mb-3 px-1 py-1 rounded-md group',
          isDraggingColumn && !isThisColumnDragging && 'hover:bg-surface cursor-grab',
        )}
      >
        {/* Grip handle */}
        <button
          className={cn(
            'text-tertiary transition-colors shrink-0 cursor-grab active:cursor-grabbing touch-none',
            isDraggingColumn ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        <div className={cn('w-2 h-2 rounded-full shrink-0', colDotColor)} />

        {/* Column name — click to rename */}
        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') { setEditName(column.name); setEditing(false) }
            }}
            className="flex-1 text-sm font-semibold bg-surface border border-accent/50 rounded px-1.5 py-0.5 text-foreground outline-none"
          />
        ) : (
          <span
            className="flex-1 text-sm font-semibold text-foreground truncate cursor-default select-none"
            onDoubleClick={() => setEditing(true)}
          >
            {column.name}
          </span>
        )}

        <span className="bg-surface text-muted-foreground text-[11px] rounded-full px-2 py-0.5 font-medium shrink-0">
          {tasks.length}
        </span>

        {/* Column options */}
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          onClick={e => setContextMenu({ x: e.clientX, y: e.clientY })}
        >
          <MoreHorizontal className="w-3 h-3" />
        </button>
      </div>

      {/* ── Task list ─────────────────────────────────────────────────────── */}
      <div
        ref={setDropRef}
        className={cn(
          'flex flex-col flex-1 min-h-[48px] rounded-lg transition-colors',
          isDraggingTask && isColOver && !dropIndicator && 'bg-accent/5 ring-1 ring-accent/20',
          isColDragOver && 'bg-accent/5 ring-1 ring-accent/20',
        )}
      >
        {tasks.map((task) => {
          const isBefore = dropIndicator?.type === 'before-task' && dropIndicator.taskId === task.id
          const isAfter = dropIndicator?.type === 'after-task' && dropIndicator.taskId === task.id

          return (
            <div key={task.id}>
              {isBefore && <InsertLine />}
              <TaskCard
                task={task}
                columnId={column.id}
                isGhosted={activeDragTaskId === task.id}
              />
              {isAfter && <InsertLine />}
            </div>
          )
        })}

        {/* Empty drop zone when no tasks */}
        {tasks.length === 0 && isDraggingTask && (
          <div className={cn(
            'flex-1 rounded-lg border border-dashed border-border min-h-[80px] flex items-center justify-center',
            isColDragOver && 'border-accent/50 bg-accent/5',
          )}>
            <span className="text-xs text-muted-foreground">Drop here</span>
          </div>
        )}
      </div>

      {/* ── Add task ──────────────────────────────────────────────────────── */}
      <div className="mt-2">
        {addingTask ? (
          <div className="flex flex-col gap-1.5">
            <input
              ref={inputRef}
              autoFocus
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { handleAddTask(); setNewTaskTitle('') }
                if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle('') }
              }}
              placeholder="Task title…"
              className="w-full text-sm bg-card border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent/60 transition-colors"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { if (newTaskTitle.trim()) { handleAddTask(); setAddingTask(false) } }}
                className="px-3 py-1 bg-accent text-accent-foreground text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
              >
                Add
              </button>
              <button
                onClick={() => { setAddingTask(false); setNewTaskTitle('') }}
                className="px-3 py-1 text-muted-foreground text-xs hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className={cn(
              'w-full flex items-center justify-center gap-1.5 border border-dashed border-border rounded-md p-2',
              'text-xs text-muted-foreground hover:border-accent/50 hover:text-accent transition-colors',
            )}
          >
            <Plus className="w-3 h-3" />
            Add task
          </button>
        )}
      </div>

      {/* ── Context menu ──────────────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'Rename column',
              onClick: () => { setContextMenu(null); setEditing(true) },
            },
            {
              label: 'Delete column',
              destructive: true,
              onClick: () => { setContextMenu(null); handleDeleteColumn() },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
