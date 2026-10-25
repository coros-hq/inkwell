import { useEffect, useRef, useState } from 'react'
import { CalendarDays, FileText, Search, X, Command, Hash } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { SHORTCUT_DEFS, formatCombo } from '../../lib/shortcuts'
import { cn } from '../../lib/utils'
import { TagChip } from './TagChip'

// Fixed key bindings that aren't remappable — listed in the palette for lookup only.
const STATIC_KEYMAPS: { label: string; description: string; keys: string }[] = [
  { label: 'Bold', description: 'Editor · wrap selection in **', keys: 'mod+b' },
  { label: 'Italic', description: 'Editor · wrap selection in *', keys: 'mod+i' },
  { label: 'Underline', description: 'Editor', keys: 'mod+u' },
  { label: 'Strikethrough', description: 'Editor', keys: 'mod+shift+s' },
  { label: 'Select next occurrence', description: 'Editor · multi-cursor', keys: 'mod+d' },
  { label: 'Nest list item', description: 'Editor · bullet / numbered lists', keys: 'tab' },
  { label: 'Un-nest list item', description: 'Editor · bullet / numbered lists', keys: 'shift+tab' },
  { label: 'Rename', description: 'File tree · focused row', keys: 'f2' },
  { label: 'Back to editor', description: 'File tree · focused row', keys: 'escape' },
]

type Entry =
  | { kind: 'command'; id: string; label: string; description: string; combo: string; runnable: boolean }
  | { kind: 'note'; id: string }
  | { kind: 'event'; id: string }

// Re-fires a shortcut as a keydown on window, so it runs through the same handler a real keypress would.
function runCombo(combo: string) {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
    ctrlKey: parts.includes('mod'), shiftKey: parts.includes('shift'), altKey: parts.includes('alt'),
  }))
}

