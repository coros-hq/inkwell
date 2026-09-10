import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

// Fenced code blocks tagged with one of these info strings are treated as
// display math instead of syntax-highlighted code:
//
//   ```math
//   \int_0^1 x^2 \, dx
//   ```
//
// remark-math only understands $…$ / $$…$$; this bridges the fenced-block form
// so `$` doesn't have to be escaped for multi-line formulas.
const MATH_LANGS = new Set(['math', 'latex', 'tex', 'katex'])

/**
 * Rewrites ```math / ```latex code nodes into the hast shape that
 * `rehype-katex` renders — a `<div class="math math-display">` whose text is the
 * TeX source. Runs on the mdast tree, before remark-rehype.
 */
export function remarkMathCodeBlocks() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const lang = (node.lang ?? '').toLowerCase()
      if (!MATH_LANGS.has(lang)) return

      node.data = node.data ?? {}
      // `mdast-util-to-hast` applies these over its default `code` handler.
      node.data.hName = 'div'
      node.data.hProperties = { className: ['math', 'math-display'] }
      node.data.hChildren = [{ type: 'text', value: node.value }]
    })
  }
}
