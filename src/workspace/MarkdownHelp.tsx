import { Modal } from '../components/Modal'
import { MARKDOWN_SHORTCUTS } from '../lib/markdown'

interface MarkdownHelpProps {
  open: boolean
  onClose: () => void
}

export function MarkdownHelp({ open, onClose }: MarkdownHelpProps) {
  return (
    <Modal
      open={open}
      title="Markdown shortcuts"
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn--primary btn--sm" onClick={onClose} autoFocus>
          Got it
        </button>
      }
    >
      <p className="modal__lede">
        Start an empty text block with a symbol, then press <kbd>Space</kbd>. The symbol disappears
        and the block changes instantly.
      </p>
      <div className="md-help">
        {MARKDOWN_SHORTCUTS.map((shortcut) => (
          <div key={`${shortcut.type}-${shortcut.marker}`} className="md-help__item">
            <kbd className="md-help__key">{shortcut.marker}</kbd>
            <span className="md-help__label">{shortcut.label}</span>
            {shortcut.aliases?.length ? (
              <span className="md-help__alias" title="Also works">
                {shortcut.aliases.join(' ')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="md-help__note">
        These symbols choose the block type. Bold, italic, colour and size apply to the whole block
        from the format rail; inline Markdown is not interpreted.
      </p>
    </Modal>
  )
}
