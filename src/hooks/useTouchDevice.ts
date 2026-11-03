import { useEffect, useState } from 'react'

export const TOUCH_DEVICE_QUERY =
  '(pointer: coarse), (any-pointer: coarse) and (max-width: 1180px)'

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(TOUCH_DEVICE_QUERY).matches
}

export function useTouchDevice(): boolean {
  const [touch, setTouch] = useState(isTouchDevice)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia(TOUCH_DEVICE_QUERY)
    const update = () => setTouch(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return touch
}
