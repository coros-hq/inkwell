import { useState } from 'react'
import { ExternalLink, Lightbulb, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import type { BrainstormNode } from '../../types'

// Live, read-only view of a brainstorm for ```brainstorm blocks. Reads from the
// store, so it tracks the outline; clicking "Open" jumps to the Brainstorm view.

export function openBrainstorm(brainstormId: string) {
  const s = useAppStore.getState()
  if (!s.brainstorms.some(b => b.id === brainstormId)) return
  s.setActiveBrainstormId(brainstormId)
  s.setActiveView('brainstorm')
}

function Row({ node }: { node: BrainstormNode }) {
  const [open, setOpen] = useState(!node.collapsed)
  const has = node.children.length > 0
  return (
    <div>
      <div className="flex items-start gap-1.5 py-0.5">
        <button
          type="button"
          onClick={() => has && setOpen(o => !o)}
          className={cn('w-4 h-5 flex items-center justify-center text-muted-foreground shrink-0', !has && 'cursor-default')}
        >
          {has ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : (
            <span className="w-[5px] h-[5px] rounded-full bg-foreground/60" />
          )}
        </button>
        <span className="text-[14px] leading-5 text-foreground whitespace-pre-wrap">{node.text || <span className="text-muted-foreground/50">Empty point</span>}</span>
      </div>
      {has && open && (
        <div className="ml-[7px] pl-3 border-l border-border/60">
          {node.children.map(c => <Row key={c.id} node={c} />)}
        </div>
      )}
    </div>
  )
}

export function BrainstormEmbed({ brainstormId, onRemove }: { brainstormId: string; onRemove?: () => void }) {
  const brainstorm = useAppStore(s => s.brainstorms.find(b => b.id === brainstormId))
  if (!brainstorm) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground font-sans">
        <span className="flex-1">This brainstorm no longer exists or isn't in this vault.</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="hover:text-destructive" title="Remove from note">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="group/embed my-4 rounded-lg border border-border font-sans">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/40 rounded-t-lg">
        <Lightbulb className="w-4 h-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold text-foreground flex-1 truncate">{brainstorm.title || 'Untitled brainstorm'}</span>
        <button
          type="button"
          onClick={() => openBrainstorm(brainstorm.id)}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-accent"
        >
          Open <ExternalLink className="w-3 h-3" />
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
      <div className="p-3">
        {brainstorm.root.map(n => <Row key={n.id} node={n} />)}
      </div>
    </div>
  )
}
