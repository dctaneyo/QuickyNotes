const CACHE = 'quicky-shell-v5'
// Icons and the manifest stay network-first: a cached icon can keep the old
// Home Screen artwork even after the page itself has updated.
const PRECACHE = []

async function cacheResponse(cache, request, response) {
  if (response.ok) await cache.put(request, response)
}

async function precacheShell() {
  const cache = await caches.open(CACHE)

  for (const path of PRECACHE) {
    try {
      const response = await fetch(path, { cache: 'reload' })
      await cacheResponse(cache, path, response)
    } catch {
      // A missing optional asset must not stop the worker from installing.
    }
  }

  try {
    const response = await fetch('/index.html', { cache: 'reload' })
    if (!response.ok) return
    const html = await response.clone().text()
    await cache.put('/index.html', response.clone())
    await cache.put('/', response.clone())

    // Vite's asset names are hashed, so learn the current shell from index.html.
    const assets = new Set()
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
      assets.add(match[1])
    }
    await Promise.all(
      [...assets].map(async (url) => {
        try {
          const asset = await fetch(url, { cache: 'reload' })
          await cacheResponse(cache, url, asset)
        } catch {
          // The runtime cache will fill this in on the next successful load.
        }
      }),
    )
  } catch {
    // Offline install is best-effort; normal network loading still works.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws/') ||
    url.pathname === '/healthz'
  ) {
    return
  }

  // Never serve an older icon or manifest from Cache Storage. iOS keeps its own
  // Home Screen icon cache, so a stale response here makes the problem worse.
  if (
    url.pathname.startsWith('/app-icons/') ||
    url.pathname.startsWith('/apple-touch-icon') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const cache = await caches.open(CACHE)
            await cache.put('/index.html', response.clone())
          }
          return response
        } catch {
          const cached = await caches.match('/index.html')
          return (
            cached ||
            new Response('Quicky Notes is offline. Reconnect once to cache the app.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  const isAsset =
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|png|svg|ico|woff2?)$/.test(url.pathname)
  if (!isAsset) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) {
        // Refresh in the background so the next launch has current assets.
        void fetch(request)
          .then(async (response) => {
            if (!response.ok) return
            const cache = await caches.open(CACHE)
            await cache.put(request, response.clone())
          })
          .catch(() => {})
        return cached
      }

      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        return new Response('', { status: 503, statusText: 'Offline' })
      }
    })(),
  )
})
