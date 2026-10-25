import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { Cue, Person, Routine, Sample, Trace } from '../domain';
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
    const stream = goodStream([{ bounceHz: 8, seed: 9 }], 5);
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

  it('fills one dot per accepted rep, coaches each cue and shows the feature means', async () => {
    const { root, cues } = mount(createReplaySource(traceOf(goodStream([]))));
    expect(root.textContent).toContain('sternum');
    expect(root.querySelectorAll('[data-rep-dots] li')).toHaveLength(5);

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
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    await flush();
    expect(root.querySelector('[data-rep-feedback]')?.textContent).toContain(rejectMessage('caught-landing'));
    expect(root.querySelector('[data-cue-text]')?.textContent).toContain('Rest');
  });

  it('shows the fix for a rejected rep and does not fill a dot for it', async () => {
    const stream = goodStream([{ failure: 'caught-landing' }]);
    const { root } = mount(createReplaySource(traceOf(stream)));
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
    root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')?.click();
    window.location.hash = '#/permission';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    grant('granted');
    await flush();
    expect(starts).toBe(0);
    expect(awake).toEqual([]);
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
