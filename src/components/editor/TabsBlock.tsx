import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Plus, X, Eye, Pencil, Code2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { newTabId, parseTabsSpec, serializeTabsSpec, type TabsSpec } from '../../lib/tabsBlock'

interface Props {
  spec: string
  /** Absent → read-only (reading view / export). */
  onChange?: (next: string) => void
  onEditAsText?: () => void
}

/** Tab group inside a note: each tab has its own markdown content. */
export function TabsBlock({ spec, onChange, onEditAsText }: Props) {
  const parsed = parseTabsSpec(spec)
  const editable = !!onChange
  // Read-only viewers keep their own active tab; editors persist it in the block.
  const [localActive, setLocalActive] = useState(parsed.active)
  const active = editable ? parsed.active : Math.min(localActive, parsed.tabs.length - 1)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const tab = parsed.tabs[active]

  const commit = (next: TabsSpec) => onChange?.(serializeTabsSpec(next))
  const select = (i: number) => {
    if (editable) commit({ ...parsed, active: i })
    else setLocalActive(i)
  }

  // Auto-grow the textarea so the block's height tracks its content.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 96)}px`
  }, [tab?.content, active, previewing])

  const addTab = () => {
    const tabs = [...parsed.tabs, { id: newTabId(), title: `Tab ${parsed.tabs.length + 1}`, content: '' }]
    commit({ tabs, active: tabs.length - 1 })
  }

  const removeTab = (i: number) => {
    if (parsed.tabs.length <= 1) return
    const tabs = parsed.tabs.filter((_, idx) => idx !== i)
    commit({ tabs, active: Math.min(active > i ? active - 1 : active, tabs.length - 1) })
  }

  const rename = (i: number, title: string) => {
    setRenamingId(null)
    const t = title.trim()
    if (!t || t === parsed.tabs[i].title) return
    commit({ ...parsed, tabs: parsed.tabs.map((x, idx) => (idx === i ? { ...x, title: t } : x)) })
  }

  const setContent = (content: string) =>
    commit({ ...parsed, tabs: parsed.tabs.map((x, idx) => (idx === active ? { ...x, content } : x)) })

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden not-prose">
      <div className="flex items-center gap-0.5 px-1.5 pt-1.5 border-b border-border bg-surface/40 overflow-x-auto">
        {parsed.tabs.map((t, i) => (
          <div
            key={t.id}
            className={cn(
              'group/tab flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-[13px] rounded-t-md border border-b-0 cursor-pointer select-none shrink-0 -mb-px',
              i === active
                ? 'bg-background border-border text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => select(i)}
            onDoubleClick={() => editable && setRenamingId(t.id)}
          >
            {renamingId === t.id ? (
              <input
                autoFocus
                defaultValue={t.title}
                className="w-24 bg-transparent outline-none border-b border-accent text-[13px]"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => rename(i, e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <span className="max-w-[160px] truncate">{t.title}</span>
            )}
            {editable && parsed.tabs.length > 1 && (
              <button
                className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-0 group-hover/tab:opacity-100"
                onClick={(e) => { e.stopPropagation(); removeTab(i) }}
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {editable && (
          <button
            className="w-6 h-6 mb-1 ml-0.5 shrink-0 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
            onClick={addTab}
            title="Add tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex-1" />
        {editable && (
          <div className="flex items-center gap-0.5 mb-1 shrink-0">
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
              onClick={() => setPreviewing((v) => !v)}
              title={previewing ? 'Edit this tab' : 'Preview this tab'}
            >
              {previewing ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            {onEditAsText && (
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface"
                onClick={onEditAsText}
                title="Edit block source"
              >
                <Code2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-background">
        {editable && !previewing ? (
          <textarea
            ref={areaRef}
            value={tab.content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Write markdown for this tab…"
            spellCheck={false}
            className="w-full resize-none bg-transparent outline-none text-[14px] leading-[1.7] text-foreground placeholder:text-muted-foreground font-sans"
          />
        ) : tab.content.trim() ? (
          <div className="inkwell-preview-root text-[14.5px] leading-[1.7] text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{tab.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This tab is empty.</p>
        )}
      </div>
    </div>
  )
}
