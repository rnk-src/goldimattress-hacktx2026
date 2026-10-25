import type { Person, Surface, TestRecord } from '../../domain';
import { decodeSamples, encodePerson, encodeTest } from './codec';
import type { StoredPerson, StoredTest } from './codec';

/** What `createLocalStore` keeps in storage today. */
export interface StoredData {
  version: 2;
  people: StoredPerson[];
  surfaces: Surface[];
  tests: StoredTest[];
}

export const emptyStored = (): StoredData => ({ version: 2, people: [], surfaces: [], tests: [] });

const isLists = (x: Record<string, unknown>): boolean =>
  Array.isArray(x.people) && Array.isArray(x.surfaces) && Array.isArray(x.tests);

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** A stored trace holds one base64 string that decodes to whole samples. */
function isStoredTrace(x: unknown): boolean {
  if (!isObject(x) || typeof x.samples !== 'string') return false;
  try {
    decodeSamples(x.samples);
    return true;
  } catch {
    return false;
  }
}

const areReps = (x: unknown): boolean =>
  Array.isArray(x) && x.every((rep) => isObject(rep) && isStoredTrace(rep.trace));

const isStat = (x: unknown): boolean => isObject(x) && 'center' in x;

/** Reference stats in the current shape (`center`, not the old `median` or `mean`). */
const isStats = (x: unknown): boolean =>
  isObject(x) && isObject(x.features) && isStat(x.leanDeg) && isStat(x.impactSpeed) && typeof x.jitterScale === 'number';

/**
 * Checks the parts of a v2 blob the decoders rely on: people with references and stats, tests with reps.
 * shortcut: scalar fields (names, verdicts, each feature's stats) are trusted, so a hand-edited blob can
 * still misbehave; add a schema check if the data ever comes from outside this app.
 */
function isValidStored(data: Record<string, unknown>): boolean {
  const people = data.people as unknown[];
  const tests = data.tests as unknown[];
  return (
    (data.surfaces as unknown[]).every(isObject) &&
    people.every(
      (p) =>
        isObject(p) &&
        isObject(p.references) &&
        Object.values(p.references).every((ref) => isObject(ref) && isStats(ref.stats) && areReps(ref.reps)),
    ) &&
    tests.every((t) => isObject(t) && areReps(t.reps))
  );
}

/** v0 had no version field and kept every trace as a plain array of samples. Returns v2 data. */
function migrateV0(old: { people: Person[]; surfaces: Surface[]; tests: TestRecord[] }): Record<string, unknown> {
  return {
    version: 2,
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
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || !isLists(parsed)) return emptyStored();
    // shortcut: a v1 blob (old `median` stats) reads as empty with its people; dev data only, add a migration if real users ever hold v1.
    const data = parsed.version === undefined ? migrateV0(parsed as Parameters<typeof migrateV0>[0]) : parsed;
    return data.version === 2 && isValidStored(data) ? (data as unknown as StoredData) : emptyStored();
  } catch {
    return emptyStored();
  }
}
