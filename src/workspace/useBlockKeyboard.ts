import { useCallback, useRef, useState } from 'react'
import { useTouchKeyboardDevice } from '../hooks/useTouchKeyboard'

/**
 * The block editor keeps the real textarea focused. These operations let the
 * onscreen board edit that textarea while the native keyboard stays hidden.
 */
export interface BlockKeyboardController {
  insert: (text: string) => void
  backspace: () => void
  newline: () => void
  moveCaret: (delta: number) => void
  /** Put the caret back after a keyboard button was focused. */
  refocus: () => void
  blur: () => void
}

/**
 * Registers each block's keyboard operations and tracks which block owns the
 * board. Only touch devices use the custom keyboard; a mouse-driven desktop
 * keeps the regular textarea and native keyboard.
 */
export function useBlockKeyboard() {
  const enabled = useTouchKeyboardDevice()
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const controllers = useRef(new Map<string, BlockKeyboardController>())

  const register = useCallback((blockId: string, controller: BlockKeyboardController | null) => {
    if (controller) controllers.current.set(blockId, controller)
    else controllers.current.delete(blockId)
  }, [])

  const open = useCallback(
    (blockId: string) => {
      if (enabled) setActiveBlockId(blockId)
    },
    [enabled],
  )

  const close = useCallback(() => {
    if (activeBlockId) controllers.current.get(activeBlockId)?.blur()
    setActiveBlockId(null)
  }, [activeBlockId])

  const insert = useCallback(
    (text: string) => {
      if (activeBlockId) controllers.current.get(activeBlockId)?.insert(text)
    },
    [activeBlockId],
  )

  const backspace = useCallback(() => {
    if (activeBlockId) controllers.current.get(activeBlockId)?.backspace()
  }, [activeBlockId])

  const newline = useCallback(() => {
    if (activeBlockId) controllers.current.get(activeBlockId)?.newline()
  }, [activeBlockId])

  const moveCaret = useCallback(
    (delta: number) => {
      if (activeBlockId) controllers.current.get(activeBlockId)?.moveCaret(delta)
    },
    [activeBlockId],
  )

  const refocus = useCallback(() => {
    if (activeBlockId) controllers.current.get(activeBlockId)?.refocus()
  }, [activeBlockId])

  return {
    enabled,
    activeBlockId,
    register,
    open,
    close,
    insert,
    backspace,
    newline,
    moveCaret,
    refocus,
  }
}
