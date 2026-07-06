import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion } from '@codemirror/autocomplete'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { applyBlockFormat, applyInlineFormat } from './editorFormatting';

// ─── Syntax Highlight Style ──────────────────────────────────────────────────

export const inkwellHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: '700',
    color: 'hsl(var(--foreground))',
  },
  { tag: tags.heading1, fontSize: '1.5em' },
  { tag: tags.heading2, fontSize: '1.25em' },
  { tag: tags.heading3, fontSize: '1.1em' },
  { tag: tags.strong, fontWeight: '700', color: 'hsl(var(--foreground))' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'hsl(var(--foreground))' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'hsl(var(--muted-foreground))' },
  { tag: tags.link, color: 'hsl(var(--accent))', textDecoration: 'underline' },
  { tag: tags.url, color: 'hsl(var(--accent))' },
  { tag: tags.monospace, fontFamily: 'monospace', color: 'hsl(var(--accent))', fontSize: '0.9em' },
  { tag: tags.processingInstruction, color: 'hsl(var(--muted-foreground))', opacity: '0.6' },
  { tag: tags.punctuation, color: 'hsl(var(--muted-foreground))', opacity: '0.6' },
  { tag: tags.quote, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
  { tag: tags.list, color: 'hsl(var(--accent))' },
  { tag: tags.meta, color: 'hsl(var(--muted-foreground))' },
])

export const markdownHighlighting = syntaxHighlighting(inkwellHighlightStyle)

// ─── Slash Command Autocomplete ───────────────────────────────────────────────

const SLASH_COMMANDS = [
  { label: '/heading1', displayLabel: 'Heading 1', detail: '# Large heading', apply: '# ' },
  { label: '/heading2', displayLabel: 'Heading 2', detail: '## Medium heading', apply: '## ' },
  { label: '/heading3', displayLabel: 'Heading 3', detail: '### Small heading', apply: '### ' },
  { label: '/bullet', displayLabel: 'Bullet List', detail: '- Unordered list', apply: '- ' },
  { label: '/numbered', displayLabel: 'Numbered List', detail: '1. Ordered list', apply: '1. ' },
  { label: '/todo', displayLabel: 'To-do', detail: '- [ ] Checkbox item', apply: '- [ ] ' },
  { label: '/quote', displayLabel: 'Quote', detail: '> Blockquote', apply: '> ' },
  { label: '/code', displayLabel: 'Code Block', detail: 'Fenced code block', apply: '```\n\n```' },
  { label: '/table', displayLabel: 'Table', detail: '3-column table', apply: '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |\n' },
  { label: '/highlight', displayLabel: 'Highlight', detail: '==highlighted text==', apply: '====', boost: -1 },
  { label: '/divider', displayLabel: 'Divider', detail: '--- Horizontal rule', apply: '---\n' },
  { label: '/bold', displayLabel: 'Bold', detail: '**bold text**', apply: '****', boost: -1 },
  { label: '/italic', displayLabel: 'Italic', detail: '*italic text*', apply: '**', boost: -1 },
  { label: '/video', displayLabel: 'Video Embed', detail: 'YouTube / Vimeo / Loom', apply: '__VIDEO_URL__' },
]

function slashCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)

  const match = before.match(/^(\s*)(\/\w*)$/)
  if (!match) return null

  const from = line.from + match[1].length

  return {
    from,
    validFor: /^\/\w*$/,
    options: SLASH_COMMANDS.map(cmd => ({
      label: cmd.label,
      displayLabel: cmd.displayLabel,
      detail: cmd.detail,
      boost: (cmd as any).boost,
      apply: (view: EditorView, _completion: unknown, slashFrom: number, slashTo: number) => {
        if (cmd.apply === '__VIDEO_URL__') {
          // Insert on its own line, select "URL" so the user can paste immediately
          const line = view.state.doc.lineAt(slashFrom)
          const needsLeading = slashFrom !== line.from || line.text.trim().length > 0
          const prefix = needsLeading ? '\n' : ''
          const placeholder = 'https://'
          view.dispatch({
            changes: { from: slashFrom, to: slashTo, insert: prefix + placeholder + '\n' },
            selection: { anchor: slashFrom + prefix.length, head: slashFrom + prefix.length + placeholder.length },
          })
          return
        }
        view.dispatch({ changes: { from: slashFrom, to: slashTo, insert: cmd.apply } })
        if (cmd.apply === '```\n\n```') {
          view.dispatch({ selection: { anchor: slashFrom + 4 } })
        }
        if (cmd.apply === '====') {
          view.dispatch({ selection: { anchor: slashFrom + 2 } })
        }
        if (cmd.apply === '****') {
          view.dispatch({ selection: { anchor: slashFrom + 2 } })
        }
      },
    })),
  }
}

