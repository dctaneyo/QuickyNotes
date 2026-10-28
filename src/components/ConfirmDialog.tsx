import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

/** Destructive confirmation in the app's own modal, never the browser prompt. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal__lede">{body}</p>
    </Modal>
  )
}
