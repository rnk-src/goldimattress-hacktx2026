import { describe, expect, it } from 'vitest';
import type { Person, RepResult, TestRecord, Verdict } from '../domain';
import { synthRep } from '../testkit';
import type { Store } from '../store';
import { withRepMetadata } from './index';

const verdict: Verdict = {
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
};

const rep = (): RepResult => ({
  ok: true,
  features: { peakOverV: 20, stopTime: 0.1, bounceRatio: 0.4, settleTime: 1.5 },
  impactSpeed: 0.6,
  leanDeg: 15,
  hoverJitter: 0.1,
  weight: 1,
  issues: [],
  trace: { ...synthRep(), device: '', startedAt: '' },
});

const testRecord = (): TestRecord => ({
  id: 't1',
  personId: 'p1',
  surfaceId: 's1',
  routine: 'sit-drop',
  createdAt: '2026-10-24T16:00:00.000Z',
  device: 'iPhone',
  sampleRateHz: 60,
  reps: [rep()],
  verdict,
});

describe('saved rep metadata', () => {
  it('fills device and startedAt on test reps when the app saves them', async () => {
    let saved: TestRecord | undefined;
    const store: Store = {
      listPeople: () => Promise.resolve([]),
      savePerson: () => Promise.resolve(),
      findSurfaces: () => Promise.resolve([]),
      saveSurface: () => Promise.resolve(),
      saveTest: (record) => {
        saved = record;
        return Promise.resolve();
      },
      listTests: () => Promise.resolve([]),
    };
    const appStore = withRepMetadata(store, 'iPhone', () => new Date('2026-10-24T17:00:00.000Z'));

    await appStore.saveTest(testRecord());

    expect(saved?.reps[0]?.trace).toMatchObject({
      device: 'iPhone',
      startedAt: '2026-10-24T17:00:00.000Z',
    });
  });

  it('fills device and startedAt on reference reps when the app saves a person', async () => {
    let saved: Person | undefined;
    const store: Store = {
      listPeople: () => Promise.resolve([]),
      savePerson: (person) => {
        saved = person;
        return Promise.resolve();
      },
      findSurfaces: () => Promise.resolve([]),
      saveSurface: () => Promise.resolve(),
      saveTest: () => Promise.resolve(),
      listTests: () => Promise.resolve([]),
    };
    const appStore = withRepMetadata(store, 'iPhone', () => new Date('2026-10-24T17:00:00.000Z'));
    const stats = { median: 1, mad: 0.1 };
    const person: Person = {
      id: 'p1',
      name: 'Ana',
      references: {
        'sit-drop': {
          stats: {
            routine: 'sit-drop',
            repCount: 1,
            createdAt: '2026-10-24T17:00:00.000Z',
            features: { peakOverV: stats, stopTime: stats, bounceRatio: stats, settleTime: stats },
            leanDeg: stats,
            impactSpeed: stats,
            jitterScale: 0.1,
          },
          reps: [rep()],
        },
      },
    };

    await appStore.savePerson(person);

    expect(saved?.references['sit-drop']?.reps[0]?.trace).toMatchObject({
      device: 'iPhone',
      startedAt: '2026-10-24T17:00:00.000Z',
    });
  });
});
