import { useEffect } from 'react'

/**
 * Keep a CSS variable in step with the space the native keyboard covers.
 *
 * iOS leaves the layout viewport at its full height and shrinks/pans the
 * visual viewport. Chrome may instead resize the content viewport. This measures
 * both cases, then the format tray and any other bottom-anchored UI can sit
 * directly above the keyboard.
 */
export function useNativeKeyboardInset() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const viewport = window.visualViewport
    let frame = 0

    const update = () => {
      frame = 0
      const inset =
        viewport && viewport.scale <= 1.01
          ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
          : 0
      root.style.setProperty('--keyboard-inset', `${inset}px`)
      root.classList.toggle('has-native-keyboard', inset > 80)
    }

    const schedule = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(update)
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      root.style.removeProperty('--keyboard-inset')
      root.classList.remove('has-native-keyboard')
    }
  }, [])
}
