import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../components/Modal'
import { useTouchKeyboardDevice } from '../hooks/useTouchKeyboard'

interface SaveTemplateDialogProps {
  open: boolean
  defaultName: string
  onClose: () => void
  onSave: (name: string) => Promise<void>
}

const FORM_ID = 'save-template-form'

export function SaveTemplateDialog({
  open,
  defaultName,
  onClose,
  onSave,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touchKeyboard = useTouchKeyboardDevice()

  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setSaving(false)
    setError(null)
  }, [open, defaultName])

  const close = () => {
    if (!saving) onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this template.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Save as template"
      onClose={close}
      size="sm"
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form={FORM_ID}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </>
      }
    >
      <p className="modal__lede">
        This copies the note’s title, tags and blocks into a template only you can use. Later edits
        to the note will not change it.
      </p>
      <form id={FORM_ID} onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Template name</span>
          <input
            value={name}
            maxLength={60}
            required
            aria-required="true"
            inputMode={touchKeyboard ? 'none' : undefined}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
