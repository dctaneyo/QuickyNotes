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
import type { Filter, Member, NoteSummary, Role, ViewId } from '../lib/types'
import { encodeSeed, blockViews, noteMeta } from '../sync/noteModel'
import { useNoteSync } from '../sync/useNoteSync'
import { useLobby } from '../sync/useLobby'
import { useEvents } from '../sync/useEvents'
import { putSeed } from '../sync/seeds'
import { useNoteIndex } from '../hooks/useNoteIndex'
import { useMentions } from '../hooks/useMentions'
import { templateById, type CustomTemplate, type NoteTemplate, type TemplateDraft } from '../lib/templates'
import type { TransferNote } from '../lib/transfer'
import { DailyReviewDialog } from './DailyReviewDialog'
import { MentionsDialog } from './MentionsDialog'
import { TransferDialog } from './TransferDialog'
import { Sidebar } from './Sidebar'
import { NoteList } from './NoteList'
import { NoteEditor } from './NoteEditor'
import { TemplateSheet } from './TemplateSheet'
import { TemplateNoteEditor } from './TemplateNoteEditor'
import { ShareDialog } from './ShareDialog'
import { SettingsDialog } from './SettingsDialog'
import { AdminConsole } from './AdminConsole'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ConnectionBadge } from '../components/ConnectionBadge'

const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Today',
  all: 'All notes',
  starred: 'Starred',
  trash: 'Trash',
}

function filtersMatch(a: Filter, b: Filter): boolean {
  if (a.kind === 'view' && b.kind === 'view') return a.id === b.id
  if (a.kind === 'day' && b.kind === 'day') return a.date === b.date
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag
  return false
}

