import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion } from '@codemirror/autocomplete'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { useAppStore } from '../store/useAppStore'

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

// Fenced code blocks embed a real language grammar (see `codeLanguages` on the
// markdown() extension in MarkdownEditor) whose tokens — keywords, strings,
// numbers, comments — aren't covered by inkwellHighlightStyle above. Layered
// in as a fallback so it only fills gaps rather than fighting the markdown-
// specific rules (headings, emphasis, etc.) for tags both styles define.
export const codeHighlighting = syntaxHighlighting(oneDarkHighlightStyle, { fallback: true })

// ─── Autocomplete popup theme ──────────────────────────────────────────────────
// Shared by both the slash-command and @-mention popups (MarkdownEditor and
// QuickNoteEditor both wire this in). Icons are CodeMirror's own mechanism:
// each completion's `type` picks a `.cm-completionIcon-<type>` class, which we
// style with a `content` glyph below — see SLASH_COMMANDS' `type` field and the
// 'iknote' type used for @-mentions.

const ICON_GLYPH: Record<string, string> = {
  ikheading1: 'H1', ikheading2: 'H2', ikheading3: 'H3',
  ikbullet: '≡', iknumbered: '1.', iktodo: '☑', ikquote: '"',
  ikcode: '</>', iktable: '▦', ikhighlight: '▮', ikdivider: '—',
  ikbold: 'B', ikitalic: 'I', ikvideo: '▶', iknote: '📄',
}

function iconRules(): Record<string, unknown> {
  const rules: Record<string, unknown> = {}
  for (const [type, glyph] of Object.entries(ICON_GLYPH)) {
    rules[`.cm-completionIcon-${type}`] = { '&:after': { content: `'${glyph}'` } }
  }
  return rules
}

export const autocompleteTheme = EditorView.theme({
  '.cm-tooltip-autocomplete': {
    backgroundColor: 'hsl(var(--surface))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '12px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.20), 0 2px 8px rgba(0,0,0,0.10)',
    overflow: 'hidden',
    padding: '6px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    // Deliberately not editorFontFamily — this is UI chrome, not document
    // content, so it shouldn't follow the user's prose font (e.g. a serif).
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxHeight: '320px',
    minWidth: '260px',
  },
  '.cm-tooltip-autocomplete ul li': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: '7px 9px',
    margin: '1px 0',
    borderRadius: '8px',
    transition: 'background-color 0.1s ease',
  },
  '.cm-tooltip-autocomplete ul li:hover': {
    backgroundColor: 'hsl(var(--accent) / 0.08)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'hsl(var(--accent) / 0.14)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionLabel': {
    color: 'hsl(var(--accent))',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionIcon': {
    backgroundColor: 'hsl(var(--accent) / 0.2)',
  },
  '.cm-completionIcon': {
    flexShrink: '0',
    width: '24px',
    height: '24px',
    marginRight: '10px',
    borderRadius: '7px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9.5px',
    fontWeight: '700',
    letterSpacing: '-0.02em',
    backgroundColor: 'hsl(var(--accent) / 0.12)',
    color: 'hsl(var(--accent))',
    opacity: '1',
    padding: '0',
    boxSizing: 'border-box',
    transition: 'background-color 0.1s ease',
  },
  '.cm-completionLabel': {
    fontSize: '13px',
    fontWeight: '600',
    color: 'hsl(var(--foreground))',
  },
  '.cm-completionDetail': {
    flexBasis: '100%',
    marginLeft: '34px',
    marginTop: '2px',
    fontSize: '11.5px',
    fontStyle: 'normal',
    opacity: '0.75',
    color: 'hsl(var(--muted-foreground))',
  },
  ...iconRules(),
})

// ─── Slash Command Autocomplete ───────────────────────────────────────────────

