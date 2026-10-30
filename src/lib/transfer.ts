import type { BlockSeed } from '../sync/noteModel'
import type { BlockType } from './types'

export interface TransferNote {
  title: string
  tags: string[]
  due: string | null
  parentId: string | null
  blocks: BlockSeed[]
}

export interface TransferArchive {
  version: number
  exportedAt: number
  notes: Array<{
    id?: string
    title: string
    due: string | null
    tags: string[]
    starred?: boolean
    parentId?: string | null
    blocks: BlockSeed[]
  }>
}

const BLOCK_PREFIXES: { prefix: string; type: BlockType; checked?: boolean }[] = [
  { prefix: '# ', type: 'h1' },
  { prefix: '## ', type: 'h2' },
  { prefix: '### ', type: 'h3' },
  { prefix: '- [ ] ', type: 'todo', checked: false },
  { prefix: '- [x] ', type: 'todo', checked: true },
  { prefix: '- [X] ', type: 'todo', checked: true },
  { prefix: '- ', type: 'bullet' },
  { prefix: '* ', type: 'bullet' },
  { prefix: '> ', type: 'quote' },
]

function blockLine(block: BlockSeed): string {
  if (block.type === 'divider') return '---'
  const indent = '  '.repeat(Math.max(0, Math.min(3, block.indent ?? 0)))
  if (block.type === 'h1') return `# ${block.text}`
  if (block.type === 'h2') return `## ${block.text}`
  if (block.type === 'h3') return `### ${block.text}`
  if (block.type === 'todo') return `${indent}- [${block.checked ? 'x' : ' '}] ${block.text}`
  if (block.type === 'bullet') return `${indent}- ${block.text}`
  if (block.type === 'number') return `${indent}1. ${block.text}`
  if (block.type === 'quote') return `> ${block.text}`
  if (block.type === 'code') return `\`\`\`\n${block.text}\n\`\`\``
  return block.text
}

export function markdownForNote(
  title: string,
  blocks: BlockSeed[],
  tags: string[] = [],
): string {
  const heading = title.trim() ? `# ${title.trim()}\n\n` : ''
  const tagLine = tags.length ? `${tags.map((tag) => `#${tag}`).join(' ')}\n\n` : ''
  return `${heading}${tagLine}${blocks.map(blockLine).join('\n')}\n`
}

export function parseMarkdown(markdown: string): TransferNote {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let index = 0
  let title = ''
  while (index < lines.length && !lines[index].trim()) index += 1
  if (lines[index]?.startsWith('# ')) {
    title = lines[index].slice(2).trim()
    index += 1
  }
  const tags: string[] = []
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    if (/^(#[\w-]+\s*)+$/.test(line)) {
      for (const match of line.matchAll(/#([\w-]+)/g)) {
        if (!tags.includes(match[1])) tags.push(match[1])
      }
      index += 1
      continue
    }
    break
  }

  const blocks: BlockSeed[] = []
  let inCode = false
  let code: string[] = []
  while (index < lines.length) {
    const raw = lines[index]
    const line = raw.replace(/\s+$/, '')
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', text: code.join('\n') })
        code = []
        inCode = false
      } else {
        inCode = true
      }
      index += 1
      continue
    }
    if (inCode) {
      code.push(line)
      index += 1
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      index += 1
      continue
    }
    if (trimmed === '---' || trimmed === '***') {
      blocks.push({ type: 'divider', text: '' })
      index += 1
      continue
    }
    let matched = false
    for (const candidate of BLOCK_PREFIXES) {
      if (!trimmed.startsWith(candidate.prefix)) continue
      const indent = Math.max(0, Math.min(3, Math.floor((line.length - line.trimStart().length) / 2)))
      blocks.push({
        type: candidate.type,
        text: trimmed.slice(candidate.prefix.length),
        checked: candidate.checked,
        indent,
      })
      matched = true
      break
    }
    if (!matched) {
      const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/)
      blocks.push(
        numbered
          ? { type: 'number', text: numbered[2], indent: 0 }
          : { type: 'text', text: line },
      )
    }
    index += 1
  }
  if (inCode && code.length) blocks.push({ type: 'code', text: code.join('\n') })
  if (blocks.length === 0) blocks.push({ type: 'text', text: '' })
  if (!title) {
    const firstText = blocks.find((block) => block.text.trim())
    title = firstText ? firstText.text.trim().slice(0, 80) : 'Imported note'
  }
  return { title, tags, due: null, parentId: null, blocks }
}

export function parseArchive(raw: string): TransferNote[] {
  const parsed = JSON.parse(raw) as TransferArchive | TransferArchive['notes'][number]
  const notes = Array.isArray((parsed as TransferArchive).notes)
    ? (parsed as TransferArchive).notes
    : [parsed as TransferArchive['notes'][number]]
  return notes
    .filter((note) => note && typeof note.title === 'string' && Array.isArray(note.blocks))
    .map((note) => ({
      title: note.title.slice(0, 200),
      tags: Array.isArray(note.tags) ? note.tags.filter((tag) => typeof tag === 'string') : [],
      due: typeof note.due === 'string' ? note.due : null,
      parentId: typeof note.parentId === 'string' ? note.parentId : null,
      blocks: note.blocks.filter(
        (block) => block && typeof block.text === 'string' && typeof block.type === 'string',
      ),
    }))
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return clean.slice(0, 60) || 'quicky-note'
}
