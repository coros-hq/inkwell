import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'

export const TAG_COLORS = [
  'hsl(210 80% 58%)', 'hsl(135 55% 48%)', 'hsl(5 75% 58%)', 'hsl(265 65% 62%)',
  'hsl(35 90% 55%)', 'hsl(175 60% 42%)', 'hsl(320 65% 58%)', 'hsl(220 10% 55%)',
]

interface Props {
  /** Present when editing an existing tag. */
  initial?: { name: string; color: string }
  onSave: (name: string, color: string) => void
  onDelete?: () => void
  onClose: () => void
}

export function TagDialog({ initial, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? TAG_COLORS[0])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name, color)
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xs bg-panel border border-border rounded-lg shadow-lg p-5 focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-sm font-semibold text-foreground mb-3">
            {initial ? 'Edit tag' : 'New tag'}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Choose a name and a colour for the tag.</Dialog.Description>
          <form onSubmit={submit}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tag name"
              className="w-full h-9 px-3 text-sm bg-surface border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2 mt-3">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  className={cn(
                    'w-6 h-6 rounded-full transition-transform',
                    color === c ? 'ring-2 ring-offset-2 ring-offset-panel ring-foreground/70 scale-110' : 'hover:scale-110',
                  )}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-5">
              {onDelete && (
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md"
                  onClick={() => { onDelete(); onClose() }}
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button type="button" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded-md hover:opacity-90 disabled:opacity-40"
              >
                {initial ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
