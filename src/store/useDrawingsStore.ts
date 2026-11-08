import { create } from 'zustand'
import {
  type DrawingMeta,
  deleteDrawingFile,
  loadDrawing,
  loadDrawingIndex,
  newDrawingMeta,
  saveDrawing,
  saveDrawingIndex,
} from '../lib/drawings'

// Index of canvas drawings (title / tags / folder link). The shapes of the open
// drawing are owned by CanvasView; this store only tracks which drawing is open
// and persists the metadata.

interface DrawingsState {
  drawings: DrawingMeta[]
  activeId: string | null
  loaded: boolean
  /** Storage root this index was loaded from (null = global ~/.inkwell). */
  linkedVault: string | null

  init: (linkedVault: string | null) => Promise<void>
  setActive: (id: string) => void
  create: (title?: string, folderPath?: string | null) => string
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  duplicate: (id: string) => Promise<void>
  setFolder: (id: string, folderPath: string | null) => void
  setTag: (id: string, tag: string, on: boolean) => void
  /** Bumps updatedAt (called after the open drawing is saved). */
  touch: (id: string) => void
  /** CanvasView registers a function that writes the open drawing to disk now. */
  registerFlush: (fn: (() => Promise<void>) | null) => void
}

let flushActive: (() => Promise<void>) | null = null
let indexTimer: ReturnType<typeof setTimeout> | null = null

export const useDrawingsStore = create<DrawingsState>((set, get) => {
  const persist = () => {
    if (indexTimer) clearTimeout(indexTimer)
    indexTimer = setTimeout(() => {
      indexTimer = null
      const { linkedVault, drawings, loaded } = get()
      if (loaded) void saveDrawingIndex(linkedVault, drawings)
    }, 300)
  }
  const patch = (id: string, fn: (d: DrawingMeta) => DrawingMeta) => {
    set((s) => ({ drawings: s.drawings.map((d) => (d.id === id ? { ...fn(d), updatedAt: Date.now() } : d)) }))
    persist()
  }

  return {
    drawings: [],
    activeId: null,
    loaded: false,
    linkedVault: null,

    init: async (linkedVault) => {
      // Write out any edit still waiting on the debounce before re-reading the index.
      if (indexTimer) {
        clearTimeout(indexTimer); indexTimer = null
        const cur = get()
        if (cur.loaded) await saveDrawingIndex(cur.linkedVault, cur.drawings)
      }
      set({ loaded: false })
      const drawings = await loadDrawingIndex(linkedVault)
      const lastId = localStorage.getItem('inkwell-active-drawing')
      const activeId = drawings.find((d) => d.id === lastId)?.id ?? drawings[0].id
      set({ drawings, activeId, linkedVault, loaded: true })
    },

    setActive: (id) => {
      localStorage.setItem('inkwell-active-drawing', id)
      set({ activeId: id })
    },

    create: (title = 'Untitled drawing', folderPath = null) => {
      const meta = newDrawingMeta(title, folderPath)
      set((s) => ({ drawings: [...s.drawings, meta], activeId: meta.id }))
      localStorage.setItem('inkwell-active-drawing', meta.id)
      persist()
      return meta.id
    },

    rename: (id, title) => patch(id, (d) => ({ ...d, title: title.trim() || 'Untitled drawing' })),

    remove: (id) => {
      const { drawings, activeId, linkedVault } = get()
      void deleteDrawingFile(linkedVault, id)
      let next = drawings.filter((d) => d.id !== id)
      // Never leave the canvas without a drawing.
      if (!next.length) next = [newDrawingMeta('My canvas')]
      const nextActive = activeId === id ? next[0].id : activeId
      set({ drawings: next, activeId: nextActive })
      if (nextActive) localStorage.setItem('inkwell-active-drawing', nextActive)
      persist()
    },

    duplicate: async (id) => {
      const { drawings, linkedVault, activeId } = get()
      const src = drawings.find((d) => d.id === id)
      if (!src) return
      if (id === activeId && flushActive) await flushActive()
      const file = await loadDrawing(linkedVault, id)
      const copy = { ...newDrawingMeta(`${src.title} copy`, src.folderPath), tags: [...src.tags] }
      await saveDrawing(linkedVault, copy.id, file)
      set((s) => ({ drawings: [...s.drawings, copy], activeId: copy.id }))
      localStorage.setItem('inkwell-active-drawing', copy.id)
      persist()
    },

    setFolder: (id, folderPath) => patch(id, (d) => ({ ...d, folderPath })),

    setTag: (id, tag, on) =>
      patch(id, (d) => ({ ...d, tags: on ? (d.tags.includes(tag) ? d.tags : [...d.tags, tag]) : d.tags.filter((t) => t !== tag) })),

    touch: (id) => {
      set((s) => ({ drawings: s.drawings.map((d) => (d.id === id ? { ...d, updatedAt: Date.now() } : d)) }))
      persist()
    },

    registerFlush: (fn) => { flushActive = fn },
  }
})
