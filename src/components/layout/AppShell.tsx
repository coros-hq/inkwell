import { useEffect, useRef, useState } from 'react'
import { isDarkTheme, THEMES, loadCustomThemes } from '../../lib/themes'
import { deriveThemeVars, applyCustomThemeVars, clearCustomThemeVars } from '../../lib/themeUtils'
import { Sidebar } from './Sidebar'
import { NoteList } from './NoteList'
import { EditorPane } from './EditorPane'
import { BoardView } from '../board/BoardView'
import { CanvasView } from '../canvas/CanvasView'
import { BrainstormView } from '../brainstorm/BrainstormView'
import { CalendarView } from '../calendar/CalendarView'
import { TaskDrawer } from '../board/TaskDrawer'
import { SearchOverlay } from '../shared/SearchOverlay'
import { NamePromptDialog } from '../shared/NamePromptDialog'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { VaultPicker } from '../shared/VaultPicker'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import { confirmDeleteNote, confirmDeleteSelectedNotes, confirmDeleteFolderById } from '../../lib/deleteActions'
import { onWriteError } from '../../lib/safeFs'
import { readVaultFS, writeAppData, readAppData, addRecentVault, getLastVaultPath } from '../../lib/vault'
import type { AppData } from '../../lib/vault'
import { comboMatches } from '../../lib/shortcuts'
import { focusFileNav, focusNavList } from '../../lib/listKeyNav'
import { startVaultSync, stopVaultSync } from '../../lib/sync/vaultSession'
import { onAuthStateChange } from '../../lib/auth'
import { startVaultWatcher } from '../../lib/vaultWatcher'
import { TrashView } from '../trash/TrashView'
import { ConflictBanner } from '../editor/ConflictBanner'
import { CollabGlobals } from '../collab/CollabGlobals'

