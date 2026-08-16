import { useState, useRef, useCallback } from 'react'
import { Plus, ChevronDown, Trash2, LayoutGrid } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import { KanbanColumn } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import { cn } from '../../lib/utils'
import type { BoardTask, BoardColumn } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type DropIndicator =
  | { type: 'before-task'; taskId: string; columnId: string }
  | { type: 'after-task'; taskId: string; columnId: string }
  | { type: 'col-end'; columnId: string }
  | { type: 'col-gap'; afterColumnId: string | null }

type ActiveDrag =
  | { type: 'task'; taskId: string; columnId: string }
  | { type: 'column'; columnId: string }

// ─── Collision detection ──────────────────────────────────────────────────────

const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  return pointer.length > 0 ? pointer : rectIntersection(args)
}

// ─── Column gap indicator (purely visual — no droppable) ─────────────────────

function ColGap({ active, isDropTarget }: { active: boolean; isDropTarget: boolean }) {
  return (
    <div
      className={cn(
        'shrink-0 transition-all duration-150 flex items-center justify-center',
        !active && 'w-0 overflow-hidden',
        active && !isDropTarget && 'w-3',
        active && isDropTarget && 'w-12',
      )}
    >
      {active && isDropTarget && (
        <div
          className="w-[3px] self-stretch rounded-full my-1"
          style={{
            background: 'hsl(var(--accent))',
            boxShadow: '0 0 8px 2px hsl(var(--accent) / 0.5)',
          }}
        />
      )}
    </div>
  )
}

// ─── BoardView ────────────────────────────────────────────────────────────────

