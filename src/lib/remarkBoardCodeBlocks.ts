import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

// ```board / ```task fenced blocks hold a single board or task id. Rewritten
// into `<inkwell-board rid="…">` / `<inkwell-task rid="…">` hast nodes, which
// RichPreview renders live from the store.
export function remarkBoardCodeBlocks() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const lang = (node.lang ?? '').toLowerCase()
      if (lang !== 'board' && lang !== 'task') return
      node.data = node.data ?? {}
      node.data.hName = `inkwell-${lang}`
      node.data.hProperties = { rid: node.value.trim() }
      node.data.hChildren = []
    })
  }
}
