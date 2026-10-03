import { useAppStore } from '../store/useAppStore'

// Jump from a note to a board / task. Embeds and `board://` / `task://` links
// in notes all route through these.

export function openBoard(boardId: string) {
  const s = useAppStore.getState()
  if (!s.boards.some(b => b.id === boardId)) return
  s.setActiveBoardId(boardId)
  s.setActiveBoardTaskId(null)
  s.setActiveView('board')
}

export function openTask(taskId: string) {
  const s = useAppStore.getState()
  const task = s.boardTasks.find(t => t.id === taskId)
  if (!task) return
  s.setActiveBoardId(task.boardId)
  s.setActiveView('board')
  s.setActiveBoardTaskId(taskId)
}
