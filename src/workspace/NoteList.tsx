import { useState } from 'react'
import type { RefObject } from 'react'
import type { NoteSummary } from '../lib/types'
import {
  dayLabel,
  effectiveTitle,
  formatDayShort,
  formatTime,
  groupByDay,
  noteSnippet,
} from '../lib/notes'
import { LockIcon, SearchIcon, StarIcon, TrashIcon, XIcon } from '../components/Icons'

interface NoteListProps {
  title: string
  notes: NoteSummary[]
  search: string
  onSearch: (value: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onCapture: (text: string) => void
  onDeleteForever: (id: string) => void
  onEmptyTrash: () => void
  onOpenDrawer: () => void
  syncing: boolean
  trashView: boolean
  trashCount: number
}

export function NoteList({
  title,
  notes,
  search,
  onSearch,
  searchRef,
  selectedId,
  onSelect,
  onNew,
  onCapture,
  onDeleteForever,
  onEmptyTrash,
  onOpenDrawer,
  syncing,
  trashView,
  trashCount,
}: NoteListProps) {
  const [draft, setDraft] = useState('')
  const groups = groupByDay(notes)
  const isSearching = search.trim().length > 0

  const capture = () => {
    const text = draft.trim()
    if (!text) return
    onCapture(text)
    setDraft('')
  }

  return (
    <section className="list" aria-label="Notes">
      <header className="list__head">
        <button
          type="button"
          className="icon-btn list__menu"
          onClick={onOpenDrawer}
          aria-label="Open menu"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="list__heading">
          <h2 className="list__title">{title}</h2>
          <span className="list__count mono">{notes.length}</span>
        </div>
        <div className="list__head-actions">
          {trashView ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm list__trash-btn"
              onClick={onEmptyTrash}
              disabled={trashCount === 0}
              aria-label={`Empty trash (${trashCount} ${trashCount === 1 ? 'note' : 'notes'})`}
            >
              Empty trash
            </button>
          ) : (
            <button type="button" className="btn btn--icon" onClick={onNew} aria-label="New note">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="list__search">
        <SearchIcon size={16} />
        <input
          ref={searchRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          value={search}
          placeholder="Search every note…"
          aria-label="Search notes"
          onChange={(event) => onSearch(event.target.value)}
        />
        {search ? (
          <button type="button" className="search-clear" onClick={() => onSearch('')} aria-label="Clear search">
            <XIcon size={14} />
          </button>
        ) : (
          <span className="search-hint mono">⌘K</span>
        )}
      </div>

      {!trashView && !isSearching ? (
        <form
          className="capture"
          onSubmit={(event) => {
            event.preventDefault()
            capture()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write it down before it goes…"
            aria-label="Quick capture"
          />
          <button type="submit" className="capture__send" disabled={!draft.trim()} aria-label="Save note">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M5 12h13M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      ) : null}

      {trashView ? (
        <p className="list__retention">
          Notes are deleted automatically 10 days after they are trashed.
        </p>
      ) : null}

      <div className="list__scroll">
        {groups.length === 0 ? (
          <div className="empty">
            {isSearching ? (
              <>
                <p className="empty__title">Nothing matches “{search.trim()}”</p>
                <p className="empty__body">Try fewer words, or a tag name.</p>
              </>
            ) : trashView ? (
              <>
                <p className="empty__title">Trash is empty</p>
                <p className="empty__body">
                  Notes stay here for 10 days, then are deleted automatically.
                </p>
              </>
            ) : (
              <>
                <p className="empty__title">Nothing here yet</p>
                <p className="empty__body">Press the + button to start a note.</p>
              </>
            )}
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.day} className="daygroup">
            <header className="daygroup__head">
              <h3 className="daygroup__label">{dayLabel(group.day)}</h3>
              <span className="daygroup__date mono">{formatDayShort(group.day)}</span>
            </header>
            {group.notes.map((note) => (
              <article
                key={note.id}
                className={`row${note.id === selectedId ? ' is-selected' : ''}${
                  note.trashed ? ' is-trashed' : ''
                }${note.parentId ? ' is-child' : ''}`}
              >
                <button type="button" className="row__main" onClick={() => onSelect(note.id)}>
                  <span className="row__top">
                    {note.parentId ? <span className="row__nest" aria-label="Subpage">↳</span> : null}
                    <span className="row__title">{effectiveTitle(note)}</span>
                    {note.starred ? (
                      <span className="row__star">
                        <StarIcon size={13} filled />
                      </span>
                    ) : null}
                  </span>
                  <span className="row__snippet">{noteSnippet(note) || 'No more text yet'}</span>
                  <span className="row__meta">
                    <span className="mono">{formatTime(note.updatedAt)}</span>
                    {note.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="tag tag--sm">
                        {tag}
                      </span>
                    ))}
                    {note.memberCount > 1 ? <span className="row__badge">Shared</span> : null}
                    {note.locked ? (
                      <span className="row__lock" title="Locked" aria-label="Locked">
                        <LockIcon size={12} />
                      </span>
                    ) : null}
                    {note.pending ? <span className="row__badge row__badge--pending">Local only</span> : null}
                  </span>
                </button>
                {trashView ? (
                  <div className="row__actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn--tiny icon-btn--danger"
                      onClick={() => onDeleteForever(note.id)}
                      aria-label={`Permanently delete ${effectiveTitle(note)}`}
                      title="Permanently delete"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ))}
        {syncing ? <p className="list__sync mono">Syncing…</p> : null}
      </div>

      <button type="button" className="fab" onClick={onNew} aria-label="New note">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  )
}