export function SearchOverlay() {
  const { searchOpen, searchQuery, setSearchOpen, setSearchQuery, searchMode, setSearchMode, shortcuts, tagDefs, notes, selectNote, folderMeta, calendarEnabled, calendarEvents, openCalendarEvent } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(0)
  const commandMode = searchMode === 'commands'
  const tagMode = searchMode === 'tags'

  const close = () => { setSearchOpen(false); setSearchQuery(''); setSearchMode('notes') }

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [searchOpen, searchMode])

  useEffect(() => { setCursor(0) }, [searchQuery, searchMode, searchOpen])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchOpen) {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen])

  if (!searchOpen) return null

  // "#tag" searches tags only; otherwise tags (note's own or its folder chain's) match alongside title/content.
  const raw = searchQuery.trim().toLowerCase()
  // Tags tab, or a leading '#', matches tags and nothing else (no titles / content).
  const tagOnly = tagMode || raw.startsWith('#')
  const q = raw.replace(/^#+/, '')
  const folderTags = (folder: string | null): string[] => {
    const out: string[] = []
    for (let f = folder; f; f = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null) {
      out.push(...(folderMeta[f]?.tags ?? []))
    }
    return out
  }
  const filtered = raw || tagMode
    ? notes.filter(n => {
        const tagHit = [...n.tags, ...folderTags(n.folder)].some(t => t.toLowerCase().includes(q))
        if (tagOnly) return tagHit
        return n.title.toLowerCase().includes(raw) || n.content.toLowerCase().includes(raw) || tagHit
      })
    : notes.slice(0, 8)

  const eventResults = raw && !tagOnly && calendarEnabled
    ? calendarEvents.filter(e => e.title.toLowerCase().includes(raw) || (e.notes ?? '').toLowerCase().includes(raw)).slice(0, 8)
    : []

  const cmdQuery = raw.split(/\s+/).filter(Boolean)
  const commandEntries: Entry[] = commandMode
    ? [
        ...SHORTCUT_DEFS.filter(d => d.id !== 'commandPalette').map((d): Entry => ({
          kind: 'command', id: d.id, label: d.label, description: d.description, combo: shortcuts[d.id] ?? d.defaultCombo, runnable: true,
        })),
        ...STATIC_KEYMAPS.map((k): Entry => ({ kind: 'command', id: `static:${k.label}`, label: k.label, description: k.description, combo: k.keys, runnable: false })),
      ].filter(en => en.kind !== 'command' || cmdQuery.every(w => `${en.label} ${en.description} ${formatCombo(en.combo)} ${en.combo}`.toLowerCase().includes(w)))
    : []
  const entries: Entry[] = commandMode
    ? commandEntries
    : [...filtered.map((n): Entry => ({ kind: 'note', id: n.id })), ...eventResults.map((ev): Entry => ({ kind: 'event', id: ev.id }))]
  const activeIdx = Math.min(cursor, Math.max(entries.length - 1, 0))

  const activate = (en: Entry | undefined) => {
    if (!en) return
    close()
    if (en.kind === 'note') selectNote(en.id)
    else if (en.kind === 'event') openCalendarEvent(en.id)
    else if (en.runnable) {
      if (en.id === 'search') { setSearchMode('notes'); setSearchOpen(true); return }
      setTimeout(() => runCombo(en.combo), 0)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setCursor(Math.min(activeIdx + 1, entries.length - 1)) }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setCursor(Math.max(activeIdx - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); activate(entries[activeIdx]) }
    else if (e.key === 'Tab') { e.preventDefault(); setSearchMode(searchMode === 'notes' ? 'tags' : searchMode === 'tags' ? 'commands' : 'notes') }
  }

  // A short window of text around the first body match, so a content hit is
  // visible in the results instead of looking like a stray title match.
  const snippet = (text: string): string | null => {
    if (!raw || tagOnly) return null
    const i = text.toLowerCase().indexOf(raw)
    if (i < 0) return null
    const start = Math.max(0, i - 36)
    const end = Math.min(text.length, i + raw.length + 60)
    const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
    return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
  }

  const highlight = (text: string) => {
    const needle = searchQuery.trim().replace(/^#+/, '')
    if (!needle) return text
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === needle.toLowerCase()
        ? <mark key={i} className="bg-accent/20 text-accent rounded px-0.5 not-italic">{part}</mark>
        : part
    )
  }

  const rowCls = (active: boolean) => cn(
    'w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer text-left',
    active ? 'bg-active' : 'hover:bg-active/60',
  )
  let idx = -1

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-background/80 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-[560px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-3 pt-2.5">
          {([['notes', 'Notes', Search], ['tags', 'Tags', Hash], ['commands', 'Shortcuts', Command]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              onClick={() => { setSearchMode(m); inputRef.current?.focus() }}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                searchMode === m ? 'bg-active text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-border">
          {commandMode ? <Command className="w-4 h-4 text-muted-foreground shrink-0" /> : tagMode ? <Hash className="w-4 h-4 text-muted-foreground shrink-0" /> : <Search className="w-4 h-4 text-muted-foreground shrink-0" />}
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={commandMode ? 'Find a shortcut or command...' : tagMode ? 'Search by tag only...' : 'Search notes...'}
            className="flex-1 h-12 bg-transparent text-sm font-sans text-foreground placeholder:text-muted-foreground outline-none border-0"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nothing found</p>
          ) : commandMode ? (
            <>
              {entries.map(en => {
                if (en.kind !== 'command') return null
                idx++
                const active = idx === activeIdx
                const i = idx
                return (
                  <button
                    key={en.id}
                    data-active={active}
                    className={rowCls(active)}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => activate(en)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{highlight(en.label)}</p>
                      <p className="text-xs text-muted-foreground truncate">{en.description}</p>
                    </div>
                    <kbd className="shrink-0 font-mono text-[11px] text-muted-foreground bg-surface border border-border rounded px-1.5 py-0.5">
                      {formatCombo(en.combo)}
                    </kbd>
                  </button>
                )
              })}
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-widest text-tertiary px-4 py-2">
                {tagMode ? 'Tagged notes' : searchQuery ? 'Results' : 'Recent Notes'}
              </p>
              {tagMode && tagDefs.length > 0 && (
                <div className="flex flex-wrap gap-1 px-4 pb-2">
                  {tagDefs.map(t => (
                    <button
                      key={t.name}
                      onClick={() => { setSearchQuery(q === t.name.toLowerCase() ? '' : t.name); inputRef.current?.focus() }}
                      className={cn(
                        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                        q === t.name.toLowerCase() ? 'bg-accent/20 text-accent' : 'bg-surface text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.name}
                    </button>
                  ))}
                </div>
              )}
              {filtered.map(note => {
                idx++
                const active = idx === activeIdx
                const i = idx
                return (
                  <button
                    key={note.id}
                    data-active={active}
                    className={rowCls(active)}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => activate({ kind: 'note', id: note.id })}
                  >
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{highlight(note.title)}</p>
                      {(() => {
                        const hit = !note.title.toLowerCase().includes(raw) ? snippet(note.content) : null
                        return hit
                          ? <p className="text-xs text-muted-foreground truncate">{highlight(hit)}</p>
                          : <p className="text-xs text-muted-foreground truncate">{note.path}</p>
                      })()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {[...new Set([...note.tags, ...folderTags(note.folder)])].slice(0, 3).map(t => (
                        <TagChip key={t} tag={t} />
                      ))}
                    </div>
                  </button>
                )
              })}
              {eventResults.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-widest text-tertiary px-4 py-2">Calendar</p>
                  {eventResults.map(ev => {
                    idx++
                    const active = idx === activeIdx
                    const i = idx
                    return (
                      <button
                        key={ev.id}
                        data-active={active}
                        className={rowCls(active)}
                        onMouseMove={() => setCursor(i)}
                        onClick={() => activate({ kind: 'event', id: ev.id })}
                      >
                        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{highlight(ev.title)}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {ev.date}{!ev.title.toLowerCase().includes(raw) && ev.notes ? ` · ${highlight(snippet(ev.notes) ?? '')}` : ''}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-tertiary">
          <span><kbd className="font-mono">↵</kbd> {commandMode ? 'run' : 'open'}</span>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">tab</kbd> switch</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
