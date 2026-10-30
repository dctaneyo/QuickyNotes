import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { websocketBase } from '../lib/api'
import { formatDayShort, formatTime } from '../lib/notes'
import { formatTextStyle } from '../lib/formatting'
import { blockViews, noteMeta } from '../sync/noteModel'
import type { BlockView } from '../sync/noteModel'

interface PublicNote {
  id: string
  title: string
  due: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
  ownerName: string
  locked: boolean
  text: string
  content: string | null
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function markerFor(block: BlockView, index: number) {
  if (block.type === 'bullet') return '•'
  if (block.type === 'number') return `${index + 1}.`
  if (block.type === 'todo') return block.checked ? '✓' : ''
  return null
}

function PublicBlock({ block, index }: { block: BlockView; index: number }) {
  if (block.type === 'divider') return <hr className="public-note__rule" />
  const marker = markerFor(block, index)
  return (
    <div
      className={`public-block public-block--${block.type}${block.checked ? ' is-checked' : ''}`}
      style={{ marginLeft: block.indent > 0 ? block.indent * 22 : undefined }}
    >
      {marker !== null ? (
        <span className={`public-block__marker${block.type === 'todo' ? ' todo__box' : ''}`}>
          {marker}
        </span>
      ) : null}
      <div className="public-block__text" style={formatTextStyle(block.format)}>
        {block.format.highlight ? (
          <span style={{ backgroundColor: block.format.highlight }}>{block.text || '\u200b'}</span>
        ) : (
          block.text || '\u200b'
        )}
      </div>
    </div>
  )
}

export function PublicNoteScreen({ shareToken }: { shareToken: string }) {
  const [note, setNote] = useState<PublicNote | null>(null)
  const [meta, setMeta] = useState<{ title: string; tags: string[]; due: string | null } | null>(null)
  const [blocks, setBlocks] = useState<BlockView[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let doc: Y.Doc | null = null
    let provider: WebsocketProvider | null = null
    const fetchNote = async () => {
      try {
        const response = await fetch(`/api/public/notes/${encodeURIComponent(shareToken)}`)
        const data = (await response.json()) as { note?: PublicNote; error?: string }
        if (!response.ok || !data.note) throw new Error(data.error || 'This note is not available.')
        if (cancelled) return
        const published = data.note
        setNote(published)
        doc = new Y.Doc()
        if (published.content) Y.applyUpdate(doc, decodeBase64(published.content), 'public')
        const refresh = () => {
          setBlocks(blockViews(doc as Y.Doc))
          const values = noteMeta(doc as Y.Doc)
          setMeta({ title: values.title, tags: values.tags, due: values.due })
        }
        doc.on('update', refresh)
        refresh()
        provider = new WebsocketProvider(websocketBase(), `note:${published.id}`, doc, {
          params: { share: shareToken },
        })
        provider.awareness.setLocalState(null)
        provider.on('status', (event: { status: string }) =>
          setStatus(event.status === 'connected' ? 'live' : 'offline'),
        )
        provider.on('sync', (synced: boolean) => {
          if (synced) setStatus('live')
        })
        setStatus(provider.wsconnected ? 'live' : 'connecting')
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not open this note.')
      }
    }
    void fetchNote()
    return () => {
      cancelled = true
      provider?.destroy()
      doc?.destroy()
    }
  }, [shareToken])

  if (error) {
    return (
      <main className="public-shell">
        <div className="public-error">
          <span className="brand__mark" aria-hidden="true">Q</span>
          <p className="eyebrow">Quicky Notes</p>
          <h1>This page is private now.</h1>
          <p>{error}</p>
          <a className="btn btn--primary" href="/">Open Quicky Notes</a>
        </div>
      </main>
    )
  }

  if (!note) {
    return (
      <main className="public-shell public-shell--loading">
        <span className="brand__mark" aria-hidden="true">Q</span>
        <p>Opening shared note…</p>
      </main>
    )
  }

  const title = meta?.title || note.title || 'Untitled note'
  const tags = meta?.tags ?? note.tags
  const due = meta?.due ?? note.due

  return (
    <main className="public-shell">
      <header className="public-bar">
        <a className="public-brand" href="/">
          <span className="brand__mark brand__mark--sm" aria-hidden="true">Q</span>
          <span className="brand__name">Quicky Notes</span>
        </a>
        <span className={`public-status public-status--${status}`}>
          <span className="conn__dot" aria-hidden="true" />
          {status === 'live' ? 'Live, read-only' : status === 'connecting' ? 'Connecting' : 'Offline, read-only'}
        </span>
      </header>
      <article className="public-note">
        <div className="public-note__eyebrow">
          <span className="eyebrow">Shared note</span>
          {due ? <span className="mono">{formatDayShort(due)}</span> : null}
        </div>
        <h1 className="public-note__title">{title}</h1>
        <p className="public-note__byline">
          Shared by {note.ownerName} · edited {formatTime(note.updatedAt)}
          {note.locked ? ' · locked by owner' : ''}
        </p>
        {tags.length > 0 ? (
          <div className="public-note__tags">
            {tags.map((tag) => (
              <span key={tag} className="tag tag--sm">#{tag}</span>
            ))}
          </div>
        ) : null}
        <div className="public-note__body">
          {blocks.length > 0 ? (
            blocks.map((block, index) => (
              <PublicBlock key={`${block.id}-${index}`} block={block} index={index} />
            ))
          ) : (
            <p className="muted">This note is empty.</p>
          )}
        </div>
        <footer className="public-note__footer">
          <span>Read-only public link</span>
          <a href="/">Make your own notes →</a>
        </footer>
      </article>
    </main>
  )
}
