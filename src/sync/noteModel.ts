import * as Y from 'yjs'
import type { BlockType } from '../lib/types'
import { uid } from '../lib/notes'

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'

export interface NoteMetaValues {
  title: string
  tags: string[]
  due: string | null
  repeat: Repeat
  starred: boolean
  trashed: boolean
  createdAt: number
  updatedAt: number
  ownerId: string
}

export interface BlockSeed {
  type: BlockType
  text: string
  checked?: boolean
  indent?: number
}

export interface BlockView {
  id: string
  type: BlockType
  text: string
  checked: boolean
  indent: number
}

const BLOCK_TYPES = new Set<BlockType>([
  'text',
  'h1',
  'h2',
  'h3',
  'bullet',
  'number',
  'todo',
  'quote',
  'code',
  'callout',
  'divider',
])

export function noteMeta(doc: Y.Doc): NoteMetaValues {
  const meta = doc.getMap<unknown>('meta')
  const rawTags = meta.get('tags')
  return {
    title: typeof meta.get('title') === 'string' ? (meta.get('title') as string) : '',
    tags: Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === 'string') : [],
    due: typeof meta.get('due') === 'string' && meta.get('due') ? (meta.get('due') as string) : null,
    repeat: (['daily', 'weekly', 'monthly'].includes(String(meta.get('repeat')))
      ? String(meta.get('repeat'))
      : 'none') as Repeat,
    starred: meta.get('starred') === true,
    trashed: meta.get('trashed') === true,
    createdAt: Number(meta.get('createdAt')) || Date.now(),
    updatedAt: Number(meta.get('updatedAt')) || Date.now(),
    ownerId: typeof meta.get('ownerId') === 'string' ? (meta.get('ownerId') as string) : '',
  }
}

export function patchMeta(doc: Y.Doc, patch: Partial<NoteMetaValues>, touch = true): void {
  const meta = doc.getMap<unknown>('meta')
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) meta.set(key, value)
    if (touch) meta.set('updatedAt', Date.now())
  })
}

export function blockArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>('blocks')
}

export function blockTextNode(block: Y.Map<unknown>): Y.Text {
  const existing = block.get('text')
  if (existing instanceof Y.Text) return existing
  const text = new Y.Text()
  block.set('text', text)
  return text
}

export function blockView(block: Y.Map<unknown>): BlockView {
  const type = block.get('type')
  return {
    id: String(block.get('id') ?? ''),
    type: (typeof type === 'string' && BLOCK_TYPES.has(type as BlockType) ? type : 'text') as BlockType,
    text: blockTextNode(block).toString(),
    checked: block.get('checked') === true,
    indent: Number(block.get('indent')) || 0,
  }
}

export function blockViews(doc: Y.Doc): BlockView[] {
  return blockArray(doc).toArray().map(blockView)
}

export function plainText(doc: Y.Doc): string {
  return blockArray(doc)
    .toArray()
    .map((block) => (block.get('type') === 'divider' ? '' : blockTextNode(block).toString()))
    .join('\n')
    .trim()
}

export function createBlock(doc: Y.Doc, index: number, seed: BlockSeed): Y.Map<unknown> {
  const blocks = blockArray(doc)
  const block = new Y.Map<unknown>()
  let created = block
  doc.transact(() => {
    blocks.insert(index, [block])
    block.set('id', uid())
    block.set('type', seed.type)
    block.set('indent', seed.indent ?? 0)
    block.set('checked', seed.checked === true)
    const text = new Y.Text()
    if (seed.text) text.insert(0, seed.text)
    block.set('text', text)
  })
  created = block
  return created
}

export function deleteBlock(doc: Y.Doc, index: number): void {
  const blocks = blockArray(doc)
  if (blocks.length <= 1) {
    const only = blocks.get(0)
    if (only) blockTextNode(only).delete(0, blockTextNode(only).length)
    return
  }
  doc.transact(() => blocks.delete(index, 1))
}

export function moveBlock(doc: Y.Doc, from: number, to: number): void {
  const blocks = blockArray(doc)
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return
  doc.transact(() => {
    const block = blocks.get(from)
    blocks.delete(from, 1)
    blocks.insert(to, [block])
  })
}

/** Minimal prefix/suffix diff so concurrent typists do not clobber whole lines. */
export function applyTextEdit(text: Y.Text, next: string): void {
  const previous = text.toString()
  if (previous === next) return
  let start = 0
  const limit = Math.min(previous.length, next.length)
  while (start < limit && previous[start] === next[start]) start += 1
  let previousEnd = previous.length
  let nextEnd = next.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }
  text.doc?.transact(() => {
    if (previousEnd > start) text.delete(start, previousEnd - start)
    if (nextEnd > start) text.insert(start, next.slice(start, nextEnd))
  })
}

export function seedDocument(
  doc: Y.Doc,
  values: {
    ownerId: string
    title: string
    tags: string[]
    due: string | null
    repeat?: Repeat
    blocks: BlockSeed[]
  },
): void {
  const now = Date.now()
  doc.transact(() => {
    const meta = doc.getMap<unknown>('meta')
    meta.set('title', values.title)
    meta.set('tags', values.tags)
    meta.set('due', values.due)
    meta.set('repeat', values.repeat ?? 'none')
    meta.set('starred', false)
    meta.set('trashed', false)
    meta.set('createdAt', now)
    meta.set('updatedAt', now)
    meta.set('ownerId', values.ownerId)
    const blocks = blockArray(doc)
    for (const seed of values.blocks) {
      const block = new Y.Map<unknown>()
      blocks.push([block])
      block.set('id', uid())
      block.set('type', seed.type)
      block.set('indent', seed.indent ?? 0)
      block.set('checked', seed.checked === true)
      const text = new Y.Text()
      if (seed.text) text.insert(0, seed.text)
      block.set('text', text)
    }
  })
}

export function cloneUpdateWithDue(source: Y.Doc, due: string | null): Uint8Array {
  const clone = new Y.Doc()
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source))
  patchMeta(clone, { due, trashed: false, starred: false }, true)
  const update = Y.encodeStateAsUpdate(clone)
  clone.destroy()
  return update
}

export function encodeSeed(values: Parameters<typeof seedDocument>[1]): Uint8Array {
  const doc = new Y.Doc()
  seedDocument(doc, values)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}
