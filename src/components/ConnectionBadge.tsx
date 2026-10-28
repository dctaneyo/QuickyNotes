import type { SyncState } from '../lib/types'

interface ConnectionBadgeProps {
  status: SyncState
  synced?: boolean
  onRetry?: () => void
  compact?: boolean
}

export function ConnectionBadge({ status, synced = true, onRetry, compact = false }: ConnectionBadgeProps) {
  const label =
    status === 'online' ? (synced ? 'Synced' : 'Syncing') : status === 'connecting' ? 'Reconnecting' : 'Offline'
  const title =
    status === 'online'
      ? 'Connected to the live server'
      : status === 'connecting'
        ? 'Trying to reconnect — edits are saved on this device'
        : 'No connection — edits are saved on this device'

  return (
    <button
      type="button"
      className={`conn conn--${status}${compact ? ' conn--compact' : ''}`}
      onClick={onRetry}
      title={title}
      aria-label={`${label}. ${title}`}
    >
      <span className="conn__dot" aria-hidden="true" />
      <span className="conn__label">{label}</span>
    </button>
  )
}
