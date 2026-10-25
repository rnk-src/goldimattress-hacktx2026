import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { Person, RigSetup, Sample, Trace } from '../domain';
import { createReplaySource } from '../sensors';
import type { SensorSource } from '../sensors';
import { DEFAULT_RIG } from '../signal';
import { createLocalStore } from '../store';
import type { Store } from '../store';
import { memoryStorage, synthStream } from '../testkit';
import type { SynthOptions } from '../testkit';
import { startApp } from './index';

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = '';
});

const REST_S = 22;
let nextId = 0;

const rigRep = (seed: number, extra: Partial<SynthOptions> = {}): SynthOptions => ({
  routine: 'rig-drop',
  dropHeightCm: 5,
  sampleRateHz: 57,
  durationS: 5,
  seed,
  ...extra,
});

/** Seven rig drops with distinct noise, so a session always has enough clean reps to finish. */
function rigStream(extra: Partial<SynthOptions> = {}, count = 7): Sample[] {
  return synthStream(Array.from({ length: count }, (_, i) => rigRep(i + 1, extra)), REST_S);
}

/** Trailing stillness so the last rep's capture window closes. */
const padded = (samples: Sample[]): Sample[] => {
  const last = samples.at(-1)!;
  return [...samples, ...Array.from({ length: 300 }, (_, i) => ({ ...last, t: last.t + (i + 1) / 57 }))];
};

