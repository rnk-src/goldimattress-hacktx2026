import type { Person, Surface, TestRecord } from '../../domain';
import { decodePerson, decodeTest, encodePerson, encodeTest } from './codec';
import { readStored } from './migrate';
import type { StoredData } from './migrate';
import type { Store, StorageLike } from './types';

interface Data {
  people: Person[];
  surfaces: Surface[];
  tests: TestRecord[];
}

/** Thrown by a save when the browser's storage quota is used up. Nothing is written. */
export class StoreFullError extends Error {
  constructor(options?: ErrorOptions) {
    super('Storage is full', options);
    this.name = 'StoreFullError';
  }
}

/** Browsers name the quota error differently: Chrome and Safari by name, old Firefox by code. */
const isQuotaError = (e: unknown): boolean => {
  const { name, code } = (e ?? {}) as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22;
};

const KEY = 'goldimattress';

/** Replaces the entry with the same id in place, or appends. */
function upsert<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

/**
 * Keeps everything in one storage value and rewrites it on each save.
 * shortcut: rewrite-all is fine for ~100 tests, split into per-test keys if saves get slow.
 */
export function createLocalStore(storage: StorageLike = localStorage): Store {
  const load = (): Data => {
    const stored = readStored(storage.getItem(KEY));
    return {
      people: stored.people.map(decodePerson),
      surfaces: stored.surfaces,
      tests: stored.tests.map(decodeTest),
    };
  };
  const save = (data: Data) => {
    const stored: StoredData = {
      version: 2,
      people: data.people.map(encodePerson),
      surfaces: data.surfaces,
      tests: data.tests.map(encodeTest),
    };
    try {
      storage.setItem(KEY, JSON.stringify(stored));
    } catch (e) {
      throw isQuotaError(e) ? new StoreFullError({ cause: e }) : e;
    }
  };
  const change = async (edit: (data: Data) => void) => {
    const data = load();
    edit(data);
    save(data);
  };

  return {
    listPeople: async () => load().people,
    savePerson: (p) => change((d) => upsert(d.people, p)),
    findSurfaces: async (prefix) => {
      const p = prefix.toLowerCase();
      return load()
        .surfaces.filter((s) => s.name.toLowerCase().startsWith(p))
        .reverse();
    },
    saveSurface: (s) => change((d) => upsert(d.surfaces, s)),
    saveTest: (t) => change((d) => upsert(d.tests, t)),
    listTests: async (filter = {}) =>
      load()
        .tests.filter(
          (t) =>
            (filter.personId === undefined || t.personId === filter.personId) &&
            (filter.surfaceId === undefined || t.surfaceId === filter.surfaceId),
        )
        .reverse(),
  };
}
