import type { BlockType, Member, MemberPermissions, NoteSummary } from './types'

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

export function shiftDay(key: string, days: number): string {
  const date = parseDay(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

/** Every note belongs to a day; `due` stores it, creation day is the fallback. */
export function noteDay(note: NoteSummary): string {
  return note.due ?? dateKey(new Date(note.createdAt))
}

export function noteSnippet(note: NoteSummary): string {
  const clean = note.text.replace(/\s+/g, ' ').trim()
  return clean.length > 180 ? `${clean.slice(0, 180)}…` : clean
}

export function notePermissions(
  note: Pick<NoteSummary, 'role' | 'permissions'>,
): MemberPermissions {
  return note.permissions ?? { edit: note.role !== 'viewer', comment: true }
}

export function memberPermissions(
  member: Pick<Member, 'role' | 'permissions'>,
): MemberPermissions {
  return member.permissions ?? { edit: member.role !== 'viewer', comment: true }
}

export function effectiveTitle(note: Pick<NoteSummary, 'title' | 'text'>): string {
  if (note.title.trim()) return note.title.trim()
  const firstLine = note.text.split('\n').map((line) => line.trim()).find(Boolean)
  if (firstLine) return firstLine.slice(0, 80)
  return 'Untitled'
}

export interface NoteListEntry {
  note: NoteSummary
  depth: number
}

export function sortNotes(a: NoteSummary, b: NoteSummary): number {
  return b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
}

/**
 * Build the sidebar tree. Top-level notes are newest-created first, and each
 * page's subpages are nested beneath it in the same order.
 */
export function groupByDay(
  notes: NoteSummary[],
): { day: string; notes: NoteListEntry[] }[] {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const children = new Map<string, NoteSummary[]>()
  const roots: NoteSummary[] = []

  for (const note of notes) {
    if (note.parentId && note.parentId !== note.id && byId.has(note.parentId)) {
      const siblings = children.get(note.parentId)
      if (siblings) siblings.push(note)
      else children.set(note.parentId, [note])
    } else {
      roots.push(note)
    }
  }
  for (const siblings of children.values()) siblings.sort(sortNotes)
  roots.sort(sortNotes)

  const ordered: { note: NoteSummary; depth: number; day: string }[] = []
  const seen = new Set<string>()
  const visit = (note: NoteSummary, depth: number, day: string) => {
    if (seen.has(note.id)) return
    seen.add(note.id)
    ordered.push({ note, depth, day })
    for (const child of children.get(note.id) ?? []) visit(child, depth + 1, day)
  }

  for (const root of roots) visit(root, 0, noteDay(root))
  // A malformed parent cycle has no root; still show every note exactly once.
  for (const note of [...notes].sort(sortNotes)) {
    if (!seen.has(note.id)) visit(note, 0, noteDay(note))
  }

  const groups = new Map<string, NoteListEntry[]>()
  for (const entry of ordered) {
    const bucket = groups.get(entry.day)
    if (bucket) bucket.push({ note: entry.note, depth: entry.depth })
    else groups.set(entry.day, [{ note: entry.note, depth: entry.depth }])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, notes: items }))
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
