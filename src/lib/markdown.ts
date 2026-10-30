import type { BlockType } from './types'

export interface MarkdownShortcut {
  type: BlockType
  label: string
  marker: string
  aliases?: string[]
}

export const MARKDOWN_SHORTCUTS: MarkdownShortcut[] = [
  { type: 'h1', label: 'Heading 1', marker: '#' },
  { type: 'h2', label: 'Heading 2', marker: '##' },
  { type: 'h3', label: 'Heading 3', marker: '###' },
  { type: 'bullet', label: 'Bulleted list', marker: '-', aliases: ['*', '+'] },
  { type: 'number', label: 'Numbered list', marker: '1.' },
  { type: 'todo', label: 'To-do', marker: '[]', aliases: ['[ ]'] },
  { type: 'quote', label: 'Quote', marker: '>' },
  { type: 'callout', label: 'Callout', marker: '!' },
  { type: 'code', label: 'Code block', marker: '```' },
  { type: 'divider', label: 'Divider', marker: '---' },
]

const TYPES_BY_MARKER = new Map<string, BlockType>()
for (const shortcut of MARKDOWN_SHORTCUTS) {
  TYPES_BY_MARKER.set(shortcut.marker, shortcut.type)
  for (const alias of shortcut.aliases ?? []) TYPES_BY_MARKER.set(alias, shortcut.type)
}

/** Match a complete marker, before the user has typed the separating space. */
export function markdownTypeForMarker(marker: string): BlockType | null {
  return TYPES_BY_MARKER.get(marker) ?? null
}

/** Match the input after a marker and its separating space have been inserted. */
export function markdownTypeAfterInput(value: string): BlockType | null {
  if (!value.endsWith(' ')) return null
  return markdownTypeForMarker(value.slice(0, -1))
}
