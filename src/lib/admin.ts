export interface AdminUser {
  userId: string
  displayName: string
  isAdmin: boolean
  createdAt: number
  suspendedAt: number
  lockedUntil: number
  failedAttempts: number
  noteCount: number
  sessionCount: number
  lastSeen: number | null
}

export interface AdminStats {
  accounts: number
  admins: number
  suspended: number
  notes: number
  sessions: number
  dbBytes: number
  version: string
  node: string
  uptime: number
  signupsEnabled: boolean
  rooms: {
    rooms: number
    noteRooms: number
    connections: number
    lobbyConnections: number
  }
}

export interface AuditEntry {
  id: number
  actorId: string
  actorName: string | null
  targetId: string | null
  targetName: string | null
  action: string
  detail: string
  createdAt: number
}

export interface AdminSnapshot {
  users: AdminUser[]
  stats: AdminStats
  audit: AuditEntry[]
}
