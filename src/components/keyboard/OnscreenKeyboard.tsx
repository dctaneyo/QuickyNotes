import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon } from '../Icons'

type KeyboardMode = 'alpha' | 'shift' | 'caps' | 'numbers' | 'symbols' | 'emoji'

interface KeyHint {
  key: string
  hint?: string
}

const ROW1: KeyHint[] = [
  { key: 'q', hint: '1' },
  { key: 'w', hint: '2' },
  { key: 'e', hint: '3' },
  { key: 'r', hint: '4' },
  { key: 't', hint: '5' },
  { key: 'y', hint: '6' },
  { key: 'u', hint: '7' },
  { key: 'i', hint: '8' },
  { key: 'o', hint: '9' },
  { key: 'p', hint: '0' },
]

const ROW2: KeyHint[] = [
  { key: 'a', hint: '@' },
  { key: 's', hint: '#' },
  { key: 'd', hint: '$' },
  { key: 'f', hint: '&' },
  { key: 'g', hint: '*' },
  { key: 'h', hint: '(' },
  { key: 'j', hint: ')' },
  { key: 'k', hint: "'" },
  { key: 'l', hint: '"' },
]

const ROW3: KeyHint[] = [
  { key: 'z', hint: '%' },
  { key: 'x', hint: '-' },
  { key: 'c', hint: '+' },
  { key: 'v', hint: '=' },
  { key: 'b', hint: '/' },
  { key: 'n', hint: ';' },
  { key: 'm', hint: ':' },
]

const NUMBER_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '%', '+'],
]

const SYMBOL_ROWS = [
  ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
  ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
  ['.', ',', '?', '!', "'", '"', ';'],
]

const EMOJI_CATEGORIES = [
  {
    label: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '😜', '🤪', '😝',
      '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒',
    ],
  },
  {
    label: '👍',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
      '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '👌', '🤌', '🤏', '👈',
      '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙',
    ],
  },
  {
    label: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '⭐', '🌟',
      '✨', '💫', '🔥', '💯', '✅', '❌', '⚠️', '🚫', '♻️', '💤',
    ],
  },
  {
    label: '🎉',
    emojis: [
      '🎉', '🎊', '🏆', '🥇', '🥈', '🥉', '🎯', '🎮', '🎲', '🎭',
      '🎨', '🎬', '🎤', '🎧', '🎵', '🎶', '🔔', '📣', '💬', '💭',
      '🗯️', '📋', '📌', '📎', '🖊️', '✏️', '📝', '📅', '📊', '🚀',
    ],
  },
  {
    label: '🍔',
    emojis: [
      '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🍳', '🥘',
      '🍲', '🥗', '🍿', '🍱', '🍣', '🍤', '🍦', '🍧', '🍨', '🍩',
      '🍪', '🎂', '🍰', '☕', '🍵', '🥤', '🍺', '🍷', '🥂', '🧃',
    ],
  },
]

const LONG_PRESS_MS = 420
const BACKSPACE_INITIAL_MS = 380
const BACKSPACE_REPEAT_MS = 70

function haptic(ms = 7) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms)
  }
}

interface OnscreenKeyboardProps {
  onInsert: (text: string) => void
  onBackspace: () => void
  onReturn: () => void
  onMoveCaret: (delta: number) => void
  onUndo?: () => void
  onRedo?: () => void
  onDismiss: () => void
  /** Return focus to the text field when a key tries to take it. */
  onKeepFocus?: () => void
  onHeightChange?: (height: number) => void
  formatBar?: ReactNode
  label?: string
  initialMode?: 'text' | 'numbers'
}

/**
 * A pointer-first replacement for the native mobile keyboard. It edits the real
 * focused field, so selections, collaboration carets and hardware input keep
 * working while the board is open.
 */
