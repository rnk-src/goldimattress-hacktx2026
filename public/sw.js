// Lets the app open with no network after one visit. Plain JS: it runs in the worker, outside the Vite build.
// The page registers it as sw.js?v=<build id>, so every deploy is a new worker with its own cache, and the old
// caches are removed when it activates.
const CACHE = `goldimattress-${new URL(self.location.href).searchParams.get('v') ?? 'dev'}`;
/** A page that has not answered by now is shown from the cache instead, so a weak signal does not hang the app. */
const NAVIGATION_WAIT_MS = 3_000;

const shellUrl = () => new URL('./index.html', self.location.href).href;
/** Past the browser's HTTP cache, which may still hold the previous deploy's page for minutes. */
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const page = await fetch(fresh(shellUrl()));
      if (!page.ok) throw new Error('The page could not be fetched');
      const html = await page.text();
      // The assets are named in the page, so they can be stored now instead of waiting for a second visit.
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], shellUrl()))
        .filter((url) => url.origin === self.location.origin)
        .map((url) => url.href);
      // addAll fails on any reply that is not ok, so the worker only installs once the whole app is stored.
      await cache.addAll([...new Set([shellUrl(), ...assets])].map(fresh));
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

/** The page comes from the network so a new deploy shows up, and from the cache when offline or slow. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const stored = (await cache.match(request)) ?? (await cache.match(shellUrl()));
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (!stored) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(stored), NAVIGATION_WAIT_MS));
  return Promise.race([network.catch(() => stored), slow]);
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
