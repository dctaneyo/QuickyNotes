import { useCallback, useEffect } from 'react'

interface NumPadProps {
  length: number
  max: number
  onDigit: (digit: string) => void
  onBackspace: () => void
  onSubmit: () => void
  canSubmit: boolean
  disabled?: boolean
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function NumPad({
  length,
  max,
  onDigit,
  onBackspace,
  onSubmit,
  canSubmit,
  disabled = false,
}: NumPadProps) {
  const handleDigit = useCallback(
    (digit: string) => {
      if (disabled || length >= max) return
      onDigit(digit)
    },
    [disabled, length, max, onDigit],
  )

  // Physical keyboards should feel identical to the on-screen pad.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        handleDigit(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        onBackspace()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleDigit, onBackspace, onSubmit, canSubmit])

  return (
    <div className="numpad" role="group" aria-label="Number pad">
      {KEYS.map((digit) => (
        <button
          key={digit}
          type="button"
          className="numpad__key"
          onClick={() => handleDigit(digit)}
          disabled={disabled || length >= max}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className="numpad__key numpad__key--ghost"
        onClick={onBackspace}
        disabled={disabled || length === 0}
        aria-label="Delete last digit"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M9 5h11v14H9l-6-7 6-7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      <button
        type="button"
        className="numpad__key"
        onClick={() => handleDigit('0')}
        disabled={disabled || length >= max}
      >
        0
      </button>
      <button
        type="button"
        className="numpad__key numpad__key--go"
        onClick={onSubmit}
        disabled={disabled || !canSubmit}
        aria-label="Continue"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M5 12h13M13 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

interface DigitSlotsProps {
  value: string
  max: number
  masked?: boolean
  label: string
}

export function DigitSlots({ value, max, masked = false, label }: DigitSlotsProps) {
  return (
    <div className={`slots${masked ? ' slots--masked' : ''}`} role="status" aria-label={label}>
      {Array.from({ length: max }, (_, index) => {
        const digit = value[index]
        const filled = digit !== undefined
        const active = index === value.length
        return (
          <span
            key={index}
            className={`slots__cell${filled ? ' is-filled' : ''}${active ? ' is-active' : ''}`}
          >
            {filled ? (masked ? '•' : digit) : ''}
          </span>
        )
      })}
    </div>
  )
}