export const slashCommandCompletion = autocompletion({
  override: [slashCompletion],
  activateOnTyping: true,
  closeOnBlur: true,
})


const MOD = "Ctrl-Shift";
const MAC_MOD = "Cmd-Shift";

export const markdownKeymap = [
  // Headings
  { key: `${MOD}-1`, mac: `${MAC_MOD}-1`, run: (view: EditorView) => { applyBlockFormat(view, "# "); return true } },
  { key: `${MOD}-2`, mac: `${MAC_MOD}-2`, run: (view: EditorView) => { applyBlockFormat(view, "## "); return true } },
  { key: `${MOD}-3`, mac: `${MAC_MOD}-3`, run: (view: EditorView) => { applyBlockFormat(view, "### "); return true } },
  { key: `${MOD}-4`, mac: `${MAC_MOD}-4`, run: (view: EditorView) => { applyBlockFormat(view, "#### "); return true } },
  { key: `${MOD}-5`, mac: `${MAC_MOD}-5`, run: (view: EditorView) => { applyBlockFormat(view, "##### "); return true } },
  { key: `${MOD}-6`, mac: `${MAC_MOD}-6`, run: (view: EditorView) => { applyBlockFormat(view, "###### "); return true } },

  // Inline Formatting
  { key: `${MOD}-b`, mac: `${MAC_MOD}-b`, run: (view: EditorView) => { applyInlineFormat(view, "**", "**"); return true } },
  { key: `${MOD}-i`, mac: `${MAC_MOD}-i`, run: (view: EditorView) => { applyInlineFormat(view, "*", "*"); return true } },
  { key: `${MOD}-u`, mac: `${MAC_MOD}-u`, run: (view: EditorView) => { applyInlineFormat(view, "<u>", "</u>"); return true } },
  { key: `${MOD}-s`, mac: `${MAC_MOD}-s`, run: (view: EditorView) => { applyInlineFormat(view, "~~", "~~"); return true } },
  { key: `${MOD}-k`, mac: `${MAC_MOD}-k`, run: (view: EditorView) => { applyInlineFormat(view, "`", "`"); return true } },
  { key: `${MOD}-h`, mac: `${MAC_MOD}-h`, run: (view: EditorView) => { applyInlineFormat(view, "==", "=="); return true } },
  { key: `${MOD}-l`, mac: `${MAC_MOD}-l`, run: (view: EditorView) => { applyInlineFormat(view, "[", "](url)"); return true } },
  { key: `${MOD}-e`, mac: `${MAC_MOD}-e`, run: (view: EditorView) => { applyInlineFormat(view, "![", "](url)"); return true } },

  // Block Elements
  { key: `${MOD}-q`, mac: `${MAC_MOD}-q`, run: (view: EditorView) => { applyBlockFormat(view, "> "); return true } },
  { key: `${MOD}-c`, mac: `${MAC_MOD}-c`, run: (view: EditorView) => { applyBlockFormat(view, "```\n\n```"); return true } },
  { key: `${MOD}-8`, mac: `${MAC_MOD}-8`, run: (view: EditorView) => { applyBlockFormat(view, "- "); return true } },
  { key: `${MOD}-9`, mac: `${MAC_MOD}-9`, run: (view: EditorView) => { applyBlockFormat(view, "1. "); return true } },
  { key: `${MOD}-0`, mac: `${MAC_MOD}-0`, run: (view: EditorView) => { applyBlockFormat(view, "- [ ] "); return true } },
  { key: `${MOD}-enter`, mac: `${MAC_MOD}-enter`, run: (view: EditorView) => { applyBlockFormat(view, "---\n"); return true } },
  { key: `${MOD}-t`, mac: `${MAC_MOD}-t`, run: (view: EditorView) => { applyBlockFormat(view, "| Col 1 | Col 2 | Col 3 |\n| --- | --- | --- |\n|  |  |  |\n"); return true } },
  { key: `${MOD}-m`, mac: `${MAC_MOD}-m`, run: (view: EditorView) => { applyBlockFormat(view, "$$\n\n$$"); return true } },
  { key: `${MOD}-/`, mac: `${MAC_MOD}-/`, run: (view: EditorView) => { applyBlockFormat(view, "> [!INFO] "); return true } },
]




