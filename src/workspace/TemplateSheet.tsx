import { Modal } from '../components/Modal'
import { TEMPLATES } from '../lib/templates'

interface TemplateSheetProps {
  open: boolean
  onClose: () => void
  onPick: (templateId: string) => void
}

export function TemplateSheet({ open, onClose, onPick }: TemplateSheetProps) {
  return (
    <Modal open={open} title="Start a note" onClose={onClose}>
      <p className="modal__lede">Pick a starting point. You can change anything afterwards.</p>
      <div className="template-list">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="template"
            onClick={() => onPick(template.id)}
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
    </Modal>
  )
}
