import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Brainstorm, BrainstormNode, BrainstormRelation } from '../types'
import { genId } from './id'

// XMind (.xmind) import/export. A .xmind file is a zip:
//   - XMind 2020+ ("Zen"):  content.json (+ metadata.json, manifest.json)
//   - XMind 8 and older:    content.xml
// Both are read; export writes the modern content.json layout.
//
// Mapping: a sheet is one Brainstorm. The sheet's central topic is the
// brainstorm title (our map has a virtual root), its children are the
// top-level points, and XMind relationships become BrainstormRelations.
// Markers, notes, labels, summaries and boundaries have no equivalent and are dropped.

export class XmindError extends Error {}

interface Imported {
  brainstorms: Brainstorm[]
}

// ── Import ────────────────────────────────────────────────────────────────────

export function importXmind(bytes: Uint8Array): Imported {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new XmindError('This file is not a valid .xmind archive.')
  }

  let sheets: ParsedSheet[]
  if (files['content.json']) {
    let json: unknown
    try {
      json = JSON.parse(strFromU8(files['content.json']))
    } catch {
      throw new XmindError('The map data (content.json) is corrupted.')
    }
    sheets = parseJsonSheets(json)
  } else if (files['content.xml']) {
    sheets = parseXmlSheets(strFromU8(files['content.xml']))
  } else {
    throw new XmindError('No map data found in this file (expected content.json or content.xml).')
  }

  if (sheets.length === 0) throw new XmindError('This file contains no maps.')

  const now = new Date().toISOString()
  return {
    brainstorms: sheets.map((s, i) => ({
      id: genId('brainstorm'),
      title: s.title || s.rootTitle || `Imported map ${i + 1}`,
      createdAt: now,
      updatedAt: now,
      root: s.root,
      relations: s.relations,
    })),
  }
}

interface ParsedSheet {
  title: string
  rootTitle: string
  root: BrainstormNode[]
  relations: BrainstormRelation[]
}

/** Builds our nodes from an XMind topic tree, remembering XMind ids so relationships can be re-linked. */
class Builder {
  private ids = new Map<string, string>()

  node(xmindId: string | undefined, text: string, collapsed: boolean, children: BrainstormNode[]): BrainstormNode {
    const id = genId('bn')
    if (xmindId) this.ids.set(xmindId, id)
    const node: BrainstormNode = { id, text, children }
    if (collapsed && children.length) node.collapsed = true
    return node
  }

  relations(raw: { end1: string; end2: string; label: string }[]): BrainstormRelation[] {
    const out: BrainstormRelation[] = []
    for (const r of raw) {
      const from = this.ids.get(r.end1)
      const to = this.ids.get(r.end2)
      if (!from || !to || from === to) continue
      out.push({ id: genId('br'), from, to, ...(r.label ? { label: r.label } : {}) })
    }
    return out
  }
}

// -- content.json

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function parseJsonSheets(json: unknown): ParsedSheet[] {
  if (!Array.isArray(json)) throw new XmindError('Unrecognised map data format.')
  const sheets: ParsedSheet[] = []
  for (const sheet of json) {
    if (!isObj(sheet) || !isObj(sheet.rootTopic)) continue
    const b = new Builder()

    const topic = (t: Json): BrainstormNode => {
      const children = isObj(t.children) ? topicList(t.children.attached) : []
      return b.node(str(t.id), str(t.title), t.branch === 'folded', children)
    }
    const topicList = (v: unknown): BrainstormNode[] =>
      Array.isArray(v) ? v.filter(isObj).map(topic) : []

    const rootTopic = sheet.rootTopic
    const root = isObj(rootTopic.children) ? topicList(rootTopic.children.attached) : []
    // Floating topics sit beside the main tree; keep them as extra top-level points.
    if (isObj(rootTopic.children)) root.push(...topicList(rootTopic.children.detached))

    // The central topic isn't a node of ours, but relationships may point at it.
    // Map it onto nothing — such relationships are skipped by Builder.relations.
    const rels = Array.isArray(sheet.relationships)
      ? sheet.relationships.filter(isObj).map((r) => ({ end1: str(r.end1Id), end2: str(r.end2Id), label: str(r.title) }))
      : []

    sheets.push({
      title: str(sheet.title),
      rootTitle: str(rootTopic.title),
      root,
      relations: b.relations(rels),
    })
  }
  return sheets
}

// -- content.xml (XMind 8)

function parseXmlSheets(xml: string): ParsedSheet[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new XmindError('The map data (content.xml) is corrupted.')

  const kids = (el: Element, name: string) =>
    Array.from(el.children).filter((c) => c.localName === name)

  const sheets: ParsedSheet[] = []
  for (const sheet of kids(doc.documentElement, 'sheet')) {
    const rootTopic = kids(sheet, 'topic')[0]
    if (!rootTopic) continue
    const b = new Builder()

    const topic = (t: Element): BrainstormNode => {
      const children: BrainstormNode[] = []
      for (const wrap of kids(t, 'children')) {
        for (const group of kids(wrap, 'topics')) {
          if (group.getAttribute('type') && group.getAttribute('type') !== 'attached') continue
          children.push(...kids(group, 'topic').map(topic))
        }
      }
      const title = kids(t, 'title')[0]?.textContent ?? ''
      return b.node(t.getAttribute('id') ?? undefined, title, t.getAttribute('branch') === 'folded', children)
    }

    const root: BrainstormNode[] = []
    for (const wrap of kids(rootTopic, 'children')) {
      for (const group of kids(wrap, 'topics')) {
        if (group.getAttribute('type') && group.getAttribute('type') !== 'attached') continue
        root.push(...kids(group, 'topic').map(topic))
      }
    }

    const rels: { end1: string; end2: string; label: string }[] = []
    for (const wrap of kids(sheet, 'relationships')) {
      for (const r of kids(wrap, 'relationship')) {
        rels.push({
          end1: r.getAttribute('end1') ?? '',
          end2: r.getAttribute('end2') ?? '',
          label: kids(r, 'title')[0]?.textContent ?? '',
        })
      }
    }

    sheets.push({
      title: kids(sheet, 'title')[0]?.textContent ?? '',
      rootTitle: kids(rootTopic, 'title')[0]?.textContent ?? '',
      root,
      relations: b.relations(rels),
    })
  }
  return sheets
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportXmind(brainstorm: Brainstorm): Uint8Array {
  // XMind ids only need to be unique within the file; reuse ours.
  const topic = (n: BrainstormNode): Json => ({
    id: n.id,
    class: 'topic',
    title: n.text,
    ...(n.collapsed && n.children.length ? { branch: 'folded' } : {}),
    ...(n.children.length ? { children: { attached: n.children.map(topic) } } : {}),
  })

  const rootId = genId('root')
  const sheet = {
    id: genId('sheet'),
    class: 'sheet',
    title: brainstorm.title || 'Untitled',
    rootTopic: {
      id: rootId,
      class: 'topic',
      title: brainstorm.title || 'Untitled',
      structureClass: 'org.xmind.ui.map.unbalanced',
      ...(brainstorm.root.length ? { children: { attached: brainstorm.root.map(topic) } } : {}),
    },
    relationships: (brainstorm.relations ?? []).map((r) => ({
      id: r.id,
      end1Id: r.from,
      end2Id: r.to,
      ...(r.label ? { title: r.label } : {}),
    })),
  }

  const enc = (v: unknown) => strToU8(JSON.stringify(v))
  return zipSync({
    'content.json': enc([sheet]),
    'metadata.json': enc({ creator: { name: 'Inkwell' } }),
    'manifest.json': enc({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }),
  })
}