// ─── Todo Checkbox Widget ─────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly to: number) { super() }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;'

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.style.cssText = 'width:14px;height:14px;cursor:pointer;accent-color:hsl(var(--accent));vertical-align:middle;'

    cb.addEventListener('mousedown', e => {
      e.preventDefault()
      const newText = this.checked ? '[ ]' : '[x]'
      view.dispatch({ changes: { from: this.from, to: this.to, insert: newText } })
    })

    wrap.appendChild(cb)
    return wrap
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from
  }

  ignoreEvent() { return false }
}

export const todoCheckboxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildCheckboxDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildCheckboxDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations }
)

function buildCheckboxDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = []
  const re = /(\[[ x]\])/g

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    let match
    re.lastIndex = 0
    while ((match = re.exec(text)) !== null) {
      const matchFrom = from + match.index
      const matchTo = matchFrom + 3

      // Only decorate task list items (preceded by "- " or "* ")
      const lineStart = view.state.doc.lineAt(matchFrom).from
      const linePrefix = view.state.doc.sliceString(lineStart, matchFrom)
      if (!/^\s*[-*]\s$/.test(linePrefix)) continue

      const checked = match[1] === '[x]'
      widgets.push(
        Decoration.replace({
          widget: new CheckboxWidget(checked, matchFrom, matchTo),
          inclusive: false,
        }).range(matchFrom, matchTo)
      )
    }
  }

  return Decoration.set(widgets, true)
}

// ─── Markdown Table Plugin ────────────────────────────────────────────────────

function isTableRow(text: string): boolean {
  const t = text.trim()
  // Must start AND end with '|' and have at least one more '|' in between
  return t.startsWith('|') && t.endsWith('|') && t.length > 1
}

function isSeparatorRow(text: string): boolean {
  // Matches lines like: | --- | :--: | ---: |
  return /^\s*\|[\s|:\-]+\|\s*$/.test(text) && text.includes('-')
}

type TableLineType = 'header' | 'separator' | 'row-even' | 'row-odd'

function buildTableDecorations(view: EditorView): DecorationSet {
  const decs: Range<Decoration>[] = []
  const doc = view.state.doc
  const totalLines = doc.lines

  // ── Pass 1: classify every line in the document ──────────────────────────
  const lineTypes = new Map<number, TableLineType>()

  let i = 1
  while (i <= totalLines) {
    const lineText = doc.line(i).text
    if (!isTableRow(lineText)) { i++; continue }

    // Collect consecutive table-row lines as a block
    const blockLines: number[] = [i]
    i++
    while (i <= totalLines && isTableRow(doc.line(i).text)) {
      blockLines.push(i)
      i++
    }

    // Find the first separator row within the block
    let sepIdx = -1
    for (let j = 0; j < blockLines.length; j++) {
      if (isSeparatorRow(doc.line(blockLines[j]).text)) { sepIdx = j; break }
    }

    if (sepIdx > 0) {
      // Standard GFM table: header(s) | separator | body rows
      for (let j = 0; j < sepIdx; j++) lineTypes.set(blockLines[j], 'header')
      lineTypes.set(blockLines[sepIdx], 'separator')
      let bodyIdx = 0
      for (let j = sepIdx + 1; j < blockLines.length; j++) {
        lineTypes.set(blockLines[j], bodyIdx % 2 === 0 ? 'row-even' : 'row-odd')
        bodyIdx++
      }
    } else if (sepIdx === 0) {
      // Separator is the very first line (unusual)
      lineTypes.set(blockLines[0], 'separator')
      let bodyIdx = 0
      for (let j = 1; j < blockLines.length; j++) {
        lineTypes.set(blockLines[j], bodyIdx % 2 === 0 ? 'row-even' : 'row-odd')
        bodyIdx++
      }
    } else {
      // No separator — treat all as body rows
      let bodyIdx = 0
      for (const ln of blockLines) {
        lineTypes.set(ln, bodyIdx % 2 === 0 ? 'row-even' : 'row-odd')
        bodyIdx++
      }
    }
  }

  // ── Pass 2: emit decorations only for visible lines ───────────────────────
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number
    const endLine = doc.lineAt(to).number

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const type = lineTypes.get(lineNum)
      if (!type) continue

      const line = doc.line(lineNum)

      // Line-level background decoration
      const cls =
        type === 'header' ? 'cm-table-header' :
          type === 'separator' ? 'cm-table-separator' :
            type === 'row-even' ? 'cm-table-row-even' :
              'cm-table-row-odd'
      decs.push(Decoration.line({ attributes: { class: cls } }).range(line.from))

      // Color each '|' pipe character (skip separator rows — dashes are the content)
      if (type !== 'separator') {
        const text = line.text
        const pipeMark = Decoration.mark({ class: 'cm-table-pipe' })
        for (let ci = 0; ci < text.length; ci++) {
          if (text[ci] === '|') {
            decs.push(pipeMark.range(line.from + ci, line.from + ci + 1))
          }
        }
      }
    }
  }

  return Decoration.set(decs, true) // true = sort the array
}