const SLASH_COMMANDS = [
  { label: '/heading1', displayLabel: 'Heading 1', detail: '# Large heading', apply: '# ', type: 'ikheading1' },
  { label: '/heading2', displayLabel: 'Heading 2', detail: '## Medium heading', apply: '## ', type: 'ikheading2' },
  { label: '/heading3', displayLabel: 'Heading 3', detail: '### Small heading', apply: '### ', type: 'ikheading3' },
  { label: '/bullet', displayLabel: 'Bullet List', detail: '- Unordered list', apply: '- ', type: 'ikbullet' },
  { label: '/numbered', displayLabel: 'Numbered List', detail: '1. Ordered list', apply: '1. ', type: 'iknumbered' },
  { label: '/todo', displayLabel: 'To-do', detail: '- [ ] Checkbox item', apply: '- [ ] ', type: 'iktodo' },
  { label: '/quote', displayLabel: 'Quote', detail: '> Blockquote', apply: '> ', type: 'ikquote' },
  { label: '/code', displayLabel: 'Code Block', detail: 'Fenced code block', apply: '```\n\n```', type: 'ikcode' },
  { label: '/table', displayLabel: 'Table', detail: '3-column table', apply: '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |\n', type: 'iktable' },
  { label: '/highlight', displayLabel: 'Highlight', detail: '==highlighted text==', apply: '====', boost: -1, type: 'ikhighlight' },
  { label: '/divider', displayLabel: 'Divider', detail: '--- Horizontal rule', apply: '---\n', type: 'ikdivider' },
  { label: '/bold', displayLabel: 'Bold', detail: '**bold text**', apply: '****', boost: -1, type: 'ikbold' },
  { label: '/italic', displayLabel: 'Italic', detail: '*italic text*', apply: '**', boost: -1, type: 'ikitalic' },
  { label: '/video', displayLabel: 'Video Embed', detail: 'YouTube / Vimeo / Loom', apply: '__VIDEO_URL__', type: 'ikvideo' },
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
      type: cmd.type,
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

// ─── @ Note Mention Autocomplete ───────────────────────────────────────────────

function noteMentionCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)

  const match = before.match(/(^|\s)(@(\w*))$/)
  if (!match) return null

  const prefixLen = match[1].length
  const atIndex = match.index! + prefixLen
  const query = match[3] || ''

  const { notes } = useAppStore.getState()
  const lower = query.toLowerCase()
  const filtered = notes
    .filter(n => !query || n.title.toLowerCase().includes(lower))
    .slice(0, 20)

  if (filtered.length === 0) return null

  return {
    from: line.from + atIndex,
    validFor: /^@\w*$/,
    options: filtered.map(note => ({
      label: `@${note.title}`,
      detail: note.folder ?? undefined,
      type: 'iknote',
      apply: (view, _completion, from, to) => {
        view.dispatch({ changes: { from, to, insert: `[@${note.title}](note://${note.id})` } })
        const { selectedNoteIds, addNoteLink } = useAppStore.getState()
        const currentId = selectedNoteIds[0]
        if (currentId && currentId !== note.id) {
          addNoteLink(currentId, { type: 'note', id: note.id })
        }
      },
    })),
  }
}


const BUILT_IN_ABBREVIATIONS: Record<string, () => string> = {
  today: () => new Date().toISOString().split('T')[0],
  tomorrow: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] },
  nextweek: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0] },
  nextmonth: () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().split('T')[0] },
  now: () => new Date().toTimeString().split(' ')[0].substring(0, 5),
}

function abbreviationCompletion(context: CompletionContext): CompletionResult | null {
  const { abbreviationTrigger, abbreviations } = useAppStore.getState()
  const trigger = abbreviationTrigger || ':'
  const esc = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = before.match(new RegExp(`(^|\\s)(${esc}(\\w*))$`))
  if (!match) return null

  const word = match[2]
  const prefixLen = match[1].length
  const from = line.from + match.index! + prefixLen

  const all = [
    ...Object.entries(BUILT_IN_ABBREVIATIONS).map(([k, fn]) => ({ key: `${trigger}${k}`, value: fn() })),
    ...abbreviations.map(a => ({ key: `${trigger}${a.key}`, value: a.value })),
  ].filter(a => a.key.startsWith(word))

  if (all.length === 0) return null

  return {
    from,
    validFor: new RegExp(`^${esc}\\w*$`),
    options: all.map(({ key, value }) => ({
      label: key,
      detail: value,
      apply: (view, _completion, _from, _to) => {
        view.dispatch({ changes: { from, to: context.pos, insert: value } })
      },
    })),
  }
}


export function tryAbbreviationReplace(view: EditorView, pending: string): boolean {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const before = view.state.sliceDoc(line.from, pos) + pending

  const { abbreviationTrigger, abbreviations } = useAppStore.getState()
  const trigger = abbreviationTrigger || ':'
  const esc = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const match = before.match(new RegExp(`(^|\\s)(${esc}(\\w*))$`))
  if (!match) return false

  const key = match[3]
  if (!key) return false

  const builtIn = BUILT_IN_ABBREVIATIONS[key]
  const custom = builtIn !== undefined ? undefined : abbreviations.find(a => a.key === key)
  const value = builtIn ? builtIn() : custom?.value
  if (!value) return false

  const from = line.from + match.index! + match[1].length
  view.dispatch({ changes: { from, to: pos, insert: value } })
  return true
}

