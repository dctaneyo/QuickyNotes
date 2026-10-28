import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import {
  dateKey,
  effectiveTitle,
  formatDayLong,
  noteDay,
  sortNotes,
  todayKey,
  uid,
} from '../lib/notes'
import type { Filter, Member, ViewId } from '../lib/types'
import { encodeSeed, blockViews, noteMeta } from '../sync/noteModel'
import { useNoteSync } from '../sync/useNoteSync'
import { useLobby } from '../sync/useLobby'
import { putSeed } from '../sync/seeds'
import { useNoteIndex } from '../hooks/useNoteIndex'
import { templateById } from '../lib/templates'
import { Sidebar } from './Sidebar'
import { NoteList } from './NoteList'
import { NoteEditor } from './NoteEditor'
import { TemplateSheet } from './TemplateSheet'
import { ShareDialog } from './ShareDialog'
import { SettingsDialog } from './SettingsDialog'

const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Today',
  all: 'All notes',
  starred: 'Starred',
  reminders: 'Reminders',
  trash: 'Trash',
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
}

export function WorkspaceScreen() {
  const { user, token, signOut, setName, changePin } = useAuth()
  const index = useNoteIndex(token, user?.userId ?? null)
  const lobby = useLobby(token, user?.userId ?? null, user?.displayName ?? null)

  const [filter, setFilter] = useState<Filter>({ kind: 'view', id: 'today' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)
  const autoFocusRef = useRef<string | null>(null)

  const notes = index.notes
  const selected = notes.find((note) => note.id === selectedId) ?? null
  const sync = useNoteSync(
    selected?.id ?? null,
    token,
    user?.userId ?? null,
    user?.displayName ?? null,
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  const setActiveRef = useRef(lobby.setActiveNote)
  setActiveRef.current = lobby.setActiveNote
  useEffect(() => {
    setActiveRef.current(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) {
      setMembers(null)
      return
    }
    if (!token) return
    let cancelled = false
    setMembersLoading(true)
    setMembersError(null)
    api<{ members: Member[] }>(`/api/notes/${selectedId}`, { token })
      .then((result) => {
        if (!cancelled) setMembers(result.members)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMembers(null)
          setMembersError(error instanceof Error ? error.message : 'Could not load people.')
        }
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, token, lobby.status])

  useEffect(() => {
    if (selectedId && !notes.some((note) => note.id === selectedId) && !index.syncing) {
      setSelectedId(null)
    }
  }, [notes, selectedId, index.syncing])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query) {
      return notes
        .filter(
          (note) =>
            !note.trashed &&
            `${note.title} ${note.text} ${note.tags.join(' ')}`.toLowerCase().includes(query),
        )
        .sort(sortNotes)
    }
    return notes
      .filter((note) => {
        if (filter.kind === 'view') {
          if (filter.id === 'trash') return note.trashed
          if (note.trashed) return false
          if (filter.id === 'today') return noteDay(note) === todayKey()
          if (filter.id === 'starred') return note.starred
          if (filter.id === 'reminders') return !!note.due && note.due <= todayKey()
          return true
        }
        if (filter.kind === 'day') return !note.trashed && noteDay(note) === filter.date
        return !note.trashed && note.tags.includes(filter.tag)
      })
      .sort(sortNotes)
  }, [notes, filter, search])

  const counts = useMemo<Record<ViewId, number>>(() => {
    const active = notes.filter((note) => !note.trashed)
    return {
      today: active.filter((note) => noteDay(note) === todayKey()).length,
      all: active.length,
      starred: active.filter((note) => note.starred).length,
      reminders: active.filter((note) => !!note.due && note.due <= todayKey()).length,
      trash: notes.filter((note) => note.trashed).length,
    }
  }, [notes])

  const tags = useMemo(() => {
    const counter = new Map<string, number>()
    for (const note of notes) {
      if (note.trashed) continue
      for (const tag of note.tags) counter.set(tag, (counter.get(tag) ?? 0) + 1)
    }
    return [...counter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [notes])

  const markers = useMemo(() => {
    const set = new Set<string>()
    for (const note of notes) {
      if (!note.trashed) set.add(noteDay(note))
    }
    return set
  }, [notes])

  const listTitle = search.trim()
    ? 'Search results'
    : filter.kind === 'view'
      ? VIEW_TITLES[filter.id]
      : filter.kind === 'day'
        ? formatDayLong(filter.date)
        : `#${filter.tag}`

  const selectNote = (id: string) => {
    setSelectedId(id)
    setDrawerOpen(false)
  }

  const changeFilter = (next: Filter) => {
    setFilter(next)
    setSearch('')
    setDrawerOpen(false)
    if (isMobileViewport()) setSelectedId(null)
  }

  const openSettings = () => {
    setSettingsOpen(true)
    setDrawerOpen(false)
  }

  const createNote = (templateId: string) => {
    if (!user) return
    const template = templateById(templateId)
    const id = uid()
    const due = template.dueToday ? todayKey() : null
    const title = template.title ? template.title(new Date()) : ''
    const update = encodeSeed({
      ownerId: user.userId,
      title,
      tags: template.tags,
      due,
      blocks: template.blocks,
    })
    putSeed(id, update)
    autoFocusRef.current = id
    const now = Date.now()
    void index.registerNote({
      id,
      title,
      due,
      tags: template.tags,
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
      ownerId: user.userId,
      ownerName: user.displayName,
      role: 'owner',
      memberCount: 1,
      text: template.blocks.map((block) => block.text).join('\n'),
      pending: true,
    })
    setSelectedId(id)
    setFilter({ kind: 'view', id: 'today' })
    setTemplateOpen(false)
    setDrawerOpen(false)
    showToast(template.name === 'Blank note' ? 'New note' : `${template.name} created`)
  }

  const capture = (text: string) => {
    if (!user) return
    const id = uid()
    const now = Date.now()
    putSeed(
      id,
      encodeSeed({
        ownerId: user.userId,
        title: text,
        tags: [],
        due: null,
        blocks: [{ type: 'text', text: '' }],
      }),
    )
    autoFocusRef.current = id
    void index.registerNote({
      id,
      title: text,
      due: null,
      tags: [],
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
      ownerId: user.userId,
      ownerName: user.displayName,
      role: 'owner',
      memberCount: 1,
      text: '',
      pending: true,
    })
    setSelectedId(id)
    setFilter({ kind: 'view', id: 'today' })
    showToast('Saved')
  }

  const duplicateSelected = () => {
    if (!selected || !sync.doc || !user) return
    const source = sync.doc
    const meta = noteMeta(source)
    const blocks = blockViews(source).map((block) => ({
      type: block.type,
      text: block.text,
      checked: block.checked,
      indent: block.indent,
    }))
    const id = uid()
    const due = meta.due
    const title = `${meta.title || effectiveTitle(selected)} copy`
    putSeed(
      id,
      encodeSeed({
        ownerId: user.userId,
        title,
        tags: meta.tags,
        due,
        repeat: meta.repeat,
        blocks,
      }),
    )
    autoFocusRef.current = id
    const now = Date.now()
    void index.registerNote({
      id,
      title,
      due,
      tags: meta.tags,
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
      ownerId: user.userId,
      ownerName: user.displayName,
      role: 'owner',
      memberCount: 1,
      text: blocks.map((block) => block.text).join('\n'),
      pending: true,
    })
    setSelectedId(id)
    showToast('Note duplicated')
  }

  const createNextOccurrence = (due: string) => {
    if (!selected || !sync.doc || !user) return
    const source = sync.doc
    const meta = noteMeta(source)
    const blocks = blockViews(source).map((block) => ({
      type: block.type,
      text: block.text,
      checked: false,
      indent: block.indent,
    }))
    const id = uid()
    putSeed(
      id,
      encodeSeed({
        ownerId: user.userId,
        title: meta.title || effectiveTitle(selected),
        tags: meta.tags,
        due,
        repeat: meta.repeat,
        blocks,
      }),
    )
    autoFocusRef.current = id
    const now = Date.now()
    void index.registerNote({
      id,
      title: meta.title || effectiveTitle(selected),
      due,
      tags: meta.tags,
      starred: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
      ownerId: user.userId,
      ownerName: user.displayName,
      role: 'owner',
      memberCount: 1,
      text: blocks.map((block) => block.text).join('\n'),
      pending: true,
    })
    setSelectedId(id)
    showToast('Next occurrence started')
  }

  const deleteForever = (id: string) => {
    const target = notes.find((note) => note.id === id)
    if (!target) return
    if (!window.confirm(`Delete “${effectiveTitle(target)}” forever? This cannot be undone.`)) return
    void index.deleteForever(id)
    if (selectedId === id) setSelectedId(null)
    showToast('Deleted forever')
  }

  const invite = async (userId: string) => {
    if (!selected || !token) return
    const result = await api<{ members: Member[] }>(`/api/notes/${selected.id}/members`, {
      method: 'POST',
      token,
      body: { userId },
    })
    setMembers(result.members)
    index.updateSummary({ ...selected, memberCount: result.members.length })
    showToast('Invited to this note')
  }

  const removeMember = async (userId: string) => {
    if (!selected || !token) return
    const result = await api<{ members: Member[] }>(
      `/api/notes/${selected.id}/members/${userId}`,
      { method: 'DELETE', token },
    )
    setMembers(result.members)
    index.updateSummary({ ...selected, memberCount: result.members.length })
    showToast('Removed from this note')
  }

  const leaveNote = async () => {
    if (!selected || !token) return
    await api(`/api/notes/${selected.id}/members/${user?.userId}`, { method: 'DELETE', token })
    index.removeLocal(selected.id)
    setSelectedId(null)
    setShareOpen(false)
    showToast('You left this note')
  }

  const status = selected ? sync.status : lobby.status
  const synced = selected ? sync.synced : lobby.status === 'online'
  const retry = selected ? sync.retry : lobby.retry

  return (
    <div className={`shell${selected ? ' is-editing' : ''}${drawerOpen ? ' is-drawer' : ''}`}>
      <Sidebar
        filter={filter}
        counts={counts}
        tags={tags}
        markers={markers}
        selectedDay={filter.kind === 'day' ? filter.date : dateKey(new Date())}
        user={user!}
        status={lobby.status}
        synced={lobby.status === 'online'}
        peers={lobby.peers}
        syncing={index.syncing}
        onRetry={lobby.retry}
        onFilter={changeFilter}
        onSelectDay={(date) => {
          changeFilter({ kind: 'day', date })
        }}
        onNew={() => setTemplateOpen(true)}
        onSettings={openSettings}
        onSignOut={() => void signOut()}
        onClose={() => setDrawerOpen(false)}
      />

      {drawerOpen ? (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <NoteList
        title={listTitle}
        notes={visible}
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        selectedId={selectedId}
        onSelect={selectNote}
        onNew={() => setTemplateOpen(true)}
        onCapture={capture}
        onDeleteForever={deleteForever}
        onOpenDrawer={() => setDrawerOpen(true)}
        status={status}
        synced={synced}
        syncing={index.syncing}
        onRetry={retry}
        trashView={filter.kind === 'view' && filter.id === 'trash'}
      />

      <div className="shell__note">
        {selected && sync.doc ? (
          <NoteEditor
            key={selected.id}
            summary={selected}
            doc={sync.doc}
            peers={sync.peers}
            status={sync.status}
            synced={sync.synced}
            setFocus={sync.setFocus}
            retry={sync.retry}
            members={members}
            onSummaryChange={index.updateSummary}
            onShare={() => setShareOpen(true)}
            onDeleteForever={() => deleteForever(selected.id)}
            onDuplicate={duplicateSelected}
            onCreateNext={createNextOccurrence}
            onBack={() => setSelectedId(null)}
            onToast={showToast}
            autoFocus={autoFocusRef.current === selected.id}
          />
        ) : (
          <div className="placeholder">
            <div className="placeholder__inner">
              <p className="eyebrow">Quicky Notes</p>
              <h2 className="placeholder__title">
                {selected ? 'Opening your note…' : 'Every thought gets somewhere to land.'}
              </h2>
              <p className="placeholder__body">
                {selected
                  ? 'Loading the latest version from this device and the server.'
                  : 'Write one line now and tidy it later. Notes live with you, sync with the people you invite, and keep working offline.'}
              </p>
              {!selected ? (
                <div className="placeholder__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setTemplateOpen(true)}
                  >
                    Start a note
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => changeFilter({ kind: 'view', id: 'today' })}
                  >
                    Go to today
                  </button>
                </div>
              ) : null}
              <div className="placeholder__keys">
                <span>
                  <kbd>⌘</kbd>
                  <kbd>K</kbd> search
                </span>
                <span>
                  <kbd>/</kbd> blocks
                </span>
                <span>
                  <kbd>⌘</kbd>
                  <kbd>Z</kbd> undo
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <TemplateSheet
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onPick={createNote}
      />

      {selected ? (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          note={selected}
          members={members}
          loading={membersLoading}
          error={membersError}
          currentUserId={user?.userId ?? ''}
          onInvite={invite}
          onRemove={removeMember}
          onLeave={leaveNote}
        />
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user!}
        token={token}
        onSignOut={signOut}
        onRename={setName}
        onChangePin={changePin}
      />

      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  )
}
