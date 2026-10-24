import { describe, expect, it } from 'vitest';
import type { Sample, Trace } from '../domain';
import { synthReps } from './index';

const G = 9.81;
const mag = (s: Sample) => Math.hypot(s.ax, s.ay, s.az);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

const clean = { sampleRateHz: 1000, noise: 0, hoverS: 1, dropS: 0.3 } as const;

/** Impact speed read back from a clean trace: ∫(g − |a|)dt over the descent. */
const speedOf = (t: Trace) =>
  t.samples.filter((s) => s.t >= 1 && s.t < 1.3).reduce((sum, s) => sum + (G - mag(s)) * 0.001, 0);
/** Lean read back from the hover: angle between the sample and the y axis. */
const leanOf = (t: Trace) => (Math.acos(t.samples[0]!.ay / mag(t.samples[0]!)) * 180) / Math.PI;

describe('synthReps', () => {
  it('returns n traces', () => {
    expect(synthReps(5)).toHaveLength(5);
  });

  it('repeats exactly for the same seed', () => {
    const spread = { impactSpeed: 0.05 };
    expect(synthReps(4, { seed: 9 }, spread)).toEqual(synthReps(4, { seed: 9 }, spread));
  });

  it('gives each rep its own noise', () => {
    const [a, b] = synthReps(2);
    expect(a!.samples).not.toEqual(b!.samples);
  });

  it('makes identical reps when there is no spread and no noise', () => {
    const [a, b, c] = synthReps(3, { noise: 0 });
    expect(b!.samples).toEqual(a!.samples);
    expect(c!.samples).toEqual(a!.samples);
  });

  it.each(['impactSpeed', 'bounceHz', 'bounceRatio', 'leanDeg'] as const)(
    'spread.%s varies that parameter between reps',
    (key) => {
      const [a, b] = synthReps(2, { noise: 0 }, { [key]: 0.05 });
      expect(b!.samples).not.toEqual(a!.samples);
    },
  );

  it('draws impact speed with the requested mean and spread', () => {
    const speeds = synthReps(200, { ...clean, impactSpeed: 0.6 }, { impactSpeed: 0.06 }).map(speedOf);
    expect(mean(speeds)).toBeCloseTo(0.6, 1);
    expect(Math.abs(sd(speeds) / 0.06 - 1)).toBeLessThan(0.2);
  });

  it('draws lean with the requested mean and spread', () => {
    const leans = synthReps(200, { ...clean, leanDeg: 15 }, { leanDeg: 2 }).map(leanOf);
    expect(Math.abs(mean(leans) - 15)).toBeLessThan(0.5);
    expect(Math.abs(sd(leans) / 2 - 1)).toBeLessThan(0.2);
  });

  it('keeps every rep valid, even with an extreme spread', () => {
    const spread = { impactSpeed: 5, bounceHz: 5, bounceRatio: 5, leanDeg: 90 };
    expect(() => synthReps(100, {}, spread)).not.toThrow();
  });
});
