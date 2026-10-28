import type { BlockType, NoteSummary } from './types'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayKey(): string {
  return dateKey(new Date())
}

export function parseDay(key: string): Date {
  return new Date(`${key}T12:00:00`)
}

export function isTodayKey(key: string): boolean {
  return key === todayKey()
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(timestamp),
  )
}

export function formatDayLong(key: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parseDay(key))
}

export function formatDayShort(key: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(
    parseDay(key),
  )
}

export function dayLabel(key: string): string {
  const today = todayKey()
  if (key === today) return 'Today'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === dateKey(yesterday)) return 'Yesterday'
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (key === dateKey(tomorrow)) return 'Tomorrow'
  return formatDayShort(key)
}

export function formatDue(due: string): string {
  const today = todayKey()
  if (due === today) return 'Today'
  if (due < today) return `Overdue · ${formatDayShort(due)}`
  return formatDayShort(due)
}

export function isOverdue(due: string | null): boolean {
  return !!due && due < todayKey()
}

/** Twos groups notes by the day they belong to; a due date wins over creation. */
export function noteDay(note: NoteSummary): string {
  return note.due ?? dateKey(new Date(note.createdAt))
}

export function noteSnippet(note: NoteSummary): string {
  const clean = note.text.replace(/\s+/g, ' ').trim()
  return clean.length > 180 ? `${clean.slice(0, 180)}…` : clean
}

export function effectiveTitle(note: Pick<NoteSummary, 'title' | 'text'>): string {
  if (note.title.trim()) return note.title.trim()
  const firstLine = note.text.split('\n').map((line) => line.trim()).find(Boolean)
  if (firstLine) return firstLine.slice(0, 80)
  return 'Untitled'
}

export function sortNotes(a: NoteSummary, b: NoteSummary): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1
  return b.updatedAt - a.updatedAt
}

export function groupByDay(notes: NoteSummary[]): { day: string; notes: NoteSummary[] }[] {
  const groups = new Map<string, NoteSummary[]>()
  for (const note of notes) {
    const day = noteDay(note)
    const bucket = groups.get(day)
    if (bucket) bucket.push(note)
    else groups.set(day, [note])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, notes: items.sort(sortNotes) }))
}

const PRESENCE_COLORS = [
  '#FF5C35',
  '#2D6BFF',
  '#12A67A',
  '#B14CE0',
  '#E0A400',
  '#0EA5B7',
  '#E0457B',
  '#6B7A99',
]

export function colorFor(userId: string): string {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) % 100_000
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'Bulleted list',
  number: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  code: 'Code',
  callout: 'Callout',
  divider: 'Divider',
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24)
}