export const tablePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildTableDecorations(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildTableDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations }
)

// ─── ==Highlight== Mark Decoration ───────────────────────────────────────────

export const highlightMarkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildHighlightDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHighlightDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations }
)

function buildHighlightDecorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = []
  const re = /==([^=\n]+)==/g

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    let match
    re.lastIndex = 0
    while ((match = re.exec(text)) !== null) {
      const start = from + match.index
      const end = start + match[0].length
      marks.push(Decoration.mark({ class: 'cm-highlight-mark' }).range(start, end))
    }
  }

  return Decoration.set(marks, true)
}

// ─── File Embed Plugin ────────────────────────────────────────────────────────
// Syntax inserted at cursor:  ![[attachments/file.pdf|Display Name|3300]]
// Renders as a collapsible accordion widget replacing that text in the editor.

const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const EMBED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'])
const EMBED_VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

function embedFileType(ext: string): 'image' | 'pdf' | 'video' | 'other' {
  if (EMBED_IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (EMBED_VIDEO_EXTS.has(ext)) return 'video'
  return 'other'
}

function embedFormatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// Convert Uint8Array → base64 string without blowing the call stack on large files
function uint8ToBase64(bytes: Uint8Array): string {
  let str = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(str)
}

// Matches ![[path|name|size]]  (name and size are optional parts after |)
const FILE_EMBED_RE = /!\[\[([^\]|]+?)(?:\|([^\]|]*))?(?:\|(\d+))?\]\]/g

class FileEmbedWidget extends WidgetType {
  private expanded = false
  private previewEl: HTMLElement | null = null
  private resolvedPath: string | null = null

  constructor(
    readonly fullPath: string,
    readonly displayName: string,
    readonly sizeBytes: number,
    readonly type: 'image' | 'pdf' | 'video' | 'other',
    readonly relativePath: string,
    readonly vaultPath: string,
    readonly onRemove: (relativePath: string) => void,
  ) { super() }

  // Obsidian's `![[filename]]` embeds are bare filenames resolved by searching the
  // whole vault, since the file usually lives in an attachments folder, not next to
  // the note. Try the literal vault-relative path first, then fall back to a
  // vault-wide search by basename so images from imported Obsidian vaults resolve.
  private async resolvePath(): Promise<string> {
    if (this.resolvedPath) return this.resolvedPath
    if (!isTauriEnv) return this.fullPath
    try {
      const { exists } = await import('@tauri-apps/plugin-fs')
      if (await exists(this.fullPath)) { this.resolvedPath = this.fullPath; return this.fullPath }
    } catch { /* fall through to vault-wide search */ }
    if (this.vaultPath) {
      try {
        const { findFileInVault } = await import('./vault')
        const filename = this.relativePath.split('/').pop() || this.relativePath
        const found = await findFileInVault(this.vaultPath, filename)
        if (found) { this.resolvedPath = found; return found }
      } catch { /* ignore, use literal path below */ }
    }
    this.resolvedPath = this.fullPath
    return this.fullPath
  }

