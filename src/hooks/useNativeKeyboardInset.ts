import { useEffect } from 'react'

/**
 * Keep a CSS variable in step with the space the native keyboard covers.
 *
 * iOS leaves the layout viewport at its full height and shrinks/pans the
 * visual viewport. Chrome may instead resize the content viewport. This measures
 * both cases, then the format tray and any other bottom-anchored UI can sit
 * directly above the keyboard.
 */

// Safari can finish its keyboard animation without firing another viewport
// event, so sample through the animation and the delayed update that follows it.
const SETTLE_DELAYS = [30, 100, 220, 400, 650, 950, 1300, 1800]

export function useNativeKeyboardInset() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const viewport = window.visualViewport
    const userAgent = navigator.userAgent
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const isIosSafari =
      /iPhone|iPod/.test(userAgent) &&
      /Safari/.test(userAgent) &&
      !/(CriOS|FxiOS|EdgiOS|OPiOS|OPT\/)/.test(userAgent) &&
      !standalone
    let frame = 0
    let timers: number[] = []

    // iOS 26 Safari floats its address pill inside the visual viewport, above
    // the native keyboard. No viewport measurement includes that browser UI, so
    // the stylesheet reserves room for it only on an iPhone in Safari.
    if (isIosSafari) root.classList.add('is-ios-safari')

    const measure = () => {
      if (!viewport || viewport.scale > 1.01) return 0
      return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    }

    const apply = () => {
      const inset = measure()
      const value = `${inset}px`
      if (root.style.getPropertyValue('--keyboard-inset') !== value) {
        root.style.setProperty('--keyboard-inset', value)
      }
      const open = inset > 80
      if (root.classList.contains('has-native-keyboard') !== open) {
        root.classList.toggle('has-native-keyboard', open)
      }
    }

    const update = () => {
      frame = 0
      apply()
    }

    const schedule = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(update)
    }

    const clearSettle = () => {
      for (const timer of timers) window.clearTimeout(timer)
      timers = []
    }

    /**
     * Measure immediately, then keep checking while the keyboard settles.
     * Focus changes are the reliable signal that the native keyboard is about
     * to open or close; the visual viewport can update after that event.
     */
    const settle = () => {
      schedule()
      clearSettle()
      for (const delay of SETTLE_DELAYS) {
        timers.push(window.setTimeout(apply, delay))
      }
    }

    // Scrolling can pan Safari's visual viewport without a resize event.
    const onScroll = () => schedule()

    update()
    viewport?.addEventListener('resize', settle)
    viewport?.addEventListener('scroll', onScroll)
    window.addEventListener('resize', settle)
    window.addEventListener('orientationchange', settle)
    window.addEventListener('pageshow', settle)
    window.addEventListener('focusin', settle)
    window.addEventListener('focusout', settle)
    window.addEventListener('scroll', onScroll)
    document.addEventListener('scroll', onScroll, true)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      clearSettle()
      viewport?.removeEventListener('resize', settle)
      viewport?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', settle)
      window.removeEventListener('orientationchange', settle)
      window.removeEventListener('pageshow', settle)
      window.removeEventListener('focusin', settle)
      window.removeEventListener('focusout', settle)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('scroll', onScroll, true)
      root.style.removeProperty('--keyboard-inset')
      root.classList.remove('has-native-keyboard', 'is-ios-safari')
    }
  }, [])
}
