/**
 * The mobile channel's receiver: a push from the server becomes a system
 * notification, and tapping it opens the floor it names. Registered on demand
 * when a Mobile toggle is switched on (AccountDialog); browsers keep the
 * registration after that, so pushes arrive with every tab closed.
 */
self.addEventListener('push', event => {
  let payload = { title: 'Telarchy', body: '', url: '/' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // A payload that does not parse still deserves a notification shell.
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/logo-mark.png',
    badge: '/logo-mark.png',
    data: { url: payload.url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) { client.navigate(url); return client.focus(); }
    }
    return clients.openWindow(url);
  }));
});
