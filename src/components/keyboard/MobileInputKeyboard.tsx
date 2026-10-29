import { useCallback, useEffect, useRef, useState } from 'react'
import { useTouchKeyboardDevice } from '../../hooks/useTouchKeyboard'
import { OnscreenKeyboard } from './OnscreenKeyboard'

type TextField = HTMLInputElement | HTMLTextAreaElement

interface ActiveField {
  element: TextField
  label: string
  numeric: boolean
  key: number
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
])

function asTextField(value: Element | null): TextField | null {
  if (value instanceof HTMLTextAreaElement) return value
  if (value instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(value.type)) return value
  return null
}

function fieldFromTarget(target: EventTarget | null): TextField | null {
  if (!(target instanceof Element)) return null
  const direct = asTextField(target)
  if (direct) return direct
  const label = target.closest('label')
  return label ? asTextField(label.control) : null
}

function isEditableField(field: TextField): boolean {
  if (field.disabled || field.readOnly) return false
  if (field.closest('.osk')) return false
  return (
    field.dataset.onscreenKeyboard !== 'block' &&
    field.dataset.onscreenKeyboard !== 'native'
  )
}

function isNumericField(field: TextField, inputMode = field.inputMode): boolean {
  const mode = inputMode.toLowerCase()
  return (
    field.type === 'number' ||
    field.type === 'tel' ||
    mode === 'numeric' ||
    mode === 'tel' ||
    mode === 'decimal'
  )
}

function labelFor(field: TextField): string {
  const aria = field.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const labelledBy = field.getAttribute('aria-labelledby')
  if (labelledBy) {
    const label = document.getElementById(labelledBy)?.textContent?.trim()
    if (label) return label
  }
  const label = field.labels?.[0]?.textContent?.trim()
  if (label) return label.replace(/\s+/g, ' ')
  return field.placeholder?.trim() || 'Text'
}

function readCaret(field: TextField): { start: number; end: number } {
  try {
    const start = field.selectionStart
    const end = field.selectionEnd
    if (start === null || end === null) {
      return { start: field.value.length, end: field.value.length }
    }
    return { start, end }
  } catch {
    // Number and email inputs do not expose a selection range.
    return { start: field.value.length, end: field.value.length }
  }
}

function setNativeValue(field: TextField, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(field, value)
  else field.value = value
}

function emitInput(field: TextField) {
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

function replaceRange(field: TextField, start: number, end: number, text: string) {
  if (field.disabled || field.readOnly) return
  const value = field.value
  let next = value.slice(0, start) + text + value.slice(end)
  if (field.maxLength >= 0) next = next.slice(0, field.maxLength)
  const caret = Math.min(start + text.length, next.length)
  setNativeValue(field, next)
  try {
    field.setSelectionRange(caret, caret)
  } catch {
    // Some input types do not expose a selection; the value still updates.
  }
  emitInput(field)
}

function insertText(field: TextField, text: string) {
  const { start, end } = readCaret(field)
  replaceRange(field, start, end, text)
}

function dispatchKey(field: TextField, key: string): boolean {
  return field.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: key === 'Enter' ? 'Enter' : 'Backspace',
      bubbles: true,
      cancelable: true,
    }),
  )
}

function deleteBackward(field: TextField) {
  if (field.disabled || field.readOnly) return
  const { start, end } = readCaret(field)
  if (start !== end) {
    replaceRange(field, start, end, '')
    return
  }
  if (start === 0) {
    // Empty tag inputs use Backspace to remove their last chip.
    if (field.value === '') dispatchKey(field, 'Backspace')
    return
  }
  const before = field.value.slice(0, start)
  const last = Array.from(before).pop() ?? ''
  replaceRange(field, start - last.length, start, '')
}

function moveFieldCaret(field: TextField, delta: number) {
  const { start, end } = readCaret(field)
  const next =
    start !== end
      ? delta < 0
        ? start
        : end
      : Math.max(0, Math.min(field.value.length, start + delta))
  try {
    field.setSelectionRange(next, next)
  } catch {
    // Input types without a selection still keep their value.
  }
}

