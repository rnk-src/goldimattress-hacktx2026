import { decodePerson, decodeTest, encodePerson, encodeTest } from './codec';
import { readStored, readStoredState } from './migrate';
import type { StoredData } from './migrate';
import type { Store, StorageLike } from './types';

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
const CORRUPT_BACKUP_KEY = 'goldimattress-corrupt-backup';

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
const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

export function createLocalStore(storage: StorageLike = localStorage): Store {
  const load = (): StoredData => readStored(storage.getItem(KEY));
  const save = (data: StoredData, corruptBackup?: string) => {
    try {
      if (corruptBackup !== undefined) {
        try {
          storage.setItem(CORRUPT_BACKUP_KEY, corruptBackup);
        } catch (e) {
          // Only text that is not JSON at all is expendable. Readable data from a newer app must not be overwritten unbacked.
          if (isJson(corruptBackup)) throw e;
        }
      }
      storage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      throw isQuotaError(e) ? new StoreFullError({ cause: e }) : e;
    }
  };
  const change = async (edit: (data: StoredData) => void) => {
    const raw = storage.getItem(KEY);
    const loaded = readStoredState(raw);
    const data = loaded.data;
    edit(data);
    save(data, loaded.corrupt ? raw! : undefined);
  };

  return {
    listPeople: async () => load().people.map(decodePerson),
    savePerson: (p) => change((d) => upsert(d.people, encodePerson(p))),
    findSurfaces: async (prefix) => {
      const p = prefix.toLowerCase();
      return load()
        .surfaces.filter((s) => s.name.toLowerCase().startsWith(p))
        .reverse();
    },
    saveSurface: (s) => change((d) => upsert(d.surfaces, s)),
    saveTest: (t) => change((d) => upsert(d.tests, encodeTest(t))),
    listTests: async (filter = {}) =>
      load()
        .tests.filter(
          (t) =>
            (filter.personId === undefined || t.personId === filter.personId) &&
            (filter.surfaceId === undefined || t.surfaceId === filter.surfaceId),
        )
        .reverse()
        .map(decodeTest),
  };
}
