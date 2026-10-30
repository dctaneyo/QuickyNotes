import { useEffect, useReducer, useRef, type CSSProperties } from 'react'
import type * as Y from 'yjs'
import { blockArray, blockTextNode, blockView, applyTextEdit } from '../sync/noteModel'
import { formatSignature, formatTextMetrics, formatTextStyle } from '../lib/formatting'
import { markdownTypeAfterInput, markdownTypeForMarker } from '../lib/markdown'
import type { BlockType } from '../lib/types'
import { RemoteCarets } from './RemoteCaret'
import { filterSlash } from './SlashMenu'
import type { BlockKeyboardController } from './useBlockKeyboard'

export interface FocusRequest {
  blockId: string
  at: 'start' | 'end'
  nonce: number
}

export interface SlashState {
  blockId: string
  query: string
  top: number
  left: number
  index: number
}

export interface RemoteCursor {
  clientId: number
  displayName: string
  color: string
  index: number
}

export interface BlockRowApi {
  insertAfter: (index: number, seed: { type: BlockType; text: string; indent: number }) => string
  remove: (index: number) => void
  move: (from: number, to: number) => void
  requestFocus: (blockId: string, at: 'start' | 'end') => void
  clearFocus: () => void
  setSlash: (state: SlashState | null) => void
  slash: SlashState | null
  onPickCommand: (type: BlockType) => void
  openFormat: (blockId: string) => void
  setDrag: (index: number | null) => void
  dragIndex: number | null
  dropIndex: number | null
  setDropIndex: (index: number | null) => void
  onDropAt: (index: number) => void
}

interface BlockRowProps {
  doc: Y.Doc
  block: Y.Map<unknown>
  index: number
  order: number | null
  focusRequest: FocusRequest | null
  remoteCursors: RemoteCursor[]
  api: BlockRowApi
  onEdited: () => void
  onFocusBlock: (blockId: string | null, cursorIndex?: number) => void
  readOnly?: boolean
  /** Hide the native mobile keyboard; the onscreen board drives this block. */
  customKeyboard?: boolean
  /** Lets the note surface send onscreen-keyboard actions to this block. */
  registerKeyboard?: (
    blockId: string,
    controller: BlockKeyboardController | null,
  ) => void
}

const CONTINUES: Partial<Record<BlockType, BlockType>> = {
  bullet: 'bullet',
  number: 'number',
  todo: 'todo',
  quote: 'quote',
}