function pressReturn(field: TextField) {
  if (!field.isConnected) return
  const accepted = dispatchKey(field, 'Enter')
  if (!accepted) return
  if (field instanceof HTMLTextAreaElement) {
    insertText(field, '\n')
    return
  }
  if (field.form) {
    if (typeof field.form.requestSubmit === 'function') field.form.requestSubmit()
    else field.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    field.blur()
    return
  }
  field.blur()
}

export function MobileInputKeyboard() {
  const enabled = useTouchKeyboardDevice()
  const [active, setActive] = useState<ActiveField | null>(null)
  const [height, setHeight] = useState(0)
  const activeRef = useRef<ActiveField | null>(null)
  const prepared = useRef(new Map<TextField, string | null>())
  const caretRef = useRef<{ element: TextField; start: number; end: number } | null>(null)
  const blurTimer = useRef<number | null>(null)
  const nextKey = useRef(0)

  const rememberCaret = useCallback((field: TextField) => {
    const { start, end } = readCaret(field)
    caretRef.current = { element: field, start, end }
  }, [])

  /**
   * The native field can lose focus when a touch leaves it for the board.
   * Restore the field, its saved selection, and (after React commits the
   * controlled value) the caret again so typing continues in place.
   */
  const withActiveField = useCallback(
    (action: (field: TextField) => void) => {
      const current = activeRef.current
      if (!current) return
      const field = current.element
      if (!field.isConnected) {
        activeRef.current = null
        setActive(null)
        return
      }

      const remembered = caretRef.current?.element === field ? caretRef.current : null
      if (document.activeElement !== field) field.focus({ preventScroll: true })
      if (remembered) {
        try {
          field.setSelectionRange(remembered.start, remembered.end)
        } catch {
          // The value can still be edited without a selection range.
        }
      }

      action(field)
      const caret = readCaret(field)
      rememberCaret(field)
      window.requestAnimationFrame(() => {
        if (!field.isConnected || activeRef.current?.element !== field) return
        const focused = document.activeElement
        const focusIsOurs =
          focused === field ||
          focused === document.body ||
          focused === document.documentElement ||
          focused === null ||
          (focused instanceof Element && focused.closest('.osk') !== null)
        if (!focusIsOurs) return
        if (focused !== field) field.focus({ preventScroll: true })
        try {
          field.setSelectionRange(caret.start, caret.end)
        } catch {
          // Some input types do not expose a selection range.
        }
        rememberCaret(field)
      })
    },
    [rememberCaret],
  )

  const deactivate = useCallback((blur = false) => {
    const current = activeRef.current
    if (!current) return
    activeRef.current = null
    setActive(null)
    if (blur && document.activeElement === current.element) current.element.blur()
  }, [])

  const activate = useCallback((field: TextField) => {
    if (activeRef.current?.element === field) return
    setHeight(0)
    // Preparing the field changes its inputmode to none, so read the original
    // mode here to know whether the number layout should open first.
    const originalMode = prepared.current.get(field) ?? field.inputMode
    const next: ActiveField = {
      element: field,
      label: labelFor(field),
      numeric: isNumericField(field, originalMode),
      key: nextKey.current++,
    }
    activeRef.current = next
    setActive(next)
    rememberCaret(field)
  }, [rememberCaret])

  useEffect(() => {
    if (enabled) return
    deactivate()
  }, [enabled, deactivate])

  useEffect(() => {
    if (!enabled) return

    const originalModes = prepared.current
    const prepare = (field: TextField) => {
      if (!originalModes.has(field)) {
        originalModes.set(field, field.getAttribute('inputmode'))
      }
      // React can restore its inputMode prop on a re-render; keep the native
      // keyboard suppressed whenever the field is focused from the app.
      field.setAttribute('inputmode', 'none')
    }

    const clearBlurTimer = () => {
      if (blurTimer.current === null) return
      window.clearTimeout(blurTimer.current)
      blurTimer.current = null
    }

    const prepareFieldsIn = (root: ParentNode) => {
      if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
        if (isEditableField(root)) prepare(root)
        return
      }
      if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return
      for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input, textarea',
      )) {
        if (isEditableField(field)) prepare(field)
      }
    }

    // Suppress the native keyboard before a field can be focused, including
    // fields that dialogs or shortcuts focus programmatically.
    prepareFieldsIn(document)

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      if (target.closest('.osk')) {
        const current = activeRef.current
        if (current) rememberCaret(current.element)
        return
      }
      const field = fieldFromTarget(target)
      if (field) {
        if (isEditableField(field)) prepare(field)
        return
      }
      if (!activeRef.current) return
      // Any tap outside the active field and its board dismisses the board.
      // This is explicit so a lost focus event cannot do it by accident.
      window.setTimeout(() => {
        const current = activeRef.current
        if (!current) return
        if (document.activeElement === current.element) current.element.blur()
        deactivate()
      }, 0)
    }

    const onFocusIn = (event: FocusEvent) => {
      clearBlurTimer()
      // Buttons and format controls inside the board can take focus without
      // meaning the user left the field. Never tear the board down for those.
      if (event.target instanceof Element && event.target.closest('.osk')) return
      const field = fieldFromTarget(event.target)
      if (!field || !isEditableField(field)) {
        deactivate()
        return
      }
      prepare(field)
      activate(field)
      rememberCaret(field)
    }

    const onSelectionChange = () => {
      const current = activeRef.current
      if (current && document.activeElement === current.element) rememberCaret(current.element)
    }

    const onFocusOut = (event: FocusEvent) => {
      clearBlurTimer()
      const next = event.relatedTarget
      if (next instanceof Element && next.closest('.osk')) return
      // Touch browsers frequently drop focus to the document itself when a
      // board key is tapped. That is not an exit; outside taps dismiss the
      // board explicitly in onPointerDown.
      if (
        next === null ||
        next === document.body ||
        next === document.documentElement
      ) {
        return
      }
      blurTimer.current = window.setTimeout(() => {
        const current = activeRef.current
        if (!current) return
        if (document.activeElement === current.element) return
        if (
          document.activeElement instanceof Element &&
          document.activeElement.closest('.osk')
        ) {
          return
        }
        deactivate()
      }, 90)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('selectionchange', onSelectionChange)

    const observer = new MutationObserver((records) => {
      const current = activeRef.current
      if (current && !current.element.isConnected) deactivate()
      for (const field of originalModes.keys()) {
        if (!field.isConnected) originalModes.delete(field)
      }
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) prepareFieldsIn(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      observer.disconnect()
      clearBlurTimer()
      deactivate()
      for (const [field, original] of originalModes) {
        if (!field.isConnected) continue
        if (original === null) field.removeAttribute('inputmode')
        else field.setAttribute('inputmode', original)
      }
      originalModes.clear()
    }
  }, [enabled, activate, deactivate, rememberCaret])

  useEffect(() => {
    if (!enabled || !active) return
    const keyboardHeight = height > 0 ? height : 320
    document.body.classList.add('has-onscreen-keyboard')
    document.documentElement.style.setProperty('--osk-height', `${keyboardHeight}px`)
    return () => {
      document.body.classList.remove('has-onscreen-keyboard')
      document.documentElement.style.removeProperty('--osk-height')
    }
  }, [enabled, active, height])

  useEffect(() => {
    if (!active || height <= 0) return
    const frame = window.requestAnimationFrame(() => {
      const field = active.element
      if (!field.isConnected) return
      const rect = field.getBoundingClientRect()
      const bottom = window.innerHeight - height - 14
      if (rect.bottom > bottom || rect.top < 8) {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, height])

  if (!enabled || !active) return null

  return (
    <OnscreenKeyboard
      key={active.key}
      label={active.label}
      initialMode={active.numeric ? 'numbers' : 'text'}
      onInsert={(text) => withActiveField((field) => insertText(field, text))}
      onBackspace={() => withActiveField(deleteBackward)}
      onReturn={() => {
        const field = activeRef.current?.element
        if (!field) return
        withActiveField(pressReturn)
        if (!(field instanceof HTMLTextAreaElement)) deactivate(true)
      }}
      onMoveCaret={(delta) => withActiveField((field) => moveFieldCaret(field, delta))}
      onDismiss={() => deactivate(true)}
      onHeightChange={setHeight}
    />
  )
}
