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

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** A stored trace holds one base64 string that decodes to whole samples. */
function isStoredTrace(x: unknown): boolean {
  if (!isObject(x) || typeof x.samples !== 'string') return false;
  const encoded = x.samples;
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = (encoded.length / 4) * 3 - padding;
  return bytes % 16 === 0;
}

const areReps = (x: unknown): boolean =>
  Array.isArray(x) && x.every((rep) => isObject(rep) && isStoredTrace(rep.trace));

/**
 * Checks the parts of a v1 blob the decoders rely on: people with references, tests with reps.
 * shortcut: scalar fields (names, stats, verdicts) are trusted, so a hand-edited blob can still
 * misbehave; add a schema check if the data ever comes from outside this app.
 */
function isValidV1(data: Record<string, unknown>): boolean {
  const people = data.people as unknown[];
  const tests = data.tests as unknown[];
  return (
    (data.surfaces as unknown[]).every(isObject) &&
    people.every(
      (p) =>
        isObject(p) &&
        isObject(p.references) &&
        Object.values(p.references).every((ref) => isObject(ref) && areReps(ref.reps)),
    ) &&
    tests.every((t) => isObject(t) && areReps(t.reps))
  );
}

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
export function readStoredState(raw: string | null): { data: StoredData; corrupt: boolean } {
  if (raw === null) return { data: emptyStored(), corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: emptyStored(), corrupt: true };
  }
  if (typeof parsed !== 'object' || parsed === null || !isLists(parsed as Record<string, unknown>)) {
    return { data: emptyStored(), corrupt: true };
  }
  const data = parsed as Record<string, unknown>;
  if (data.version === undefined) return { data: migrateV0(data as Parameters<typeof migrateV0>[0]), corrupt: false };
  if (data.version === 1 && isValidV1(data)) return { data: data as unknown as StoredData, corrupt: false };
  return { data: emptyStored(), corrupt: true };
}

export const readStored = (raw: string | null): StoredData => readStoredState(raw).data;
