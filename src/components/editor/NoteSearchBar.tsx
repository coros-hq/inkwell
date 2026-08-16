import { useEffect, useRef } from 'react'
import { EditorSelection } from '@codemirror/state'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { useEditorViewRef } from './EditorViewContext'
import { setSearchHighlights } from '../../lib/searchHighlightExtension'
import { cn } from '../../lib/utils'

interface NoteSearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  matchIndex: number
  matches: number[]       // array of char offsets in note.content
  onNext: () => void
  onPrev: () => void
}

export function NoteSearchBar({
  query,
  onQueryChange,
  onClose,
  matchIndex,
  matches,
  onNext,
  onPrev,
}: NoteSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewRef = useEditorViewRef()

  // Auto-focus input when bar opens
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Highlight all matches + scroll to active match in the source CodeMirror view
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (!query || !matches.length) {
      view.dispatch({ effects: setSearchHighlights.of({ ranges: [], activeIndex: -1 }) })
      return
    }

    const ranges = matches.map(from => ({ from, to: from + query.length }))
    const activeFrom = matches[matchIndex]
    view.dispatch({
      effects: setSearchHighlights.of({ ranges, activeIndex: matchIndex }),
      selection: EditorSelection.single(activeFrom, activeFrom + query.length),
      scrollIntoView: true,
    })
  }, [matchIndex, matches, query, viewRef])

  // Clear highlights when search bar unmounts
  useEffect(() => {
    return () => {
      const view = viewRef.current
      if (view) {
        view.dispatch({ effects: setSearchHighlights.of({ ranges: [], activeIndex: -1 }) })
      }
    }
  }, [viewRef])

  const total = matches.length
  const current = total === 0 ? 0 : matchIndex + 1

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background shrink-0">
      <div className="flex items-center flex-1 gap-2 bg-surface border border-border rounded-md px-2 py-1 focus-within:border-accent/50 transition-colors">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.shiftKey ? onPrev() : onNext() }
            if (e.key === 'Escape') onClose()
            if (e.key === 'f' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onNext() }
          }}
          placeholder="Find in note…"
          className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
        {query.length > 0 && (
          <span className={cn(
            'text-[11px] shrink-0 tabular-nums',
            total === 0 ? 'text-destructive' : 'text-muted-foreground'
          )}>
            {total === 0 ? 'No results' : `${current} / ${total}`}
          </span>
        )}
      </div>

      <button
        onClick={onPrev}
        disabled={total === 0}
        title="Previous match (Shift+Enter)"
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onNext}
        disabled={total === 0}
        title="Next match (Enter)"
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onClose}
        title="Close (Esc)"
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
