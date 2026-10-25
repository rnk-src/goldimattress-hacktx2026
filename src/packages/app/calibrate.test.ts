import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { Cue, FeatureStats, Person, ReferenceStats, Routine, Sample, Trace } from '../domain';
import { createReplaySource } from '../sensors';
import type { SensorSource } from '../sensors';
import { rejectMessage } from '../session';
import { routineSpec } from '../signal';
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

const stat = (center: number): FeatureStats => ({ center, mad: center / 10 });
const bridgeStats = (): ReferenceStats => ({
  routine: 'bridge-drop',
  repCount: 5,
  createdAt: '2026-10-24T16:00:00.000Z',
  features: { peak: stat(12), peakOverV: stat(10), stopTime: stat(0.2), bounceRatio: stat(0.4), settleTime: stat(1.5) },
  leanDeg: stat(10),
  impactSpeed: stat(0.6),
  jitterScale: 0.1,
});

function traceOf(samples: Sample[], routine: Routine = 'sit-drop'): Trace {
  return { routine, sampleRateHz: 60, device: 'Replay phone', startedAt: '2026-10-24T16:00:00.000Z', samples };
}

/** `reps` followed by good reps so the stream always holds enough clean ones to finish. */
function goodStream(reps: SynthOptions[], total = 7): Sample[] {
  const extra = Array.from({ length: total - reps.length }, (_, i) => ({ seed: 100 + i }));
  return synthStream([...reps, ...extra], REST_S);
}

interface Harness {
  root: HTMLElement;
  cues: Cue[];
  awake: boolean[];
  stop: () => void;
}

function storeWithPerson(): Store {
  const store = createLocalStore(memoryStorage());
  void store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
  return store;
}

