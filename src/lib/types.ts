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
  createdAt: number
  updatedAt: number
  ownerId: string
  ownerName: string
  role: Role
  memberCount: number
  text: string
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
