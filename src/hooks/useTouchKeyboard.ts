import { useEffect, useState } from 'react'

export const TOUCH_KEYBOARD_QUERY =
  '(pointer: coarse), (any-pointer: coarse) and (max-width: 1180px)'

export function isTouchKeyboardDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(TOUCH_KEYBOARD_QUERY).matches
}

export function useTouchKeyboardDevice(): boolean {
  const [enabled, setEnabled] = useState(isTouchKeyboardDevice)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia(TOUCH_KEYBOARD_QUERY)
    const update = () => setEnabled(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return enabled
}
