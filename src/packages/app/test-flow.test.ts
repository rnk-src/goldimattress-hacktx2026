import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { Person, ReferenceStats, Sample, Trace } from '../domain';
import { createReplaySource } from '../sensors';
import { analyzeRep, buildReference } from '../signal';
import { createLocalStore } from '../store';
import type { Store } from '../store';
import { memoryStorage, synthRep, synthStream } from '../testkit';
import type { SynthOptions } from '../testkit';
import { startApp } from './index';

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = '';
});

const REST_S = 22;
let nextId = 0;

const traceOf = (samples: Sample[]): Trace => ({
  routine: 'sit-drop',
  sampleRateHz: 60,
  device: 'Replay phone',
  startedAt: '2026-10-24T16:00:00.000Z',
  samples,
});

/** `reps` followed by good reps so the stream always holds enough clean ones to finish. */
function stream(reps: SynthOptions[], total = 7): Sample[] {
  const extra = Array.from({ length: total - reps.length }, (_, i) => ({ seed: 100 + i }));
  return synthStream([...reps, ...extra], REST_S);
}

function reference(): ReferenceStats {
  const reps = [1, 2, 3, 4, 5].map((seed) => analyzeRep(synthRep({ seed })));
  const built = buildReference(reps, 'sit-drop');
  if (!built.ok) throw new Error('fixture reference failed');
  return built.ref;
}

async function storeWith(person: Person | undefined): Promise<Store> {
  const store = createLocalStore(memoryStorage());
  if (person) await store.savePerson(person);
  return store;
}

const withReference = (): Person => ({
  id: 'person-1',
  name: 'Alex',
  references: { 'sit-drop': { stats: reference(), reps: [] } },
});

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function mount(samples: Sample[], store: Store) {
  const coach: Coach = { play() {}, keepAwake: () => Promise.resolve(), setMuted() {}, dispose() {} };
  const root = document.createElement('main');
  document.body.append(root);
  window.location.hash = '#/test';

  const stop = startApp(root, {
    source: createReplaySource(traceOf(samples)),
    store,
    makeCoach: () => coach,
    now: () => new Date('2026-10-24T17:00:00.000Z'),
    device: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    newId: () => `id-${(nextId += 1)}`,
  });
  return { root, stop };
}

const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent ?? '';

async function runTest(root: HTMLElement, surface = 'Blue couch', type = 'couch') {
  await flush();
  root.querySelector<HTMLInputElement>('input[name="surface"]')!.value = surface;
  root.querySelector<HTMLSelectElement>('select[name="type"]')!.value = type;
  root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.click();
  await flush();
}

describe('test screen', () => {
  it('blocks the test and points to calibration when the routine has no reference', async () => {
    const { root } = mount(stream([]), await storeWith({ id: 'person-1', name: 'Alex', references: {} }));
    await flush();

    expect(text(root, '[data-block]')).toContain('Calibrate');
    expect(root.querySelector('[data-block] a')?.getAttribute('href')).toBe('#/calibrate');
    expect(root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.disabled).toBe(true);
  });

  it('saves a test record with every rep, the device, the sample rate and the verdict', async () => {
    const store = await storeWith(withReference());
    const { root } = mount(stream([{ failure: 'caught-landing', seed: 20 }]), store);

    await runTest(root);

    const [record] = await store.listTests();
    expect(record?.personId).toBe('person-1');
    expect(record?.routine).toBe('sit-drop');
    expect(record?.device).toBe('iPhone');
    expect(record?.sampleRateHz).toBeGreaterThan(50);
    expect(record?.reps.length).toBeGreaterThanOrEqual(6);
    expect(record?.reps.some((rep) => !rep.ok || rep.weight < 1)).toBe(true);
    expect(record?.reps.every((rep) => rep.trace.samples.length > 0)).toBe(true);
    expect(record?.verdict.match).toBeGreaterThanOrEqual(0);
  });

  it('creates the surface from its typed name and type, and reuses it by name', async () => {
    const store = await storeWith(withReference());
    const first = mount(stream([]), store);
    await runTest(first.root, 'Blue couch', 'couch');
    first.stop();
    const second = mount(stream([]), store);
    await runTest(second.root, 'blue couch', 'couch');

    const surfaces = await store.findSurfaces('');
    const tests = await store.listTests();
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({ name: 'Blue couch', type: 'couch' });
    expect(tests.map((t) => t.surfaceId)).toEqual([surfaces[0]!.id, surfaces[0]!.id]);
  });

  it('shows the match, a springiness direction, and hardness as not yet known', async () => {
    const { root } = mount(stream([1, 2, 3, 4, 5, 6, 7].map((seed) => ({ seed: 30 + seed, bounceRatio: 0.85 })), 7), await storeWith(withReference()));

    await runTest(root);

    expect(text(root, '[data-match]')).toMatch(/^\d+%/);
    expect(text(root, '[data-direction]')).toMatch(/bouncier/);
    expect(text(root, '[data-hardness]')).toContain("can't tell yet");
  });

  it('labels the confidence and never claims confidence from fewer than three usable reps', async () => {
    const { root } = mount(stream([]), await storeWith(withReference()));
    await runTest(root);
    expect(text(root, '[data-confidence]')).toMatch(/confident|close call|not enough data/);

    const samples = stream([]);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const low = mount(samples.slice(0, Math.floor(samples.length / 3)), await storeWith(withReference()));
    await runTest(low.root);
    expect(text(low.root, '[data-confidence]')).not.toContain('confident');
  });

  it('lists a lean difference as a caveat', async () => {
    const { root } = mount(stream([1, 2, 3, 4, 5, 6, 7].map((seed) => ({ seed: 40 + seed, leanDeg: 38 })), 7), await storeWith(withReference()));

    await runTest(root);

    expect(text(root, '[data-caveats]').toLowerCase()).toContain('lean');
  });

  it('offers a retry and saves nothing when no rep was usable', async () => {
    const store = await storeWith(withReference());
    const bad = stream(Array.from({ length: 10 }, (_, i) => ({ failure: 'left-surface' as const, seed: 60 + i })), 10);
    const last = bad.at(-1)!;
    for (let i = 1; i <= 300; i += 1) bad.push({ ...last, t: last.t + i / 60 });
    const { root } = mount(bad, store);

    await runTest(root);

    expect(text(root, '[data-result]')).toContain('not working');
    expect(await store.listTests()).toEqual([]);
    expect(root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.disabled).toBe(false);
  });

  it('says so when the test could not be saved', async () => {
    const base = await storeWith(withReference());
    const store: Store = { ...base, saveTest: () => Promise.reject(new Error('Storage is full')) };
    const { root } = mount(stream([]), store);

    await runTest(root);

    expect(text(root, '[data-save-status]')).toContain('Could not save');
  });
});