export const slashCommandCompletion = autocompletion({
  override: [slashCompletion, noteMentionCompletion, abbreviationCompletion],
  activateOnTyping: true,
  closeOnBlur: true,
})

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

// ─── Live markdown preview (Normal mode WYSIWYG) ─────────────────────────────
// Conceals the raw delimiter characters (#, **, ~~, `, >, [](url), list marks)
// so the note reads as formatted text with no visible markdown — the styling
// itself comes from inkwellHighlightStyle above, which already tags the
// remaining text as heading/strong/emphasis/etc. Marks on the line the cursor
// is currently on are revealed so they stay editable, matching the standard
// "live preview" pattern (Obsidian, Typora).

// Delimiters hidden outright wherever they appear (inline marks only — the
// fenced-code ``` fence reuses the "CodeMark" node name but is handled as a
// block below, so it's excluded here rather than added to this set).
const CONCEALED_MARK_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'QuoteMark',
])

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-bullet-dot'
    span.textContent = '•'
    return span
  }
  ignoreEvent() { return false }
}

function activeLineSet(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine = view.state.doc.lineAt(range.to).number
    for (let l = fromLine; l <= toLine; l++) lines.add(l)
  }
  return lines
}

// Applies a class to every line spanned by a block node (fenced code,
// blockquote) so it reads as a distinct block rather than plain paragraph
// text — mirrors what the rendered preview already does for the same nodes.
function decorateBlockLines(
  view: EditorView,
  decos: Range<Decoration>[],
  from: number,
  to: number,
  className: string,
  firstClass?: string,
  lastClass?: string,
) {
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  for (let l = startLine; l <= endLine; l++) {
    const line = view.state.doc.line(l)
    const extra = l === startLine ? firstClass : l === endLine ? lastClass : undefined
    const cls = extra ? `${className} ${extra}` : className
    decos.push(Decoration.line({ attributes: { class: cls } }).range(line.from))
  }
}

function buildLiveMarkdownDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const activeLines = activeLineSet(view)

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        // Block-level styling applies regardless of the active line — a code
        // block or quote shouldn't lose its box just because you're typing in it.
        if (node.name === 'FencedCode') {
          decorateBlockLines(view, decos, node.from, node.to, 'cm-line-codeblock', 'cm-line-codeblock-first', 'cm-line-codeblock-last')
          return
        }
        if (node.name === 'Blockquote') {
          decorateBlockLines(view, decos, node.from, node.to, 'cm-line-blockquote')
        }

        const lineNo = view.state.doc.lineAt(node.from).number
        if (activeLines.has(lineNo)) return

        if (CONCEALED_MARK_NODES.has(node.name)) {
          let end = node.to
          // ATX heading marks ("#", "##", ...) and blockquote's ">" are each
          // followed by a single space that reads oddly once the mark itself
          // disappears — swallow it along with the mark.
          if (
            (node.name === 'HeaderMark' || node.name === 'QuoteMark') &&
            view.state.sliceDoc(node.to, node.to + 1) === ' '
          ) {
            end = node.to + 1
          }
          decos.push(Decoration.replace({}).range(node.from, end))
          return
        }

        if (
          node.name === 'CodeMark' &&
          (node.node.parent?.name === 'InlineCode' || node.node.parent?.name === 'FencedCode')
        ) {
          decos.push(Decoration.replace({}).range(node.from, node.to))
          return
        }

        if (node.name === 'LinkMark' || (node.name === 'URL' && node.node.parent?.name === 'Link')) {
          decos.push(Decoration.replace({}).range(node.from, node.to))
          return
        }

        if (node.name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
          decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
        }
      },
    })
  }

  return Decoration.set(decos, true)
}

export const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLiveMarkdownDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildLiveMarkdownDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)

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

// Lines that fall inside a fenced/indented code block — ASCII art in a code
// sample (box-drawing with "|" columns) reads as a table by pure regex, but
// it's literal code content and must be left alone.
function codeBlockLineNumbers(view: EditorView): Set<number> {
  const lines = new Set<number>()
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return
      const startLine = view.state.doc.lineAt(node.from).number
      const endLine = view.state.doc.lineAt(node.to).number
      for (let l = startLine; l <= endLine; l++) lines.add(l)
    },
  })
  return lines
}

