import type { BlockType, NoteSummary } from './types'

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
  dueToday?: boolean
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
    dueToday: true,
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

export function quickCaptureSummary(id: string, text: string, ownerId: string, ownerName: string): NoteSummary {
  const now = Date.now()
  return {
    id,
    title: text.slice(0, 120),
    due: null,
    tags: [],
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
    ownerId,
    ownerName,
    role: 'owner',
    memberCount: 1,
    text: '',
    pending: true,
  }
}