function mount(source: SensorSource, hash = '#/calibrate', store: Store = storeWithPerson()): Harness {
  const cues: Cue[] = [];
  const awake: boolean[] = [];
  const coach: Coach = {
    play: (cue) => void cues.push(cue),
    keepAwake: (on) => {
      awake.push(on);
      return Promise.resolve();
    },
    setMuted() {},
    dispose() {},
  };
  const root = document.createElement('main');
  document.body.append(root);
  window.location.hash = hash;
  const stop = startApp(root, {
    source,
    store,
    makeCoach: () => coach,
    now: () => new Date('2026-10-24T16:00:00.000Z'),
    device: 'Replay phone',
    newId: () => 'test-id',
  });
  return { root, cues, awake, stop };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('calibrate screen', () => {
  it('blocks calibration and links to profile creation when nobody is selected', async () => {
    const { root } = mount(createReplaySource(traceOf([])), '#/calibrate', createLocalStore(memoryStorage()));
    await flush();

    expect(root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.disabled).toBe(true);
    expect(root.querySelector('[data-profile-prompt]')?.textContent).toContain('Create a profile');
    expect(root.querySelector('a[href="#/profile"]')).not.toBeNull();
  });

  it('saves a five-usable-rep sit-drop reference with raw traces and metadata', async () => {
    const store = createLocalStore(memoryStorage());
    const person: Person = { id: 'person-1', name: 'Alex', references: {} };
    await store.savePerson(person);
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const [saved] = await store.listPeople();
    const reference = saved?.references['sit-drop'];
    expect(reference?.stats.repCount).toBe(5);
    expect(reference?.reps).toHaveLength(5);
    expect(reference?.reps.every((rep) => rep.trace.samples.length > 0)).toBe(true);
    expect(reference?.reps.every((rep) => rep.trace.device === 'Replay phone')).toBe(true);
    expect(reference?.reps.every((rep) => rep.trace.startedAt !== '')).toBe(true);
  });

  it('saves calibration to the profile selected by the user', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    await store.savePerson({ id: 'person-2', name: 'Sam', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();
    const profile = root.querySelector<HTMLSelectElement>('select[name="person"]')!;
    profile.value = 'person-2';
    profile.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const people = await store.listPeople();
    expect(people.find((person) => person.id === 'person-1')?.references['sit-drop']).toBeUndefined();
    expect(people.find((person) => person.id === 'person-2')?.references['sit-drop']?.stats.repCount).toBe(5);
  });

  it('lets the user finish at three usable reps and saves a low-confidence reference', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const samples = synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], REST_S);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const { root } = mount(createReplaySource(traceOf(samples)), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();
    const finish = root.querySelector<HTMLButtonElement>('[data-action="finish-calibration"]');
    expect(finish?.disabled).toBe(false);
    finish?.click();
    await flush();

    const [saved] = await store.listPeople();
    expect(saved?.references['sit-drop']?.stats.repCount).toBe(3);
    expect(root.querySelector('[data-calibration-result]')?.textContent).toContain('low confidence');
  });

  it("drops one statistical outlier automatically and explains it without asking for a redo", async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const stream = goodStream([{ bounceRatio: 0.9, seed: 9 }], 7);
    const { root } = mount(createReplaySource(traceOf(stream)), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const [saved] = await store.listPeople();
    expect(saved?.references['sit-drop']?.stats.repCount).toBe(4);
    expect(root.querySelector('[data-calibration-result]')?.textContent).toContain(
      "dropped 1 rep that didn't match the others",
    );
    expect(root.querySelector('[data-calibration-result]')?.textContent).not.toContain('redo');
  });

  it('finishes a sloppy session within ten attempts and still saves the reference', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const sloppy = [
      { failure: 'caught-landing' },
      { failure: 'moving-hover' },
      { failure: 'left-surface' },
      { failure: 'no-drop' },
    ] as const;
    const { root } = mount(
      createReplaySource(traceOf(goodStream(sloppy.map((rep, i) => ({ ...rep, seed: 50 + i })), 10))),
      '#/calibrate',
      store,
    );
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const [saved] = await store.listPeople();
    expect(saved?.references['sit-drop']?.stats.repCount).toBeGreaterThanOrEqual(3);
    expect(saved?.references['sit-drop']?.reps.length).toBeLessThanOrEqual(10);
  });

  it('shows usable reps out of five as the session goes', async () => {
    const { root } = mount(createReplaySource(traceOf(goodStream([]))));
    expect(root.querySelector('[data-usable-count]')?.textContent).toBe('0 of 5 usable reps');

    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelector('[data-usable-count]')?.textContent).toBe('5 of 5 usable reps');
  });

  it('says the reference was saved only after the store accepted it', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelector('[data-save-status]')?.textContent).toBe('Reference saved.');
  });

  it('tells the user when the reference could not be saved', async () => {
    const base = createLocalStore(memoryStorage());
    await base.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const store: Store = { ...base, savePerson: () => Promise.reject(new Error('Storage is full')) };
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const status = root.querySelector('[data-save-status]')?.textContent ?? '';
    expect(status).toContain('Could not save');
    expect(status).not.toContain('Reference saved');
  });

  it('keeps Start disabled until the profiles have loaded', async () => {
    const base = createLocalStore(memoryStorage());
    await base.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store: Store = { ...base, listPeople: async () => (await gate, base.listPeople()) };
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    const start = root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')!;

    expect(start.disabled).toBe(true);
    release();
    await flush();

    expect(start.disabled).toBe(false);
  });

  it('shows an error and keeps Start disabled when the profiles cannot load', async () => {
    const base = createLocalStore(memoryStorage());
    const store: Store = { ...base, listPeople: () => Promise.reject(new Error('storage unavailable')) };
    const { root } = mount(createReplaySource(traceOf([])), '#/calibrate', store);
    await flush();

    expect(root.querySelector('[data-profile-prompt]')?.textContent).toContain('Could not load profiles');
    expect(root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.disabled).toBe(true);
  });

  it('saves only its own routine and keeps what another tab saved meanwhile', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();
    const [stale] = await store.listPeople();
    const other = { stats: bridgeStats(), reps: [] };
    await store.savePerson({ ...stale!, references: { 'bridge-drop': other } });

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const [saved] = await store.listPeople();
    expect(saved?.references['sit-drop']?.stats.repCount).toBe(5);
    expect(saved?.references['bridge-drop']).toBeDefined();
  });

  it('stamps each saved rep with when that rep started', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const [saved] = await store.listPeople();
    const stamps = (saved?.references['sit-drop']?.reps ?? []).map((rep) => Date.parse(rep.trace.startedAt));
    expect(stamps).toHaveLength(5);
    // Each rep starts at least one rest after the previous one started.
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(REST_S * 1_000);
  });

  it('labels the finish button with the usable reps so far', async () => {
    const samples = synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 4 }], REST_S);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const { root } = mount(createReplaySource(traceOf(samples)));
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelector('[data-action="finish-calibration"]')?.textContent).toBe('Finish with 4 reps');
  });

  it('enables finish after three reps and disables it once the run is done', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const samples = synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], REST_S);
    const last = samples.at(-1)!;
    for (let i = 1; i <= 300; i += 1) samples.push({ ...last, t: last.t + i / 60 });
    const { root } = mount(createReplaySource(traceOf(samples)), '#/calibrate', store);
    await flush();
    const finish = root.querySelector<HTMLButtonElement>('[data-action="finish-calibration"]')!;
    expect(finish.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();
    expect(finish.hidden).toBe(false);
    expect(finish.disabled).toBe(false);
    finish.click();
    await flush();

    expect(finish.hidden).toBe(true);
    expect(finish.disabled).toBe(true);
  });

  it('offers the test screen once the reference is saved', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelector('[data-calibration-result] a')?.getAttribute('href')).toBe('#/test');
  });

  it('warns that calibrating again replaces the saved reference', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: { 'bridge-drop': { stats: bridgeStats(), reps: [] } } });
    const { root } = mount(createReplaySource(traceOf([])), '#/calibrate', store);
    await flush();
    expect(root.querySelector('[data-existing-reference]')?.textContent).toBe('');

    const routine = root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
    routine.value = 'bridge-drop';
    routine.dispatchEvent(new Event('change'));

    expect(root.querySelector('[data-existing-reference]')?.textContent).toContain('will replace');
  });

  it('warns about the reference it just saved when the same routine is picked again', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    const { root } = mount(createReplaySource(traceOf(goodStream([]))), '#/calibrate', store);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    const routine = root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
    routine.value = 'bridge-drop';
    routine.dispatchEvent(new Event('change'));
    routine.value = 'sit-drop';
    routine.dispatchEvent(new Event('change'));

    expect(root.querySelector('[data-existing-reference]')?.textContent).toContain('will replace');
  });

  it('fills one dot per accepted rep, coaches each cue and shows the feature means', async () => {
    const { root, cues } = mount(createReplaySource(traceOf(goodStream([]))));
    expect(root.textContent).toContain('sternum');
    expect(root.querySelectorAll('[data-rep-dots] li')).toHaveLength(5);

    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelectorAll('[data-rep-dots] li[data-state="accepted"]')).toHaveLength(5);
    expect(cues.map((c) => c.key)).toContain('drop-when-ready');
    expect(cues.filter((c) => c.key === 'rep-accepted')).toHaveLength(5);
    expect(cues.at(-1)?.key).toBe('done');
    const result = root.querySelector('[data-calibration-result]');
    expect(result?.textContent).toContain('5 accepted reps');
    expect(result?.textContent).toContain('peakOverV');
  });

  it('lets the user retry or switch routine after a run, clearing the old progress', async () => {
    const { root } = mount(createReplaySource(traceOf(goodStream([{ failure: 'caught-landing' }]))));
    const start = root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')!;
    const select = root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
    start.click();
    await flush();
    expect(start.disabled).toBe(false);
    expect(select.disabled).toBe(false);

    select.value = 'bridge-drop';
    select.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('[data-rep-dots] li[data-state="accepted"]')).toHaveLength(0);
    expect(root.querySelector('[data-rejected-reps]')?.children).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-calibration-result]')?.hidden).toBe(true);
  });

  it('keeps the fix for a rejected rep visible next to the rest cue', async () => {
    const stream = goodStream([{ failure: 'caught-landing' }]).slice(0, 420);
    const { root } = mount(createReplaySource(traceOf(stream)));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();
    expect(root.querySelector('[data-rep-feedback]')?.textContent).toContain(rejectMessage('caught-landing'));
    expect(root.querySelector('[data-cue-text]')?.textContent).toContain('Rest');
  });

  it('shows the fix for a rejected rep and does not fill a dot for it', async () => {
    const stream = goodStream([{ failure: 'caught-landing' }]);
    const { root } = mount(createReplaySource(traceOf(stream)));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();

    expect(root.querySelector('[data-rejected-reps]')?.textContent).toContain(rejectMessage('caught-landing'));
    expect(root.querySelectorAll('[data-rep-dots] li[data-state="accepted"]')).toHaveLength(5);
  });

  it('explains a motion block instead of starting', async () => {
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('denied'),
      start() {
        throw new Error('should not start');
      },
      stop() {},
      sampleRateHz: null,
    };
    const { root } = mount(source);
    await flush();
    const start = root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]');
    start?.click();
    await flush();
    expect(root.querySelector('[data-cue-text]')?.textContent).toContain('Motion access is blocked');
    expect(start?.disabled).toBe(false);
  });

  it('does not start anything when the user leaves before motion access resolves', async () => {
    let grant: (a: 'granted') => void = () => {};
    let starts = 0;
    const source: SensorSource = {
      requestAccess: () => new Promise((resolve) => void (grant = resolve)),
      start() {
        starts += 1;
      },
      stop() {},
      sampleRateHz: null,
    };
    const { root, awake } = mount(source);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    window.location.hash = '#/permission';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    grant('granted');
    await flush();
    expect(starts).toBe(0);
    expect(awake).toEqual([]);
  });

  it('does not offer rig-drop, which needs a rig the calibrate screen cannot set', () => {
    const { root } = mount(createReplaySource(traceOf([])));
    const values = Array.from(root.querySelectorAll<HTMLOptionElement>('select[name="routine"] option'), (o) => o.value);
    expect(values).toEqual(['sit-drop', 'bridge-drop']);
  });

  it('shows the bridge-drop placement and rest time from the routine spec', () => {
    const { root } = mount(createReplaySource(traceOf([])));
    const select = root.querySelector<HTMLSelectElement>('select[name="routine"]');
    if (select) select.value = 'bridge-drop';
    select?.dispatchEvent(new Event('change'));
    const spec = routineSpec('bridge-drop');
    expect(root.querySelector('[data-placement]')?.textContent).toContain('lower belly');
    expect(root.querySelector('[data-placement]')?.textContent).toContain(`Stay still for ${spec.captureS} s`);
  });

  it('stops the sensor and releases the wake lock when the user leaves', async () => {
    let stops = 0;
    let onSample: ((s: Sample) => void) | undefined;
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start(cb) {
        onSample = cb;
      },
      stop() {
        stops += 1;
      },
      sampleRateHz: null,
    };
    const { root, awake } = mount(source);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();
    expect(awake).toEqual([true]);
    window.location.hash = '#/permission';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(stops).toBe(1);
    expect(awake).toEqual([true, false]);
    expect(onSample).toBeDefined();
    expect(root.textContent).toContain('Enable motion');
  });
});

