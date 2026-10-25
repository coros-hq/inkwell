import { PenLine } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

/** Centered empty state for the note list: a static stack of pages with a pen. */
export function NoteListEmpty({ folderName }: { folderName?: string }) {
  const createNote = useAppStore((s) => s.createNote)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)

  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-5 px-6 text-center select-none">
      <div className="relative w-36 h-32">
        <svg viewBox="0 0 144 128" className="relative w-full h-full" fill="none" aria-hidden>
          {/* back page */}
          <g transform="rotate(-9 52 70)">
            <rect x="22" y="22" width="68" height="88" rx="9" fill="hsl(var(--surface))" stroke="hsl(var(--border-strong))" strokeWidth="1.5" />
          </g>
          {/* middle page */}
          <g transform="rotate(6 70 70)">
            <rect x="38" y="18" width="68" height="88" rx="9" fill="hsl(var(--card))" stroke="hsl(var(--border-strong))" strokeWidth="1.5" />
          </g>
          {/* front page */}
          <rect x="28" y="28" width="72" height="92" rx="10" fill="hsl(var(--panel))" stroke="hsl(var(--accent) / 0.55)" strokeWidth="1.75" />
          <rect x="40" y="44" width="30" height="5" rx="2.5" fill="hsl(var(--accent) / 0.8)" />
          <rect x="40" y="58" width="48" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.35)" />
          <rect x="40" y="69" width="42" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.35)" />
          <rect x="40" y="80" width="46" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.2)" />
          <rect x="40" y="91" width="26" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.2)" />
          {/* pen */}
          <g transform="rotate(38 112 84)">
            <rect x="106" y="46" width="12" height="52" rx="3" fill="hsl(var(--accent))" />
            <rect x="106" y="46" width="12" height="9" rx="3" fill="hsl(var(--accent-foreground) / 0.35)" />
            <path d="M106 98 L112 112 L118 98 Z" fill="hsl(var(--foreground))" />
          </g>
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-[15px] font-semibold text-foreground">A blank page awaits</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {folderName ? <>Nothing in <span className="text-foreground/80">{folderName}</span> yet.<br /></> : null}
          Start writing and your notes will live here.
        </p>
      </div>

      <button
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        onClick={() => createNote(selectedFolderId)}
      >
        <PenLine className="w-3.5 h-3.5" /> New note
      </button>
    </div>
  )
}