  eq(other: FileEmbedWidget) {
    return (
      other.fullPath === this.fullPath &&
      other.displayName === this.displayName &&
      other.sizeBytes === this.sizeBytes &&
      other.relativePath === this.relativePath &&
      other.vaultPath === this.vaultPath
    )
  }

  // Images render directly — no accordion chrome, just the picture and a hover-only
  // remove button, matching how a normal markdown image looks.
  private buildImageDOM(view: EditorView): HTMLElement {
    const outer = document.createElement('div')
    outer.setAttribute('data-cm-embed', 'image')
    outer.style.cssText = [
      'display:inline-block',
      'position:relative',
      'max-width:100%',
      'margin:6px 0',
      'font-family:inherit',
      'user-select:none',
    ].join(';')

    const img = document.createElement('img')
    img.alt = this.displayName
    img.style.cssText = [
      'display:block',
      'max-width:100%',
      'border-radius:8px',
      'border:1px solid hsl(var(--border)/0.4)',
    ].join(';')

    const placeholder = document.createElement('div')
    placeholder.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'height:128px',
      'min-width:200px',
      'font-size:12px',
      'color:hsl(var(--muted-foreground))',
      'border:1px solid hsl(var(--border)/0.4)',
      'border-radius:8px',
    ].join(';')
    placeholder.textContent = 'Loading…'
    outer.appendChild(placeholder)

    const resolveUrl = async (): Promise<string> => {
      const path = await this.resolvePath()
      if (isTauriEnv) {
        try {
          const { convertFileSrc } = await import('@tauri-apps/api/core')
          return convertFileSrc(path)
        } catch {
          return `asset://localhost/${encodeURIComponent(path)}`
        }
      }
      return `file://${path}`
    }
    resolveUrl().then(url => {
      img.src = url
      img.onload = () => { placeholder.replaceWith(img) }
    })

