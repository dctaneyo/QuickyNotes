import type { BlockFormat } from './formatting'

export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'todo'
  | 'quote'
  | 'code'
  | 'callout'
  | 'divider'

export type Role = 'owner' | 'editor'

export interface NoteSummary {
  id: string
  title: string
  due: string | null
  tags: string[]
  starred: boolean
  trashed: boolean
  /** When the note was moved to the trash (0 when not trashed). */
  trashedAt?: number
  createdAt: number
  updatedAt: number
  ownerId: string
  ownerName: string
  role: Role
  memberCount: number
  /** Read-only because the owner locked it. */
  locked?: boolean
  /** A note password is required for non-owners to unlock it. */
  lockProtected?: boolean
  text: string
  /** Pushed with the note list so the share dialog is live too. */
  members?: Member[]
  /** Created on this device and not yet registered with the server. */
  pending?: boolean
}

export interface Member {
  userId: string
  displayName: string
  role: Role
}

export type ViewId = 'today' | 'all' | 'starred' | 'trash'

export type Filter =
  | { kind: 'view'; id: ViewId }
  | { kind: 'day'; date: string }
  | { kind: 'tag'; tag: string }

export type SyncState = 'online' | 'connecting' | 'offline'

export interface NoteHistoryChange {
  blockId: string
  field: 'title' | 'block'
  kind: 'changed' | 'added' | 'removed'
  before: string
  after: string
  beforeType?: BlockType | null
  afterType?: BlockType | null
  beforeChecked?: boolean
  afterChecked?: boolean
  beforeIndent?: number
  afterIndent?: number
  beforeFormat?: BlockFormat | null
  afterFormat?: BlockFormat | null
  index?: number
}

export interface NoteHistoryEntry {
  id: number
  actorId: string
  actorName: string
  createdAt: number
  changes: NoteHistoryChange[]
}