// Lists keep their type and indentation when Return is pressed on an empty
// item, so a template can be sketched one placeholder at a time.
const LIST_TYPES = new Set<BlockType>(['bullet', 'number', 'todo'])

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 26)}px`
}

function placeholderFor(type: BlockType): string {
  switch (type) {
    case 'h1':
      return 'Heading 1'
    case 'h2':
      return 'Heading 2'
    case 'h3':
      return 'Heading 3'
    case 'code':
      return 'Code'
    case 'quote':
      return 'Quote'
    case 'callout':
      return 'Callout'
    case 'todo':
      return 'To-do'
    case 'bullet':
    case 'number':
      return 'List item'
    default:
      return "Write something, or press '/' for blocks"
  }
}

export function BlockRow({
  doc,
  block,
  index,
  order,
  focusRequest,
  remoteCursors,
  api,
  onEdited,
  onFocusBlock,
  readOnly = false,
  customKeyboard = false,
  registerKeyboard,
}: BlockRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const keyboardActionsRef = useRef<BlockKeyboardController | null>(null)
  const focusRestoreTimer = useRef<number | null>(null)
  const text = blockTextNode(block)
  const view = blockView(block)
  const apiRef = useRef(api)
  apiRef.current = api
  const [, refreshBlock] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    return () => {
      if (focusRestoreTimer.current !== null) window.clearTimeout(focusRestoreTimer.current)
    }
  }, [])

  // Type, checkbox and indentation live on the map, so re-render on its changes
  // rather than waiting for an unrelated parent update.
  useEffect(() => {
    const handler = () => refreshBlock()
    block.observe(handler)
    return () => block.unobserve(handler)
  }, [block])

  // Keep the textarea in step with Yjs, including edits from other people.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const sync = () => {
      const next = text.toString()
      const changed = el.value !== next
      if (changed) {
        const focused = document.activeElement === el
        const start = el.selectionStart
        const end = el.selectionEnd
        el.value = next
        if (focused) {
          const caret = Math.min(start, next.length)
          el.setSelectionRange(caret, Math.min(end, next.length))
        }
      }
      autoGrow(el)
      return changed
    }
    if (sync()) refreshBlock()
    const observer = () => {
      if (sync()) refreshBlock()
    }
    text.observe(observer)
    return () => text.unobserve(observer)
  }, [text])

  useEffect(() => {
    const el = textareaRef.current
    if (el) autoGrow(el)
  }, [view.type])

  useEffect(() => {
    if (!focusRequest || focusRequest.blockId !== view.id) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const position = focusRequest.at === 'end' ? el.value.length : 0
    el.setSelectionRange(position, position)
    autoGrow(el)
    apiRef.current.clearFocus()
  }, [focusRequest, view.id])

  const slashOpen = api.slash?.blockId === view.id

  const applySlash = (type: BlockType) => {
    const el = textareaRef.current
    if (el) el.value = ''
    text.delete(0, text.length)
    block.set('type', type)
    block.set('checked', false)
    api.setSlash(null)
    api.requestFocus(view.id, 'start')
    onEdited()
  }

  const maybeOpenSlash = (el: HTMLTextAreaElement) => {
    if (view.type === 'code') return
    const value = el.value
    if (/^\/[a-z0-9]*$/i.test(value)) {
      const rect = el.getBoundingClientRect()
      api.setSlash({
        blockId: view.id,
        query: value.slice(1),
        top: rect.bottom + 8,
        left: rect.left,
        index: 0,
      })
    } else if (api.slash?.blockId === view.id) {
      api.setSlash(null)
    }
  }

  const applyMarkdownShortcut = (el: HTMLTextAreaElement, type: BlockType) => {
    doc.transact(() => {
      text.delete(0, text.length)
      block.set('type', type)
      block.set('checked', false)
    })
    el.value = ''
    el.setSelectionRange(0, 0)
    autoGrow(el)
    api.setSlash(null)
    onEdited()
    if (type === 'divider') {
      const nextId = api.insertAfter(index, { type: 'text', text: '', indent: view.indent })
      api.requestFocus(nextId, 'start')
      return
    }
    onFocusBlock(view.id, 0)
  }

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const el = event.currentTarget
    const markdownType = view.type === 'text' ? markdownTypeAfterInput(el.value) : null
    if (markdownType) {
      applyMarkdownShortcut(el, markdownType)
      return
    }
    applyTextEdit(text, el.value)
    autoGrow(el)
    maybeOpenSlash(el)
    onFocusBlock(view.id, el.selectionEnd)
    onEdited()
  }

  /** Replace the current selection with text from the onscreen keyboard. */
  const insertFromKeyboard = (value: string) => {
    if (readOnly) return
    const el = textareaRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const next = el.value.slice(0, start) + value + el.value.slice(end)
    const markdownType = view.type === 'text' ? markdownTypeAfterInput(next) : null
    if (markdownType) {
      applyMarkdownShortcut(el, markdownType)
      scheduleFocusRestore()
      return
    }
    el.value = next
    applyTextEdit(text, next)
    const caret = start + value.length
    el.setSelectionRange(caret, caret)
    autoGrow(el)

    maybeOpenSlash(el)
    onFocusBlock(view.id, el.selectionEnd)
    onEdited()
    scheduleFocusRestore()
  }

  /**
   * Safari can blur the textarea after the click that follows pointerup. Put
   * the live caret back once more, without rewinding fast typing.
   */
  function scheduleFocusRestore() {
    if (focusRestoreTimer.current !== null) window.clearTimeout(focusRestoreTimer.current)
    focusRestoreTimer.current = window.setTimeout(() => {
      focusRestoreTimer.current = null
      const el = textareaRef.current
      if (!el || !el.isConnected) return
      // Do not reopen the board after it was dismissed or the note changed.
      if (!document.querySelector('.note.has-keyboard')) return
      const focused = document.activeElement
      const focusIsOurs =
        focused === el ||
        focused === document.body ||
        focused === document.documentElement ||
        focused === null ||
        (focused instanceof Element &&
          focused.closest('.osk') !== null &&
          !focused.matches('input, textarea, select'))
      if (!focusIsOurs) return
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      if (focused !== el) el.focus({ preventScroll: true })
      try {
        el.setSelectionRange(start, end)
      } catch {
        // Some block types do not expose a selection range.
      }
    }, 120)
  }

  /** Delete the selection, or the character immediately before the caret. */
  const deleteFromKeyboard = () => {
    if (readOnly) return
    const el = textareaRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    if (start !== end) {
      insertFromKeyboard('')
      return
    }
    if (start > 0) {
      el.setSelectionRange(start - 1, start)
      insertFromKeyboard('')
      return
    }
    scheduleFocusRestore()
    if (view.indent > 0) {
      block.set('indent', view.indent - 1)
      onEdited()
      return
    }
    if (view.type !== 'text') {
      block.set('type', 'text')
      onEdited()
      return
    }
    if (index > 0) mergeIntoPrevious()
  }

  /** Split the block like the Return key, keeping list and code behavior. */
  const newlineFromKeyboard = () => {
    if (readOnly) return
    const el = textareaRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })

    if (slashOpen && api.slash) {
      const choice = filterSlash(api.slash.query)[api.slash.index]
      if (choice) applySlash(choice.type)
      else api.setSlash(null)
      return
    }

    const value = el.value
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    if (view.type === 'code') {
      el.setSelectionRange(start, end)
      insertFromKeyboard('\n')
      return
    }
    if (!value.trim() && LIST_TYPES.has(view.type)) {
      const newId = api.insertAfter(index, {
        type: view.type,
        text: '',
        indent: view.indent,
      })
      api.requestFocus(newId, 'start')
      onEdited()
      return
    }
    const before = value.slice(0, start)
    const after = value.slice(end)
    applyTextEdit(text, before)
    const nextType = CONTINUES[view.type] ?? 'text'
    const newId = api.insertAfter(index, { type: nextType, text: after, indent: view.indent })
    api.requestFocus(newId, 'start')
    onEdited()
  }

  const moveCaretFromKeyboard = (delta: number) => {
    const el = textareaRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    const next =
      start !== end
        ? delta < 0
          ? start
          : end
        : Math.max(0, Math.min(el.value.length, start + delta))
    el.setSelectionRange(next, next)
    onFocusBlock(view.id, next)
    scheduleFocusRestore()
  }

  /** Return the caret to the block if a board key took focus from it. */
  const refocusFromKeyboard = () => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    try {
      el.setSelectionRange(start, end)
    } catch {
      // Some block types do not expose a selection range.
    }
  }

  useEffect(() => {
    keyboardActionsRef.current = {
      insert: insertFromKeyboard,
      backspace: deleteFromKeyboard,
      newline: newlineFromKeyboard,
      moveCaret: moveCaretFromKeyboard,
      refocus: refocusFromKeyboard,
      blur: () => textareaRef.current?.blur(),
    }
  })

  useEffect(() => {
    if (!registerKeyboard) return
    const controller: BlockKeyboardController = {
      insert: (value) => keyboardActionsRef.current?.insert(value),
      backspace: () => keyboardActionsRef.current?.backspace(),
      newline: () => keyboardActionsRef.current?.newline(),
      moveCaret: (delta) => keyboardActionsRef.current?.moveCaret(delta),
      refocus: () => keyboardActionsRef.current?.refocus(),
      blur: () => keyboardActionsRef.current?.blur(),
    }
    registerKeyboard(view.id, controller)
    return () => registerKeyboard(view.id, null)
  }, [view.id, registerKeyboard])

  function mergeIntoPrevious() {
    const blocks = blockArray(doc)
    if (index === 0) return
    const previous = blocks.get(index - 1)
    const previousView = blockView(previous)
    const previousText = blockTextNode(previous)
    const current = text.toString()
    if (current) previousText.insert(previousText.length, current)
    blocks.delete(index, 1)
    api.requestFocus(previousView.id, 'end')
    onEdited()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const el = event.currentTarget
    const items = api.slash ? filterSlash(api.slash.query) : []

    if (slashOpen && api.slash) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = items.length ? (api.slash.index + 1) % items.length : 0
        api.setSlash({ ...api.slash, index: next })
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const next = items.length ? (api.slash.index - 1 + items.length) % items.length : 0
        api.setSlash({ ...api.slash, index: next })
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const choice = items[api.slash.index]
        if (choice) applySlash(choice.type)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        api.setSlash(null)
        return
      }
    }

    if (
      event.key === ' ' &&
      view.type === 'text' &&
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length
    ) {
      const markdownType = markdownTypeForMarker(el.value)
      if (markdownType) {
        event.preventDefault()
        applyMarkdownShortcut(el, markdownType)
        return
      }
    }

    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const position = el.selectionStart
      if (view.type === 'code' || event.shiftKey) {
        const value = el.value
        applyTextEdit(text, `${value.slice(0, position)}\n${value.slice(el.selectionEnd)}`)
        window.requestAnimationFrame(() => {
          el.selectionStart = position + 1
          el.selectionEnd = position + 1
          autoGrow(el)
        })
        onEdited()
        return
      }
      const value = el.value
      const before = value.slice(0, position)
      const after = value.slice(position)
      if (!value.trim() && LIST_TYPES.has(view.type)) {
        const newId = api.insertAfter(index, {
          type: view.type,
          text: '',
          indent: view.indent,
        })
        api.requestFocus(newId, 'start')
        onEdited()
        return
      }
      applyTextEdit(text, before)
      const nextType = CONTINUES[view.type] ?? 'text'
      const newId = api.insertAfter(index, { type: nextType, text: after, indent: view.indent })
      api.requestFocus(newId, 'start')
      onEdited()
      return
    }

    if (event.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (view.indent > 0) {
        event.preventDefault()
        block.set('indent', view.indent - 1)
        onEdited()
        return
      }
      if (view.type !== 'text') {
        event.preventDefault()
        block.set('type', 'text')
        onEdited()
        return
      }
      if (index > 0) {
        event.preventDefault()
        mergeIntoPrevious()
      }
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      const next = Math.min(3, Math.max(0, view.indent + (event.shiftKey ? -1 : 1)))
      if (next !== view.indent) {
        block.set('indent', next)
        onEdited()
      }
      return
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      api.move(index, index + (event.key === 'ArrowUp' ? -1 : 1))
      return
    }

    if (event.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionEnd === 0 && index > 0) {
      event.preventDefault()
      api.requestFocus(blockView(blockArray(doc).get(index - 1)).id, 'end')
      return
    }

    if (
      event.key === 'ArrowDown' &&
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length &&
      index < blockArray(doc).length - 1
    ) {
      event.preventDefault()
      api.requestFocus(blockView(blockArray(doc).get(index + 1)).id, 'start')
      return
    }
  }

  if (view.type === 'divider') {
    return (
      <div
        className={`block block--divider${readOnly ? ' is-readonly' : ''}${
          api.dropIndex === index && api.dragIndex !== index ? ' is-drop' : ''
        }`}
        data-block-id={view.id}
        onDragOver={(event) => {
          if (api.dragIndex === null || api.dragIndex === index) return
          event.preventDefault()
          api.setDropIndex(index)
        }}
        onDrop={(event) => {
          event.preventDefault()
          api.onDropAt(index)
        }}
      >
        {readOnly ? (
          <div className="block__gutter" aria-hidden="true" />
        ) : (
          <div className="block__gutter">
            <button type="button" className="gutter-btn" onClick={() => api.remove(index)} aria-label="Delete divider">
              ×
            </button>
          </div>
        )}
        <hr className="block__rule" />
      </div>
    )
  }

  return (
    <div
      className={`block block--${view.type}${view.checked ? ' is-checked' : ''}${
        readOnly ? ' is-readonly' : ''
      }${api.dropIndex === index && api.dragIndex !== index ? ' is-drop' : ''}${
        api.dragIndex === index ? ' is-dragging' : ''
      }`}
      style={
        {
          marginLeft: `${view.indent * 22}px`,
          '--block-indent': `${view.indent * 22}px`,
        } as CSSProperties
      }
      data-block-id={view.id}
      onDragOver={(event) => {
        if (api.dragIndex === null || api.dragIndex === index) return
        event.preventDefault()
        api.setDropIndex(index)
      }}
      onDrop={(event) => {
        event.preventDefault()
        api.onDropAt(index)
      }}
    >
      {readOnly ? (
        <div className="block__gutter" aria-hidden="true" />
      ) : (
        <div className="block__gutter">
          <button
            type="button"
            className="gutter-btn gutter-btn--add"
            onClick={() => {
              const id = api.insertAfter(index, { type: 'text', text: '', indent: view.indent })
              api.requestFocus(id, 'start')
            }}
            aria-label="Add block below"
            title="Add block below"
          >
            +
          </button>
          <button
            type="button"
            className="gutter-btn gutter-btn--grip"
            draggable
            onClick={() => api.openFormat(view.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', view.id)
              api.setDropIndex(null)
              api.setDrag(index)
            }}
            onDragEnd={() => {
              api.setDrag(null)
              api.setDropIndex(null)
            }}
            aria-label="Block menu"
            title="Select to format · drag to reorder"
          >
            ⠿
          </button>
          <button
            type="button"
            className="gutter-btn gutter-btn--delete"
            onClick={() => api.remove(index)}
            aria-label="Delete block"
            title="Delete block"
          >
            ×
          </button>
        </div>
      )}

      {view.type === 'todo' ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={view.checked}
          className="todo__box"
          disabled={readOnly}
          onClick={() => {
            block.set('checked', !view.checked)
            onEdited()
          }}
          aria-label={view.checked ? 'Mark as not done' : 'Mark as done'}
        >
          {view.checked ? (
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M5 12.5l4.5 4.5L19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>
      ) : null}

      {view.type === 'bullet' ? (
        <span className="block__marker" aria-hidden="true">
          •
        </span>
      ) : null}

      {view.type === 'number' ? (
        <span className="block__marker block__marker--number" aria-hidden="true">
          {order ?? 1}.
        </span>
      ) : null}

      <div className="block__editor">
        {view.format.highlight && view.text ? (
          <div
            className={`block__highlight block__input block__input--${view.type}`}
            style={formatTextMetrics(view.format)}
            aria-hidden="true"
          >
            <span
              className="block__highlight-text"
              style={{ backgroundColor: view.format.highlight }}
            >
              {view.text}
            </span>
          </div>
        ) : null}

        <RemoteCarets
          textareaRef={textareaRef}
          text={view.text}
          peers={remoteCursors}
          metricsKey={`${view.type}:${formatSignature(view.format)}`}
        />

        <textarea
          ref={textareaRef}
          className={`block__input block__input--${view.type}`}
          style={formatTextStyle(view.format)}
          defaultValue={view.text}
          placeholder={readOnly ? undefined : placeholderFor(view.type)}
          rows={1}
          spellCheck
          inputMode={customKeyboard ? 'none' : undefined}
          data-onscreen-keyboard="block"
          readOnly={readOnly}
          aria-readonly={readOnly}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={(event) => {
            onFocusBlock(view.id, event.currentTarget.selectionEnd)
            if (api.slash && api.slash.blockId !== view.id) api.setSlash(null)
          }}
          onSelect={(event) => {
            if (document.activeElement === event.currentTarget) {
              onFocusBlock(view.id, event.currentTarget.selectionEnd)
            }
          }}
          onBlur={() => onFocusBlock(null)}
          aria-label={view.type === 'text' ? 'Note text' : `${view.type} block`}
        />
      </div>
    </div>
  )
}
