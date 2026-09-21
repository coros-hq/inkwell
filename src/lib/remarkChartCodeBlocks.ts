import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

// Fenced code blocks tagged ```chart hold a small JSON spec (Chart.js-shaped:
// type/labels/datasets) instead of syntax-highlighted code:
//
//   ```chart
//   { "type": "bar", "labels": ["Mon","Tue"], "datasets": [{ "label": "Sales", "data": [10,20] }] }
//   ```
//
// Rewritten into a custom `<inkwell-chart spec="...">` hast node, rendered by
// RichPreview's `inkwell-chart` component instead of a highlighted code block.
const CHART_LANGS = new Set(['chart'])

export function remarkChartCodeBlocks() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const lang = (node.lang ?? '').toLowerCase()
      if (!CHART_LANGS.has(lang)) return

      node.data = node.data ?? {}
      node.data.hName = 'inkwell-chart'
      node.data.hProperties = { spec: node.value }
      node.data.hChildren = []
    })
  }
}
