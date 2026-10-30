import { Modal } from '../components/Modal'
import { CalendarIcon, PlusIcon, StarIcon } from '../components/Icons'
import {
  effectiveTitle,
  formatDayLong,
  noteDay,
  noteSnippet,
  todayKey,
} from '../lib/notes'
import type { NoteSummary } from '../lib/types'

interface DailyReviewDialogProps {
  open: boolean
  notes: NoteSummary[]
  onClose: () => void
  onOpenNote: (id: string) => void
  onNewDaily: () => void
}

export function DailyReviewDialog({
  open,
  notes,
  onClose,
  onOpenNote,
  onNewDaily,
}: DailyReviewDialogProps) {
  const today = todayKey()
  const active = notes.filter((note) => !note.trashed)
  const todaysNotes = active
    .filter((note) => noteDay(note) === today)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const stale = active
    .filter((note) => noteDay(note) < today)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, 4)
  const starred = active.filter((note) => note.starred).slice(0, 4)

  const openNote = (id: string) => {
    onOpenNote(id)
    onClose()
  }

  return (
    <Modal open={open} title="Daily review" onClose={onClose} size="md">
      <div className="review">
        <div className="review__date">
          <CalendarIcon size={15} />
          <span>{formatDayLong(today)}</span>
        </div>
        <p className="modal__lede">
          A small pause before the next thing. See what is on today’s page, then leave a clear
          starting point for tomorrow.
        </p>

        <div className="review__stats">
          <div>
            <strong>{todaysNotes.length}</strong>
            <span>{todaysNotes.length === 1 ? 'note today' : 'notes today'}</span>
          </div>
          <div>
            <strong>{starred.length}</strong>
            <span>starred</span>
          </div>
          <div>
            <strong>{stale.length}</strong>
            <span>to revisit</span>
          </div>
        </div>

        <section className="review__section">
          <div className="review__section-head">
            <h3>On today’s page</h3>
            <span className="mono">{todaysNotes.length}</span>
          </div>
          {todaysNotes.length === 0 ? (
            <p className="muted">Nothing filed here yet. Start a daily page when you are ready.</p>
          ) : (
            <div className="review__notes">
              {todaysNotes.slice(0, 6).map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="review-note"
                  onClick={() => openNote(note.id)}
                >
                  <span className="review-note__title">{effectiveTitle(note)}</span>
                  <span className="review-note__snippet">{noteSnippet(note) || 'No more text yet'}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onNewDaily}>
            <PlusIcon size={14} /> Start today’s note
          </button>
        </section>

        {starred.length > 0 ? (
          <section className="review__section">
            <div className="review__section-head">
              <h3>Keep in view</h3>
              <StarIcon size={14} />
            </div>
            <div className="review__notes">
              {starred.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="review-note"
                  onClick={() => openNote(note.id)}
                >
                  <span className="review-note__title">{effectiveTitle(note)}</span>
                  <span className="review-note__snippet">{noteSnippet(note) || 'No more text yet'}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {stale.length > 0 ? (
          <section className="review__section">
            <div className="review__section-head">
              <h3>Worth a second look</h3>
              <span className="mono">quiet lately</span>
            </div>
            <div className="review__notes">
              {stale.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="review-note"
                  onClick={() => openNote(note.id)}
                >
                  <span className="review-note__title">{effectiveTitle(note)}</span>
                  <span className="review-note__snippet">{noteSnippet(note) || 'No more text yet'}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <p className="review__foot">
          This is a reading view. Nothing changes until you open a note and write.
        </p>
      </div>
    </Modal>
  )
}
