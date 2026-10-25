import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');

type Listener = (event: Record<string, unknown>) => void;

/** Runs public/sw.js against in-memory fakes for the worker globals, the cache store and the network. */
type Reply = { ok: boolean; text: () => Promise<string>; clone: () => unknown };

function loadWorker(fetchUrl: (url: string) => Promise<Reply>) {
  // The worker may pass a URL string or a Request; the fakes only care about the address.
  const network = (input: string | { url: string }) => fetchUrl(typeof input === 'string' ? input : input.url);
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, unknown>>();
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (req: { url: string } | string, res: unknown) => void store.set(typeof req === 'string' ? req : req.url, res),
      match: async (req: { url: string } | string) => store.get(typeof req === 'string' ? req : req.url),
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(url, await network(url));
      },
    };
  };
  const caches = {
    open: async (name: string) => cacheOf(name),
    match: async (req: { url: string } | string) => {
      for (const store of stores.values()) {
        const hit = store.get(typeof req === 'string' ? req : req.url);
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: { origin: 'https://example.github.io', href: 'https://example.github.io/app/sw.js' },
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  new Function('self', 'caches', 'fetch', 'URL', read('public/sw.js'))(self, caches, network, URL);
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => (pending = p),
      respondWith: (p: Promise<unknown>) => (pending = Promise.resolve(p).then((value) => ((event as { result?: unknown }).result = value))),
    });
    await pending;
    return event;
  };
  return { stores, dispatch, listeners };
}

const INDEX = '<script type="module" src="/app/assets/index-abc.js"></script><link rel="stylesheet" href="/app/assets/index-abc.css">';
const ok = (body: string) => ({ ok: true, text: async () => body, clone: () => ok(body) });

describe('manifest', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;

  it('opens full screen from the repository path, with a name and an icon', () => {
    expect(manifest.name).toBe('GoldiMattress');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons).toEqual([expect.objectContaining({ src: 'icon.svg', type: 'image/svg+xml' })]);
  });

  it('is linked from the page', () => {
    expect(read('index.html')).toContain('rel="manifest"');
  });
});

describe('service worker', () => {
  it('stores the page and the assets it names when it installs, so the app opens offline', async () => {
    const worker = loadWorker(async (url) => ok(url.endsWith('index.html') ? INDEX : 'asset'));

    await worker.dispatch('install', {});

    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).toContain('https://example.github.io/app/index.html');
    expect(cached).toContain('https://example.github.io/app/assets/index-abc.js');
    expect(cached).toContain('https://example.github.io/app/assets/index-abc.css');
  });

  it('opens a page from the cache when the network is down', async () => {
    let offline = false;
    const worker = loadWorker(async (url) => {
      if (offline) throw new Error('offline');
      return ok(url.endsWith('index.html') ? INDEX : 'asset');
    });
    await worker.dispatch('install', {});
    offline = true;
    const request = { method: 'GET', url: 'https://example.github.io/app/', mode: 'navigate' };

    const event = await worker.dispatch('fetch', { request });

    expect(event.result).toBeDefined();
  });

  it('prefers the network for the page, so a new deploy shows up', async () => {
    let page = 'old';
    const worker = loadWorker(async (url) => (url.endsWith('index.html') || url.endsWith('/app/') ? ok(page) : ok('x')));
    await worker.dispatch('install', {});
    page = 'new';
    const request = { method: 'GET', url: 'https://example.github.io/app/', mode: 'navigate' };

    const event = await worker.dispatch('fetch', { request });

    expect(await (event.result as { text: () => Promise<string> }).text()).toBe('new');
  });

  it('serves a stored asset without touching the network', async () => {
    let calls = 0;
    const worker = loadWorker(async (url) => {
      calls += url.endsWith('index-abc.js') ? 1 : 0;
      return ok(url.endsWith('index.html') ? INDEX : 'asset');
    });
    await worker.dispatch('install', {});
    calls = 0;
    const request = { method: 'GET', url: 'https://example.github.io/app/assets/index-abc.js', mode: 'no-cors' };

    const event = await worker.dispatch('fetch', { request });

    expect(event.result).toBeDefined();
    expect(calls).toBe(0);
  });

  it('ignores other sites and non-GET requests', async () => {
    const worker = loadWorker(async () => ok(INDEX));
    await worker.dispatch('install', {});

    const other = await worker.dispatch('fetch', { request: { method: 'GET', url: 'https://other.example/x.js', mode: 'no-cors' } });
    const post = await worker.dispatch('fetch', { request: { method: 'POST', url: 'https://example.github.io/app/x', mode: 'no-cors' } });

    expect(other.result).toBeUndefined();
    expect(post.result).toBeUndefined();
  });

  it('removes caches left by an older version when it activates', async () => {
    const worker = loadWorker(async () => ok(INDEX));
    await worker.dispatch('install', {});
    worker.stores.set('goldimattress-old', new Map());

    await worker.dispatch('activate', {});

    expect([...worker.stores.keys()]).not.toContain('goldimattress-old');
    expect(worker.stores.size).toBe(1);
  });
});
