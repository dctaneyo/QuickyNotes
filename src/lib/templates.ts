import type { BlockType } from './types'

export interface TemplateBlock {
  type: BlockType
  text: string
  checked?: boolean
}

export interface NoteTemplate {
  id: string
  name: string
  blurb: string
  glyph: string
  tags: string[]
  title?: (date: Date) => string
  blocks: TemplateBlock[]
}

const longDate = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)

export const TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    name: 'Blank note',
    blurb: 'An empty page and a cursor.',
    glyph: '—',
    tags: [],
    blocks: [{ type: 'text', text: '' }],
  },
  {
    id: 'daily',
    name: 'Daily note',
    blurb: 'Three things, then whatever else.',
    glyph: '☀',
    tags: ['daily'],
    title: longDate,
    blocks: [
      { type: 'h2', text: 'Three things for today' },
      { type: 'todo', text: '' },
      { type: 'todo', text: '' },
      { type: 'todo', text: '' },
      { type: 'divider', text: '' },
      { type: 'h2', text: 'Notes' },
      { type: 'text', text: '' },
    ],
  },
  {
    id: 'meeting',
    name: 'Meeting',
    blurb: 'Attendees, decisions, follow-ups.',
    glyph: '◷',
    tags: ['meeting'],
    blocks: [
      { type: 'h2', text: 'Attendees' },
      { type: 'text', text: '' },
      { type: 'h2', text: 'Decisions' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Follow-ups' },
      { type: 'todo', text: '' },
      { type: 'todo', text: '' },
    ],
  },
  {
    id: 'project',
    name: 'Project',
    blurb: 'Outcome, next actions, notes.',
    glyph: '◇',
    tags: ['project'],
    blocks: [
      { type: 'h2', text: 'Outcome' },
      { type: 'text', text: '' },
      { type: 'h2', text: 'Next actions' },
      { type: 'todo', text: '' },
      { type: 'todo', text: '' },
      { type: 'todo', text: '' },
      { type: 'h2', text: 'Notes' },
      { type: 'text', text: '' },
    ],
  },
]

export function templateById(id: string): NoteTemplate {
  return TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0]
}