const traceOf = (samples: Sample[]): Trace => ({
  routine: 'rig-drop',
  sampleRateHz: 57,
  device: 'Replay phone',
  startedAt: '2026-10-24T16:00:00.000Z',
  samples,
  rig: { ...DEFAULT_RIG, baseCm: [...DEFAULT_RIG.baseCm] as [number, number] },
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

async function storeWith(person: Partial<Person> = {}): Promise<Store> {
  const store = createLocalStore(memoryStorage());
  await store.savePerson({ id: 'person-1', name: 'Alex', references: {}, ...person });
  return store;
}

function mount(hash: string, store: Store, source?: SensorSource, samples: Sample[] = []) {
  const coach: Coach = { play() {}, keepAwake: () => Promise.resolve(), setMuted() {}, dispose() {} };
  const root = document.createElement('main');
  document.body.append(root);
  window.location.hash = hash;
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

const q = <T extends HTMLElement>(root: HTMLElement, selector: string) => root.querySelector<T>(selector)!;
const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent ?? '';

function setValue(root: HTMLElement, selector: string, value: string) {
  const el = q<HTMLInputElement | HTMLSelectElement>(root, selector);
  el.value = value;
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('change'));
}

async function calibrate(store: Store, rig?: RigSetup) {
  if (rig) {
    const [person] = await store.listPeople();
    await store.savePerson({ ...person!, rig });
  }
  const { root, stop } = mount('#/calibrate', store, undefined, padded(rigStream()));
  await flush();
  q<HTMLButtonElement>(root, '[data-action="start-calibration"]').click();
  await flush();
  stop();
  return root;
}

describe('rig setup screen', () => {
  it('saves the spacer height, spot and mass override on the person', async () => {
    const store = await storeWith();
    const { root } = mount('#/rig', store);
    await flush();

    setValue(root, 'input[name="dropHeightCm"]', '7');
    setValue(root, 'select[name="spot"]', 'seat-middle');
    setValue(root, 'input[name="massKg"]', '2.6');
    q<HTMLFormElement>(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const [person] = await store.listPeople();
    expect(person?.rig).toEqual({ ...DEFAULT_RIG, massKg: 2.6, dropHeightCm: 7, spot: 'seat-middle' });
    expect(text(root, '[data-rig-status]')).toContain('saved');
  });

  it('shows the default rig and explains the strap and spacer before anything is saved', async () => {
    const { root } = mount('#/rig', await storeWith());
    await flush();

    expect(q<HTMLInputElement>(root, 'input[name="dropHeightCm"]').value).toBe('5');
    expect(q<HTMLInputElement>(root, 'input[name="massKg"]').value).toBe('');
    expect(text(root, '[data-rig-help]').toLowerCase()).toContain('strap');
    expect(text(root, '[data-rig-help]').toLowerCase()).toContain('spacer');
  });

  it.each([
    ['a zero spacer height', 'dropHeightCm', '0'],
    ['a spacer taller than 10 cm', 'dropHeightCm', '12'],
    ['a mass that is not a number', 'massKg', 'heavy'],
    ['a negative mass', 'massKg', '-1'],
  ])('saves nothing and says why for %s', async (_name, field, value) => {
    const store = await storeWith();
    const { root } = mount('#/rig', store);
    await flush();

    setValue(root, `input[name="${field}"]`, value);
    q<HTMLFormElement>(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const [person] = await store.listPeople();
    expect(person?.rig).toBeUndefined();
    expect(text(root, '[data-rig-status]')).not.toBe('');
    expect(text(root, '[data-rig-status]')).not.toContain('saved');
  });
});

describe('routine picker', () => {
  it.each(['#/calibrate', '#/test'])('defaults to the rig on %s and hides the body routines until asked', async (hash) => {
    const { root } = mount(hash, await storeWith());
    await flush();
    const routine = q<HTMLSelectElement>(root, 'select[name="routine"]');

    expect(routine.value).toBe('rig-drop');
    expect([...routine.options].map((o) => o.value)).toEqual(['rig-drop']);

    const legacy = q<HTMLInputElement>(root, 'input[name="legacy"]');
    legacy.checked = true;
    legacy.dispatchEvent(new Event('change'));

    expect([...routine.options].map((o) => o.value)).toEqual(['rig-drop', 'sit-drop', 'bridge-drop']);
    expect(routine.value).toBe('rig-drop');
  });

  it('goes back to the rig when the legacy toggle is turned off', async () => {
    const { root } = mount('#/calibrate', await storeWith());
    await flush();
    const legacy = q<HTMLInputElement>(root, 'input[name="legacy"]');
    legacy.checked = true;
    legacy.dispatchEvent(new Event('change'));
    setValue(root, 'select[name="routine"]', 'sit-drop');

    legacy.checked = false;
    legacy.dispatchEvent(new Event('change'));

    expect(q<HTMLSelectElement>(root, 'select[name="routine"]').value).toBe('rig-drop');
  });
});

describe('rig calibrate -> test -> result', () => {
  it('saves a rig reference stamped with the rig from the profile', async () => {
    const rig: RigSetup = { ...DEFAULT_RIG, baseCm: [17.5, 9], dropHeightCm: 5, spot: 'seat-middle' };
    const store = await storeWith();
    await calibrate(store, rig);

    const [person] = await store.listPeople();
    const reference = person?.references['rig-drop'];
    expect(reference?.stats.routine).toBe('rig-drop');
    expect(reference?.stats.repCount).toBeGreaterThanOrEqual(3);
    expect(reference?.reps.every((rep) => rep.trace.rig?.spot === 'seat-middle')).toBe(true);
  });

  it('tests a surface against the reference and shows the verdict with the rig index "for this rig"', async () => {
    const store = await storeWith();
    await calibrate(store);
    const { root } = mount('#/test', store, undefined, padded(rigStream({ bounceRatio: 0.55 })));
    await flush();

    setValue(root, 'input[name="surface"]', 'Blue couch');
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-match]')).toMatch(/^\d+% match/);
    expect(text(root, '[data-direction]')).toMatch(/bouncier/);
    const index = text(root, '[data-rig-index]');
    expect(index).toContain('for this rig');
    expect(index).toMatch(/peak [\d.]+ g/);
    expect(index).toMatch(/bounce ratio [\d.]+/);
    const [record] = await store.listTests();
    expect(record?.routine).toBe('rig-drop');
    expect(record?.index?.peak.center).toBeGreaterThan(0);
    expect(record?.reps.length).toBeGreaterThanOrEqual(5);
  });

  it('blocks the rig test with a prompt to calibrate when the rig has no reference', async () => {
    const { root } = mount('#/test', await storeWith());
    await flush();

    expect(text(root, '[data-block]')).toContain('Calibrate');
    expect(q<HTMLButtonElement>(root, '[data-action="start-test"]').disabled).toBe(true);
  });

  it('lists a caveat when the rig setup differs from the one used for calibration', async () => {
    const store = await storeWith();
    await calibrate(store);
    const [person] = await store.listPeople();
    await store.savePerson({ ...person!, rig: { ...DEFAULT_RIG, baseCm: [17.5, 9], dropHeightCm: 8 } });
    const { root } = mount('#/test', store, undefined, padded(rigStream({ dropHeightCm: 8, bounceRatio: 0.1 })));
    await flush();

    setValue(root, 'input[name="surface"]', 'Blue couch');
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-caveats]').toLowerCase()).toContain('rig setup');
  });

  it('shows no rig caveat when the rig is the same', async () => {
    const store = await storeWith();
    await calibrate(store);
    const { root } = mount('#/test', store, undefined, padded(rigStream()));
    await flush();

    setValue(root, 'input[name="surface"]', 'Blue couch');
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-caveats]').toLowerCase()).not.toContain('rig setup');
  });
});

describe('measure only', () => {
  it('shows the rig index with no reference, no match and no verdict', async () => {
    const store = await storeWith();
    const { root } = mount('#/test', store, undefined, padded(rigStream()));
    await flush();

    q<HTMLInputElement>(root, 'input[name="mode"][value="measure"]').click();
    await flush();
    expect(q<HTMLButtonElement>(root, '[data-action="start-test"]').disabled).toBe(false);
    expect(text(root, '[data-block]')).toBe('');
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-rig-index]')).toContain('for this rig');
    expect(root.querySelector('[data-match]')).toBeNull();
    expect(root.querySelector('[data-direction]')).toBeNull();
    expect(root.querySelector('[data-confidence]')).toBeNull();
    expect(text(root, '[data-result]')).toContain('Measure only');
  });

  it('does not need a surface name', async () => {
    const { root } = mount('#/test', await storeWith(), undefined, padded(rigStream()));
    await flush();

    q<HTMLInputElement>(root, 'input[name="mode"][value="measure"]').click();
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-form-error]')).toBe('');
    expect(root.querySelector('[data-rig-index]')).not.toBeNull();
  });

  it('says nothing was saved, and saves no test', async () => {
    const store = await storeWith();
    const { root } = mount('#/test', store, undefined, padded(rigStream()));
    await flush();

    q<HTMLInputElement>(root, 'input[name="mode"][value="measure"]').click();
    q<HTMLButtonElement>(root, '[data-action="start-test"]').click();
    await flush();

    expect(text(root, '[data-result]')).toContain('not saved');
    expect(await store.listTests()).toEqual([]);
  });
});