export function BoardView() {
  const {
    boards,
    boardColumns,
    boardTasks,
    activeBoardId,
    setActiveBoardId,
    createBoard,
    deleteBoard,
    addBoardColumn,
    reorderBoardColumns,
    moveBoardTask,
    openPrompt,
    openConfirm,
    sidebarOpen,
    toggleSidebar,
  } = useAppStore()

  const board = boards.find(b => b.id === activeBoardId)
  const columns: BoardColumn[] = board
    ? board.columnIds.map(id => boardColumns.find(c => c.id === id)).filter(Boolean) as BoardColumn[]
    : []

  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const dropIndicatorRef = useRef<DropIndicator | null>(null)
  const [boardPickerOpen, setBoardPickerOpen] = useState(false)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColName, setNewColName] = useState('')

  const updateDropIndicator = useCallback((next: DropIndicator | null) => {
    const prev = dropIndicatorRef.current
    if (
      next?.type === prev?.type &&
      (next as { taskId?: string })?.taskId === (prev as { taskId?: string })?.taskId &&
      (next as { columnId?: string })?.columnId === (prev as { columnId?: string })?.columnId &&
      (next as { afterColumnId?: string | null })?.afterColumnId === (prev as { afterColumnId?: string | null })?.afterColumnId
    ) return
    dropIndicatorRef.current = next
    setDropIndicator(next)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as { type: string; taskId?: string; columnId?: string }
    if (data.type === 'task') {
      setActiveDrag({ type: 'task', taskId: data.taskId!, columnId: data.columnId! })
    } else if (data.type === 'column') {
      setActiveDrag({ type: 'column', columnId: data.columnId! })
    }
  }

  const handleDragOver = ({ active, over, delta, activatorEvent }: DragOverEvent) => {
    if (!over) { updateDropIndicator(null); return }

    const activeData = active.data.current as { type: string; taskId?: string; columnId?: string }
    const overData = over.data.current as { type: string; taskId?: string; columnId?: string; afterColumnId?: string | null }

    if (activeData.type === 'task') {
      if (overData.type === 'task' && overData.taskId !== activeData.taskId) {
        const rect = over.rect
        const pointerY = (activatorEvent as PointerEvent).clientY + delta.y
        const ratio = (pointerY - rect.top) / rect.height
        const position = ratio < 0.5 ? 'before-task' : 'after-task'
        updateDropIndicator({ type: position, taskId: overData.taskId!, columnId: overData.columnId! })
      } else if (overData.type === 'col-end') {
        updateDropIndicator({ type: 'col-end', columnId: overData.columnId! })
      } else {
        updateDropIndicator(null)
      }
    } else if (activeData.type === 'column') {
      // Detect insert position by x-coordinate vs hovered column center.
      // Works regardless of which droppable within the column the pointer hits.
      const targetColId = overData.columnId  // set on both task and col-end droppables
      if (!targetColId || targetColId === activeData.columnId) {
        updateDropIndicator(null)
        return
      }
      const pointerX = (activatorEvent as PointerEvent).clientX + delta.x
      const colCenterX = over.rect.left + over.rect.width / 2
      const targetIdx = columns.findIndex(c => c.id === targetColId)
      const dragIdx  = columns.findIndex(c => c.id === activeData.columnId)

      if (pointerX < colCenterX) {
        // Insert BEFORE targetCol → afterId = column just before targetCol
        const afterId = targetIdx > 0 ? columns[targetIdx - 1].id : null
        // Skip if that would be a no-op (dragged col is already right before target)
        if (afterId === activeData.columnId) { updateDropIndicator(null); return }
        updateDropIndicator({ type: 'col-gap', afterColumnId: afterId })
      } else {
        // Insert AFTER targetCol
        // Skip if dragged col is already right after target
        if (dragIdx === targetIdx + 1) { updateDropIndicator(null); return }
        updateDropIndicator({ type: 'col-gap', afterColumnId: targetColId })
      }
    }
  }

  const handleDragEnd = ({ active }: DragEndEvent) => {
    const indicator = dropIndicatorRef.current
    const drag = activeDrag
    setActiveDrag(null)
    updateDropIndicator(null)

    if (!indicator || !drag) return

    if (drag.type === 'task') {
      if (indicator.type === 'before-task') {
        moveBoardTask(drag.taskId, indicator.columnId, indicator.taskId)
      } else if (indicator.type === 'after-task') {
        // Find the task AFTER the indicator task in its column
        const col = boardColumns.find(c => c.id === indicator.columnId)
        if (!col) return
        const idx = col.taskIds.indexOf(indicator.taskId)
        const nextId = col.taskIds[idx + 1] ?? null
        moveBoardTask(drag.taskId, indicator.columnId, nextId)
      } else if (indicator.type === 'col-end') {
        moveBoardTask(drag.taskId, indicator.columnId, null)
      }
    } else if (drag.type === 'column' && board) {
      if (indicator.type === 'col-gap') {
        // Reorder columns
        const colIds = board.columnIds.filter(id => id !== drag.columnId)
        const afterId = indicator.afterColumnId
        if (afterId === null) {
          reorderBoardColumns(board.id, [drag.columnId, ...colIds])
        } else {
          const idx = colIds.indexOf(afterId)
          colIds.splice(idx + 1, 0, drag.columnId)
          reorderBoardColumns(board.id, colIds)
        }
      }
    }
    void active
  }

  const handleDragCancel = () => {
    setActiveDrag(null)
    updateDropIndicator(null)
  }

  const handleCreateBoard = () => {
    openPrompt({
      title: 'New board',
      placeholder: 'Board name',
      confirmLabel: 'Create',
      onConfirm: (name) => createBoard(name),
    })
  }

  const handleDeleteBoard = () => {
    if (!board) return
    openConfirm({
      title: `Delete "${board.name}"?`,
      description: 'This will permanently delete the board and all its tasks.',
      confirmLabel: 'Delete board',
      destructive: true,
      onConfirm: () => deleteBoard(board.id),
    })
  }

  const handleAddColumn = () => {
    if (!board || !newColName.trim()) return
    addBoardColumn(board.id, newColName.trim())
    setNewColName('')
    setAddingColumn(false)
  }

  const draggingTask = activeDrag?.type === 'task'
    ? boardTasks.find(t => t.id === activeDrag.taskId)
    : null

  const draggingColumn = activeDrag?.type === 'column'
    ? columns.find(c => c.id === activeDrag.columnId)
    : null

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (boards.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background overflow-hidden min-w-0">
        <div className="h-10 shrink-0 border-b border-border flex items-center px-4 gap-2" data-tauri-drag-region>
          {!sidebarOpen && (
            <button
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              onClick={toggleSidebar}
              title="Show sidebar (⌘B)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <LayoutGrid className="w-10 h-10 text-tertiary" />
          <p className="text-sm font-medium text-foreground">No boards yet</p>
          <p className="text-xs text-muted-foreground">Create a board to start organizing your work</p>
          <button
            onClick={handleCreateBoard}
            className="mt-1 px-4 py-2 bg-accent text-accent-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            New board
          </button>
        </div>
      </div>
    )
  }

  const totalTasks = columns.reduce((sum, c) => sum + c.taskIds.length, 0)

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden min-w-0">
      {/* Top bar */}
      <div className="h-10 shrink-0 border-b border-border flex items-center px-4 gap-3 relative" data-tauri-drag-region>
        {!sidebarOpen && (
          <button
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shrink-0"
            onClick={toggleSidebar}
            title="Show sidebar (⌘B)"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        )}

        {/* Board picker */}
        <div className="relative">
          <button
            onClick={() => setBoardPickerOpen(v => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {board?.name ?? 'Board'}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          {boardPickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBoardPickerOpen(false)} />
              <div className="absolute top-full left-0 mt-1 z-20 bg-panel border border-border rounded-lg shadow-xl py-1 min-w-[180px]">
                {boards.map(b => (
                  <button
                    key={b.id}
                    onClick={() => { setActiveBoardId(b.id); setBoardPickerOpen(false) }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-sm transition-colors',
                      b.id === activeBoardId
                        ? 'text-accent font-medium bg-active'
                        : 'text-foreground hover:bg-surface'
                    )}
                  >
                    {b.name}
                  </button>
                ))}
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={() => { setBoardPickerOpen(false); handleCreateBoard() }}
                    className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-surface transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New board
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <span className="text-xs bg-accent/10 text-accent font-medium px-2 py-0.5 rounded-full">Board</span>
        <span className="text-xs text-muted-foreground">{totalTasks} {totalTasks === 1 ? 'task' : 'tasks'}</span>

        <div className="flex-1" />

        <button
          onClick={handleDeleteBoard}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-surface transition-colors"
          title="Delete board"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setAddingColumn(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2.5 py-1 hover:text-foreground hover:border-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add column
        </button>
      </div>

      {/* Board body */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-0 p-4 h-full items-start min-w-max">

            {/* Start gap (before first column) */}
            <ColGap
              active={activeDrag?.type === 'column'}
              isDropTarget={dropIndicator?.type === 'col-gap' && dropIndicator.afterColumnId === null}
            />

            {columns.map((col) => {
              const tasks = col.taskIds
                .map(id => boardTasks.find(t => t.id === id))
                .filter(Boolean) as BoardTask[]
              return (
                <div key={col.id} className="flex items-start">
                  <KanbanColumn
                    column={col}
                    tasks={tasks}
                    isDraggingTask={activeDrag?.type === 'task'}
                    isDraggingColumn={activeDrag?.type === 'column'}
                    activeDragTaskId={activeDrag?.type === 'task' ? activeDrag.taskId : null}
                    activeDragColumnId={activeDrag?.type === 'column' ? activeDrag.columnId : null}
                    dropIndicator={dropIndicator}
                  />
                  <ColGap
                    active={activeDrag?.type === 'column'}
                    isDropTarget={dropIndicator?.type === 'col-gap' && dropIndicator.afterColumnId === col.id}
                  />
                </div>
              )
            })}

            {/* Add column form */}
            {addingColumn ? (
              <div className="w-[260px] shrink-0 ml-3">
                <input
                  autoFocus
                  value={newColName}
                  onChange={e => setNewColName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddColumn()
                    if (e.key === 'Escape') { setAddingColumn(false); setNewColName('') }
                  }}
                  onBlur={() => { if (newColName.trim()) handleAddColumn(); else { setAddingColumn(false); setNewColName('') } }}
                  placeholder="Column name…"
                  className="w-full text-sm bg-card border border-accent/50 rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={{ duration: 120, easing: 'ease-out' }}>
          {draggingTask && (
            <div className="w-[260px] opacity-95 rotate-1 shadow-2xl shadow-black/40">
              <TaskCard task={draggingTask} isOverlay />
            </div>
          )}
          {draggingColumn && (
            <div className="w-[260px] opacity-90 rotate-1 shadow-2xl shadow-black/60 bg-panel border-2 border-accent/40 rounded-xl p-3 ring-1 ring-accent/20">
              <span className="text-sm font-semibold text-foreground">{draggingColumn.name}</span>
              <div className="mt-3 space-y-1.5">
                <div className="h-10 rounded-lg bg-surface/60 border border-border/40" />
                <div className="h-10 rounded-lg bg-surface/40 border border-border/30" />
                <div className="h-8 rounded-lg bg-surface/20 border border-border/20" />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
