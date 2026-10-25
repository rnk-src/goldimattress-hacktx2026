import { afterEach, describe, expect, it } from 'vitest';
import type { Coach } from '../coach';
import type { Person, RepResult, TestRecord, Verdict } from '../domain';
import { createReplaySource } from '../sensors';
import { DEFAULT_RIG, analyzeRep, buildReference, compare, summarize } from '../signal';
import { createLocalStore } from '../store';
import type { Store } from '../store';
import { memoryStorage, synthRep } from '../testkit';
import type { SynthOptions } from '../testkit';
import { startApp } from './index';

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = '';
});

const rigRep = (seed: number, extra: Partial<SynthOptions> = {}): SynthOptions => ({
  routine: 'rig-drop',
  dropHeightCm: 5,
  sampleRateHz: 57,
  durationS: 5,
  seed,
  ...extra,
});

const withRig = (rep: SynthOptions) => ({ ...synthRep(rep), rig: { ...DEFAULT_RIG, baseCm: [17.5, 9] as [number, number] } });
const analyzed = (extra: Partial<SynthOptions> = {}, count = 5): RepResult[] =>
  Array.from({ length: count }, (_, i) => analyzeRep(withRig(rigRep(i + 1, extra))));

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const BOGUS: Verdict = {
  hardness: 9,
  springiness: 9,
  hardnessLabel: 'much',
  springinessLabel: 'much',
  firmer: true,
  bouncier: true,
  match: 1,
  perFeatureZ: { peak: 9, peakOverV: 9, stopTime: 9, bounceRatio: 9, settleTime: 9 },
  hardnessInterval: [9, 9],
  springinessInterval: [9, 9],
  confidence: 'confident',
  hardnessReliable: false,
  caveats: [],
};

async function seed(options: { testReps?: RepResult[]; withReference?: boolean } = {}) {
  const store = createLocalStore(memoryStorage());
  const refReps = analyzed({ bounceRatio: 0.2 });
  const built = buildReference(refReps, 'rig-drop');
  if (!built.ok) throw new Error('fixture reference failed');
  const person: Person = {
    id: 'person-1',
    name: 'Alex',
    references: options.withReference === false ? {} : { 'rig-drop': { stats: built.ref, reps: refReps } },
  };
  await store.savePerson(person);
  await store.saveSurface({ id: 's1', name: 'Blue couch', type: 'couch' });
  const reps = options.testReps ?? analyzed({ bounceRatio: 0.5 });
  const record: TestRecord = {
    id: 't1',
    personId: 'person-1',
    surfaceId: 's1',
    routine: 'rig-drop',
    createdAt: '2026-10-24T17:00:00.000Z',
    device: 'iPhone',
    sampleRateHz: 57,
    reps,
    verdict: BOGUS,
  };
  await store.saveTest(record);
  return { store, built, reps };
}

function mount(store: Store) {
  const coach: Coach = { play() {}, keepAwake: () => Promise.resolve(), setMuted() {}, dispose() {} };
  const root = document.createElement('main');
  document.body.append(root);
  window.location.hash = '#/history';
  startApp(root, {
    source: createReplaySource({ routine: 'rig-drop', sampleRateHz: 57, device: 'x', startedAt: 'x', samples: [] }),
    store,
    makeCoach: () => coach,
    now: () => new Date('2026-10-24T17:00:00.000Z'),
    device: 'iPhone',
    newId: () => 'id',
  });
  return root;
}

const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent ?? '';

