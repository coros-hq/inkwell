import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

// Fenced code blocks tagged ```table hold a JSON spec (user-defined columns
// and rows — see lib/dataTable.ts) instead of syntax-highlighted code.
// Rewritten into a custom `<inkwell-table spec="...">` hast node, rendered by
// RichPreview's `inkwell-table` component.
export function remarkTableCodeBlocks() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      if ((node.lang ?? '').toLowerCase() !== 'table') return
      node.data = node.data ?? {}
      node.data.hName = 'inkwell-table'
      node.data.hProperties = { spec: node.value }
      node.data.hChildren = []
    })
  }
}
