import { describe, expect, it } from 'vitest';
import type { Person, RepResult, Surface, TestRecord, Trace, Verdict } from '../domain';
import { memoryStorage, synthRep } from '../testkit';
import { StoreFullError, createLocalStore } from './index';

const person = (id: string, name = id): Person => ({ id, name, references: {} });
const surface = (id: string, name: string): Surface => ({ id, name, type: 'couch' });
const verdict: Verdict = {
  hardness: 0,
  springiness: 0,
  hardnessLabel: 'just-right',
  springinessLabel: 'just-right',
  firmer: false,
  bouncier: false,
  match: 100,
  perFeatureZ: { peakOverV: 0, stopTime: 0, bounceRatio: 0, settleTime: 0 },
};
const record = (id: string, personId: string, surfaceId: string): TestRecord => ({
  id,
  personId,
  surfaceId,
  routine: 'sit-drop',
  createdAt: '2026-10-24T16:00:00.000Z',
  device: 'test',
  sampleRateHz: 60,
  reps: [],
  verdict,
});

describe('people', () => {
  it('starts empty', async () => {
    expect(await createLocalStore(memoryStorage()).listPeople()).toEqual([]);
  });

  it('round-trips a saved person, with optional body mass', async () => {
    const store = createLocalStore(memoryStorage());
    const ana = { ...person('p1', 'Ana'), bodyMassKg: 62 };
    await store.savePerson(ana);
    await store.savePerson(person('p2', 'Ben'));
    expect(await store.listPeople()).toEqual([ana, person('p2', 'Ben')]);
  });

  it('replaces a person saved again under the same id', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson(person('p1', 'Ana'));
    await store.savePerson(person('p1', 'Ana B'));
    expect(await store.listPeople()).toEqual([person('p1', 'Ana B')]);
  });

  it('survives a reload: a new store on the same storage sees the person', async () => {
    const storage = memoryStorage();
    await createLocalStore(storage).savePerson(person('p1', 'Ana'));
    expect(await createLocalStore(storage).listPeople()).toEqual([person('p1', 'Ana')]);
  });
});

