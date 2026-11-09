import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Upload, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import {
  COLOR_PRESETS, GRADIENT_PRESETS, backgroundStyle, pickBackgroundImage,
} from '../../lib/boardBackgrounds'
import type { Board, BoardBackground } from '../../types'

/** Top-bar button + popover for choosing a board's wallpaper (Trello-style). */
export function BoardBackgroundPicker({ board }: { board: Board }) {
  const { vaultPath, setBoardBackground } = useAppStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const current = board.background
  const choose = (bg: BoardBackground | null) => setBoardBackground(board.id, bg)

  const upload = async () => {
    if (!vaultPath) return
    const path = await pickBackgroundImage(vaultPath)
    if (path) choose({ type: 'image', path })
  }

  const isActive = (bg: BoardBackground) =>
    current?.type === bg.type && JSON.stringify(current) === JSON.stringify(bg)

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded transition-colors',
          open || current ? 'text-accent bg-accent/10' : 'text-muted-foreground hover:text-foreground hover:bg-surface',
        )}
        title="Board background"
        aria-label="Board background"
        aria-expanded={open}
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Board background"
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-border bg-panel p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Background</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <Section label="Gradients">
            {GRADIENT_PRESETS.map(g => {
              const bg: BoardBackground = { type: 'gradient', value: g.value }
              return <Swatch key={g.name} label={g.name} style={backgroundStyle(bg, null)!} active={isActive(bg)} onClick={() => choose(bg)} />
            })}
          </Section>

          <Section label="Colors">
            {COLOR_PRESETS.map(c => {
              const bg: BoardBackground = { type: 'color', value: c.value }
              return <Swatch key={c.name} label={c.name} style={backgroundStyle(bg, null)!} active={isActive(bg)} onClick={() => choose(bg)} />
            })}
          </Section>

          <div className="mt-3 flex gap-2">
            <button
              onClick={upload}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-background"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload image…
            </button>
            {current && (
              <button
                onClick={() => choose(null)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-red-500"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-4 gap-1.5">{children}</div>
    </div>
  )
}

function Swatch({
  label, style, active, onClick,
}: { label: string; style: React.CSSProperties; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={style}
      className={cn(
        'h-10 rounded-md border border-black/10 transition-transform hover:scale-[1.04]',
        active && 'ring-2 ring-accent ring-offset-1 ring-offset-panel',
      )}
    />
  )
}
