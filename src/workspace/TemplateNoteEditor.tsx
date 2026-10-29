import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import * as Y from 'yjs'
import type { BlockType } from '../lib/types'
import { formatTime } from '../lib/notes'
import type { CustomTemplate, TemplateDraft } from '../lib/templates'
import {
  applyBlockFormat,
  blockArray,
  blockTextNode,
  blockView,
  blockViews,
  clearBlockFormat,
  createBlock,
  deleteBlock,
  moveBlock,
  seedDocument,
} from '../sync/noteModel'
import type { BlockFormat } from '../lib/formatting'
import {
  BlockRow,
  type BlockRowApi,
  type FocusRequest,
  type SlashState,
} from './BlockRow'
import { SlashMenu, filterSlash } from './SlashMenu'
import { FormatMenu } from './FormatMenu'
import { OnscreenKeyboard } from '../components/keyboard/OnscreenKeyboard'
import { useBlockKeyboard } from './useBlockKeyboard'

const NOOP = () => undefined

function buildDoc(template: CustomTemplate): Y.Doc {
  const doc = new Y.Doc()
  seedDocument(doc, {
    ownerId: 'template',
    title: template.title,
    tags: template.tags,
    due: null,
    blocks: template.blocks.length > 0 ? template.blocks : [{ type: 'text', text: '' }],
  })
  return doc
}

interface TemplateNoteEditorProps {
  template: CustomTemplate
  onSave: (id: string, draft: TemplateDraft) => Promise<void>
  onDone: () => void
}

/**
 * A template edited as a page rather than a form: the same block surface as a
 * note, wrapped in a ribbon that makes the template mode unmistakable.
 */