describe('surfaces', () => {
  const seed = async () => {
    const store = createLocalStore(memoryStorage());
    await store.saveSurface(surface('s1', 'Couch cushion'));
    await store.saveSurface(surface('s2', 'cozy bed'));
    await store.saveSurface(surface('s3', 'Desk chair'));
    return store;
  };

  it("returns every surface, newest first, for ''", async () => {
    const names = (await (await seed()).findSurfaces('')).map((s) => s.id);
    expect(names).toEqual(['s3', 's2', 's1']);
  });

  it('matches a prefix case-insensitively', async () => {
    const found = await (await seed()).findSurfaces('CO');
    expect(found.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('does not match inside a name', async () => {
    expect(await (await seed()).findSurfaces('cushion')).toEqual([]);
  });

  it('replaces a surface saved again under the same id, keeping its place', async () => {
    const store = await seed();
    await store.saveSurface(surface('s1', 'Couch cushion (blue)'));
    const all = await store.findSurfaces('');
    expect(all.map((s) => s.name)).toEqual(['Desk chair', 'cozy bed', 'Couch cushion (blue)']);
  });
});

describe('tests', () => {
  const seed = async () => {
    const store = createLocalStore(memoryStorage());
    await store.saveTest(record('t1', 'p1', 's1'));
    await store.saveTest(record('t2', 'p2', 's1'));
    await store.saveTest(record('t3', 'p1', 's2'));
    return store;
  };
  const ids = (list: TestRecord[]) => list.map((t) => t.id);

  it('lists every test, newest first', async () => {
    expect(ids(await (await seed()).listTests())).toEqual(['t3', 't2', 't1']);
  });

  it('filters by person', async () => {
    expect(ids(await (await seed()).listTests({ personId: 'p1' }))).toEqual(['t3', 't1']);
  });

  it('filters by surface', async () => {
    expect(ids(await (await seed()).listTests({ surfaceId: 's1' }))).toEqual(['t2', 't1']);
  });

  it('filters by person and surface together', async () => {
    expect(ids(await (await seed()).listTests({ personId: 'p1', surfaceId: 's1' }))).toEqual(['t1']);
  });
});

describe('trace encoding', () => {
  const features = { peakOverV: 20, stopTime: 0.1, bounceRatio: 0.4, settleTime: 1.5 };
  const accepted = (trace: Trace): RepResult => ({ ok: true, features, impactSpeed: 0.6, leanDeg: 15, trace });
  const rejected = (trace: Trace): RepResult => ({ ok: false, reasons: ['not-still'], trace });

  /** Storage that remembers everything written, to inspect the stored form. */
  const spyStorage = () => {
    const inner = memoryStorage();
    const writes: string[] = [];
    return {
      writes,
      getItem: inner.getItem,
      removeItem: inner.removeItem,
      setItem: (k: string, v: string) => {
        writes.push(v);
        inner.setItem(k, v);
      },
    };
  };

  const expectTraceClose = (actual: Trace, expected: Trace) => {
    expect({ ...actual, samples: [] }).toEqual({ ...expected, samples: [] });
    expect(actual.samples).toHaveLength(expected.samples.length);
    expected.samples.forEach((s, i) => {
      const a = actual.samples[i]!;
      for (const key of ['t', 'ax', 'ay', 'az'] as const) expect(a[key]).toBeCloseTo(s[key], 4);
    });
  };

  it('returns test reps with their traces, to Float32 precision', async () => {
    const trace = synthRep({ seed: 3 });
    const store = createLocalStore(memoryStorage());
    await store.saveTest({ ...record('t1', 'p1', 's1'), reps: [accepted(trace), rejected(trace)] });
    const [loaded] = await store.listTests();
    expect(loaded!.reps[0]).toMatchObject({ ok: true, features, impactSpeed: 0.6, leanDeg: 15 });
    expect(loaded!.reps[1]).toMatchObject({ ok: false, reasons: ['not-still'] });
    loaded!.reps.forEach((r) => expectTraceClose(r.trace, trace));
  });

  it('returns reference reps stored on a person', async () => {
    const trace = synthRep({ seed: 4 });
    const store = createLocalStore(memoryStorage());
    const stats = { mean: 1, std: 0.1 };
    const reference = {
      stats: {
        routine: 'sit-drop' as const,
        repCount: 1,
        createdAt: '2026-10-24T16:00:00.000Z',
        features: { peakOverV: stats, stopTime: stats, bounceRatio: stats, settleTime: stats },
        leanDeg: stats,
        impactSpeed: stats,
      },
      reps: [accepted(trace)],
    };
    await store.savePerson({ ...person('p1', 'Ana'), references: { 'sit-drop': reference } });
    const [loaded] = await store.listPeople();
    expect(loaded!.references['sit-drop']!.stats).toEqual(reference.stats);
    expectTraceClose(loaded!.references['sit-drop']!.reps[0]!.trace, trace);
  });

  it('writes samples as one compact string, not one object per sample', async () => {
    const storage = spyStorage();
    const trace = synthRep({ seed: 5 });
    await createLocalStore(storage).saveTest({ ...record('t1', 'p1', 's1'), reps: [accepted(trace)] });
    const written = storage.writes.at(-1)!;
    expect(written).not.toContain('"ax"');
    expect(written.length).toBeLessThan(trace.samples.length * 16 * 2);
  });
});

describe('capacity', () => {
  const features = { peakOverV: 20, stopTime: 0.1, bounceRatio: 0.4, settleTime: 1.5 };
  /** A typical test: 5 accepted reps and 1 rejected, each a 3.5 s trace at 60 Hz. */
  const typicalTest = (i: number): TestRecord => ({
    ...record(`t${i}`, 'p1', 's1'),
    reps: [
      ...[0, 1, 2, 3, 4].map(
        (n): RepResult => ({ ok: true, features, impactSpeed: 0.6, leanDeg: 15, trace: synthRep({ seed: i * 10 + n }) }),
      ),
      { ok: false, reasons: ['not-still'], trace: synthRep({ seed: i * 10 + 9 }) },
    ],
  });
  const FIVE_MB = 5_000_000;

  it('fits 100 typical tests in 5 MB', async () => {
    const store = createLocalStore(memoryStorage({ limitChars: FIVE_MB }));
    for (let i = 0; i < 100; i++) await store.saveTest(typicalTest(i));
    expect(await store.listTests()).toHaveLength(100);
  });

  it('throws StoreFullError when the storage is full, and keeps what was saved before', async () => {
    const store = createLocalStore(memoryStorage({ limitChars: 40_000 }));
    await store.saveTest(typicalTest(0));
    await expect(store.saveTest(typicalTest(1))).rejects.toBeInstanceOf(StoreFullError);
    expect((await store.listTests()).map((t) => t.id)).toEqual(['t0']);
  });

  it('lets other storage errors through unchanged', async () => {
    const boom = new Error('disk on fire');
    const storage = { ...memoryStorage(), setItem: () => { throw boom; } };
    await expect(createLocalStore(storage).savePerson(person('p1'))).rejects.toBe(boom);
  });
});

describe('schema versioning and bad data', () => {
  const KEY = 'goldimattress';
  const features = { peakOverV: 20, stopTime: 0.1, bounceRatio: 0.4, settleTime: 1.5 };

  it('stamps what it writes with schema version 1', async () => {
    const storage = memoryStorage();
    await createLocalStore(storage).savePerson(person('p1'));
    expect(JSON.parse(storage.getItem(KEY)!)).toMatchObject({ version: 1 });
  });

  it('migrates unversioned v0 data (raw per-sample traces) and rewrites it as v1', async () => {
    const trace = synthRep({ seed: 8 });
    const legacy = {
      people: [person('p1', 'Ana')],
      surfaces: [surface('s1', 'Couch')],
      tests: [{ ...record('t1', 'p1', 's1'), reps: [{ ok: true, features, impactSpeed: 0.6, leanDeg: 15, trace }] }],
    };
    const storage = memoryStorage();
    storage.setItem(KEY, JSON.stringify(legacy));
    const store = createLocalStore(storage);

    expect(await store.listPeople()).toEqual([person('p1', 'Ana')]);
    const [migrated] = await store.listTests();
    expect(migrated!.reps[0]!.trace.samples).toHaveLength(trace.samples.length);
    expect(migrated!.reps[0]!.trace.samples[5]!.ay).toBeCloseTo(trace.samples[5]!.ay, 4);

    await store.savePerson(person('p2'));
    const rewritten = storage.getItem(KEY)!;
    expect(JSON.parse(rewritten)).toMatchObject({ version: 1 });
    expect(rewritten).not.toContain('"ax"');
    expect(await store.listTests()).toHaveLength(1);
  });

  it.each([['broken JSON', '{not json'], ['a non-object', '42'], ['missing lists', '{"version":1}']])(
    'reads %s as empty, and the next save replaces it',
    async (_name, stored) => {
      const storage = memoryStorage();
      storage.setItem(KEY, stored);
      const store = createLocalStore(storage);
      expect(await store.listPeople()).toEqual([]);
      expect(await store.listTests()).toEqual([]);
      await store.savePerson(person('p1'));
      expect(await store.listPeople()).toEqual([person('p1')]);
    },
  );
});
