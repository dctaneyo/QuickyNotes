import { useState } from 'react'
import { Modal } from '../components/Modal'
import {
  TEMPLATES,
  customTemplateAsNoteTemplate,
  type CustomTemplate,
  type NoteTemplate,
} from '../lib/templates'

interface TemplateSheetProps {
  open: boolean
  onClose: () => void
  onPick: (template: NoteTemplate) => void
  onEdit: (template: CustomTemplate) => void
  customTemplates: CustomTemplate[]
  onDelete: (id: string) => Promise<void>
}

export function TemplateSheet({
  open,
  onClose,
  onPick,
  onEdit,
  customTemplates,
  onDelete,
}: TemplateSheetProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDeletingId(null)
    setBusy(null)
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const confirmDelete = async (id: string) => {
    if (busy) return
    setBusy(id)
    setError(null)
    try {
      await onDelete(id)
      setDeletingId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this template.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} title="Start a note" onClose={close}>
      <>
          <p className="modal__lede">Pick a starting point. You can change anything afterwards.</p>

          <section className="template-section">
            <div className="template-section__head">
              <span className="eyebrow">Your templates</span>
              <span className="template-section__count mono">{customTemplates.length}</span>
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            {customTemplates.length === 0 ? (
              <p className="template-empty muted">
                Save any note as a template from its ··· menu. It stays private to your account.
              </p>
            ) : (
              <div className="template-list">
                {customTemplates.map((template) => {
                  const noteTemplate = customTemplateAsNoteTemplate(template)

                  if (deletingId === template.id) {
                    return (
                      <div key={template.id} className="template-confirm">
                        <span>Delete “{template.name}”?</span>
                        <button
                          type="button"
                          className="link link--danger"
                          disabled={busy === template.id}
                          onClick={() => void confirmDelete(template.id)}
                        >
                          {busy === template.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          className="link"
                          disabled={busy === template.id}
                          onClick={() => setDeletingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )
                  }

                  return (
                    <div key={template.id} className="template-row">
                      <button
                        type="button"
                        className="template"
                        onClick={() => onPick(noteTemplate)}
                      >
                        <span className="template__glyph" aria-hidden="true">
                          {noteTemplate.glyph}
                        </span>
                        <span className="template__text">
                          <span className="template__name">{noteTemplate.name}</span>
                          <span className="template__blurb">{noteTemplate.blurb}</span>
                        </span>
                        <span className="template__arrow" aria-hidden="true">
                          →
                        </span>
                      </button>
                      <div className="template-row__tools">
                        <button
                          type="button"
                          className="icon-btn icon-btn--tiny"
                          onClick={() => {
                            setDeletingId(null)
                            setError(null)
                            onEdit(template)
                          }}
                          aria-label={`Edit ${template.name}`}
                          title="Edit template"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn--tiny"
                          onClick={() => {
                            setDeletingId(template.id)
                            setError(null)
                          }}
                          aria-label={`Delete ${template.name}`}
                          title="Delete template"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="template-section">
            <div className="template-section__head">
              <span className="eyebrow">Built-in</span>
            </div>
            <div className="template-list">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template"
                  onClick={() => {
                    reset()
                    onPick(template)
                  }}
                >
                  <span className="template__glyph" aria-hidden="true">
                    {template.glyph}
                  </span>
                  <span className="template__text">
                    <span className="template__name">{template.name}</span>
                    <span className="template__blurb">{template.blurb}</span>
                  </span>
                  <span className="template__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
    </Modal>
  )
}
