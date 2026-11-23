/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Qualquer rota abre o index.html guardado (abre rápido mesmo com internet fraca).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// Fotos do cardápio
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' && (url.hostname === 'firebasestorage.googleapis.com' || url.hostname === 'storage.googleapis.com'),
  new CacheFirst({
    cacheName: 'menu-photos',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ---------- Avisos dos chamados (Firebase Cloud Messaging, mensagens de dados) ----------
type PushData = { title?: string; body?: string; url?: string; tag?: string; renotify?: string }

self.addEventListener('push', (event) => {
  let data: PushData = {}
  try {
    const payload = event.data?.json() as { data?: PushData; notification?: PushData } | undefined
    data = { ...payload?.notification, ...payload?.data }
  } catch {
    data = { body: event.data?.text() }
  }
  const url = data.url?.startsWith('/') && !data.url.startsWith('//') ? data.url : '/garcom'
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: data.body ?? '',
    icon: '/icons/icon-192.png',
    // Ícone da barra de notificações do Android: só a forma, em branco sobre fundo transparente.
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag && data.renotify === '1',
    vibrate: data.renotify === '1' ? [300, 120, 300, 120, 300] : undefined,
    requireInteraction: data.renotify === '1',
    data: { url },
  }
  event.waitUntil(self.registration.showNotification(data.title || 'MA Beach', options))
})

// Toque no aviso: abre (ou traz para frente) o painel dos chamados.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data?.url as string) || '/garcom', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        return open.navigate(url)
      }
      return self.clients.openWindow(url)
    })(),
  )
})