export function TemplateNoteEditor({ template, onSave, onDone }: TemplateNoteEditorProps) {
  const [doc] = useState(() => buildDoc(template))
  const blockKeyboard = useBlockKeyboard()
  const keyboardEnabled = blockKeyboard.enabled
  const openKeyboard = blockKeyboard.open
  const closeKeyboard = blockKeyboard.close
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [, bump] = useReducer((value: number) => value + 1, 0)
  const [name, setName] = useState(template.name)
  const [title, setTitle] = useState(template.title)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(template.updatedAt || null)
  const [error, setError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(() => {
    const first = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).type !== 'divider')
    return first ? blockView(first).id : null
  })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const surfaceRef = useRef<HTMLElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const undoRef = useRef<Y.UndoManager | null>(null)
  const nameRef = useRef(name)
  const titleRef = useRef(title)
  const dirtyRef = useRef(false)
  const runningSaveRef = useRef<Promise<boolean> | null>(null)
  const saveRef = useRef(onSave)

  useEffect(() => {
    nameRef.current = name
  }, [name])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    saveRef.current = onSave
  }, [onSave])

  const views = blockViews(doc)
  const activeView = views.find((view) => view.id === activeBlockId) ?? null
  const keyboardOpen =
    keyboardEnabled &&
    blockKeyboard.activeBlockId !== null &&
    blockKeyboard.activeBlockId === activeBlockId &&
    activeView !== null &&
    activeView.type !== 'divider'

  const orders: (number | null)[] = []
  const counters = [0, 0, 0, 0]
  for (const view of views) {
    if (view.type !== 'number') {
      counters.fill(0)
      orders.push(null)
      continue
    }
    counters[view.indent] += 1
    for (let deeper = view.indent + 1; deeper < 4; deeper += 1) counters[deeper] = 0
    orders.push(counters[view.indent])
  }

  useEffect(() => {
    const blocks = blockArray(doc)
    const handler = () => {
      bump()
      setVersion((value) => value + 1)
      setDirty(true)
    }
    blocks.observeDeep(handler)
    return () => blocks.unobserveDeep(handler)
  }, [doc])

  useEffect(() => {
    const manager = new Y.UndoManager(blockArray(doc), { captureTimeout: 350 })
    undoRef.current = manager
    return () => {
      manager.destroy()
      undoRef.current = null
    }
  }, [doc])

  const persist = useCallback((): Promise<boolean> => {
    if (runningSaveRef.current) return runningSaveRef.current

    const task = (async () => {
      const nextName = nameRef.current.trim()
      if (!nextName) {
        setError('Give this template a name before saving.')
        return false
      }
      setSaving(true)
      setError(null)
      try {
        await saveRef.current(template.id, {
          name: nextName.slice(0, 60),
          title: titleRef.current.trim().slice(0, 200),
          tags: template.tags,
          blocks: blockViews(doc).map(({ type, text, checked, indent, format }) => ({
            type,
            text,
            checked,
            indent,
            format,
          })),
        })
        setSavedAt(Date.now())
        setDirty(false)
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save this template.')
        return false
      } finally {
        setSaving(false)
      }
    })()

    runningSaveRef.current = task
    void task.finally(() => {
      if (runningSaveRef.current === task) runningSaveRef.current = null
    })
    return task
  }, [doc, template.id, template.tags])

  const persistRef = useRef(persist)
  useEffect(() => {
    persistRef.current = persist
  }, [persist])

  // Unmounting always keeps the latest edit, even without pressing Done.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void persistRef.current()
      doc.destroy()
    }
  }, [doc])

  // The page autosaves like a note, shortly after typing stops.
  useEffect(() => {
    if (!dirty || !name.trim()) return
    const timer = window.setTimeout(() => {
      void persist()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [dirty, version, name, title, persist])

  const requestFocus = useCallback((blockId: string, at: 'start' | 'end') => {
    setFocusRequest({ blockId, at, nonce: Date.now() })
  }, [])

  const refocusBlock = useCallback((blockId: string) => {
    window.requestAnimationFrame(() => {
      const row = [...(surfaceRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])].find(
        (element) => element.dataset.blockId === blockId,
      )
      row?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
    })
  }, [])

  const openFormat = useCallback(
    (blockId: string) => {
      setSlash(null)
      setActiveBlockId(blockId)
      if (keyboardEnabled) openKeyboard(blockId)
      refocusBlock(blockId)
    },
    [keyboardEnabled, openKeyboard, refocusBlock],
  )

  const dismissKeyboard = useCallback(() => {
    closeKeyboard()
    setKeyboardHeight(0)
  }, [closeKeyboard])

  const handleBlockFocus = useCallback(
    (blockId: string | null) => {
      if (!blockId) return
      setActiveBlockId(blockId)
      if (keyboardEnabled) openKeyboard(blockId)
    },
    [keyboardEnabled, openKeyboard],
  )

  useEffect(() => {
    if (!keyboardOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.osk')) return
      if (target.closest('.note__body textarea')) return
      dismissKeyboard()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [keyboardOpen, dismissKeyboard])

  useEffect(() => {
    if (!keyboardOpen || !blockKeyboard.activeBlockId || keyboardHeight <= 0) return
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-block-id="${blockKeyboard.activeBlockId}"]`,
      )
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [keyboardOpen, blockKeyboard.activeBlockId, keyboardHeight])

  const applyFormatType = (type: BlockType) => {
    if (!activeBlockId) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === activeBlockId)
    if (!target) return
    doc.transact(() => {
      target.set('type', type)
      target.set('checked', false)
    })
    refocusBlock(activeBlockId)
  }

  const changeFormatIndent = (delta: number) => {
    if (!activeBlockId) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === activeBlockId)
    if (!target) return
    const current = Number(target.get('indent')) || 0
    const next = Math.min(3, Math.max(0, current + delta))
    if (next !== current) target.set('indent', next)
    refocusBlock(activeBlockId)
  }

  const applyFormatStyle = (patch: Partial<BlockFormat>) => {
    if (!activeBlockId) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === activeBlockId)
    if (!target) return
    doc.transact(() => applyBlockFormat(target, patch))
    refocusBlock(activeBlockId)
  }

  const resetFormatStyle = () => {
    if (!activeBlockId) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === activeBlockId)
    if (!target) return
    doc.transact(() => clearBlockFormat(target))
    refocusBlock(activeBlockId)
  }

  const pickCommand = (type: BlockType) => {
    if (!slash) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === slash.blockId)
    if (!target) return
    const text = blockTextNode(target)
    text.delete(0, text.length)
    target.set('type', type)
    target.set('checked', false)
    const id = blockView(target).id
    setSlash(null)
    window.requestAnimationFrame(() => requestFocus(id, 'start'))
  }

  const api: BlockRowApi = {
    insertAfter: (index, seed) => blockView(createBlock(doc, index + 1, seed)).id,
    remove: (index) => {
      const blocks = blockArray(doc)
      const fallback = blocks.length > 1 ? blocks.get(Math.max(0, index - 1)) : null
      const fallbackId = fallback ? blockView(fallback).id : null
      deleteBlock(doc, index)
      if (fallbackId) {
        window.requestAnimationFrame(() => requestFocus(fallbackId, 'end'))
      }
    },
    move: (from, to) => moveBlock(doc, from, to),
    requestFocus,
    clearFocus: () => setFocusRequest(null),
    setSlash: (next) => setSlash(next),
    slash,
    onPickCommand: pickCommand,
    openFormat: (blockId) => openFormat(blockId),
    setDrag: setDragIndex,
    dragIndex,
    dropIndex,
    setDropIndex,
    onDropAt: (index) => {
      if (dragIndex === null) return
      const target = dragIndex < index ? index - 1 : index
      moveBlock(doc, dragIndex, target)
      setDragIndex(null)
      setDropIndex(null)
    },
  }

  const onUndoKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    const manager = undoRef.current
    if (!manager) return
    event.preventDefault()
    if (key === 'y' || event.shiftKey) manager.redo()
    else manager.undo()
  }

  const done = async () => {
    if (!name.trim()) {
      setError('Give this template a name.')
      nameInputRef.current?.focus()
      return
    }
    const ok = await persist()
    if (ok) onDone()
  }

  const status = !name.trim()
    ? 'Name required'
    : saving
      ? 'Saving…'
      : error
        ? 'Not saved'
        : dirty
          ? 'Unsaved changes'
          : 'Saved'

  return (
    <section
      ref={surfaceRef}
      className={`note note--template${keyboardOpen ? ' has-keyboard' : ''}`}
      style={
        keyboardOpen
          ? ({ '--kb-height': `${keyboardHeight}px` } as CSSProperties)
          : undefined
      }
      aria-label="Template editor"
      onKeyDown={onUndoKeys}
    >
      <header className="template-ribbon">
        <div className="template-ribbon__row">
          <span className="template-ribbon__badge">✦ Template</span>
          <label className="template-ribbon__name">
            <span className="template-ribbon__label">Name</span>
            <input
              ref={nameInputRef}
              value={name}
              maxLength={60}
              required
              aria-required="true"
              aria-label="Template name"
              onChange={(event) => {
                setName(event.target.value)
                nameRef.current = event.target.value
                setDirty(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  titleInputRef.current?.focus()
                }
              }}
            />
          </label>
          <span
            className={`template-ribbon__status${
              !name.trim() || error ? ' template-ribbon__status--error' : ''
            }`}
            role="status"
            aria-live="polite"
          >
            {status}
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void done()}>
            Done
          </button>
        </div>
        <p className="template-ribbon__hint">
          This is the starting point for new notes. Notes you already made stay exactly as they
          are.
        </p>
        {error ? (
          <p className="template-ribbon__error" role="alert">
            {error}
          </p>
        ) : null}
      </header>

      <div className="note__bar">
        <div className="note__crumb">
          <span className="mono note__date">Template</span>
          <span className="note__sep" aria-hidden="true" />
          <span className="note__role">
            {views.length} {views.length === 1 ? 'block' : 'blocks'} · edits autosave
          </span>
        </div>
      </div>

      {!keyboardEnabled && activeView && activeView.type !== 'divider' ? (
        <div className="note__format-dock">
          <FormatMenu
            mode="docked"
            type={activeView.type}
            indent={activeView.indent}
            format={activeView.format}
            onType={applyFormatType}
            onIndent={changeFormatIndent}
            onFormat={applyFormatStyle}
            onReset={resetFormatStyle}
          />
        </div>
      ) : null}

      <div className="note__scroll">
        <div className="note__title-wrap">
          <input
            ref={titleInputRef}
            className="note__title"
            value={title}
            maxLength={200}
            placeholder="Add a starting title"
            aria-label="Title given to new notes"
            onChange={(event) => {
              setTitle(event.target.value)
              titleRef.current = event.target.value
              setDirty(true)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const first = blockArray(doc).get(0)
              if (first) requestFocus(blockView(first).id, 'start')
              else titleInputRef.current?.blur()
            }}
          />

          <div className="note__meta">
            <div className="template-tags">
              <span className="template-tags__label">Tags for new notes</span>
              <div className="tag-row">
                {template.tags.length > 0 ? (
                  template.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="template-ribbon__tags-empty">
                    No tags are copied into new notes.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="note__body">
          {views.map((view, index) => (
            <BlockRow
              key={view.id}
              doc={doc}
              block={blockArray(doc).get(index)}
              index={index}
              order={orders[index]}
              focusRequest={focusRequest}
              remoteCursors={[]}
              api={api}
              onEdited={NOOP}
              onFocusBlock={handleBlockFocus}
              customKeyboard={keyboardEnabled}
              registerKeyboard={blockKeyboard.register}
            />
          ))}
          <button
            type="button"
            className="block-add"
            onClick={() => {
              const block = createBlock(doc, views.length, { type: 'text', text: '' })
              requestFocus(blockView(block).id, 'start')
            }}
          >
            + Add block
          </button>
        </div>

        <footer className="note__footer">
          <span>{views.length} blocks</span>
          <span className="note__footer-sep" aria-hidden="true">
            ·
          </span>
          <span>{savedAt ? `Saved ${formatTime(savedAt)}` : 'Not saved yet'}</span>
          <span className="note__footer-right">Template · autosaves</span>
        </footer>
      </div>

      {keyboardOpen ? (
        <OnscreenKeyboard
          label={activeView ? `${activeView.type} block` : 'Template'}
          formatBar={
            activeView ? (
              <FormatMenu
                mode="keyboard"
                type={activeView.type}
                indent={activeView.indent}
                format={activeView.format}
                onType={applyFormatType}
                onIndent={changeFormatIndent}
                onFormat={applyFormatStyle}
                onReset={resetFormatStyle}
              />
            ) : undefined
          }
          onInsert={blockKeyboard.insert}
          onBackspace={blockKeyboard.backspace}
          onReturn={blockKeyboard.newline}
          onMoveCaret={blockKeyboard.moveCaret}
          onUndo={() => undoRef.current?.undo()}
          onRedo={() => undoRef.current?.redo()}
          onDismiss={dismissKeyboard}
          onKeepFocus={blockKeyboard.refocus}
          onHeightChange={setKeyboardHeight}
        />
      ) : null}

      {slash ? (
        <SlashMenu
          items={filterSlash(slash.query)}
          active={slash.index}
          top={slash.top}
          left={slash.left}
          onPick={pickCommand}
        />
      ) : null}
    </section>
  )
}
