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

export type Role = 'owner' | 'editor' | 'viewer'

export interface MemberPermissions {
  /** Can change the note body and metadata. */
  edit: boolean
  /** Can post, resolve and delete comments. */
  comment: boolean
}

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
  /** Optional so notes cached by older clients still load safely. */
  permissions?: MemberPermissions
  memberCount: number
  /** Read-only because the owner locked it. */
  locked?: boolean
  /** A note password is required for non-owners to unlock it. */
  lockProtected?: boolean
  text: string
  /** Pushed with the note list so the share dialog is live too. */
  members?: Member[]
  /** Parent page for nested notes. */
  parentId?: string | null
  /** Public read-only link token. Only returned to the owner. */
  publicToken?: string | null
  /** Created on this device and not yet registered with the server. */
  pending?: boolean
}

export interface Member {
  userId: string
  displayName: string
  role: Role
  /** Optional so member lists cached by older clients still load safely. */
  permissions?: MemberPermissions
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

export interface NoteComment {
  id: string
  noteId: string
  authorId: string
  authorName: string
  body: string
  resolvedAt: number
  createdAt: number
  mentions: { userId: string; displayName: string }[]
}

export interface MentionItem {
  id: string
  noteId: string
  noteTitle: string
  authorId: string
  authorName: string
  body: string
  createdAt: number
  readAt: number
  /** True when this comment also explicitly @mentions the recipient. */
  mentioned: boolean
}
