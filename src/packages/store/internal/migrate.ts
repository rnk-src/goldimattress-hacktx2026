import type { Person, Surface, TestRecord } from '../../domain';
import { encodePerson, encodeTest } from './codec';
import type { StoredPerson, StoredTest } from './codec';

/** What `createLocalStore` keeps in storage today. */
export interface StoredData {
  version: 1;
  people: StoredPerson[];
  surfaces: Surface[];
  tests: StoredTest[];
}

export const emptyStored = (): StoredData => ({ version: 1, people: [], surfaces: [], tests: [] });

const isLists = (x: Record<string, unknown>): boolean =>
  Array.isArray(x.people) && Array.isArray(x.surfaces) && Array.isArray(x.tests);

/** v0 had no version field and kept every trace as a plain array of samples. */
function migrateV0(old: { people: Person[]; surfaces: Surface[]; tests: TestRecord[] }): StoredData {
  return {
    version: 1,
    people: old.people.map(encodePerson),
    surfaces: old.surfaces,
    tests: old.tests.map(encodeTest),
  };
}

/**
 * Turns whatever is in storage into the current schema. Missing, corrupt or unrecognised data
 * reads as empty, and the next save replaces it.
 * shortcut: corrupt data and a version newer than this build both read as empty and are overwritten
 * by the next save, with no backup. Keep the raw value under a second key if that ever bites.
 */
export function readStored(raw: string | null): StoredData {
  if (raw === null) return emptyStored();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStored();
  }
  if (typeof parsed !== 'object' || parsed === null || !isLists(parsed as Record<string, unknown>)) {
    return emptyStored();
  }
  const data = parsed as Record<string, unknown>;
  if (data.version === undefined) return migrateV0(data as Parameters<typeof migrateV0>[0]);
  if (data.version === 1) return data as unknown as StoredData;
  return emptyStored();
}
