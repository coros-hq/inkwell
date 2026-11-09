import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '../../lib/utils'
import inkwellIcon from '../../assets/inkwell-icon.svg'

// Windows frameless titlebar: the native frame is disabled on Windows, so the
// app draws its own drag area and minimize / maximize / close controls.
export function TitleBar({ title = 'inkwell', testId = 'titlebar' }: { title?: string; testId?: string } = {}) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined
    let cancelled = false
    const sync = () => win.isMaximized().then(m => { if (!cancelled) setMaximized(m) }).catch(() => {})
    sync()
    win.onResized(sync).then(fn => { if (cancelled) fn(); else unlisten = fn }).catch(() => {})
    return () => { cancelled = true; unlisten?.() }
  }, [])

  const win = () => getCurrentWindow()

  return (
    <div
      data-testid={testId}
      data-tauri-drag-region
      className="h-8 shrink-0 flex items-stretch justify-between border-b border-border bg-background select-none"
    >
      <div className="flex items-center gap-2 pl-3 pointer-events-none">
        <img src={inkwellIcon} alt="" className="h-4 w-4" draggable={false} />
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>

      <div className="flex items-stretch" data-tauri-no-drag>
        <ControlButton label="Minimize" onClick={() => win().minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
        </ControlButton>
        <ControlButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => win().toggleMaximize()}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5v-2h7v7h-2" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => win().close()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
        </ControlButton>
      </div>
    </div>
  )
}

function ControlButton({
  label, danger, onClick, children,
}: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'w-[46px] flex items-center justify-center text-foreground/80 transition-colors',
        danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-foreground/10',
      )}
    >
      {children}
    </button>
  )
}
