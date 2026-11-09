import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SettingsPanel } from './SettingsDialog'
import { TitleBar } from '../layout/TitleBar'
import { isMacApp, isWindowsApp } from '../../lib/platform'
import { startSettingsClient } from '../../lib/settingsSync'

/** Root of the dedicated Settings window (loaded with `?settings=1`). */
export function SettingsWindow() {
  useEffect(() => startSettingsClient(), [])

  // ⌘W / Ctrl+W closes the window, like any preferences window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        getCurrentWindow().close().catch(console.error)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Windows draws its own bar; macOS keeps its traffic lights over an overlay strip;
          elsewhere the native frame is used. */}
      {isWindowsApp && <TitleBar title="Settings" testId="settings-titlebar" />}
      {isMacApp && (
        <div
          data-tauri-drag-region
          data-testid="settings-titlebar"
          className="flex h-9 shrink-0 select-none items-center justify-center border-b border-border bg-sidebar text-xs font-medium text-muted-foreground"
        >
          Settings
        </div>
      )}
      <SettingsPanel />
    </div>
  )
}
