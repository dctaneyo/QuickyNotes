import type { BlockType } from '../lib/types'

export interface SlashItem {
  type: BlockType
  label: string
  hint: string
  glyph: string
  keywords: string
}

export const SLASH_ITEMS: SlashItem[] = [
  { type: 'text', label: 'Text', hint: 'Plain paragraph', glyph: '¶', keywords: 'paragraph body' },
  { type: 'h1', label: 'Heading 1', hint: 'Section title', glyph: 'H1', keywords: 'title big' },
  { type: 'h2', label: 'Heading 2', hint: 'Sub-section', glyph: 'H2', keywords: 'subtitle' },
  { type: 'h3', label: 'Heading 3', hint: 'Small heading', glyph: 'H3', keywords: 'minor' },
  { type: 'todo', label: 'To-do', hint: 'Track a task', glyph: '☑', keywords: 'task checkbox check' },
  { type: 'bullet', label: 'Bulleted list', hint: 'A list of points', glyph: '•', keywords: 'list unordered' },
  { type: 'number', label: 'Numbered list', hint: 'A list in order', glyph: '1.', keywords: 'list ordered' },
  { type: 'quote', label: 'Quote', hint: 'Set text apart', glyph: '”', keywords: 'citation' },
  { type: 'callout', label: 'Callout', hint: 'Something to notice', glyph: '!', keywords: 'note info highlight' },
  { type: 'code', label: 'Code', hint: 'Fixed-width block', glyph: '</>', keywords: 'snippet monospace' },
  { type: 'divider', label: 'Divider', hint: 'A line between sections', glyph: '—', keywords: 'rule separator hr' },
]

export function filterSlash(query: string): SlashItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return SLASH_ITEMS
  return SLASH_ITEMS.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().includes(needle),
  )
}

interface SlashMenuProps {
  items: SlashItem[]
  active: number
  top: number
  left: number
  onPick: (type: BlockType) => void
}

export function SlashMenu({ items, active, top, left, onPick }: SlashMenuProps) {
  if (items.length === 0) return null
  const clampedLeft = Math.min(left, Math.max(12, window.innerWidth - 300))
  const clampedTop = Math.min(top, window.innerHeight - 360)
  return (
    <div className="slash" style={{ top: clampedTop, left: clampedLeft }} role="listbox" aria-label="Insert block">
      <p className="slash__label">Blocks</p>
      <div className="slash__list">
        {items.map((item, index) => (
          <button
            key={item.type}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`slash__item${index === active ? ' is-active' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(item.type)
            }}
          >
            <span className="slash__glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span className="slash__name">{item.label}</span>
            <span className="slash__hint">{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
