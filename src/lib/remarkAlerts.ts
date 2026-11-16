import { visit } from 'unist-util-visit'
import type { Root, Blockquote, Paragraph } from 'mdast'
import { ALERT_MARKER_RE, parseAlertType } from './alerts'

/**
 * Turns `> [!NOTE]` blockquotes into alerts: strips the marker and tags the
 * blockquote with data-alert / data-alert-title, which RichPreview's
 * `blockquote` renderer turns into the styled box. See lib/alerts.ts.
 */
export function remarkAlerts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0]
      if (first?.type !== 'paragraph') return
      const text = first.children[0]
      if (text?.type !== 'text') return
      const m = text.value.match(ALERT_MARKER_RE)
      if (!m) return

      text.value = text.value.slice(m[0].length).replace(/^\n/, '')
      const para = first as Paragraph
      if (!text.value) para.children.shift()
      // A hard break right after the marker line would otherwise open the body.
      if (para.children[0]?.type === 'break') para.children.shift()
      if (para.children.length === 0) node.children.shift()

      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          dataAlert: parseAlertType(m[1]),
          dataAlertTitle: m[2].trim() || undefined,
        },
      }
    })
  }
}
