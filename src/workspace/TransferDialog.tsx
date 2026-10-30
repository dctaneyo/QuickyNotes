import { useRef, useState } from 'react'
import type * as Y from 'yjs'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import { effectiveTitle } from '../lib/notes'
import type { NoteSummary } from '../lib/types'
import { blockViews, noteMeta } from '../sync/noteModel'
import {
  downloadText,
  markdownForNote,
  parseArchive,
  parseMarkdown,
  safeFilename,
  type TransferNote,
} from '../lib/transfer'

interface TransferDialogProps {
  open: boolean
  onClose: () => void
  note: NoteSummary | null
  doc: Y.Doc | null
  token: string | null
  onImport: (notes: TransferNote[]) => Promise<void>
  onToast: (message: string) => void
}

export function TransferDialog({
  open,
  onClose,
  note,
  doc,
  token,
  onImport,
  onToast,
}: TransferDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentBlocks = doc ? blockViews(doc) : []
  const currentTitle = note ? effectiveTitle(note) : 'Untitled note'
  const currentTags = doc ? noteMeta(doc).tags : (note?.tags ?? [])

  const exportMarkdown = () => {
    if (!doc) {
      setError('Open a note before exporting it.')
      return
    }
    const content = markdownForNote(
      currentTitle,
      currentBlocks.map(({ type, text, checked, indent, format }) => ({
        type,
        text,
        checked,
        indent,
        format,
      })),
      currentTags,
    )
    downloadText(`${safeFilename(currentTitle)}.md`, content, 'text/markdown;charset=utf-8')
    onToast('Markdown exported')
  }

  const exportCurrentJson = () => {
    if (!doc) {
      setError('Open a note before exporting it.')
      return
    }
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      notes: [
        {
          title: currentTitle,
          due: note?.due ?? null,
          tags: currentTags,
          starred: note?.starred ?? false,
          blocks: currentBlocks.map(({ type, text, checked, indent, format }) => ({
            type,
            text,
            checked,
            indent,
            format,
          })),
        },
      ],
    }
    downloadText(
      `${safeFilename(currentTitle)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    )
    onToast('Note exported')
  }

  const exportAll = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      const archive = await api<{ notes: unknown[] }>('/api/notes/export', { token })
      downloadText(
        `quicky-notes-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(archive, null, 2),
        'application/json',
      )
      onToast('All notes exported')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export your notes.')
    } finally {
      setBusy(false)
    }
  }

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const imported: TransferNote[] = []
      for (const file of [...files]) {
        const text = await file.text()
        if (file.name.toLowerCase().endsWith('.json')) imported.push(...parseArchive(text))
        else imported.push(parseMarkdown(text))
      }
      if (imported.length === 0) throw new Error('No notes could be read from that file.')
      await onImport(imported)
      onToast(`${imported.length} ${imported.length === 1 ? 'note' : 'notes'} imported`)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import that file.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Modal open={open} title="Import & export" onClose={onClose} size="md">
      <p className="modal__lede">
        Your notes stay yours. Markdown is easy to read anywhere; the JSON format keeps headings,
        to-dos and formatting intact.
      </p>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="transfer-section">
        <div>
          <h3>Current note</h3>
          <p className="muted">
            {note ? effectiveTitle(note) : 'Open a note to export it.'}
          </p>
        </div>
        <div className="transfer-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={exportMarkdown}
            disabled={!doc || busy}
          >
            Export Markdown
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={exportCurrentJson}
            disabled={!doc || busy}
          >
            Export JSON
          </button>
        </div>
      </section>

      <section className="transfer-section">
        <div>
          <h3>Entire workspace</h3>
          <p className="muted">Every note you own or can open, in one portable JSON file.</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void exportAll()}
          disabled={busy || !token}
        >
          {busy ? 'Working…' : 'Export all notes'}
        </button>
      </section>

      <section className="transfer-section transfer-section--import">
        <div>
          <h3>Import</h3>
          <p className="muted">
            Choose Markdown or Quicky JSON files. Each file becomes a new note, so nothing you
            already have is overwritten.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".md,text/markdown,.json,application/json"
          multiple
          hidden
          onChange={(event) => void importFiles(event.target.files)}
        />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Choose files
        </button>
      </section>

      <p className="transfer-note">
        Backlinks use <code>[[Note title]]</code>. Imported Markdown preserves those links as plain
        text so they keep working in Quicky Notes.
      </p>
    </Modal>
  )
}
