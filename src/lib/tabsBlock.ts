// A ```tabs fenced block holds a small JSON spec — several titled tabs, each with
// its own markdown — so one note can carry separate pages of content:
//
//   ```tabs
//   { "active": 0, "tabs": [ { "id": "a1", "title": "Overview", "content": "# Hi" } ] }
//   ```
//
// JSON escapes newlines, so tab content can itself contain code fences without
// ever closing the outer block.

export interface NoteTab {
  id: string
  title: string
  content: string
}

export interface TabsSpec {
  active: number
  tabs: NoteTab[]
}

export function newTabId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export function defaultTabsSpec(): TabsSpec {
  return {
    active: 0,
    tabs: [
      { id: newTabId(), title: 'Tab 1', content: '' },
      { id: newTabId(), title: 'Tab 2', content: '' },
    ],
  }
}

export function parseTabsSpec(raw: string): TabsSpec {
  try {
    const obj = JSON.parse(raw)
    const tabs: NoteTab[] = Array.isArray(obj?.tabs)
      ? obj.tabs.map((t: Partial<NoteTab>, i: number) => ({
          id: typeof t?.id === 'string' && t.id ? t.id : newTabId(),
          title: typeof t?.title === 'string' ? t.title : `Tab ${i + 1}`,
          content: typeof t?.content === 'string' ? t.content : '',
        }))
      : []
    if (tabs.length === 0) return defaultTabsSpec()
    const active = Math.min(Math.max(Number(obj?.active) || 0, 0), tabs.length - 1)
    return { active, tabs }
  } catch {
    return defaultTabsSpec()
  }
}

export function serializeTabsSpec(spec: TabsSpec): string {
  return JSON.stringify(spec)
}

export function tabsBlock(spec: TabsSpec): string {
  return '```tabs\n' + serializeTabsSpec(spec) + '\n```'
}
