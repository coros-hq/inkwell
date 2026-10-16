import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { Note } from '../types'

export const NOTE_REF_RE = /\[@([^\]]+)\]\(note:\/\/([a-zA-Z0-9-]+)\)/g

/** Obsidian-style `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]` (not `![[embed]]`). */
export const WIKILINK_RE = /(?<!!)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** Resolves a wikilink target to a note the way Obsidian does: by file name
 *  (or vault-relative path), ignoring case, `#heading` and `^block` suffixes;
 *  falls back to the note title. */
export function resolveWikiLink(target: string) {
  const name = target.split(/[#^]/)[0].trim().replace(/\.md$/i, '').toLowerCase()
  if (!name) return undefined
  const { notes, vaultPath } = useAppStore.getState()
  const rel = (n: Note) =>
    (vaultPath && n.path.startsWith(vaultPath + '/') ? n.path.slice(vaultPath.length + 1) : n.path)
      .replace(/\.md$/i, '').toLowerCase()
  return (
    notes.find(n => rel(n) === name) ??
    notes.find(n => baseName(n.path).toLowerCase() === name) ??
    (name.includes('/') ? notes.find(n => rel(n).endsWith('/' + name)) : undefined) ??
    notes.find(n => n.title.toLowerCase() === name)
  )
}

export function navigateToWikiLink(target: string): boolean {
  const note = resolveWikiLink(target)
  if (!note) return false
  navigateToNote(note.id)
  return true
}

export function navigateToNote(noteId: string) {
  const state = useAppStore.getState()
  const note = state.notes.find(n => n.id === noteId)
  if (note) {
    state.selectNote(note.id)
    state.setActiveView('notes')
  }
}

interface NoteRefAutocompleteProps {
  inputValue: string
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  onInsert: (fullValue: string) => void
}

export function NoteRefAutocomplete({
  inputValue,
  inputRef,
  onInsert,
}: NoteRefAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [atIndex, setAtIndex] = useState(-1)
  const [atLength, setAtLength] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notes = useAppStore(s => s.notes)

  useEffect(() => {
    const cursorPos = inputRef.current?.selectionStart ?? inputValue.length
    const textBefore = inputValue.slice(0, cursorPos)
    const match = textBefore.match(/(?:^|\s)(@(\w*))$/)
    if (match) {
      const fullMatch = match[1]
      const q = match[2]
      const idx = (match.index ?? 0) + (match[0].startsWith(' ') ? 1 : 0)
      setQuery(q)
      setAtIndex(idx)
      setAtLength(fullMatch.length)
      const filtered = getFilteredNotes(notes, q)
      setOpen(filtered.length > 0)
      setSelectedIndex(0)

      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect()
        const lineHeight = 20
        const linesUp = inputValue.slice(0, cursorPos).split('\n').length
        setPosition({
          top: rect.top + linesUp * lineHeight + 4,
          left: rect.left + 8,
        })
      }
    } else {
      setOpen(false)
    }
  }, [inputValue, notes, inputRef])

  const filtered = getFilteredNotes(notes, query)

  const handleSelect = useCallback((note: Note) => {
    if (atIndex < 0) return
    const before = inputValue.slice(0, atIndex)
    const after = inputValue.slice(atIndex + atLength)
    const reference = `[@${note.title}](note://${note.id})`
    onInsert(before + reference + after)
    setOpen(false)
  }, [inputValue, atIndex, atLength, onInsert])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % filtered.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex])
      }
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return true
    }
    return false
  }, [open, filtered, selectedIndex, handleSelect])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { handleKeyDown(e); return }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, handleKeyDown])

  if (!open || filtered.length === 0) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => setOpen(false)}
      />
      <div
        ref={dropdownRef}
        className="fixed z-50 min-w-[200px] max-w-[320px] max-h-[240px] overflow-y-auto bg-panel border border-border rounded-lg shadow-xl py-1"
        style={{ top: position.top, left: position.left }}
      >
        {filtered.map((note, i) => (
          <button
            key={note.id}
            onClick={() => handleSelect(note)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
              i === selectedIndex
                ? 'bg-active text-accent'
                : 'text-foreground hover:bg-surface'
            }`}
          >
            <span className="truncate flex-1">{note.title}</span>
            {note.folder && (
              <span className="text-[10px] text-tertiary truncate max-w-[100px]">
                {note.folder}
              </span>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-tertiary">No matching notes</div>
        )}
      </div>
    </>
  )
}

function getFilteredNotes(notes: Note[], query: string): Note[] {
  if (!query) return notes.slice(0, 20)
  const lower = query.toLowerCase()
  return notes
    .filter(n => n.title.toLowerCase().includes(lower))
    .slice(0, 20)
}

export function NoteRefDisplay({
  text,
  className = '',
}: {
  text: string
  className?: string
}) {
  if (!text) return <span className={className}>{text}</span>

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = null
  const re = new RegExp(NOTE_REF_RE.source, 'g')

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const title = match[1]
    const noteId = match[2]
    parts.push(
      <button
        key={match.index}
        onClick={() => navigateToNote(noteId)}
        className="inline-flex items-center gap-0.5 text-accent underline underline-offset-2 hover:opacity-80 font-medium cursor-pointer"
        title={`Open note: ${title}`}
      >
        @{title}
      </button>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  if (parts.length === 0) return <span className={className}>{text}</span>

  return <span className={className}>{parts}</span>
}