describe('routes', () => {
  it('links to calibrate and profile from the first screen', () => {
    const { root } = mount(createReplaySource(traceOf([])), '#/permission');
    expect(root.querySelector('a[href="#/calibrate"]')).not.toBeNull();
    expect(root.querySelector('a[href="#/profile"]')).not.toBeNull();
  });

  it('creates a profile on the profile route with the injected store and id', async () => {
    const { root } = mount(createReplaySource(traceOf([])), '#/profile');
    await flush();
    const form = root.querySelector('form[aria-label="Create profile"]');
    expect(form).not.toBeNull();
    root.querySelector<HTMLInputElement>('input[name=name]')!.value = 'Rounak';
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('ul[aria-label="Profiles"]')?.textContent).toContain('Rounak');
    expect(root.querySelector('a[href="#/permission"]')).not.toBeNull();
  });

  it('does not leak a rejection when the profile list cannot load, even after leaving', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', record);
    const base = createLocalStore(memoryStorage());
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/profile';
    startApp(root, {
      source: createReplaySource(traceOf([])),
      store: { ...base, listPeople: () => Promise.reject(new Error('storage unavailable')) },
      makeCoach: () => ({ play() {}, keepAwake: () => Promise.resolve(), setMuted() {}, dispose() {} }),
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });
    await flush();
    window.location.hash = '#/permission';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', record);
    expect(unhandled).toEqual([]);
  });
});
