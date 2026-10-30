import type { Filter, ViewId } from '../lib/types'
import type { SessionUser } from '../lib/api'
import type { Peer } from '../sync/useNoteSync'
import { Calendar } from './Calendar'
import {
  BellIcon,
  NotesIcon,
  StarIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from '../components/Icons'
import { colorFor, initials } from '../lib/notes'

interface SidebarProps {
  filter: Filter
  counts: Record<ViewId, number>
  tags: { name: string; count: number }[]
  markers: Set<string>
  selectedDay: string | null
  user: SessionUser
  peers: Peer[]
  syncing: boolean
  mentionCount: number
  onFilter: (filter: Filter) => void
  onSelectDay: (date: string) => void
  onMentions: () => void
  onReview: () => void
  onTransfer: () => void
  onNew: () => void
  onSettings: () => void
  onAdmin: () => void
  onSignOut: () => void
  onClose: () => void
}

const VIEW_ITEMS: { id: ViewId; label: string; Icon: typeof SunIcon }[] = [
  { id: 'today', label: 'Today', Icon: SunIcon },
  { id: 'all', label: 'All notes', Icon: NotesIcon },
  { id: 'starred', label: 'Starred', Icon: StarIcon },
  { id: 'trash', label: 'Trash', Icon: TrashIcon },
]

export function Sidebar({
  filter,
  counts,
  tags,
  markers,
  selectedDay,
  user,
  peers,
  syncing,
  mentionCount,
  onFilter,
  onSelectDay,
  onMentions,
  onReview,
  onTransfer,
  onNew,
  onSettings,
  onAdmin,
  onSignOut,
  onClose,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Workspace">
      <div className="sidebar__brand">
        <span className="brand__mark brand__mark--sm" aria-hidden="true">
          Q
        </span>
        <span className="brand__name">Quicky Notes</span>
        <button type="button" className="icon-btn sidebar__close" onClick={onClose} aria-label="Close menu">
          <XIcon size={18} />
        </button>
      </div>

      <button type="button" className="btn btn--primary sidebar__new" onClick={onNew}>
        <span aria-hidden="true">＋</span> New note
      </button>

      <nav className="nav" aria-label="Views">
        {VIEW_ITEMS.map(({ id, label, Icon }) => {
          const active = filter.kind === 'view' && filter.id === id
          return (
            <button
              key={id}
              type="button"
              className={`nav__item${active ? ' is-active' : ''}`}
              onClick={() => onFilter({ kind: 'view', id })}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} />
              <span className="nav__label">{label}</span>
              <span className="nav__count mono">{counts[id]}</span>
            </button>
          )
        })}
        <button type="button" className="nav__item" onClick={onMentions}>
          <BellIcon size={16} />
          <span className="nav__label">Notifications</span>
          <span className={`nav__count mono${mentionCount > 0 ? ' nav__count--unread' : ''}`}>
            {mentionCount}
          </span>
        </button>
        <button type="button" className="nav__item" onClick={onReview}>
          <SunIcon size={16} />
          <span className="nav__label">Daily review</span>
        </button>
      </nav>

      <div className="sidebar__section">
        <div className="sidebar__section-head">
          <span className="eyebrow">Calendar</span>
        </div>
        <Calendar
          selected={filter.kind === 'day' ? filter.date : selectedDay}
          markers={markers}
          onSelect={onSelectDay}
        />
      </div>

      {tags.length > 0 ? (
        <div className="sidebar__section sidebar__section--tags">
          <div className="sidebar__section-head">
            <span className="eyebrow">Tags</span>
            <TagIcon size={13} />
          </div>
          <div className="taglist">
            {tags.map((tag) => {
              const active = filter.kind === 'tag' && filter.tag === tag.name
              return (
                <button
                  key={tag.name}
                  type="button"
                  className={`taglist__item${active ? ' is-active' : ''}`}
                  onClick={() => onFilter({ kind: 'tag', tag: tag.name })}
                >
                  <span className="taglist__hash">#</span>
                  <span className="taglist__name">{tag.name}</span>
                  <span className="taglist__count mono">{tag.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="sidebar__foot">
        <div className="sidebar__presence">
          {peers.length > 0 ? (
            <>
              <div className="avatars">
                {peers.slice(0, 4).map((peer) => (
                  <span
                    key={peer.clientId}
                    className="avatar avatar--xs"
                    style={{ background: peer.color }}
                    title={peer.displayName}
                  >
                    {initials(peer.displayName)}
                  </span>
                ))}
              </div>
              <span className="sidebar__presence-label">
                {peers.length} {peers.length === 1 ? 'person' : 'people'} online
              </span>
            </>
          ) : (
            <span className="sidebar__presence-label">Just you, for now</span>
          )}
        </div>

        <button type="button" className="userchip" onClick={onSettings}>
          <span className="avatar" style={{ background: colorFor(user.userId) }}>
            {initials(user.displayName)}
          </span>
          <span className="userchip__text">
            <span className="userchip__name">{user.displayName}</span>
            <span className="userchip__id mono">{user.userId}</span>
          </span>
          <span className="userchip__gear" aria-hidden="true">
            ⚙
          </span>
        </button>

        <div className="sidebar__foot-links">
          {user.isAdmin ? (
            <button type="button" className="link link--tiny" onClick={onAdmin}>
              Admin console
            </button>
          ) : null}
          <button type="button" className="link link--tiny" onClick={onTransfer}>
            Import & export
          </button>
          <button type="button" className="link link--tiny" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        {syncing ? <p className="sidebar__sync mono">Syncing notes…</p> : null}
      </div>
    </aside>
  )
}