export function OnscreenKeyboard({
  onInsert,
  onBackspace,
  onReturn,
  onMoveCaret,
  onUndo,
  onRedo,
  onDismiss,
  onKeepFocus,
  onHeightChange,
  formatBar,
  label = 'Text',
  initialMode = 'text',
}: OnscreenKeyboardProps) {
  const [mode, setMode] = useState<KeyboardMode>(initialMode === 'numbers' ? 'numbers' : 'alpha')
  const [returnTo, setReturnTo] = useState<'alpha' | 'shift' | 'caps'>('alpha')
  const [emojiCategory, setEmojiCategory] = useState(0)
  const [preview, setPreview] = useState<{
    char: string
    left: number
    top: number
    width: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const previewTimer = useRef<number | null>(null)
  const backspaceDelay = useRef<number | null>(null)
  const backspaceInterval = useRef<number | null>(null)
  const shiftTapAt = useRef(0)
  const spaceDrag = useRef<{ startX: number; moved: boolean } | null>(null)

  const isAlpha = mode === 'alpha' || mode === 'shift' || mode === 'caps'
  const isUpper = mode === 'shift' || mode === 'caps'
  const isNumeric = mode === 'numbers' || mode === 'symbols'

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const report = () => onHeightChange?.(Math.round(element.getBoundingClientRect().height))
    report()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report)
    observer?.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [onHeightChange])

  const showPreview = (char: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setPreview({
      char,
      left: rect.left + rect.width / 2,
      top: rect.top,
      width: rect.width,
    })
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
  }

  const hidePreview = () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => setPreview(null), 70)
  }

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const typeCharacter = (char: string) => {
    onInsert(char)
    haptic()
    if (mode === 'shift') setMode('alpha')
  }

  const startCharacterPress = (char: string, hint: string | undefined, element: HTMLElement) => {
    showPreview(char, element)
    longPressFired.current = false
    if (!hint) return
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressFired.current = true
      onInsert(hint)
      haptic(10)
      setPreview((current) => (current ? { ...current, char: hint } : current))
      if (mode === 'shift') setMode('alpha')
    }, LONG_PRESS_MS)
  }

  const endCharacterPress = (char: string) => {
    hidePreview()
    const longPressed = longPressFired.current
    cancelLongPress()
    longPressFired.current = false
    if (!longPressed) typeCharacter(char)
  }

  const startBackspaceRepeat = () => {
    onBackspace()
    haptic()
    stopBackspaceRepeat()
    backspaceDelay.current = window.setTimeout(() => {
      backspaceInterval.current = window.setInterval(() => {
        onBackspace()
        haptic(4)
      }, BACKSPACE_REPEAT_MS)
    }, BACKSPACE_INITIAL_MS)
  }

  const stopBackspaceRepeat = () => {
    if (backspaceDelay.current !== null) {
      window.clearTimeout(backspaceDelay.current)
      backspaceDelay.current = null
    }
    if (backspaceInterval.current !== null) {
      window.clearInterval(backspaceInterval.current)
      backspaceInterval.current = null
    }
  }

  useEffect(() => {
    const reset = () => stopBackspaceRepeat()
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('blur', reset)
      reset()
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    }
  }, [])

  const pressShift = () => {
    const now = Date.now()
    if (mode === 'caps') {
      setMode('alpha')
      shiftTapAt.current = 0
    } else if (mode === 'shift') {
      if (now - shiftTapAt.current < 380) {
        setMode('caps')
        shiftTapAt.current = 0
      } else {
        setMode('alpha')
        shiftTapAt.current = 0
      }
    } else {
      setMode('shift')
      shiftTapAt.current = now
    }
    haptic()
  }

  const toggleNumbers = () => {
    if (isNumeric || mode === 'emoji') {
      setMode(returnTo)
    } else {
      setReturnTo(mode)
      setMode('numbers')
    }
    haptic()
  }

  const switchNumberMode = () => {
    setMode((current) => (current === 'numbers' ? 'symbols' : 'numbers'))
    haptic()
  }

  const toggleEmoji = () => {
    if (mode === 'emoji') {
      setMode(returnTo)
    } else {
      if (isAlpha) setReturnTo(mode)
      setMode('emoji')
    }
    haptic()
  }

  const pressSpace = () => {
    onInsert(' ')
    haptic()
    if (mode === 'shift') setMode('alpha')
  }

  const startSpaceDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    spaceDrag.current = { startX: event.clientX, moved: false }
  }

  const moveSpaceDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = spaceDrag.current
    if (!drag) return
    const delta = event.clientX - drag.startX
    if (!drag.moved && Math.abs(delta) < 9) return
    drag.moved = true
    const steps = Math.trunc(delta / 15)
    if (steps === 0) return
    onMoveCaret(steps)
    drag.startX += steps * 15
    haptic(3)
  }

  const endSpaceDrag = () => {
    const drag = spaceDrag.current
    spaceDrag.current = null
    if (!drag?.moved) pressSpace()
  }

  const characterKey = (item: KeyHint) => {
    const display = isUpper ? item.key.toUpperCase() : item.key
    return (
      <button
        key={item.key}
        type="button"
        className="osk__key osk__key--char"
        aria-label={item.hint ? `${display}, hold for ${item.hint}` : display}
        onPointerDown={(event) => {
          event.preventDefault()
          startCharacterPress(display, item.hint, event.currentTarget)
        }}
        onPointerUp={() => endCharacterPress(display)}
        onPointerCancel={() => {
          cancelLongPress()
          hidePreview()
        }}
        onPointerLeave={() => {
          cancelLongPress()
          hidePreview()
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="osk__char">{display}</span>
        {item.hint ? (
          <span className="osk__hint" aria-hidden="true">
            {item.hint}
          </span>
        ) : null}
      </button>
    )
  }

  /** Invisible edge of the inset letter row; taps fall through to a or l. */
  const edgeKey = (item: KeyHint, side: 'left' | 'right') => {
    const display = isUpper ? item.key.toUpperCase() : item.key
    const anchorFor = (element: HTMLElement) => {
      const row = element.parentElement
      const keys = row?.querySelectorAll<HTMLElement>('.osk__key--char')
      if (!keys?.length) return element
      return side === 'left' ? keys[0] : keys[keys.length - 1]
    }
    return (
      <button
        key={`edge-${side}`}
        type="button"
        className={`osk__edge osk__edge--${side}`}
        tabIndex={-1}
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault()
          startCharacterPress(display, item.hint, anchorFor(event.currentTarget))
        }}
        onPointerUp={() => endCharacterPress(display)}
        onPointerCancel={() => {
          cancelLongPress()
          hidePreview()
        }}
        onPointerLeave={() => {
          cancelLongPress()
          hidePreview()
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
    )
  }

  const symbolKey = (char: string) => (
    <button
      key={char}
      type="button"
      className="osk__key osk__key--char"
      aria-label={char}
      onPointerDown={(event) => {
        event.preventDefault()
        showPreview(char, event.currentTarget)
        typeCharacter(char)
      }}
      onPointerUp={hidePreview}
      onPointerCancel={hidePreview}
      onPointerLeave={hidePreview}
    >
      <span className="osk__char">{char}</span>
    </button>
  )

  const utilityButton = (
    glyph: string,
    ariaLabel: string,
    action: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      className="osk__util-btn"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault()
        if (!disabled) action()
      }}
    >
      {glyph}
    </button>
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <section
        ref={rootRef}
        className="osk"
        role="group"
        aria-label={`${label} onscreen keyboard`}
        data-keyboard-mode={mode}
        onPointerDown={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('button')) event.preventDefault()
        }}
        onMouseDown={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('button')) event.preventDefault()
        }}
        onFocusCapture={(event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          // If a browser focuses a key despite the pointer guard, give the
          // caret back to the field instead of leaving the editor blurred.
          if (target.closest('button')) onKeepFocus?.()
        }}
      >
        {formatBar ? <div className="osk__format">{formatBar}</div> : null}

        <div className="osk__utility">
          <div className="osk__utility-group">
            {utilityButton('←', 'Move cursor left', () => onMoveCaret(-1))}
            {utilityButton('→', 'Move cursor right', () => onMoveCaret(1))}
            {onUndo ? utilityButton('↶', 'Undo', onUndo) : null}
            {onRedo ? utilityButton('↷', 'Redo', onRedo) : null}
          </div>
          <span className="osk__label">{label}</span>
          <button
            type="button"
            className="osk__hide"
            aria-label="Hide onscreen keyboard"
            onPointerDown={(event) => {
              event.preventDefault()
              onDismiss()
            }}
          >
            <span>Hide</span>
            <ChevronDownIcon size={15} />
          </button>
        </div>

        <div className="osk__keys">
          {isAlpha ? (
            <>
              <div className="osk__row">{ROW1.map(characterKey)}</div>
              <div className="osk__row osk__row--inset">
                {edgeKey(ROW2[0], 'left')}
                {ROW2.map(characterKey)}
                {edgeKey(ROW2[ROW2.length - 1], 'right')}
              </div>
              <div className="osk__row">
                <button
                  type="button"
                  className={`osk__key osk__key--mod${isUpper ? ' is-on' : ''}`}
                  aria-label={mode === 'caps' ? 'Caps lock on' : 'Shift'}
                  aria-pressed={isUpper}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    pressShift()
                  }}
                >
                  {mode === 'caps' ? 'CAPS' : '⇧'}
                </button>
                {ROW3.map(characterKey)}
                <button
                  type="button"
                  className="osk__key osk__key--mod osk__key--delete"
                  aria-label="Delete"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    startBackspaceRepeat()
                  }}
                  onPointerUp={stopBackspaceRepeat}
                  onPointerCancel={stopBackspaceRepeat}
                  onPointerLeave={stopBackspaceRepeat}
                >
                  ⌫
                </button>
              </div>
            </>
          ) : null}

          {isNumeric ? (
            <>
              <div className="osk__row">
                {(mode === 'numbers' ? NUMBER_ROWS[0] : SYMBOL_ROWS[0]).map(symbolKey)}
              </div>
              <div className="osk__row">
                {(mode === 'numbers' ? NUMBER_ROWS[1] : SYMBOL_ROWS[1]).map(symbolKey)}
              </div>
              <div className="osk__row">
                <button
                  type="button"
                  className="osk__key osk__key--mod"
                  aria-label={mode === 'numbers' ? 'Show symbols' : 'Show numbers'}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    switchNumberMode()
                  }}
                >
                  {mode === 'numbers' ? '#+=' : '.?123'}
                </button>
                {(mode === 'numbers' ? NUMBER_ROWS[2] : SYMBOL_ROWS[2]).map(symbolKey)}
                <button
                  type="button"
                  className="osk__key osk__key--mod osk__key--delete"
                  aria-label="Delete"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    startBackspaceRepeat()
                  }}
                  onPointerUp={stopBackspaceRepeat}
                  onPointerCancel={stopBackspaceRepeat}
                  onPointerLeave={stopBackspaceRepeat}
                >
                  ⌫
                </button>
              </div>
            </>
          ) : null}

          {mode === 'emoji' ? (
            <>
              <div className="osk__emoji-tabs">
                {EMOJI_CATEGORIES.map((category, index) => (
                  <button
                    key={category.label}
                    type="button"
                    className={`osk__emoji-tab${index === emojiCategory ? ' is-on' : ''}`}
                    aria-label={`${category.label} emoji`}
                    aria-pressed={index === emojiCategory}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      setEmojiCategory(index)
                      haptic()
                    }}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="osk__emoji-grid">
                {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="osk__emoji"
                    aria-label={emoji}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      showPreview(emoji, event.currentTarget)
                      typeCharacter(emoji)
                    }}
                    onPointerUp={hidePreview}
                    onPointerCancel={hidePreview}
                    onPointerLeave={hidePreview}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="osk__row osk__row--bottom">
            <button
              type="button"
              className="osk__key osk__key--mod"
              aria-label={isNumeric || mode === 'emoji' ? 'Show letters' : 'Show numbers'}
              onPointerDown={(event) => {
                event.preventDefault()
                if (mode === 'emoji') {
                  setMode(returnTo)
                  haptic()
                } else {
                  toggleNumbers()
                }
              }}
            >
              {isNumeric || mode === 'emoji' ? 'ABC' : '.?123'}
            </button>
            <button
              type="button"
              className="osk__key osk__key--mod osk__key--arrow"
              aria-label="Move cursor left"
              onPointerDown={(event) => {
                event.preventDefault()
                onMoveCaret(-1)
              }}
            >
              ←
            </button>
            <button
              type="button"
              className="osk__key osk__key--space"
              aria-label="Space. Drag to move the cursor."
              onPointerDown={startSpaceDrag}
              onPointerMove={moveSpaceDrag}
              onPointerUp={endSpaceDrag}
              onPointerCancel={() => {
                spaceDrag.current = null
              }}
            >
              space
            </button>
            <button
              type="button"
              className="osk__key osk__key--mod osk__key--arrow"
              aria-label="Move cursor right"
              onPointerDown={(event) => {
                event.preventDefault()
                onMoveCaret(1)
              }}
            >
              →
            </button>
            <button
              type="button"
              className={`osk__key osk__key--mod osk__key--emoji${
                mode === 'emoji' ? ' is-on' : ''
              }`}
              aria-label="Emoji"
              aria-pressed={mode === 'emoji'}
              onPointerDown={(event) => {
                event.preventDefault()
                toggleEmoji()
              }}
            >
              ☺
            </button>
            <button
              type="button"
              className="osk__key osk__key--return"
              aria-label="New line"
              onPointerDown={(event) => {
                event.preventDefault()
                onReturn()
                haptic()
                if (mode === 'shift') setMode('alpha')
              }}
            >
              ↵
            </button>
          </div>
        </div>
      </section>

      {preview ? (
        <div
          className="osk__preview"
          style={{ left: preview.left, top: preview.top, width: Math.max(preview.width, 42) }}
          aria-hidden="true"
        >
          {preview.char}
        </div>
      ) : null}
    </>,
    document.body,
  )
}
