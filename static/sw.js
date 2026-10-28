// Monoglarket service worker (vault "Mobile experience"): installable (FR-28) and a read-only offline view (FR-29).
// Pages come from the network when it works and are saved as the member opens them. Offline, the saved copy is shown.
// Writes (trades, comments, sign-in) are never cached or queued: they only ever go to the network, so nothing waits to be sent.
// Saved pages hold one member's data, so they're deleted when that member signs out.
const CACHE = 'club-pages-v1';
const MAX_PAGES = 60;
const SHELL = ['/manifest.webmanifest', '/sse-logo-mark.v3.svg'];
const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>' +
  '<p style="font-family:system-ui;margin:24px">You are offline, and this page was not saved on this device yet. Reconnect to see it.</p>';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes go to the network only
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Build output is named by content hash, so a copy never goes stale.
  if (url.pathname.startsWith('/_app/immutable/')) event.respondWith(cacheFirst(req));
  else if (req.mode === 'navigate') event.respondWith(networkFirstPage(req));
});

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await c.put(req, res.clone());
  return res;
}

async function networkFirstPage(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      await c.put(req, res.clone());
      await trim(c);
    }
    return res;
  } catch {
    return (await c.match(req)) || new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html;charset=utf-8' } });
  }
}

/** Keeps the newest pages only, so the phone's storage doesn't fill up. */
async function trim(c) {
  const keys = await c.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await c.delete(old);
}

self.addEventListener('message', (event) => {
  if (event.data === 'signed-out') event.waitUntil(caches.delete(CACHE));
});

// Web push alerts (FR-20): show the alert, and open its market when it's tapped.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Monoglarket', { body: data.body || '', icon: '/sse-logo-mark.v3.svg', data: { url: data.url || '/notifications' } }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/notifications'));
});
