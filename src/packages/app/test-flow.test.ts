import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { SensorSource } from '../sensors';
import type { Person, ReferenceStats, Sample, Trace, Verdict } from '../domain';
import { createReplaySource } from '../sensors';
import { analyzeRep, buildReference } from '../signal';
import { createLocalStore } from '../store';
import type { Store } from '../store';
import { memoryStorage, synthRep, synthStream } from '../testkit';
import type { SynthOptions } from '../testkit';
import { caveatTexts, hardnessText, springinessText, startApp } from './index';

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

function mount(samples: Sample[], store: Store, source?: SensorSource) {
  const coach: Coach = { play() {}, keepAwake: () => Promise.resolve(), setMuted() {}, dispose() {} };
  const root = document.createElement('main');
  document.body.append(root);
  window.location.hash = '#/test';

  const stop = startApp(root, {
    source: source ?? createReplaySource(traceOf(samples)),
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

  it('labels the confidence on the result', async () => {
    const store = await storeWith(withReference());
    const { root } = mount(stream([]), store);

    await runTest(root);

    expect(text(root, '[data-confidence]')).toMatch(/confident|close call|not enough data/);
    const [record] = await store.listTests();
    expect(record?.verdict.confidence).toBeDefined();
  });

  it('shows no confidence at all after fewer than three usable reps', async () => {
    const store = await storeWith(withReference());
    const reps: SynthOptions[] = [
      { seed: 70 },
      { seed: 71 },
      ...Array.from({ length: 8 }, (_, i) => ({ failure: 'left-surface' as const, seed: 80 + i })),
    ];
    const samples = synthStream(reps, REST_S);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const { root } = mount(samples, store);

    await runTest(root);

    expect(text(root, '[data-result]')).toContain('not working');
    expect(root.querySelector('[data-confidence]')).toBeNull();
    expect(await store.listTests()).toEqual([]);
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

  it('does not put a profile name into the page as HTML', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const { root } = mount(stream([]), await storeWith({ id: 'person-1', name, references: {} }));
    await flush();

    expect(root.querySelector('[data-block] img')).toBeNull();
    expect(text(root, '[data-block]')).toContain(name);
  });

  it('locks the form during a run and saves under the values it started with', async () => {
    const store = await storeWith(withReference());
    let push: (sample: Sample) => void = () => undefined;
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start: (callback) => (push = callback),
      stop() {},
      sampleRateHz: 60,
    };
    const { root } = mount([], store, source);
    await flush();
    const name = root.querySelector<HTMLInputElement>('input[name="surface"]')!;
    name.value = 'Blue couch';
    root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.click();

    expect(name.disabled).toBe(true);
    expect(root.querySelector<HTMLSelectElement>('select[name="routine"]')?.disabled).toBe(true);
    name.value = '';
    const samples = stream([]);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    await flush();
    samples.forEach(push);
    await flush();

    const [surface] = await store.findSurfaces('');
    expect(surface?.name).toBe('Blue couch');
  });

  it('files "Blue  couch" and "blue couch" under one surface', async () => {
    const store = await storeWith(withReference());
    const first = mount(stream([]), store);
    await runTest(first.root, 'Blue  couch');
    first.stop();
    const second = mount(stream([]), store);
    await runTest(second.root, 'blue couch');

    expect(await store.findSurfaces('')).toHaveLength(1);
  });

  it('lists a skipped rest as a caveat', async () => {
    const store = await storeWith(withReference());
    let push: (sample: Sample) => void = () => undefined;
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start: (callback) => (push = callback),
      stop() {},
      sampleRateHz: 60,
    };
    const samples = stream([]);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const { root } = mount([], store, source);
    await flush();
    root.querySelector<HTMLInputElement>('input[name="surface"]')!.value = 'Blue couch';
    root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.click();
    await flush();

    const skip = root.querySelector<HTMLButtonElement>('[data-action="skip-rest"]')!;
    let skipped = false;
    for (const sample of samples) {
      push(sample);
      if (!skipped && !skip.hidden) {
        skip.click();
        skipped = true;
      }
    }
    await flush();

    expect(skipped).toBe(true);
    expect(text(root, '[data-caveats]').toLowerCase()).toContain('skipped a rest');
  });

  it('stamps every saved rep with the device and when it started', async () => {
    const store = await storeWith(withReference());
    const { root } = mount(stream([]), store);

    await runTest(root);

    const [record] = await store.listTests();
    expect(record?.reps.every((rep) => rep.trace.device === 'iPhone' && rep.trace.startedAt !== '')).toBe(true);
  });

  it('retypes a known surface when the user picks another type, and hides a stale result on routine change', async () => {
    const store = await storeWith(withReference());
    const first = mount(stream([]), store);
    await runTest(first.root, 'Blue couch', 'couch');
    first.stop();
    const second = mount(stream([]), store);
    await runTest(second.root, 'Blue couch', 'mattress');

    expect(await store.findSurfaces('')).toMatchObject([{ name: 'Blue couch', type: 'mattress' }]);
    const routine = second.root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
    routine.value = 'bridge-drop';
    routine.dispatchEvent(new Event('change'));
    expect(second.root.querySelector<HTMLElement>('[data-result]')?.hidden).toBe(true);
  });

  it('clears the missing-name error as soon as the user types', async () => {
    const { root } = mount(stream([]), await storeWith(withReference()));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-test"]')?.click();
    expect(text(root, '[data-form-error]')).toContain('Enter the name');

    root.querySelector<HTMLInputElement>('input[name="surface"]')!.dispatchEvent(new Event('input'));

    expect(text(root, '[data-form-error]')).toBe('');
  });
});

const verdict = (over: Partial<Verdict>): Verdict => ({
  hardness: 0,
  springiness: 0,
  hardnessLabel: 'just-right',
  springinessLabel: 'just-right',
  firmer: false,
  bouncier: false,
  match: 100,
  perFeatureZ: { peakOverV: 0, stopTime: 0, bounceRatio: 0, settleTime: 0 },
  hardnessInterval: [0, 0],
  springinessInterval: [0, 0],
  confidence: 'confident',
  hardnessReliable: false,
  caveats: [],
  ...over,
});

describe('result wording', () => {
  it.each([
    ['just-right', true, 'same bounce'],
    ['slightly', true, 'slightly bouncier'],
    ['slightly', false, 'slightly less bouncy'],
    ['much', true, 'much bouncier'],
    ['much', false, 'much less bouncy'],
  ] as const)('says %s / bouncier=%s as "%s"', (label, bouncier, expected) => {
    expect(springinessText(verdict({ springinessLabel: label, bouncier }))).toBe(expected);
  });

  it.each([
    ['just-right', true, 'same hardness'],
    ['slightly', true, 'slightly firmer'],
    ['slightly', false, 'slightly softer'],
    ['much', true, 'much firmer'],
    ['much', false, 'much softer'],
  ] as const)('says hardness %s / firmer=%s as "%s" once it is reliable', (label, firmer, expected) => {
    expect(hardnessText(verdict({ hardnessLabel: label, firmer, hardnessReliable: true }))).toBe(expected);
  });

  it("says hardness can't be told yet while it is unreliable", () => {
    expect(hardnessText(verdict({ hardnessLabel: 'much', firmer: true }))).toBe("hardness: can't tell yet");
  });

  it('names each caveat', () => {
    expect(caveatTexts(verdict({ caveats: ['lean-differs', 'rest-skipped'] }))).toEqual([
      'Your lean differed from calibration.',
      'You skipped a rest between reps.',
    ]);
  });
});
