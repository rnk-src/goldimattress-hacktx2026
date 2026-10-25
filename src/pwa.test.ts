import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');

type Listener = (event: Record<string, unknown>) => void;

/** Runs public/sw.js against in-memory fakes for the worker globals, the cache store and the network. */
type Reply = { ok: boolean; text: () => Promise<string>; clone: () => unknown };
type Init = { cache?: string } | undefined;

class FakeRequest {
  constructor(
    public url: string,
    public init?: Init,
  ) {}
}

function loadWorker(fetchUrl: (url: string, init?: Init) => Promise<Reply>, version = 'abc') {
  // The worker may pass a URL string or a Request; the fakes only care about the address and the cache mode.
  const network = (input: string | FakeRequest, init?: Init) =>
    typeof input === 'string' ? fetchUrl(input, init) : fetchUrl(input.url, init ?? input.init);
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, unknown>>();
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (req: { url: string } | string, res: unknown) => void store.set(typeof req === 'string' ? req : req.url, res),
      match: async (req: { url: string } | string) => store.get(typeof req === 'string' ? req : req.url),
      addAll: async (requests: (string | FakeRequest)[]) => {
        // Like the real one: one reply that is not ok fails the whole call.
        for (const request of requests) {
          const reply = await network(request);
          if (!reply.ok) throw new Error('bad reply');
          store.set(typeof request === 'string' ? request : request.url, reply);
        }
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
    location: { origin: 'https://example.github.io', href: `https://example.github.io/app/sw.js?v=${version}` },
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  new Function('self', 'caches', 'fetch', 'URL', 'Request', 'setTimeout', read('public/sw.js'))(self, caches, network, URL, FakeRequest, setTimeout);
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
const notFound = (): Reply => ({ ok: false, text: async () => '', clone: () => notFound() });

describe('manifest', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;

  it('opens full screen from the repository path, with a name and an icon', () => {
    expect(manifest.name).toBe('GoldiMattress');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons).toEqual([expect.objectContaining({ src: 'icon.svg', type: 'image/svg+xml' })]);
  });

  it('is linked from the page to a file that is served', () => {
    const href = /rel="manifest" href="\/([^"]+)"/.exec(read('index.html'))?.[1];
    expect(href).toBeDefined();
    expect(existsSync(`${root}public/${href}`)).toBe(true);
  });
});

afterEach(() => {
  vi.useRealTimers();
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
    const worker = loadWorker(async (url) => (url.endsWith('/app/') ? ok(page) : ok(url.endsWith('index.html') ? INDEX : 'x')));
    await worker.dispatch('install', {});
    const request = { method: 'GET', url: 'https://example.github.io/app/', mode: 'navigate' };
    await worker.dispatch('fetch', { request }); // a first visit stores the page under its own address
    page = 'new';

    const event = await worker.dispatch('fetch', { request });

    expect(await (event.result as { text: () => Promise<string> }).text()).toBe('new');
  });

  it('asks the server whether the page changed, so the browser HTTP cache cannot serve an old deploy', async () => {
    const modes: (string | undefined)[] = [];
    const worker = loadWorker(async (url, init) => {
      if (url.endsWith('/app/')) modes.push(init?.cache);
      return ok(url.endsWith('index.html') ? INDEX : 'page');
    });
    await worker.dispatch('install', {});

    await worker.dispatch('fetch', { request: { method: 'GET', url: 'https://example.github.io/app/', mode: 'navigate' } });

    expect(modes).toEqual(['no-cache']);
  });

  it('shows the stored page when the network is slower than three seconds', async () => {
    vi.useFakeTimers();
    let slow = false;
    const worker = loadWorker((url) => {
      if (slow && url.endsWith('/app/')) return new Promise(() => undefined);
      return Promise.resolve(ok(url.endsWith('index.html') ? INDEX : 'stored page'));
    });
    await worker.dispatch('install', {});
    const request = { method: 'GET', url: 'https://example.github.io/app/', mode: 'navigate' };
    await worker.dispatch('fetch', { request });
    slow = true;

    const pending = worker.dispatch('fetch', { request });
    await vi.advanceTimersByTimeAsync(3_000);
    const event = await pending;

    expect(await (event.result as { text: () => Promise<string> }).text()).toBe('stored page');
  });

  it('does not store an asset the server could not find, but still returns the reply', async () => {
    const worker = loadWorker(async (url) => (url.endsWith('index.html') ? ok(INDEX) : url.includes('missing') ? notFound() : ok('asset')));
    await worker.dispatch('install', {});
    const request = { method: 'GET', url: 'https://example.github.io/app/assets/missing.js', mode: 'no-cors' };

    const event = await worker.dispatch('fetch', { request });

    expect((event.result as Reply).ok).toBe(false);
    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).not.toContain(request.url);
  });

  it('fails to install, and so is retried, when an asset cannot be fetched', async () => {
    const worker = loadWorker(async (url) => (url.endsWith('index.html') ? ok(INDEX) : notFound()));

    await expect(worker.dispatch('install', {})).rejects.toThrow();
  });

  it('fetches the page and its assets past the browser HTTP cache when it installs', async () => {
    const modes: Record<string, string | undefined> = {};
    const worker = loadWorker(async (url, init) => {
      modes[url] = init?.cache;
      return ok(url.endsWith('index.html') ? INDEX : 'asset');
    });

    await worker.dispatch('install', {});

    expect(modes['https://example.github.io/app/index.html']).toBe('reload');
    expect(modes['https://example.github.io/app/assets/index-abc.js']).toBe('reload');
  });

  it('names its cache after the build, so a new deploy starts a new cache and removes the old one', async () => {
    const first = loadWorker(async (url) => ok(url.endsWith('index.html') ? INDEX : 'asset'), 'build1');
    await first.dispatch('install', {});
    expect([...first.stores.keys()]).toEqual(['goldimattress-build1']);

    const second = loadWorker(async (url) => ok(url.endsWith('index.html') ? INDEX : 'asset'), 'build2');
    second.stores.set('goldimattress-build1', new Map());
    await second.dispatch('install', {});
    await second.dispatch('activate', {});

    expect([...second.stores.keys()]).toEqual(['goldimattress-build2']);
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
