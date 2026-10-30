import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronDownIcon, HighlighterIcon, ResetFormatIcon } from '../components/Icons'
import { BLOCK_LABELS } from '../lib/notes'
import {
  BLOCK_BASE_FONT_SIZE,
  HIGHLIGHT_COLORS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TEXT_COLORS,
  clampFontSize,
  isDefaultBlockFormat,
  type BlockFormat,
} from '../lib/formatting'
import type { BlockType } from '../lib/types'
import { SLASH_ITEMS } from './SlashMenu'
import { MarkdownHelp } from './MarkdownHelp'

export type FormatMode = 'docked' | 'keyboard'

interface FormatMenuProps {
  mode: FormatMode
  type: BlockType
  indent: number
  format: BlockFormat
  onType: (type: BlockType) => void
  onIndent: (delta: number) => void
  onFormat: (patch: Partial<BlockFormat>) => void
  onReset: () => void
}

// Dividers have no text to format, so they stay in the slash menu.
const FORMAT_ITEMS = SLASH_ITEMS.filter((item) => item.type !== 'divider')

const SHORT_LABELS: Partial<Record<BlockType, string>> = {
  text: 'Text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  todo: 'To-do',
  bullet: 'Bullets',
  number: 'Numbered',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
}

export function FormatMenu({
  mode,
  type,
  indent,
  format,
  onType,
  onIndent,
  onFormat,
  onReset,
}: FormatMenuProps) {
  const [sizeDraft, setSizeDraft] = useState(format.fontSize ? String(format.fontSize) : '')
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false)

  useEffect(() => {
    setSizeDraft(format.fontSize ? String(format.fontSize) : '')
  }, [format.fontSize])

  const effectiveSize = format.fontSize ?? clampFontSize(BLOCK_BASE_FONT_SIZE[type])
  const draftNumber = Number(sizeDraft)
  const currentSize =
    sizeDraft.trim() && Number.isFinite(draftNumber) ? clampFontSize(draftNumber) : effectiveSize

  const commitSize = () => {
    const value = Number(sizeDraft)
    if (!sizeDraft.trim() || !Number.isFinite(value)) {
      setSizeDraft('')
      onFormat({ fontSize: null })
      return
    }
    const next = clampFontSize(value)
    setSizeDraft(String(next))
    onFormat({ fontSize: next })
  }

  const nudgeSize = (delta: number) => {
    const next = clampFontSize(currentSize + delta)
    setSizeDraft(String(next))
    onFormat({ fontSize: next })
  }

  const customTextColor = format.color ?? '#171a17'
  const customHighlight = format.highlight ?? '#fff0a8'

  const bar = (
    <div
      className={`format-bar format-bar--${mode}`}
      role={mode === 'keyboard' ? 'group' : 'region'}
      aria-label={`Format ${BLOCK_LABELS[type]} block`}
      onPointerDown={(event) => {
        // Keep the caret in the block when a formatting button is pressed.
        if ((event.target as HTMLElement).closest('button')) event.preventDefault()
      }}
    >
      <div className="fmt-bar" role="toolbar" aria-label="Block formatting">
        <label className="fmt-select" title="Block type">
          <select
            value={type}
            aria-label="Block type"
            onChange={(event) => onType(event.target.value as BlockType)}
          >
            {FORMAT_ITEMS.map((item) => (
              <option key={item.type} value={item.type}>
                {SHORT_LABELS[item.type] ?? item.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={11} />
        </label>

        <span className="fmt-divider" aria-hidden="true" />

        <div className="fmt-group" role="group" aria-label="Text style">
          <button
            type="button"
            className={`fmt-btn${format.bold ? ' is-on' : ''}`}
            aria-pressed={format.bold}
            title="Bold block"
            onClick={() => onFormat({ bold: !format.bold })}
          >
            <span className="fmt-glyph fmt-glyph--bold">B</span>
          </button>
          <button
            type="button"
            className={`fmt-btn${format.italic ? ' is-on' : ''}`}
            aria-pressed={format.italic}
            title="Italic block"
            onClick={() => onFormat({ italic: !format.italic })}
          >
            <span className="fmt-glyph fmt-glyph--italic">I</span>
          </button>
          <button
            type="button"
            className={`fmt-btn${format.underline ? ' is-on' : ''}`}
            aria-pressed={format.underline}
            title="Underline block"
            onClick={() => onFormat({ underline: !format.underline })}
          >
            <span className="fmt-glyph fmt-glyph--underline">U</span>
          </button>
          <button
            type="button"
            className={`fmt-btn${format.strike ? ' is-on' : ''}`}
            aria-pressed={format.strike}
            title="Strikethrough block"
            onClick={() => onFormat({ strike: !format.strike })}
          >
            <span className="fmt-glyph fmt-glyph--strike">S</span>
          </button>
        </div>

        <span className="fmt-divider" aria-hidden="true" />

        <div className="fmt-size" role="group" aria-label="Font size">
          <button
            type="button"
            className="fmt-size__step"
            aria-label="Decrease font size"
            title="Decrease font size"
            disabled={currentSize <= MIN_FONT_SIZE}
            onClick={() => nudgeSize(-1)}
          >
            −
          </button>
          {mode === 'keyboard' ? (
            <span className="fmt-size__value" aria-hidden="true">
              {format.fontSize ? `${format.fontSize}px` : 'Auto'}
            </span>
          ) : (
            <label className="fmt-size__field">
              <input
                value={sizeDraft}
                inputMode="numeric"
                maxLength={2}
                placeholder="Auto"
                aria-label="Font size in pixels"
                title="Font size in pixels. Leave empty for automatic."
                onChange={(event) => setSizeDraft(event.target.value.replace(/[^\d]/g, ''))}
                onBlur={commitSize}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              <span aria-hidden="true">px</span>
            </label>
          )}
          <button
            type="button"
            className="fmt-size__step"
            aria-label="Increase font size"
            title="Increase font size"
            disabled={currentSize >= MAX_FONT_SIZE}
            onClick={() => nudgeSize(1)}
          >
            +
          </button>
        </div>

        <span className="fmt-divider" aria-hidden="true" />

        <div className="fmt-group fmt-group--colors" role="group" aria-label="Text color">
          <span
            className="fmt-color-label"
            aria-hidden="true"
            style={{ borderBottomColor: format.color ?? 'var(--ink)' }}
          >
            A
          </span>
          {TEXT_COLORS.map((choice) => {
            const active = format.color === choice.value
            return (
              <button
                key={choice.label}
                type="button"
                className={`fmt-swatch${choice.value ? '' : ' fmt-swatch--none'}${
                  active ? ' is-on' : ''
                }`}
                style={{ '--swatch': choice.value ?? 'var(--ink)' } as CSSProperties}
                aria-label={`${choice.label} text color`}
                aria-pressed={active}
                title={choice.label}
                onClick={() => onFormat({ color: choice.value })}
              />
            )
          })}
          <label className="fmt-custom" title="Custom text color">
            <input
              type="color"
              value={customTextColor}
              aria-label="Custom text color"
              onChange={(event) => onFormat({ color: event.target.value })}
            />
            <span aria-hidden="true">+</span>
          </label>
        </div>

        <span className="fmt-divider" aria-hidden="true" />

        <div className="fmt-group fmt-group--colors" role="group" aria-label="Highlight color">
          <HighlighterIcon size={14} />
          {HIGHLIGHT_COLORS.map((choice) => {
            const active = format.highlight === choice.value
            return (
              <button
                key={choice.label}
                type="button"
                className={`fmt-swatch${choice.value ? '' : ' fmt-swatch--none'}${
                  active ? ' is-on' : ''
                }`}
                style={{ '--swatch': choice.value ?? 'transparent' } as CSSProperties}
                aria-label={`${choice.label} highlight`}
                aria-pressed={active}
                title={choice.label}
                onClick={() => onFormat({ highlight: choice.value })}
              />
            )
          })}
          <label className="fmt-custom" title="Custom highlight color">
            <input
              type="color"
              value={customHighlight}
              aria-label="Custom highlight color"
              onChange={(event) => onFormat({ highlight: event.target.value })}
            />
            <span aria-hidden="true">+</span>
          </label>
        </div>

        <span className="fmt-divider" aria-hidden="true" />

        <div className="fmt-group fmt-group--indent" role="group" aria-label="Indentation">
          <button
            type="button"
            className="fmt-btn fmt-btn--arrow"
            disabled={indent <= 0}
            onClick={() => onIndent(-1)}
            aria-label="Outdent block"
            title="Outdent"
          >
            ←
          </button>
          <span className="fmt-level mono" title={`Indent level ${indent}`}>
            L{indent}
          </span>
          <button
            type="button"
            className="fmt-btn fmt-btn--arrow"
            disabled={indent >= 3}
            onClick={() => onIndent(1)}
            aria-label="Indent block"
            title="Indent"
          >
            →
          </button>
        </div>

        <span className="fmt-divider" aria-hidden="true" />

        <button
          type="button"
          className="fmt-btn"
          onClick={onReset}
          disabled={isDefaultBlockFormat(format)}
          aria-label="Clear text formatting"
          title="Clear text formatting"
        >
          <ResetFormatIcon size={16} />
        </button>

        <span className="fmt-divider" aria-hidden="true" />

        <button
          type="button"
          className="fmt-btn fmt-btn--help"
          onClick={() => setMarkdownHelpOpen(true)}
          aria-label="Markdown shortcuts"
          aria-haspopup="dialog"
          title="Markdown shortcuts"
        >
          <span className="fmt-help-glyph" aria-hidden="true">
            ?
          </span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      {bar}
      <MarkdownHelp
        open={markdownHelpOpen}
        onClose={() => setMarkdownHelpOpen(false)}
      />
    </>
  )
}
