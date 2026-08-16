import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { useEditorViewRef } from './EditorViewContext'

interface HeadingTick {
  level: number
  text: string
  /** 1-based source line number — used to look up the exact pixel position. */
  line: number
  /** Line-count fraction, kept only as a last-resort fallback. */
  fraction: number
}

function parseHeadings(content: string): HeadingTick[] {
  const lines = content.split('\n')
  const total = Math.max(lines.length - 1, 1)
  const ticks: HeadingTick[] = []
  lines.forEach((line, i) => {
    const m = /^(#{1,3})\s+(.+)/.exec(line)
    if (m) ticks.push({ level: m[1].length, text: m[2].trim(), line: i + 1, fraction: i / total })
  })
  return ticks
}

// How long the active bar stays "swelled" after the last scroll event before
// settling back down — long enough to read as a response to scrolling, short
// enough that it doesn't linger once you stop.
const SWELL_SETTLE_MS = 350

/**
 * Right-edge document map: a bar per heading (sized by level), no track line
 * or dot. The bar for whichever section is currently at the top of the
 * viewport highlights, and swells further while actively scrolling.
 *
 * Position is measured two different ways depending on what's scrolling:
 *  - CodeMirror (Normal mode / Markdown mode's source pane): via the editor's
 *    line heightmap (`lineBlockAt`), which stays accurate even for lines that
 *    aren't currently rendered in the DOM (CodeMirror virtualizes).
 *  - Rendered preview (Markdown mode's preview pane): the heading elements
 *    are real, un-virtualized DOM nodes, so their `offsetTop` is measured
 *    directly — no line-count approximation needed.
 * Line-count fraction is only a fallback for the rare case neither applies.
 */
export function StructureRail({ content, scrollerEl }: { content: string; scrollerEl: HTMLElement | null }) {
  const ticks = useMemo(() => parseHeadings(content), [content])
  const viewRef = useEditorViewRef()
  const [activeIndex, setActiveIndex] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!scrollerEl || ticks.length === 0) return

    const isCodeMirror = viewRef.current?.scrollDOM === scrollerEl

    const byFraction = () => {
      const max = scrollerEl.scrollHeight - scrollerEl.clientHeight
      const progress = max > 0 ? scrollerEl.scrollTop / max : 0
      let active = 0
      ticks.forEach((t, i) => { if (t.fraction <= progress) active = i })
      return active
    }

    const update = () => {
      const top = scrollerEl.scrollTop
      let active = 0

      try {
        if (isCodeMirror && viewRef.current) {
          const view = viewRef.current
          const totalLines = view.state.doc.lines
          ticks.forEach((t, i) => {
            const line = view.state.doc.line(Math.min(Math.max(t.line, 1), totalLines))
            if (view.lineBlockAt(line.from).top <= top + 4) active = i
          })
        } else {
          const headings = scrollerEl.querySelectorAll('h1, h2, h3')
          if (headings.length > 0) {
            headings.forEach((el, i) => {
              if (i < ticks.length && (el as HTMLElement).offsetTop <= top + 4) active = i
            })
          } else {
            active = byFraction()
          }
        }
      } catch {
        // Editor/DOM measurement can momentarily be out of sync with `ticks`
        // right as content changes — fall back rather than freeze the rail.
        active = byFraction()
      }

      setActiveIndex(active)
      setIsScrolling(true)
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => setIsScrolling(false), SWELL_SETTLE_MS)
    }

    update()
    scrollerEl.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scrollerEl)
    return () => {
      scrollerEl.removeEventListener('scroll', update)
      ro.disconnect()
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [scrollerEl, content, ticks, viewRef])

  if (ticks.length === 0) return null

  const jumpTo = (index: number) => {
    if (!scrollerEl) return
    const t = ticks[index]
    const view = viewRef.current

    if (view?.scrollDOM === scrollerEl) {
      const line = view.state.doc.line(Math.min(t.line, view.state.doc.lines))
      scrollerEl.scrollTo({ top: view.lineBlockAt(line.from).top, behavior: 'smooth' })
      return
    }

    const headings = scrollerEl.querySelectorAll('h1, h2, h3')
    const el = headings[index] as HTMLElement | undefined
    if (el) {
      scrollerEl.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
      return
    }

    const max = scrollerEl.scrollHeight - scrollerEl.clientHeight
    scrollerEl.scrollTo({ top: t.fraction * max, behavior: 'smooth' })
  }

  return (
    <div className="structure-rail">
      {ticks.map((t, i) => (
        <button
          key={i}
          type="button"
          className={cn(
            'structure-rail-tick',
            i === activeIndex && 'active',
            i === activeIndex && isScrolling && 'swelling',
          )}
          data-level={t.level}
          onClick={() => jumpTo(i)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(i)}
          onBlur={() => setHovered(null)}
        >
          {hovered === i && <span className="structure-rail-label">{t.text}</span>}
        </button>
      ))}
    </div>
  )
}
