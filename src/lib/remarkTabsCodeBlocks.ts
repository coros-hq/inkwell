import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

// ```tabs fenced blocks (see lib/tabsBlock.ts) → custom `<inkwell-tabs spec="...">`
// node, rendered by RichPreview's `inkwell-tabs` component.
export function remarkTabsCodeBlocks() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      if ((node.lang ?? '').toLowerCase() !== 'tabs') return
      node.data = node.data ?? {}
      node.data.hName = 'inkwell-tabs'
      node.data.hProperties = { spec: node.value }
      node.data.hChildren = []
    })
  }
}