describe('saved tests screen', () => {
  it('lists each saved test with its surface, routine and match', async () => {
    const { store } = await seed();
    const root = mount(store);
    await flush();

    const row = text(root, '[data-test-row]');
    expect(row).toContain('Blue couch');
    expect(row).toContain('1% match');
    expect(row.toLowerCase()).toContain('rig');
  });

  it('says so when there are no saved tests', async () => {
    const root = mount(createLocalStore(memoryStorage()));
    await flush();

    expect(text(root, '[data-history-empty]')).toContain('No saved tests');
  });

  it('re-runs analysis on the stored traces and updates the verdict and the rig index', async () => {
    const { store, built, reps } = await seed();
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    const [record] = await store.listTests();
    const fresh = reps.map((rep) => analyzeRep(rep.trace));
    expect(record?.verdict.match).toBeCloseTo(compare(fresh, built.ref).match, 0);
    expect(record?.verdict.match).not.toBe(1);
    expect(record?.index?.peak.center).toBeCloseTo(summarize(fresh).features.peak.center, 1);
    expect(text(root, '[data-test-row]')).not.toContain('1% match');
    expect(text(root, '[data-history-status]')).toContain('updated');
  });

  it('keeps the old verdict and says why when the person no longer has the reference', async () => {
    const { store } = await seed({ withReference: false });
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    const [record] = await store.listTests();
    expect(record?.verdict.match).toBe(1);
    expect(text(root, '[data-history-status]')).toContain('reference');
  });

  it('keeps the old verdict and says why when no stored rep is usable', async () => {
    const dropped = Array.from({ length: 3 }, (_, i) => analyzeRep(withRig(rigRep(i + 1, { failure: 'left-surface' }))));
    const { store } = await seed({ testReps: dropped });
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    const [record] = await store.listTests();
    expect(record?.verdict.match).toBe(1);
    expect(text(root, '[data-history-status]')).toContain('usable');
  });

  it('says the verdict now compares with the current reference', async () => {
    const { store } = await seed();
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    expect(text(root, '[data-history-status]')).toContain('current reference');
  });

  it('warns when the reference was recorded with a different rig than the test', async () => {
    const { store } = await seed();
    const [person] = await store.listPeople();
    const reference = person!.references['rig-drop']!;
    const otherRig = { ...DEFAULT_RIG, baseCm: [17.5, 9] as [number, number], massKg: 3.4 };
    await store.savePerson({
      ...person!,
      references: { 'rig-drop': { ...reference, reps: reference.reps.map((rep) => ({ ...rep, trace: { ...rep.trace, rig: otherRig } })) } },
    });
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    expect(text(root, '[data-history-status]').toLowerCase()).toContain('different rig');
  });

  it('still lists the good tests when one stored test cannot be read', async () => {
    const { store } = await seed();
    await store.saveTest({
      id: 't2',
      personId: 'person-1',
      surfaceId: 's1',
      routine: 'future-drop' as 'rig-drop',
      createdAt: '2026-10-25T17:00:00.000Z',
      device: 'iPhone',
      sampleRateHz: 57,
      reps: [],
      verdict: BOGUS,
    });
    const root = mount(store);
    await flush();

    expect(root.querySelectorAll('[data-test-row]')).toHaveLength(2);
    expect(text(root, '[data-history-list]')).toContain('Blue couch');
    expect(text(root, '[data-history-list]')).toContain('future-drop');
    expect(text(root, '[data-history-status]')).toBe('');
  });

  it('does not run the same test twice when its button is clicked twice', async () => {
    const { store } = await seed();
    let saves = 0;
    const counting: Store = {
      ...store,
      saveTest: async (test) => {
        saves += 1;
        await store.saveTest(test);
      },
    };
    const root = mount(counting);
    await flush();
    const button = root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!;

    button.click();
    button.click();
    await flush();

    expect(saves).toBe(1);
  });

  it('keeps the rest and skipped-rest facts the session recorded', async () => {
    const reps = analyzed({ bounceRatio: 0.5 }).map((rep, i) => (rep.ok ? { ...rep, restS: 20, restSkipped: i === 1 } : rep));
    const { store } = await seed({ testReps: reps });
    const root = mount(store);
    await flush();

    root.querySelector<HTMLButtonElement>('[data-action="rerun"]')!.click();
    await flush();

    const [record] = await store.listTests();
    const kept = record!.reps.filter((rep) => rep.ok);
    expect(kept[1]!.ok && kept[1]!.restSkipped).toBe(true);
    expect(kept[0]!.ok && kept[0]!.restS).toBe(20);
  });
});

describe('surface autocomplete', () => {
  it('suggests saved surfaces by prefix as the user types', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'person-1', name: 'Alex', references: {} });
    await store.saveSurface({ id: 's1', name: 'Blue couch', type: 'couch' });
    await store.saveSurface({ id: 's2', name: 'Blue mattress', type: 'mattress' });
    await store.saveSurface({ id: 's3', name: 'Grey chair', type: 'chair' });
    const root = mount(store);
    window.location.hash = '#/test';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();

    const input = root.querySelector<HTMLInputElement>('input[name="surface"]')!;
    input.value = 'blue';
    input.dispatchEvent(new Event('input'));
    await flush();

    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = [...document.querySelectorAll(`datalist#${listId} option`)].map((o) => (o as HTMLOptionElement).value);
    expect(options.sort()).toEqual(['Blue couch', 'Blue mattress']);
  });
});