function buildTableDecorations(view: EditorView): DecorationSet {
  const decs: Range<Decoration>[] = []
  const doc = view.state.doc
  const totalLines = doc.lines
  const codeLines = codeBlockLineNumbers(view)

  // ── Pass 1: classify every line in the document ──────────────────────────
  const lineTypes = new Map<number, TableLineType>()

  let i = 1
  while (i <= totalLines) {
    const lineText = doc.line(i).text
    if (codeLines.has(i) || !isTableRow(lineText)) { i++; continue }

    // Collect consecutive table-row lines as a block
    const blockLines: number[] = [i]
    i++
    while (i <= totalLines && !codeLines.has(i) && isTableRow(doc.line(i).text)) {
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
    readonly searchRoot?: string,
  ) { super() }

  // Obsidian's `![[filename]]` embeds are bare filenames resolved by searching the
  // whole vault, since the file usually lives in an attachments folder, not next to
  // the note. Try the literal vault-relative path first, then a vault-wide search by
  // basename, then (for a note opened from outside this vault) the same two steps
  // rooted at the note's own source vault, so images from an externally-opened
  // Obsidian note still resolve even though that vault was never imported here.
  private async resolvePath(): Promise<string | null> {
    if (this.resolvedPath) return this.resolvedPath
    if (!isTauriEnv) return this.fullPath
    try {
      const { exists } = await import('@tauri-apps/plugin-fs')
      if (await exists(this.fullPath)) { this.resolvedPath = this.fullPath; return this.fullPath }
    } catch { /* fall through to searches below */ }

    const filename = this.relativePath.split('/').pop() || this.relativePath
    const { findFileInVault } = await import('./vault')
    for (const root of [this.vaultPath, this.searchRoot]) {
      if (!root) continue
      try {
        const found = await findFileInVault(root, filename)
        if (found) { this.resolvedPath = found; return found }
      } catch { /* try next root */ }
    }
    return null
  }

  eq(other: FileEmbedWidget) {
    return (
      other.fullPath === this.fullPath &&
      other.displayName === this.displayName &&
      other.sizeBytes === this.sizeBytes &&
      other.relativePath === this.relativePath &&
      other.vaultPath === this.vaultPath &&
      other.searchRoot === this.searchRoot
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

    const resolveUrl = async (): Promise<string | null> => {
      const path = await this.resolvePath()
      if (!path) return null
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
    const showNotFound = () => {
      placeholder.textContent = `Image not found: ${this.displayName}`
    }
    resolveUrl().then(url => {
      if (!url) { showNotFound(); return }
      img.onerror = showNotFound
      img.src = url
      img.onload = () => {
        placeholder.replaceWith(img)
        // The widget's real height is now known and almost always differs from
        // `estimatedHeight` (a fixed guess used before the image loads) — tell
        // CodeMirror to remeasure, or the line stays sized to the stale
        // estimate and the image renders clipped/cut off.
        view.requestMeasure()
      }
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
      if (!path) throw new Error(`File not found: ${this.displayName}`)
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
        this.resolvePath().then(path => {
          if (!path) { console.error(`File not found: ${this.displayName}`); return }
          import('@tauri-apps/plugin-opener').then(({ openPath }) => openPath(path))
        })
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
            view.requestMeasure()
          }).catch(() => {
            if (!this.previewEl) return
            loader.textContent = `File not found: ${this.displayName}`
            view.requestMeasure()
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
          resolveUrl(videoMime)
            .then(url => { video.src = url })
            .catch(() => {
              const msg = document.createElement('p')
              msg.textContent = `File not found: ${this.displayName}`
              msg.style.cssText = 'font-size:13px;color:hsl(var(--muted-foreground));padding:24px;text-align:center;margin:0'
              video.replaceWith(msg)
              view.requestMeasure()
            })

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
      // Same reasoning as the image widget's onload handler — the DOM just
      // changed size outside CodeMirror's own update cycle, so it needs to be
      // told to remeasure or the line stays sized to the stale estimate.
      view.requestMeasure()
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
  searchRoot?: string,
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
          widget: new FileEmbedWidget(fullPath, displayName, sizeBytes, type, relativePath, vaultPath, onRemove, searchRoot),
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
  searchRoot?: string,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildFileEmbedDecorations(view, vaultPath, onRemove, searchRoot)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildFileEmbedDecorations(update.view, vaultPath, onRemove, searchRoot)
        }
      }
    },
    { decorations: v => v.decorations }
  )
}
