import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// Keyboard navigation over rows tagged `data-nav="note" | "folder"` (see Sidebar /
// NoteList). Rows are real DOM-focusable elements, so the cursor is just document focus.
//   ↑/↓ move · Home/End jump · → expand / step in · ← collapse / go to parent
//   Enter/Space open note or toggle folder · F2 rename · Esc back to the editor

const ROW_SELECTOR = '[data-nav]'

export function getNavRows(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(el => el.offsetParent !== null)
}

export function focusEditor() {
  document.querySelector<HTMLElement>('.cm-content')?.focus()
}

/** Focus the tree, or — when focus is already in the tree — the note list column. */
export function focusFileNav(preferred?: string | null) {
  const side = document.querySelector<HTMLElement>('[data-nav-list="sidebar"]')
  const list = document.querySelector<HTMLElement>('[data-nav-list="notelist"]')
  if (side?.contains(document.activeElement) && list && focusNavList(list, preferred)) return
  if (side && focusNavList(side, preferred)) return
  if (list) focusNavList(list, preferred)
}

/** Focuses the active row (or the first one) inside `container`; returns false if there are none. */
export function focusNavList(container: ParentNode, preferred?: string | null): boolean {
  const rows = getNavRows(container)
  const row = (preferred && rows.find(r => r.dataset.navId === preferred)) || rows[0]
  if (!row) return false
  row.focus()
  row.scrollIntoView({ block: 'nearest' })
  return true
}

export function handleListKeyNav(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target as HTMLElement
  // Rename inputs, buttons inside rows, etc. keep their own keys.
  const row = target.closest<HTMLElement>(ROW_SELECTOR)
  if (!row || row !== target) return

  const rows = getNavRows(e.currentTarget)
  const i = rows.indexOf(row)
  const go = (el: HTMLElement | undefined) => {
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }
  const isFolder = row.dataset.nav === 'folder'
  const expanded = row.dataset.navExpanded === 'true'

  switch (e.key) {
    case 'ArrowDown': go(rows[Math.min(i + 1, rows.length - 1)]); break
    case 'ArrowUp': go(rows[Math.max(i - 1, 0)]); break
    case 'Home': go(rows[0]); break
    case 'End': go(rows[rows.length - 1]); break
    case 'ArrowRight':
      if (!isFolder) {
        // Sidebar tree -> note list column
        const next = document.querySelector<HTMLElement>('[data-nav-list="notelist"]')
        if (e.currentTarget.dataset.navList === 'sidebar' && next) focusNavList(next)
        else return
        break
      }
      if (!expanded) row.click()
      else go(rows[i + 1])
      break
    case 'ArrowLeft': {
      if (isFolder && expanded) { row.click(); break }
      if (e.currentTarget.dataset.navList === 'notelist') {
        const prev = document.querySelector<HTMLElement>('[data-nav-list="sidebar"]')
        if (prev) { focusNavList(prev); break }
      }
      const parent = row.dataset.navParent
      if (parent) go(rows.find(r => r.dataset.navId === `folder:${parent}`))
      break
    }
    case 'Enter':
    case ' ':
      row.click()
      // A note opens straight into the editor; folders just toggle.
      if (!isFolder && e.key === 'Enter') requestAnimationFrame(focusEditor)
      break
    case 'F2':
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      break
    case 'Escape':
      focusEditor()
      break
    default:
      return
  }
  e.preventDefault()
  e.stopPropagation()
}
