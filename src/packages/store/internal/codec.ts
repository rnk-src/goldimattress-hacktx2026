import type { Person, ReferenceStats, RepResult, Routine, Sample, TestRecord, Trace } from '../../domain';

/**
 * A trace whose samples are one base64 string of little-endian Float32 [t, ax, ay, az, ...].
 * Float32 keeps about 7 digits, so a reloaded sample differs from the captured double by ~1e-7.
 * `t` is seconds since the trace started (see `Sample`), which Float32 holds to well under 1 ms.
 */
export type StoredTrace = Omit<Trace, 'samples'> & { samples: string };

type StoredRep = (
  | Omit<Extract<RepResult, { ok: true }>, 'trace'>
  | Omit<Extract<RepResult, { ok: false }>, 'trace'>
) & { trace: StoredTrace };

export type StoredPerson = Omit<Person, 'references'> & {
  references: Partial<Record<Routine, { stats: ReferenceStats; reps: StoredRep[] }>>;
};
export type StoredTest = Omit<TestRecord, 'reps'> & { reps: StoredRep[] };

function encodeSamples(samples: readonly Sample[]): string {
  const view = new DataView(new ArrayBuffer(samples.length * 16));
  samples.forEach((s, i) => {
    [s.t, s.ax, s.ay, s.az].forEach((v, j) => view.setFloat32(i * 16 + j * 4, v, true));
  });
  let binary = '';
  for (let i = 0; i < view.byteLength; i++) binary += String.fromCharCode(view.getUint8(i));
  return btoa(binary);
}

export function decodeSamples(encoded: string): Sample[] {
  const binary = atob(encoded);
  if (binary.length % 16 !== 0) throw new Error('Sample bytes are not whole samples');
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  return Array.from({ length: binary.length / 16 }, (_, i) => ({
    t: view.getFloat32(i * 16, true),
    ax: view.getFloat32(i * 16 + 4, true),
    ay: view.getFloat32(i * 16 + 8, true),
    az: view.getFloat32(i * 16 + 12, true),
  }));
}

const encodeTrace = (t: Trace): StoredTrace => ({ ...t, samples: encodeSamples(t.samples) });
const decodeTrace = (t: StoredTrace): Trace => ({ ...t, samples: decodeSamples(t.samples) });

const encodeRep = (r: RepResult): StoredRep => ({ ...r, trace: encodeTrace(r.trace) });
// shortcut: reps saved before weights existed read as weight 1, jitter 0 and no issues, and old issue names such as 'too-fast' are not migrated; dev data only, drop when no old data remains.
const decodeRep = (r: StoredRep): RepResult =>
  ({ ...(r.ok ? { weight: 1, hoverJitter: 0, issues: [] } : {}), ...r, trace: decodeTrace(r.trace) }) as RepResult;

export function encodePerson(p: Person): StoredPerson {
  const references: StoredPerson['references'] = {};
  for (const routine of Object.keys(p.references) as Routine[]) {
    const ref = p.references[routine]!;
    references[routine] = { stats: ref.stats, reps: ref.reps.map(encodeRep) };
  }
  return { ...p, references };
}

export function decodePerson(p: StoredPerson): Person {
  const references: Person['references'] = {};
  for (const routine of Object.keys(p.references) as Routine[]) {
    const ref = p.references[routine]!;
    references[routine] = { stats: ref.stats, reps: ref.reps.map(decodeRep) };
  }
  return { ...p, references };
}

export const encodeTest = (t: TestRecord): StoredTest => ({ ...t, reps: t.reps.map(encodeRep) });
export const decodeTest = (t: StoredTest): TestRecord => ({ ...t, reps: t.reps.map(decodeRep) });