export function WorkspaceScreen() {
  const { user, token, signOut, setName, changePin } = useAuth()
  const events = useEvents(token)
  const index = useNoteIndex(token, user?.userId ?? null, events)
  const lobby = useLobby(token, user?.userId ?? null, user?.displayName ?? null)
  const mentions = useMentions(token, events.subscribe)

  const [filter, setFilter] = useState<Filter>({ kind: 'view', id: 'today' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateEditing, setTemplateEditing] = useState<CustomTemplate | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NoteSummary | null>(null)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [mentionsOpen, setMentionsOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)
  const autoFocusRef = useRef<string | null>(null)

  const notes = index.notes
  const selected = notes.find((note) => note.id === selectedId) ?? null
  const viewingTrash = filter.kind === 'view' && filter.id === 'trash'
  const members = selected?.members ?? null
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

  // The open note must still exist and belong to the current trash context.
  // Waiting for the note summary means a trash change is saved before the
  // editor unmounts.
  useEffect(() => {
    if (!selectedId || index.syncing) return
    const current = notes.find((note) => note.id === selectedId)
    if (!current || current.trashed !== viewingTrash) setSelectedId(null)
  }, [notes, selectedId, index.syncing, viewingTrash])

  useEffect(() => {
    if (templateOpen) events.requestTemplates()
  }, [templateOpen, events.requestTemplates])

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
      trash: notes.filter((note) => note.trashed).length,
    }
  }, [notes])

  const parent = selected?.parentId
    ? notes.find((note) => note.id === selected.parentId && !note.trashed) ?? null
    : null
  const subpages = selected
    ? notes.filter((note) => note.parentId === selected.id && !note.trashed).sort(sortNotes)
    : []
  const backlinks = useMemo(() => {
    if (!selected) return []
    const title = effectiveTitle(selected).toLowerCase()
    if (!title) return []
    return notes.filter((note) => {
      if (note.id === selected.id || note.trashed) return false
      const text = note.text.toLowerCase()
      return text.includes(`[[${title}]]`) || text.includes(`[[${selected.id.toLowerCase()}]]`)
    })
  }, [notes, selected])
  const outboundLinks = useMemo(() => {
    if (!selected) return []
    const matches = [...selected.text.matchAll(/\[\[([^\]]+)\]\]/g)]
    const ids = new Set<string>()
    for (const match of matches) {
      const token = match[1].trim().toLowerCase()
      const found = notes.find(
        (note) =>
          !note.trashed &&
          note.id !== selected.id &&
          (note.id.toLowerCase() === token || effectiveTitle(note).toLowerCase() === token),
      )
      if (found) ids.add(found.id)
    }
    return notes.filter((note) => ids.has(note.id))
  }, [notes, selected])

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
    setTemplateEditing(null)
    setSelectedId(id)
    setDrawerOpen(false)
  }

  const changeFilter = (next: Filter) => {
    const changed = !filtersMatch(filter, next)
    setFilter(next)
    setSearch('')
    setDrawerOpen(false)
    if (changed) setSelectedId(null)
  }

  const openSettings = () => {
    setSettingsOpen(true)
    setDrawerOpen(false)
  }

  const createNote = (template: NoteTemplate, parentId: string | null = null) => {
    if (!user) return
    const id = uid()
    const due = todayKey()
    const title = template.title ? template.title(new Date()) : ''
    const update = encodeSeed({
      ownerId: user.userId,
      title,
      tags: template.tags,
      due,
      parentId,
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
      parentId,
      text: template.blocks.map((block) => block.text).join('\n'),
      pending: true,
    })
    setSelectedId(id)
    setFilter({ kind: 'view', id: 'today' })
    setTemplateEditing(null)
    setTemplateOpen(false)
    setDrawerOpen(false)
    showToast(
      parentId
        ? 'Subpage created'
        : template.name === 'Blank note'
          ? 'New note'
          : `${template.name} created`,
    )
  }

  const createSubpage = () => {
    if (!selected) return
    createNote(templateById('blank'), selected.id)
  }

  const importNotes = async (incoming: TransferNote[]) => {
    if (!user) throw new Error('Sign in again to import notes.')
    const firstId = uid()
    let first = true
    for (const item of incoming) {
      const id = first ? firstId : uid()
      first = false
      const due = item.due || todayKey()
      const now = Date.now()
      putSeed(
        id,
        encodeSeed({
          ownerId: user.userId,
          title: item.title,
          tags: item.tags,
          due,
          parentId: null,
          blocks: item.blocks.length ? item.blocks : [{ type: 'text', text: '' }],
        }),
      )
      await index.registerNote({
        id,
        title: item.title,
        due,
        tags: item.tags,
        starred: false,
        trashed: false,
        createdAt: now,
        updatedAt: now,
        ownerId: user.userId,
        ownerName: user.displayName,
        role: 'owner',
        memberCount: 1,
        parentId: null,
        text: item.blocks.map((block) => block.text).join('\n'),
        pending: true,
      })
    }
    setFilter({ kind: 'view', id: 'all' })
    setSelectedId(firstId)
  }

  const capture = (text: string) => {
    if (!user) return
    setTemplateEditing(null)
    const id = uid()
    const now = Date.now()
    putSeed(
      id,
      encodeSeed({
        ownerId: user.userId,
        title: text,
        tags: [],
        due: todayKey(),
        blocks: [{ type: 'text', text: '' }],
      }),
    )
    autoFocusRef.current = id
    void index.registerNote({
      id,
      title: text,
      due: todayKey(),
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
      format: block.format,
    }))
    const id = uid()
    const due = todayKey()
    const title = `${meta.title || effectiveTitle(selected)} copy`
    putSeed(
      id,
      encodeSeed({
        ownerId: user.userId,
        title,
        tags: meta.tags,
        due,
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

  const saveTemplate = async (draft: TemplateDraft) => {
    if (!token) throw new Error('Sign in again to save templates.')
    await api<{ template: CustomTemplate }>('/api/templates', {
      method: 'POST',
      token,
      body: draft,
    })
  }

  const updateTemplate = async (id: string, draft: TemplateDraft) => {
    if (!token) throw new Error('Sign in again to update templates.')
    await api(`/api/templates/${id}`, { method: 'PATCH', token, body: draft })
  }

  const deleteTemplate = async (id: string) => {
    if (!token) throw new Error('Sign in again to delete templates.')
    await api(`/api/templates/${id}`, { method: 'DELETE', token })
  }

  const lockNote = async (password: string | null) => {
    if (!selected || !token) throw new Error('Sign in again to lock notes.')
    const result = await api<{ locked: boolean; lockProtected: boolean }>(
      `/api/notes/${selected.id}/lock`,
      { method: 'POST', token, body: { password } },
    )
    index.updateSummary({
      ...selected,
      locked: result.locked,
      lockProtected: result.lockProtected,
    })
  }

  const unlockNote = async (password: string | null) => {
    if (!selected || !token) throw new Error('Sign in again to unlock notes.')
    await api(`/api/notes/${selected.id}/unlock`, {
      method: 'POST',
      token,
      body: { password },
    })
  }

  const removeNoteLock = async () => {
    if (!selected || !token) throw new Error('Sign in again to change the lock.')
    await api(`/api/notes/${selected.id}/lock`, { method: 'DELETE', token })
    index.updateSummary({ ...selected, locked: false, lockProtected: false })
  }

  const releaseNoteUnlock = async () => {
    if (!selected || !token) return
    await api(`/api/notes/${selected.id}/unlock`, { method: 'DELETE', token })
  }

  const emptyTrash = async () => {
    try {
      await index.emptyTrash()
      if (selected?.trashed) setSelectedId(null)
      setEmptyTrashOpen(false)
      showToast('Trash emptied')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not empty the trash')
    }
  }

  const requestDelete = (id: string) => {
    const target = notes.find((note) => note.id === id)
    if (target) setPendingDelete(target)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    void index.deleteForever(target.id)
    if (selectedId === target.id) setSelectedId(null)
    setPendingDelete(null)
    showToast(target.role === 'owner' ? 'Permanently deleted' : 'Removed from your trash')
  }

  const invite = async (userId: string, role: Exclude<Role, 'owner'>) => {
    if (!selected || !token) return
    const result = await api<{ members: Member[] }>(`/api/notes/${selected.id}/members`, {
      method: 'POST',
      token,
      body: { userId, role },
    })
    index.updateSummary({
      ...selected,
      memberCount: result.members.length,
      members: result.members,
    })
    showToast(role === 'viewer' ? 'Invited as a viewer' : 'Invited to this note')
  }

  const changeRole = async (userId: string, role: Exclude<Role, 'owner'>) => {
    if (!selected || !token) return
    const result = await api<{ members: Member[] }>(
      `/api/notes/${selected.id}/members/${userId}`,
      { method: 'PATCH', token, body: { role } },
    )
    index.updateSummary({ ...selected, members: result.members })
    showToast(role === 'viewer' ? 'Changed to viewer' : 'Changed to editor')
  }

  const togglePublic = async (enabled: boolean) => {
    if (!selected || !token) return
    const result = await api<{ enabled: boolean; publicToken: string | null }>(
      `/api/notes/${selected.id}/public`,
      { method: 'POST', token, body: { enabled } },
    )
    index.updateSummary({ ...selected, publicToken: result.publicToken })
    showToast(enabled ? 'Public link created' : 'Public link turned off')
  }

  const openFromAnywhere = (id: string) => {
    setFilter({ kind: 'view', id: 'all' })
    setSelectedId(id)
    setReviewOpen(false)
    setMentionsOpen(false)
    setDrawerOpen(false)
  }

  const removeMember = async (userId: string) => {
    if (!selected || !token) return
    const result = await api<{ members: Member[] }>(
      `/api/notes/${selected.id}/members/${userId}`,
      { method: 'DELETE', token },
    )
    index.updateSummary({
      ...selected,
      memberCount: result.members.length,
      members: result.members,
    })
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

  return (
    <div
      className={`shell${selected || templateEditing ? ' is-editing' : ''}${
        drawerOpen ? ' is-drawer' : ''
      }`}
    >
      <Sidebar
        filter={filter}
        counts={counts}
        tags={tags}
        markers={markers}
        selectedDay={filter.kind === 'day' ? filter.date : dateKey(new Date())}
        user={user!}
        peers={lobby.peers}
        syncing={index.syncing}
        mentionCount={mentions.unread}
        onFilter={changeFilter}
        onSelectDay={(date) => {
          changeFilter({ kind: 'day', date })
        }}
        onMentions={() => setMentionsOpen(true)}
        onReview={() => setReviewOpen(true)}
        onTransfer={() => {
          setTransferOpen(true)
          setDrawerOpen(false)
        }}
        onNew={() => setTemplateOpen(true)}
        onSettings={openSettings}
        onAdmin={() => {
          setAdminOpen(true)
          setDrawerOpen(false)
        }}
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
        onDeleteForever={requestDelete}
        onEmptyTrash={() => setEmptyTrashOpen(true)}
        onOpenDrawer={() => setDrawerOpen(true)}
        syncing={index.syncing}
        trashView={viewingTrash}
        trashCount={counts.trash}
      />

      <div className="shell__note">
        {templateEditing ? (
          <TemplateNoteEditor
            key={templateEditing.id}
            template={templateEditing}
            onSave={updateTemplate}
            onDone={() => setTemplateEditing(null)}
          />
        ) : selected && sync.doc ? (
          <NoteEditor
            key={selected.id}
            summary={selected}
            doc={sync.doc}
            peers={sync.peers}
            status={sync.status}
            synced={sync.synced}
            saveState={sync.saveState}
            savedAt={sync.savedAt}
            setCursor={sync.setCursor}
            retry={sync.retry}
            members={members}
            token={token}
            currentUserId={user?.userId ?? ''}
            backlinks={backlinks}
            outboundLinks={outboundLinks}
            linkTargets={notes.filter((note) => !note.trashed)}
            parentTitle={parent ? effectiveTitle(parent) : null}
            subpages={subpages}
            onOpenNote={openFromAnywhere}
            onCreateSubpage={createSubpage}
            historyEvents={events}
            tagSuggestions={tags.map((tag) => tag.name)}
            onSummaryChange={index.updateSummary}
            onSaveTemplate={saveTemplate}
            onShare={() => setShareOpen(true)}
            onDeleteForever={() => requestDelete(selected.id)}
            onDuplicate={duplicateSelected}
            onBack={() => setSelectedId(null)}
            onToast={showToast}
            onLock={lockNote}
            onUnlock={unlockNote}
            onRemoveLock={removeNoteLock}
            onReleaseUnlock={releaseNoteUnlock}
            autoFocus={
              !selected.trashed && !selected.locked && autoFocusRef.current === selected.id
            }
          />
        ) : (
          <div className="placeholder">
            <div className="placeholder__bar">
              <span className="eyebrow">Quicky Notes</span>
              <ConnectionBadge
                status={lobby.status}
                synced={lobby.status === 'online'}
                onRetry={lobby.retry}
                compact
              />
            </div>
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
        onEdit={(template) => {
          setTemplateOpen(false)
          setTemplateEditing(template)
        }}
        customTemplates={events.templates}
        onDelete={deleteTemplate}
      />

      {selected && !selected.trashed ? (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          note={selected}
          members={members}
          loading={!!selected && !selected.members}
          error={null}
          currentUserId={user?.userId ?? ''}
          token={token}
          onInvite={invite}
          onChangeRole={changeRole}
          onTogglePublic={togglePublic}
          onRemove={removeMember}
          onLeave={leaveNote}
        />
      ) : null}

      <ConfirmDialog
        open={emptyTrashOpen}
        title="Empty trash?"
        body="Notes you own will be permanently deleted. Notes shared with you will be removed from your account. This cannot be undone."
        confirmLabel="Empty trash"
        onConfirm={() => void emptyTrash()}
        onClose={() => setEmptyTrashOpen(false)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Permanently delete?"
        body={
          pendingDelete
            ? pendingDelete.role === 'owner'
              ? `“${effectiveTitle(pendingDelete)}” will be permanently deleted for everyone it is shared with. This cannot be undone.`
              : `“${effectiveTitle(pendingDelete)}” will be removed from your trash. The owner’s copy stays. This cannot be undone.`
            : ''
        }
        confirmLabel="Permanently delete"
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />

      <DailyReviewDialog
        open={reviewOpen}
        notes={notes}
        onClose={() => setReviewOpen(false)}
        onOpenNote={openFromAnywhere}
        onNewDaily={() => {
          createNote(templateById('daily'))
          setReviewOpen(false)
        }}
      />

      <MentionsDialog
        open={mentionsOpen}
        onClose={() => setMentionsOpen(false)}
        mentions={mentions.mentions}
        notes={notes}
        loading={mentions.loading}
        error={mentions.error}
        onOpenNote={openFromAnywhere}
        onMarkRead={mentions.markRead}
        onRefresh={mentions.refresh}
      />

      <TransferDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        note={selected}
        doc={sync.doc}
        token={token}
        onImport={importNotes}
        onToast={showToast}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user!}
        onSignOut={signOut}
        onRename={setName}
        onChangePin={changePin}
      />

      {user?.isAdmin ? (
        <AdminConsole
          open={adminOpen}
          token={token}
          currentUserId={user.userId}
          events={events}
          onClose={() => setAdminOpen(false)}
        />
      ) : null}

      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  )
}