export function AppShell() {
  const { activeView, setActiveView, setSearchOpen, vaultPath, openVault, toggleSidebar, sidebarOpen, focusMode, noteSidebarMode, sidebarGlass, bodyGlass, openExternalNote, createNote, createFolder, openPrompt, checkForUpdates } = useAppStore()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('inkwell-theme')
    // Backward compat: 'dark' → 'midnight', 'light' → 'parchment'
    const resolvedId: string = saved === 'dark' ? 'midnight'
      : saved === 'light' ? 'parchment'
      : (saved && THEMES.find(t => t.id === saved)) ? saved
      : saved ?? 'midnight'   // may be a custom theme id

    const customThemes = loadCustomThemes()
    const custom = customThemes.find(t => t.id === resolvedId)
    const dark = custom ? custom.dark : isDarkTheme(resolvedId)

    document.documentElement.classList.toggle('dark', dark)
    if (custom) {
      delete document.documentElement.dataset.theme
      applyCustomThemeVars(deriveThemeVars(custom.colors, dark))
    } else {
      clearCustomThemeVars()
      document.documentElement.dataset.theme = resolvedId
    }
    useAppStore.setState({
      themeName: resolvedId,
      theme: dark ? 'dark' : 'light',
      customThemes,
    })
    // Seed per-mode keys so toggleTheme can round-trip correctly
    const modeKey = dark ? 'inkwell-last-dark-theme' : 'inkwell-last-light-theme'
    if (!localStorage.getItem(modeKey)) {
      localStorage.setItem(modeKey, resolvedId)
    }
  }, [])

  // Restore native vibrancy if it was enabled last session
  useEffect(() => {
    const glass = localStorage.getItem('inkwell-sidebar-glass') === 'true'
      || localStorage.getItem('inkwell-body-glass') === 'true'
    if (!glass) return
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        const dark = useAppStore.getState().theme === 'dark'
        invoke('set_vibrancy', { enabled: true, dark }).catch(console.error)
      })
    }
  }, [])

  // Quiet background check for a newer release — see updateCheck.ts for the
  // rate-limiting/dismissal rules that keep this from ever nagging.
  useEffect(() => {
    checkForUpdates()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Surface failed disk writes (full disk, read-only folder, permissions…)
  // instead of leaving them in the console.
  useEffect(() => {
    return onWriteError((path, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      useAppStore.getState().setSaveError(`Couldn't save ${path.split('/').pop()}: ${reason}`)
    })
  }, [])

  // Attempt to restore last opened vault on startup
  useEffect(() => {
    const lastPath = getLastVaultPath()
    if (!lastPath) return
    readVaultFS(lastPath).then((data) => {
      addRecentVault(lastPath)
      openVault(lastPath, data)
    }).catch(() => {
      // Silently fail — vault picker will be shown instead
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save boards/tasks to .inkwell/app.json (notes are written inline by store actions)
  useEffect(() => {
    if (!vaultPath) return
    return useAppStore.subscribe((state) => {
      if (!state.vaultPath) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const vp = state.vaultPath!
        // Start from what's on disk so fields this effect doesn't own
        // (externalFiles, gitSyncEnabled, gitAutoCommit, noteMeta, …) survive.
        const existing = await readAppData(vp)
        const appData: AppData = {
          ...existing,
          version: 1,
          tasks: state.tasks,
          boards: state.boards,
          boardColumns: state.boardColumns,
          boardTasks: state.boardTasks,
          noteMeta: existing?.noteMeta ?? {},
        }
        writeAppData(vp, appData)
      }, 800)
    })
  }, [vaultPath])

  // "Auto-commit on save" (Settings > Sync) — commits, never pushes, a few
  // seconds after edits settle. Off unless both gitSyncEnabled and
  // gitAutoCommit are on; autoCommitIfDue itself is a no-op otherwise.
  useEffect(() => {
    if (!vaultPath) return
    return useAppStore.subscribe((state) => {
      if (!state.vaultPath || !state.gitSyncEnabled || !state.gitAutoCommit) return
      if (autoCommitTimer.current) clearTimeout(autoCommitTimer.current)
      autoCommitTimer.current = setTimeout(() => {
        useAppStore.getState().autoCommitIfDue().catch(console.error)
      }, 4000)
    })
  }, [vaultPath])

  // Watch the vault for changes made outside the app (git pull, iCloud/Dropbox/
  // Syncthing, a manual edit elsewhere) and fold them into the store — see
  // git-sync-feature-design.md. Self-suppressing: inkwell's own writes don't
  // trigger this (see selfWriteRegistry.ts).
  useEffect(() => {
    if (!vaultPath) return
    let handle: { stop: () => void } | null = null
    let cancelled = false
    startVaultWatcher(vaultPath, (paths) => {
      useAppStore.getState().refreshVaultFromDisk({ adoptContentFor: new Set(paths) }).catch(console.error)
    }).then((h) => {
      if (cancelled) h.stop()
      else handle = h
    })
    // Fallback for when the native watcher misses events (e.g. a file dragged
    // in from Finder): re-scan on window focus. Empty adopt set keeps every
    // in-memory note body, so only added/removed files change.
    const onFocus = () => {
      if (useAppStore.getState().vaultPath !== vaultPath) return
      useAppStore.getState().refreshVaultFromDisk({ adoptContentFor: new Set() }).catch(console.error)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      handle?.stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [vaultPath])

  // Team sync: one live session for the open vault when it's linked to a
  // cloud vault (.inkwell/team.json) — a no-op for local-only vaults. Restarted
  // on sign-in/out so a fresh login picks up syncing without a relaunch.
  useEffect(() => {
    if (!vaultPath) return
    startVaultSync(vaultPath).catch(console.error)
    const unsubscribe = onAuthStateChange((session) => {
      if (useAppStore.getState().vaultPath !== vaultPath) return
      if (session) startVaultSync(vaultPath).catch(console.error)
      else stopVaultSync().catch(console.error)
    })
    return () => {
      unsubscribe()
      stopVaultSync().catch(console.error)
    }
  }, [vaultPath])

  // Git sync: pull/push on vault open and whenever the window regains focus —
  // no continuous polling, consistent with the rest of the app.
  useEffect(() => {
    if (!vaultPath) return
    const { gitSyncEnabled, syncNow } = useAppStore.getState()
    if (gitSyncEnabled) syncNow().catch(console.error)

    const onFocus = () => {
      const s = useAppStore.getState()
      if (s.vaultPath === vaultPath && s.gitSyncEnabled) s.syncNow().catch(console.error)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [vaultPath])

  // Search / toggle sidebar / open external file — user-remappable, see Settings > Shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { shortcuts, recordingShortcut } = useAppStore.getState()
      if (recordingShortcut) return
      if (comboMatches(e, shortcuts.commandPalette)) {
        e.preventDefault()
        useAppStore.getState().setSearchMode('commands')
        setSearchOpen(true)
        return
      }
      if (comboMatches(e, shortcuts.search)) {
        e.preventDefault()
        useAppStore.getState().setSearchMode('notes')
        setSearchOpen(true)
        return
      }
      if (comboMatches(e, shortcuts.toggleSidebar)) {
        e.preventDefault()
        toggleSidebar()
        return
      }
      if (comboMatches(e, shortcuts.focusMode)) {
        e.preventDefault()
        const s = useAppStore.getState()
        if (s.activeView === 'notes') s.toggleFocusMode()
        return
      }
      if (comboMatches(e, shortcuts.toggleEditorMode)) {
        e.preventDefault()
        const s = useAppStore.getState()
        const id = s.lastSelectedNoteId ?? s.selectedNoteIds[0]
        if (s.activeView === 'notes' && id) s.setNoteEditorMode(id, s.getEditorMode(id) === 'markdown' ? 'normal' : 'markdown')
        return
      }
      if (e.key === 'Escape' && useAppStore.getState().focusMode) {
        useAppStore.getState().toggleFocusMode()
        return
      }
      if (comboMatches(e, shortcuts.focusFiles)) {
        e.preventDefault()
        const st = useAppStore.getState()
        if (st.activeView !== 'notes') st.setActiveView('notes')
        if (st.focusMode) st.toggleFocusMode()
        const wasClosed = !st.sidebarOpen
        if (wasClosed) st.toggleSidebar()
        const active = st.lastSelectedNoteId ?? st.selectedNoteIds[0]
        setTimeout(() => focusFileNav(active ? `note:${active}` : null), wasClosed ? 260 : 0)
        return
      }
      if (comboMatches(e, shortcuts.focusNotes)) {
        e.preventDefault()
        const st = useAppStore.getState()
        if (st.activeView !== 'notes') st.setActiveView('notes')
        if (st.focusMode) st.toggleFocusMode()
        if (st.noteSidebarMode === 'tabs') st.setNoteSidebarMode('list')
        const active = st.lastSelectedNoteId ?? st.selectedNoteIds[0]
        setTimeout(() => {
          const list = document.querySelector<HTMLElement>('[data-nav-list="notelist"]')
          if (list) focusNavList(list, active ? `note:${active}` : null)
        }, 0)
        return
      }
      if (comboMatches(e, shortcuts.openFile)) {
        e.preventDefault()
        openExternalNote()
        return
      }
      if (comboMatches(e, shortcuts.newNote)) {
        e.preventDefault()
        setActiveView('notes')
        // Always at the library root — creating inside a specific folder is done
        // via that folder's right-click context menu ("New note").
        createNote(null)
        return
      }
      if (comboMatches(e, shortcuts.newFolder)) {
        e.preventDefault()
        setActiveView('notes')
        const folderId = useAppStore.getState().selectedFolderId
        openPrompt({
          title: folderId ? 'New Subfolder' : 'New Folder',
          placeholder: 'Folder name',
          confirmLabel: 'Create',
          onConfirm: (name) => createFolder(name, folderId),
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearchOpen, toggleSidebar, openExternalNote, setActiveView, createNote, createFolder, openPrompt])

  // Delete key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (useAppStore.getState().recordingShortcut) return

      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.cm-editor')
      ) {
        return
      }

      const { activeView, selectedNoteIds, selectedFolderId, notes } = useAppStore.getState()
      if (activeView !== 'notes') return

      if (selectedNoteIds.length > 0) {
        e.preventDefault()
        if (selectedNoteIds.length > 1) {
          confirmDeleteSelectedNotes()
        } else {
          const note = notes.find(n => n.id === selectedNoteIds[0])
          if (note) confirmDeleteNote(note.id, note.title)
        }
        return
      }

      if (selectedFolderId) {
        e.preventDefault()
        confirmDeleteFolderById(selectedFolderId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!vaultPath) {
    return (
      <>
        <VaultPicker />
        <CollabGlobals />
      </>
    )
  }

  return (
    <div className={cn("flex h-screen w-screen overflow-hidden", !(sidebarGlass || bodyGlass) && "bg-background")}>
      <SidebarSlide open={sidebarOpen && !focusMode} />

      {activeView === 'notes' && (
        <>
          {noteSidebarMode === 'list' && !focusMode && <NoteList />}
          <EditorPane />
        </>
      )}

      {activeView === 'board' && <BoardView />}

      {activeView === 'canvas' && <CanvasView />}

      {activeView === 'brainstorm' && <BrainstormView />}

      {activeView === 'calendar' && <CalendarView />}

      {activeView === 'trash' && <TrashView />}

      {!focusMode && <TaskDrawer />}

      <SearchOverlay />
      <NamePromptDialog />
      <ConfirmDialog />
      <ConflictBanner />
      <CollabGlobals />
    </div>
  )
}

// Slides the sidebar in/out by animating a 0fr <-> 1fr grid track; the sidebar keeps its
// own fixed pixel width so its content never reflows mid-animation. It stays mounted
// only while visible or animating, so a closed sidebar is not running in the background.
function SidebarSlide({ open }: { open: boolean }) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)))
      return () => cancelAnimationFrame(id)
    }
    setExpanded(false)
    const t = setTimeout(() => setMounted(false), 220)
    return () => clearTimeout(t)
  }, [open])
  if (!mounted) return null
  return (
    <div
      className="grid shrink-0 h-full transition-[grid-template-columns] duration-200 ease-out"
      style={{ gridTemplateColumns: expanded ? '1fr' : '0fr' }}
    >
      <div className="min-w-0 overflow-hidden h-full" inert={!open}>
        <Sidebar />
      </div>
    </div>
  )
}
