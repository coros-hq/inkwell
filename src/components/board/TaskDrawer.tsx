import { useState, useRef, useEffect } from 'react'
import { X, Plus, Trash2, Check, ChevronDown, Pencil } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { TagChip } from '../shared/TagChip'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { DatePicker } from '../ui/DatePicker'
import { NoteRefAutocomplete, NoteRefDisplay } from '../../lib/noteReferences'
import type { Task } from '../../types'

// ─── Old task drawer constants ─────────────────────────────────────────────────

const STATUS_LABELS: Record<Task['status'], string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'in-review': 'In Review',
  'done': 'Done',
}

const STATUS_COLORS: Record<Task['status'], string> = {
  'todo': 'bg-surface text-muted-foreground',
  'in-progress': 'bg-accent/10 text-accent',
  'in-review': 'bg-amber-500/10 text-amber-500',
  'done': 'bg-green-500/10 text-green-600 dark:text-green-400',
}

const PRIORITY_COLORS: Record<Task['priority'], string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-green-400',
}

// ─── Priority dot ──────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-green-400',
}

const PRIORITY_TEXT: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-green-400',
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-tertiary">{children}</p>
      {right}
    </div>
  )
}

// ─── Board task drawer ─────────────────────────────────────────────────────────

function BoardTaskDrawer() {
  const {
    boardTasks,
    boardColumns,
    activeBoardTaskId,
    setActiveBoardTaskId,
    updateBoardTask,
    addBoardTaskSubtask,
    toggleBoardTaskSubtask,
    deleteBoardTaskSubtask,
    addBoardTaskComment,
    deleteBoardTaskComment,
    updateBoardTaskComment,
    openConfirm,
    deleteBoardTask,
  } = useAppStore()

  const task = boardTasks.find(t => t.id === activeBoardTaskId)
  const column = boardColumns.find(c => c.id === task?.columnId)
  const boardCols = boardColumns.filter(c => c.boardId === task?.boardId)

  // Local editing state
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentEditDraft, setCommentEditDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const subtaskInputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (addingSubtask) subtaskInputRef.current?.focus()
  }, [addingSubtask])

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus()
  }, [addingTag])

  if (!task || !column) return null

  const completedCount = task.subtasks.filter(s => s.completed).length
  const progress = task.subtasks.length ? (completedCount / task.subtasks.length) * 100 : 0

  const handleTitleSave = () => {
    if (titleDraft.trim() && titleDraft !== task.title) {
      updateBoardTask(task.id, { title: titleDraft.trim() })
    }
    setEditingTitle(false)
  }

  const handleDescSave = () => {
    updateBoardTask(task.id, { description: descDraft })
    setEditingDesc(false)
  }

  const handleAddSubtask = () => {
    if (subtaskDraft.trim()) {
      addBoardTaskSubtask(task.id, subtaskDraft.trim())
      setSubtaskDraft('')
      subtaskInputRef.current?.focus()
    }
  }

  const handleAddTag = () => {
    const tag = tagDraft.trim().toLowerCase().replace(/^#/, '')
    if (tag && !task.tags.includes(tag)) {
      updateBoardTask(task.id, { tags: [...task.tags, tag] })
    }
    setTagDraft('')
    setAddingTag(false)
  }

  const handleRemoveTag = (tag: string) => {
    updateBoardTask(task.id, { tags: task.tags.filter(t => t !== tag) })
  }

  const handleAddComment = () => {
    if (commentDraft.trim()) {
      addBoardTaskComment(task.id, commentDraft.trim())
      setCommentDraft('')
    }
  }

  const handleDeleteComment = (commentId: string) => {
    openConfirm({
      title: 'Delete this comment?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => deleteBoardTaskComment(task.id, commentId),
    })
  }

  const handleEditComment = (commentId: string, content: string) => {
    setEditingCommentId(commentId)
    setCommentEditDraft(content)
  }

  const handleSaveCommentEdit = () => {
    if (commentEditDraft.trim() && editingCommentId) {
      updateBoardTaskComment(task.id, editingCommentId, commentEditDraft.trim())
    }
    setEditingCommentId(null)
    setCommentEditDraft('')
  }

  const handleCancelCommentEdit = () => {
    setEditingCommentId(null)
    setCommentEditDraft('')
  }

  const handleDeleteTask = () => {
    openConfirm({
      title: 'Delete this task?',
      description: 'This will remove the task and its subtasks permanently.',
      confirmLabel: 'Delete task',
      destructive: true,
      onConfirm: () => {
        setActiveBoardTaskId(null)
        deleteBoardTask(task.id)
      },
    })
  }

  const formatCommentTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={() => setActiveBoardTaskId(null)}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[380px] bg-panel border-l border-border flex flex-col shadow-2xl">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 p-4 border-b border-border shrink-0">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTitleSave()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="flex-1 text-base font-semibold bg-surface border border-accent/50 rounded-md px-2 py-1 text-foreground outline-none"
            />
          ) : (
            <h2
              className="flex-1 text-base font-semibold text-foreground leading-snug cursor-text hover:text-foreground/80 transition-colors"
              onClick={() => { setTitleDraft(task.title); setEditingTitle(true) }}
              title="Click to rename"
            >
              {task.title}
            </h2>
          )}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleDeleteTask}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-400 hover:bg-surface transition-colors"
              title="Delete task"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setActiveBoardTaskId(null)}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-thin">

          {/* ── Metadata grid ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-surface/50 rounded-lg p-3 border border-border/50">

            {/* Status */}
            <div className="relative">
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1.5">Status</p>
              <button
                onClick={() => setStatusOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-foreground/70 transition-colors"
              >
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  column.color === 'blue' ? 'bg-blue-400' :
                    column.color === 'amber' ? 'bg-amber-400' :
                      column.color === 'green' ? 'bg-green-400' :
                        column.color === 'red' ? 'bg-red-400' :
                          column.color === 'purple' ? 'bg-purple-400' : 'bg-muted-foreground'
                )} />
                {column.name}
                <ChevronDown className="w-3 h-3 text-tertiary" />
              </button>
              {statusOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-20 bg-panel border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                    {boardCols.map(col => (
                      <button
                        key={col.id}
                        onClick={() => {
                          updateBoardTask(task.id, { columnId: col.id })
                          setStatusOpen(false)
                        }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2',
                          col.id === task.columnId
                            ? 'text-accent font-medium bg-active'
                            : 'text-foreground hover:bg-surface'
                        )}
                      >
                        {col.id === task.columnId && <Check className="w-3 h-3" />}
                        {col.id !== task.columnId && <span className="w-3" />}
                        {col.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Priority */}
            <div className="relative">
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1.5">Priority</p>
              <button
                onClick={() => setPriorityOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium hover:opacity-70 transition-opacity"
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[task.priority])} />
                <span className={cn('capitalize', PRIORITY_TEXT[task.priority])}>{task.priority}</span>
                <ChevronDown className="w-3 h-3 text-tertiary" />
              </button>
              {priorityOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPriorityOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-20 bg-panel border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
                    {(['high', 'medium', 'low'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => { updateBoardTask(task.id, { priority: p }); setPriorityOpen(false) }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2',
                          p === task.priority ? 'bg-active' : 'hover:bg-surface'
                        )}
                      >
                        {p === task.priority && <Check className="w-3 h-3 text-accent" />}
                        {p !== task.priority && <span className="w-3" />}
                        <span className={cn('capitalize', PRIORITY_TEXT[p])}>{p}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Assignee */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1.5">Assignee</p>
              {editingAssignee ? (
                <input
                  autoFocus
                  value={assigneeDraft}
                  onChange={e => setAssigneeDraft(e.target.value)}
                  onBlur={() => {
                    updateBoardTask(task.id, { assignee: assigneeDraft.trim() || undefined })
                    setEditingAssignee(false)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      updateBoardTask(task.id, { assignee: assigneeDraft.trim() || undefined })
                      setEditingAssignee(false)
                    }
                    if (e.key === 'Escape') setEditingAssignee(false)
                  }}
                  placeholder="Name…"
                  className="w-full text-xs bg-card border border-accent/40 rounded px-2 py-1 text-foreground placeholder:text-muted-foreground outline-none"
                />
              ) : (
                <button
                  onClick={() => { setAssigneeDraft(task.assignee ?? ''); setEditingAssignee(true) }}
                  className="flex items-center gap-1.5 text-xs text-foreground hover:opacity-70 transition-opacity"
                >
                  {task.assignee ? (
                    <>
                      <div className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[9px] font-bold flex items-center justify-center shrink-0">
                        {task.assignee.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{task.assignee}</span>
                    </>
                  ) : (
                    <span className="text-tertiary italic">Unassigned</span>
                  )}
                </button>
              )}
            </div>

            {/* Due Date */}
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1.5">Due Date</p>
              <DatePicker
                value={task.dueDate}
                onChange={iso => updateBoardTask(task.id, { dueDate: iso })}
                placeholder="No date"
              />
            </div>
          </div>

          {/* ── Description ─────────────────────────────────────────────────── */}
          <div>
            <SectionHeader>Description</SectionHeader>
            {editingDesc ? (
              <div className="relative">
                <textarea
                  ref={descInputRef}
                  autoFocus
                  value={descDraft}
                  onChange={e => setDescDraft(e.target.value)}
                  onBlur={handleDescSave}
                  onKeyDown={e => {
                    if (e.key === 'Escape') handleDescSave()
                    if (e.key === 'Enter' && e.metaKey) handleDescSave()
                  }}
                  placeholder="Add a description…"
                  rows={4}
                  className="w-full text-sm bg-surface border border-accent/40 rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed"
                />
                <NoteRefAutocomplete
                  inputValue={descDraft}
                  inputRef={descInputRef}
                  onInsert={setDescDraft}
                />
              </div>
            ) : (
              <div
                onClick={() => { setDescDraft(task.description); setEditingDesc(true) }}
                className={cn(
                  'text-sm leading-relaxed rounded-md px-3 py-2 cursor-text transition-colors',
                  'hover:bg-surface border border-transparent hover:border-border/50 min-h-[60px]',
                  task.description ? 'text-foreground whitespace-pre-wrap' : 'text-tertiary italic',
                )}
              >
                {task.description ? <NoteRefDisplay text={task.description} /> : 'Add a description…'}
              </div>
            )}
          </div>

          {/* ── Subtasks ────────────────────────────────────────────────────── */}
          <div>
            <SectionHeader
              right={
                <span className="text-[11px] text-muted-foreground font-medium">
                  {completedCount} of {task.subtasks.length} done
                </span>
              }
            >
              Subtasks
            </SectionHeader>

            {task.subtasks.length > 0 && (
              <div className="h-1 bg-border rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {task.subtasks.length === 0 && !addingSubtask && (
              <p className="text-xs text-tertiary italic mb-2">Break this task into steps.</p>
            )}

            <div className="space-y-1.5">
              {task.subtasks.map(st => (
                <div key={st.id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => toggleBoardTaskSubtask(task.id, st.id)}
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      st.completed
                        ? 'bg-accent border-accent text-accent-foreground'
                        : 'border-border hover:border-accent/60'
                    )}
                  >
                    {st.completed && <Check className="w-2.5 h-2.5" />}
                  </button>
                  <span className={cn(
                    'flex-1 text-sm',
                    st.completed ? 'line-through text-muted-foreground' : 'text-foreground'
                  )}>
                    {st.title}
                  </span>
                  <button
                    onClick={() => deleteBoardTaskSubtask(task.id, st.id)}
                    className="opacity-0 group-hover:opacity-100 text-tertiary hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add subtask */}
            {addingSubtask ? (
              <div className="flex items-center gap-2 mt-2">
                <div className="w-4 h-4 rounded border border-border shrink-0" />
                <input
                  ref={subtaskInputRef}
                  value={subtaskDraft}
                  onChange={e => setSubtaskDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddSubtask()
                    if (e.key === 'Escape') { setAddingSubtask(false); setSubtaskDraft('') }
                  }}
                  onBlur={() => {
                    if (!subtaskDraft.trim()) setAddingSubtask(false)
                  }}
                  placeholder="Subtask title…"
                  className="flex-1 text-sm bg-transparent border-b border-accent/50 text-foreground placeholder:text-muted-foreground outline-none py-0.5"
                />
              </div>
            ) : null}

            <button
              onClick={() => setAddingSubtask(true)}
              className="mt-2 flex items-center gap-1.5 text-xs text-tertiary hover:text-accent transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add subtask
            </button>
          </div>

          {/* ── Tags ────────────────────────────────────────────────────────── */}
          <div>
            <SectionHeader>Tags</SectionHeader>
            <div className="flex flex-wrap gap-1.5 items-center">
              {task.tags.length === 0 && !addingTag && (
                <span className="text-xs text-tertiary italic">No tags</span>
              )}
              {task.tags.map(tag => (
                <button
                  key={tag}
                  onClick={() => handleRemoveTag(tag)}
                  className="group flex items-center gap-1 text-[11px] bg-tag-bg text-tag-text px-2 py-0.5 rounded-full hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  title="Remove tag"
                >
                  #{tag}
                  <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
              {addingTag ? (
                <input
                  ref={tagInputRef}
                  value={tagDraft}
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddTag()
                    if (e.key === 'Escape') { setAddingTag(false); setTagDraft('') }
                  }}
                  onBlur={handleAddTag}
                  placeholder="tag name…"
                  className="text-[11px] bg-surface border border-accent/40 rounded-full px-2 py-0.5 text-foreground placeholder:text-muted-foreground outline-none w-24"
                />
              ) : (
                <button
                  onClick={() => setAddingTag(true)}
                  className="text-[11px] text-tertiary hover:text-accent transition-colors flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  Add tag
                </button>
              )}
            </div>
          </div>

          {/* ── Comments ────────────────────────────────────────────────────── */}
          <div>
            <SectionHeader>Comments</SectionHeader>

            {(!task.comments || task.comments.length === 0) && (
              <p className="text-xs text-tertiary italic mb-3">No comments yet. Start the conversation.</p>
            )}

            {task.comments && task.comments.length > 0 && (
              <div className="space-y-4 mb-4">
                {task.comments.map(comment => (
                  <div key={comment.id} className="flex gap-2.5 group">
                    <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                      {comment.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-xs font-semibold text-foreground">{comment.author}</span>
                        <span className="text-[10px] text-tertiary">{formatCommentTime(comment.createdAt)}</span>
                        <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleEditComment(comment.id, comment.content)} className="text-tertiary hover:text-accent transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => handleDeleteComment(comment.id)} className="text-tertiary hover:text-red-400 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {editingCommentId === comment.id ? (
                        <div className="space-y-1.5">
                          <textarea
                            autoFocus
                            value={commentEditDraft}
                            onChange={e => setCommentEditDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') handleCancelCommentEdit()
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveCommentEdit()
                            }}
                            className="w-full text-sm bg-surface border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent/50 transition-colors resize-none"
                            rows={2}
                          />
                          <div className="flex gap-1.5">
                            <button onClick={handleSaveCommentEdit} className="px-2 py-0.5 bg-accent text-accent-foreground text-[11px] font-medium rounded-md hover:opacity-90 transition-opacity">Save</button>
                            <button onClick={handleCancelCommentEdit} className="px-2 py-0.5 text-xs text-tertiary hover:text-foreground transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-foreground leading-relaxed">{comment.content}</p>
                      )}
                      <p className="text-sm text-foreground leading-relaxed"><NoteRefDisplay text={comment.content} /></p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment input */}
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                Y
              </div>
              <div className="flex-1 relative">
                <textarea
                  ref={commentInputRef}
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment()
                  }}
                  placeholder="Leave a comment…"
                  rows={2}
                  className="w-full text-sm bg-surface border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent/50 transition-colors resize-none"
                />
                <NoteRefAutocomplete
                  inputValue={commentDraft}
                  inputRef={commentInputRef}
                  onInsert={setCommentDraft}
                />
                {commentDraft.trim() && (
                  <button
                    onClick={handleAddComment}
                    className="mt-1.5 px-3 py-1 bg-accent text-accent-foreground text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
                  >
                    Comment
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom padding */}
          <div className="h-4" />
        </div>
      </div>
    </>
  )
}

// ─── Old task drawer (notes tasks) ────────────────────────────────────────────

function OldTaskDrawer() {
  const { tasks, activeTaskId, setActiveTask, toggleSubtask, addSubtask } = useAppStore()
  const [newSubtask, setNewSubtask] = useState('')

  const task = tasks.find(t => t.id === activeTaskId)
  if (!task) return null

  const completedCount = task.subtasks.filter(s => s.completed).length

  const handleAddSubtask = () => {
    if (newSubtask.trim()) {
      addSubtask(task.id, newSubtask.trim())
      setNewSubtask('')
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={() => setActiveTask(null)}
      />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[340px] bg-panel border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-start justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground leading-snug pr-4">{task.title}</h2>
          <button
            onClick={() => setActiveTask(null)}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Status</p>
              <span className={cn('text-xs font-medium px-2 py-1 rounded-full', STATUS_COLORS[task.status])}>
                {STATUS_LABELS[task.status]}
              </span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Priority</p>
              <span className={cn('text-xs font-semibold capitalize', PRIORITY_COLORS[task.priority])}>
                {task.priority}
              </span>
            </div>
            {task.assignee && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Assignee</p>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[9px] font-bold flex items-center justify-center">
                    {task.assigneeAvatar}
                  </div>
                  <span className="text-xs text-foreground">{task.assignee}</span>
                </div>
              </div>
            )}
            {task.dueDate && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Due Date</p>
                <span className="text-xs text-foreground">{formatDate(task.dueDate)}</span>
              </div>
            )}
          </div>

          {task.description && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-2">Description</p>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {task.subtasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-tertiary">Subtasks</p>
                <span className="text-xs text-muted-foreground">{completedCount}/{task.subtasks.length}</span>
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-accent rounded-full transition-all"
                  style={{ width: `${task.subtasks.length ? (completedCount / task.subtasks.length) * 100 : 0}%` }}
                />
              </div>
              <div className="space-y-2">
                {task.subtasks.map(st => (
                  <div key={st.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={st.completed}
                      onChange={() => toggleSubtask(task.id, st.id)}
                      className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                    />
                    <span className={cn('text-sm', st.completed ? 'line-through text-muted-foreground' : 'text-foreground')}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
              placeholder="Add a subtask…"
              className="flex-1 h-7 text-xs bg-surface border border-border rounded px-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={handleAddSubtask}
              disabled={!newSubtask.trim()}
              className="w-7 h-7 flex items-center justify-center rounded bg-surface border border-border text-muted-foreground hover:text-accent hover:border-accent transition-colors disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {task.tags.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-2">Tags</p>
              <div className="flex flex-wrap gap-1">
                {task.tags.map(tag => <TagChip key={tag} tag={tag} />)}
              </div>
            </div>
          )}

          {task.comments.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-tertiary mb-3">Comments</p>
              <div className="space-y-3">
                {task.comments.map(comment => (
                  <div key={comment.id} className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                      {comment.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-foreground">{comment.author}</span>
                        <span className="text-[10px] text-tertiary">{formatDate(comment.createdAt)}</span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed"><NoteRefDisplay text={comment.content} /></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <input
              placeholder="Leave a comment…"
              className="w-full h-9 text-sm bg-surface border border-border rounded-md px-3 text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </div>
    </>
  )
}

// ─── TaskDrawer (router) ───────────────────────────────────────────────────────

export function TaskDrawer() {
  const { activeBoardTaskId, activeTaskId } = useAppStore()

  if (activeBoardTaskId) return <BoardTaskDrawer />
  if (activeTaskId) return <OldTaskDrawer />
  return null
}