    const trashBtn = document.createElement('button')
    trashBtn.title = 'Remove from note and list'
    trashBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`
    trashBtn.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'position:absolute',
      'top:8px',
      'right:8px',
      'background:hsl(var(--background)/0.8)',
      'border:1px solid hsl(var(--border)/0.4)',
      'cursor:pointer',
      'padding:4px',
      'border-radius:6px',
      'color:hsl(var(--muted-foreground))',
      'opacity:0',
      'transition:opacity 0.15s, color 0.15s',
      'line-height:1',
    ].join(';')
    trashBtn.addEventListener('mouseenter', () => { trashBtn.style.color = 'hsl(var(--destructive, 0 72% 51%))' })
    trashBtn.addEventListener('mouseleave', () => { trashBtn.style.color = 'hsl(var(--muted-foreground))' })
    outer.addEventListener('mouseenter', () => { trashBtn.style.opacity = '1' })
    outer.addEventListener('mouseleave', () => { trashBtn.style.opacity = '0' })
    trashBtn.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const escaped = this.relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`!\\[\\[${escaped}[^\\]]*\\]\\]`)
      const docText = view.state.doc.toString()
      const m = re.exec(docText)
      if (m) {
        view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert: '' } })
      }
      this.onRemove(this.relativePath)
    })
    outer.appendChild(trashBtn)

    return outer
  }

  toDOM(view: EditorView) {
    if (this.type === 'image') return this.buildImageDOM(view)

    const outer = document.createElement('div')
    outer.setAttribute('data-cm-embed', 'file')
    outer.style.cssText = [
      'display:block',
      'border:1px solid hsl(var(--border))',
      'border-radius:8px',
      'overflow:hidden',
      'margin:6px 0',
      'background:hsl(var(--surface)/0.6)',
      'font-family:inherit',
      'user-select:none',
    ].join(';')

    // ── Header ──
    const header = document.createElement('div')
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:8px 12px',
      'cursor:pointer',
    ].join(';')

    const iconEl = document.createElement('span')
    iconEl.style.cssText = 'font-size:16px;line-height:1;flex-shrink:0'
    iconEl.textContent =
      this.type === 'pdf' ? '📄' :
        this.type === 'video' ? '🎬' : '📎'

    const nameEl = document.createElement('span')
    nameEl.style.cssText = [
      'flex:1',
      'font-size:13px',
      'color:hsl(var(--foreground))',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
    ].join(';')
    nameEl.textContent = this.displayName

    const sizeEl = document.createElement('span')
    sizeEl.style.cssText = 'font-size:11px;color:hsl(var(--muted-foreground));flex-shrink:0'
    sizeEl.textContent = this.sizeBytes > 0 ? embedFormatSize(this.sizeBytes) : ''

    const chevronEl = document.createElement('span')
    chevronEl.style.cssText = [
      'font-size:10px',
      'color:hsl(var(--muted-foreground))',
      'flex-shrink:0',
      'transition:transform 0.15s',
    ].join(';')
    chevronEl.textContent = '▼'

    // ── Trash button ──
    const trashBtn = document.createElement('button')
    trashBtn.title = 'Remove from note and list'
    trashBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`
    trashBtn.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'flex-shrink:0',
      'background:none',
      'border:none',
      'cursor:pointer',
      'padding:2px',
      'border-radius:3px',
      'color:hsl(var(--muted-foreground))',
      'opacity:0',
      'transition:opacity 0.15s, color 0.15s',
      'line-height:1',
    ].join(';')
    trashBtn.addEventListener('mouseenter', () => { trashBtn.style.color = 'hsl(var(--destructive, 0 72% 51%))' })
    trashBtn.addEventListener('mouseleave', () => { trashBtn.style.color = 'hsl(var(--muted-foreground))' })
    outer.addEventListener('mouseenter', () => { trashBtn.style.opacity = '1' })
    outer.addEventListener('mouseleave', () => { trashBtn.style.opacity = '0' })
    trashBtn.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      // Remove the ![[...]] syntax from the document by searching for it
      const escaped = this.relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`!\\[\\[${escaped}[^\\]]*\\]\\]`)
      const docText = view.state.doc.toString()
      const m = re.exec(docText)
      if (m) {
        view.dispatch({ changes: { from: m.index, to: m.index + m[0].length, insert: '' } })
      }
      // Remove from attachment list + disk
      this.onRemove(this.relativePath)
    })

    header.append(iconEl, nameEl, sizeEl, trashBtn, chevronEl)
    outer.appendChild(header)

    // ── Preview area (created lazily on expand) ──

    // Returns the best URL for rendering this file inline.
    // PDFs use a data: URL because Tauri's WKWebView blocks asset:// inside iframes.
    const resolveUrl = async (mimeType?: string): Promise<string> => {
      const path = await this.resolvePath()
      if (isTauriEnv) {
        if (mimeType) {
          // Load as bytes → base64 data URL (works in any WKWebView context)
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs')
            const bytes = await readFile(path)
            const b64 = uint8ToBase64(new Uint8Array(bytes))
            return `data:${mimeType};base64,${b64}`
          } catch {
            // fall through to asset URL
          }
        }
        try {
          const { convertFileSrc } = await import('@tauri-apps/api/core')
          return convertFileSrc(path)
        } catch {
          return `asset://localhost/${encodeURIComponent(path)}`
        }
      }
      return `file://${path}`
    }

    const openExternally = () => {
      if (isTauriEnv) {
        this.resolvePath().then(path =>
          import('@tauri-apps/plugin-opener').then(({ openPath }) => openPath(path))
        )
      }
    }

    const toggle = () => {
      this.expanded = !this.expanded
      chevronEl.style.transform = this.expanded ? 'rotate(180deg)' : ''

      if (this.expanded) {
        this.previewEl = document.createElement('div')
        this.previewEl.style.cssText = 'border-top:1px solid hsl(var(--border))'

        if (this.type === 'pdf') {
          // Show a loading indicator while we read+encode the file
          const loader = document.createElement('div')
          loader.style.cssText = [
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'height:60px',
            'font-size:12px',
            'color:hsl(var(--muted-foreground))',
          ].join(';')
          loader.textContent = 'Loading PDF…'
          this.previewEl.appendChild(loader)

          // Read file as base64 data URL — bypasses asset:// iframe restriction in WKWebView
          resolveUrl('application/pdf').then(url => {
            if (!this.previewEl) return
            loader.remove()

            const frame = document.createElement('iframe')
            frame.src = url
            frame.style.cssText = 'display:block;width:100%;height:560px;border:none'
            this.previewEl.insertBefore(frame, this.previewEl.firstChild)

            // "Open in Preview" bar beneath the iframe
            const bar = document.createElement('div')
            bar.style.cssText = [
              'display:flex',
              'align-items:center',
              'justify-content:flex-end',
              'padding:5px 10px',
              'background:hsl(var(--surface)/0.8)',
              'border-top:1px solid hsl(var(--border))',
            ].join(';')
            const openBtn = document.createElement('button')
            openBtn.textContent = '↗ Open in Preview'
            openBtn.style.cssText = [
              'font-size:11px',
              'padding:3px 8px',
              'border-radius:4px',
              'border:1px solid hsl(var(--border))',
              'background:hsl(var(--surface))',
              'color:hsl(var(--foreground))',
              'cursor:pointer',
            ].join(';')
            openBtn.addEventListener('mousedown', e => { e.preventDefault(); openExternally() })
            bar.appendChild(openBtn)
            this.previewEl.appendChild(bar)
          })

        } else if (this.type === 'video') {
          const video = document.createElement('video')
          video.controls = true
          video.style.cssText = 'display:block;width:100%;max-height:400px;background:#000'
          this.previewEl.appendChild(video)
          // WKWebView blocks asset:// in <video> — use base64 data URL like PDF
          const ext = this.relativePath.split('.').pop()?.toLowerCase() ?? 'mp4'
          const videoMime =
            ext === 'webm' ? 'video/webm' :
              ext === 'mov' ? 'video/quicktime' :
                ext === 'avi' ? 'video/x-msvideo' :
                  'video/mp4'
          resolveUrl(videoMime).then(url => { video.src = url })

        } else {
          // Generic: open externally
          const card = document.createElement('div')
          card.style.cssText = [
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'gap:10px',
            'padding:24px',
            'text-align:center',
          ].join(';')
          const label = document.createElement('p')
          label.textContent = 'No inline preview for this file type.'
          label.style.cssText = 'font-size:13px;color:hsl(var(--muted-foreground));margin:0'
          const btn = document.createElement('button')
          btn.textContent = '↗ Open with system app'
          btn.style.cssText = [
            'font-size:12px',
            'padding:5px 12px',
            'border-radius:5px',
            'border:1px solid hsl(var(--border))',
            'background:hsl(var(--surface))',
            'color:hsl(var(--accent))',
            'cursor:pointer',
          ].join(';')
          btn.addEventListener('mousedown', e => { e.preventDefault(); openExternally() })
          card.append(label, btn)
          this.previewEl.appendChild(card)
        }

        outer.appendChild(this.previewEl)
      } else {
        this.previewEl?.remove()
        this.previewEl = null
      }
    }

    header.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      toggle()
    })

    // Double-click header to open with system app
    header.addEventListener('dblclick', e => { e.preventDefault(); openExternally() })

    return outer
  }

  get estimatedHeight() { return this.type === 'image' ? 280 : (this.expanded ? 580 : 44) }
  ignoreEvent() { return false }
}

