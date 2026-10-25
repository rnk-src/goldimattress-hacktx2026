// Lets the app open with no network after one visit. Plain JS: it runs in the worker, outside the Vite build.
// shortcut: bump CACHE when this file's strategy changes; the hashed asset names change on their own.
const CACHE = 'goldimattress-v1';

const shellUrl = () => new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const page = await fetch(shellUrl());
      const html = await page.text();
      // The assets are named in the page, so they can be stored now instead of waiting for a second visit.
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], shellUrl()))
        .filter((url) => url.origin === self.location.origin)
        .map((url) => url.href);
      await cache.addAll([...new Set([shellUrl(), ...assets])]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

/** The page comes from the network so a new deploy shows up, and from the cache when offline. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const stored = (await cache.match(request)) ?? (await cache.match(shellUrl()));
    if (stored) return stored;
    throw error;
  }
}

/** Built assets carry a content hash in their name, so a stored copy never goes stale. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const stored = await cache.match(request);
  if (stored) return stored;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
