import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Lightbulb, X, Search } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { countNodes } from '../../lib/brainstorm'
import { useEditorViewRef } from './EditorViewContext'

// Picker for "/brainstorm": inserts a live ```brainstorm embed at the slash position.

export function BrainstormRefDialog() {
  const request = useAppStore(s => s.brainstormRefRequest)
  const close = useAppStore(s => s.closeBrainstormRefDialog)
  const brainstorms = useAppStore(s => s.brainstorms)
  const viewRef = useEditorViewRef()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const items = useMemo(() => brainstorms.filter(b => b.title.toLowerCase().includes(q)), [brainstorms, q])

  const insert = (id: string) => {
    const view = viewRef.current
    if (!view || !request) { close(); return }
    const { pos } = request
    const line = view.state.doc.lineAt(pos)
    const lead = pos !== line.from || line.text.trim().length > 0 ? '\n' : ''
    const text = `${lead}\`\`\`brainstorm\n${id}\n\`\`\`\n`
    view.dispatch({ changes: { from: pos, to: pos, insert: text }, selection: { anchor: pos + text.length } })
    view.focus()
    close()
  }

  return (
    <Dialog.Root open={request !== null} onOpenChange={v => { if (!v) { close(); setQuery('') } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] max-h-[70vh] bg-panel border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden focus:outline-none">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-foreground" />
              <Dialog.Title className="text-sm font-semibold text-foreground">Insert brainstorm</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface">
                <X className="w-3.5 h-3.5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="px-5 pt-4 shrink-0">
            <div className="flex items-center gap-2 border border-border rounded-lg px-2.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search brainstorms…"
                className="flex-1 bg-transparent outline-none py-2 text-sm text-foreground placeholder:text-muted-foreground/50"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-3 mt-1">
            {items.map(b => (
              <button key={b.id} onClick={() => insert(b.id)} className="w-full text-left px-3 py-2 rounded-md hover:bg-surface flex items-center gap-2 text-sm text-foreground">
                <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{b.title || 'Untitled brainstorm'}</span>
                <span className="text-[11px] text-tertiary">{countNodes(b.root)} points</span>
              </button>
            ))}
            {items.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {q ? 'No matches' : 'No brainstorms yet — create one in the Brainstorm view.'}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