function buildFileEmbedDecorations(
  view: EditorView,
  vaultPath: string,
  onRemove: (relativePath: string) => void = () => { },
): DecorationSet {
  const widgets: Range<Decoration>[] = []
  const { doc } = view.state

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to)
    FILE_EMBED_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = FILE_EMBED_RE.exec(text)) !== null) {
      const matchFrom = from + m.index
      const matchTo = matchFrom + m[0].length

      const relativePath = m[1]                             // e.g. "attachments/doc.pdf"
      const namePart = m[2] ?? ''                      // display name
      const sizePart = m[3] ?? '0'                     // size in bytes

      const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
      const type = embedFileType(ext)
      const displayName = namePart || relativePath.split('/').pop() || relativePath
      const sizeBytes = parseInt(sizePart) || 0
      const fullPath = vaultPath ? `${vaultPath}/${relativePath}` : relativePath

      widgets.push(
        Decoration.replace({
          widget: new FileEmbedWidget(fullPath, displayName, sizeBytes, type, relativePath, vaultPath, onRemove),
          inclusive: false,
        }).range(matchFrom, matchTo)
      )
    }
  }

  return Decoration.set(widgets, true)
}

/** Factory — call once per EditorState with the current vaultPath. */
export function createFileEmbedPlugin(
  vaultPath: string,
  onRemove: (relativePath: string) => void = () => { },
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildFileEmbedDecorations(view, vaultPath, onRemove)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildFileEmbedDecorations(update.view, vaultPath, onRemove)
        }
      }
    },
    { decorations: v => v.decorations }
  )
}
