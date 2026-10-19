/*
 * Alerts on this computer (§287). A push from the server is shown as the
 * system's own notification; clicking it brings the app forward on the right
 * page — an open tab if there is one, a new one if not.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'New notification', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'New notification', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (new URL(tab.url).origin === new URL(url).origin && 'focus' in tab) {
          tab.focus();
          return 'navigate' in tab ? tab.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
