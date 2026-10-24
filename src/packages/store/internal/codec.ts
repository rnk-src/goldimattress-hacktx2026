import type { Person, ReferenceStats, RepResult, Routine, Sample, TestRecord, Trace } from '../../domain';

/** A trace whose samples are one base64 string of little-endian Float32 [t, ax, ay, az, ...]. */
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

function decodeSamples(encoded: string): Sample[] {
  const binary = atob(encoded);
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
const decodeRep = (r: StoredRep): RepResult => ({ ...r, trace: decodeTrace(r.trace) }) as RepResult;

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
