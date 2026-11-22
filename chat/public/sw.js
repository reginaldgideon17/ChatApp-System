/* Morphues service worker: shows push notifications, even when the site is closed. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Morphues', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      // If the person is looking at the app right now, the page handles it itself.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((c) => c.visibilityState === 'visible' && c.focused)) return;

      await self.registration.showNotification(data.title || 'Morphues', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        data: { url: data.url || '/chat' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/chat';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
