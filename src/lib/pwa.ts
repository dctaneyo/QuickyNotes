/** iPadOS reports a desktop Mac user agent, so touch points are the giveaway. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return (
    window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
  )
}

/**
 * The app shell is only cached in production. Vite's dev server should always
 * serve the newest modules instead of a service worker's saved copy.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('[quicky] service worker registration failed', error)
    })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
