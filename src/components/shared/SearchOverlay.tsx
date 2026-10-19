import { useEffect, useRef } from 'react'
import { FileText, Search, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

export function SearchOverlay() {
  const { searchOpen, searchQuery, setSearchOpen, setSearchQuery, notes, selectNote, folderMeta } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, setSearchOpen, setSearchQuery])

  if (!searchOpen) return null

  // "#tag" searches tags only; otherwise tags (note's own or its folder chain's) match alongside title/content.
  const raw = searchQuery.trim().toLowerCase()
  const tagOnly = raw.startsWith('#')
  const q = raw.replace(/^#+/, '')
  const folderTags = (folder: string | null): string[] => {
    const out: string[] = []
    for (let f = folder; f; f = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null) {
      out.push(...(folderMeta[f]?.tags ?? []))
    }
    return out
  }
  const filtered = raw
    ? notes.filter(n => {
        const tagHit = [...n.tags, ...folderTags(n.folder)].some(t => t.toLowerCase().includes(q))
        if (tagOnly) return tagHit
        return n.title.toLowerCase().includes(raw) || n.content.toLowerCase().includes(raw) || tagHit
      })
    : notes.slice(0, 8)

  const highlight = (text: string) => {
    if (!searchQuery.trim()) return text
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} className="bg-accent/20 text-accent rounded px-0.5 not-italic">{part}</mark>
        : part
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-background/80 backdrop-blur-sm"
      onClick={() => { setSearchOpen(false); setSearchQuery('') }}
    >
      <div
        className="w-[500px] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="flex-1 h-12 bg-transparent text-sm font-sans text-foreground placeholder:text-muted-foreground outline-none border-0"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[280px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notes found</p>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-widest text-tertiary px-4 py-2">
                {searchQuery ? 'Results' : 'Recent Notes'}
              </p>
              {filtered.map(note => (
                <button
                  key={note.id}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-active cursor-pointer text-left"
                  onClick={() => {
                    selectNote(note.id)
                    setSearchOpen(false)
                    setSearchQuery('')
                  }}
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{highlight(note.title)}</p>
                    <p className="text-xs text-muted-foreground truncate">{note.path}</p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-tertiary">
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
