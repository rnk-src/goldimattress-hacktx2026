import { describe, expect, it } from 'vitest';
import type { Sample } from '../domain';
import { synthRep } from './index';

const G = 9.81;
const mag = (s: Sample) => Math.hypot(s.ax, s.ay, s.az);
const angleFrom = (s: Sample, axis: 'ax' | 'ay' | 'az') =>
  (Math.acos(s[axis] / mag(s)) * 180) / Math.PI;

describe('synthRep trace shape', () => {
  it('carries the requested routine and rate, with samples spaced 1/rate apart', () => {
    const trace = synthRep({ routine: 'bridge-drop', sampleRateHz: 100, durationS: 2 });
    expect(trace.routine).toBe('bridge-drop');
    expect(trace.sampleRateHz).toBe(100);
    expect(trace.samples).toHaveLength(200);
    expect(trace.samples[3]!.t).toBeCloseTo(0.03, 10);
  });

  it('defaults to a 60 Hz sit-drop of 3.5 s', () => {
    const trace = synthRep();
    expect(trace.routine).toBe('sit-drop');
    expect(trace.sampleRateHz).toBe(60);
    expect(trace.samples).toHaveLength(210);
  });
});

describe('synthRep hover', () => {
  it('sits at exactly 1 g with no noise', () => {
    const hover = synthRep({ noise: 0, hoverS: 1 }).samples.filter((s) => s.t < 0.9);
    for (const s of hover) expect(mag(s)).toBeCloseTo(G, 9);
  });

  it('stays within a few noise sigma of 1 g with the default noise', () => {
    const hover = synthRep({ hoverS: 1, seed: 7 }).samples.filter((s) => s.t < 0.9);
    for (const s of hover) expect(Math.abs(mag(s) - G)).toBeLessThan(0.3);
  });
});

describe('synthRep determinism', () => {
  it('repeats exactly for the same seed', () => {
    expect(synthRep({ seed: 3 })).toEqual(synthRep({ seed: 3 }));
  });

  it('differs for a different seed', () => {
    expect(synthRep({ seed: 3 }).samples).not.toEqual(synthRep({ seed: 4 }).samples);
  });
});

describe('synthRep orientation', () => {
  it('rotation leaves |a| unchanged at every sample', () => {
    const plain = synthRep({ noise: 0, seed: 1 }).samples;
    const turned = synthRep({ noise: 0, seed: 1, rotation: [30, 40, 50] }).samples;
    plain.forEach((s, i) => expect(mag(turned[i]!)).toBeCloseTo(mag(s), 9));
  });

  it('tilts a sit-drop away from the y axis by leanDeg', () => {
    const s = synthRep({ noise: 0, leanDeg: 15 }).samples[0]!;
    expect(angleFrom(s, 'ay')).toBeCloseTo(15, 6);
  });

  it('tilts a bridge drop away from the z axis by leanDeg', () => {
    const s = synthRep({ routine: 'bridge-drop', noise: 0, leanDeg: 10 }).samples[0]!;
    expect(angleFrom(s, 'az')).toBeCloseTo(10, 6);
  });
});

describe('synthRep drop', () => {
  const clean = { sampleRateHz: 1000, noise: 0, hoverS: 1, dropS: 0.3 } as const;

  it('falls at partial g for dropS, so |a| is below 1 g', () => {
    const s = synthRep({ ...clean, impactSpeed: 0.6 }).samples[1150]!;
    expect(mag(s)).toBeCloseTo(G - 0.6 / 0.3, 6);
  });

  it('gains the requested impact speed over the descent, ∫(g − |a|)dt', () => {
    const fall = synthRep({ ...clean, impactSpeed: 0.8 }).samples.filter(
      (s) => s.t >= 1 && s.t < 1.3,
    );
    const speed = fall.reduce((sum, s) => sum + (G - mag(s)) * 0.001, 0);
    expect(speed).toBeCloseTo(0.8, 2);
  });
});

describe('synthRep bounce', () => {
  /** Times and heights of the local maxima of |a| above 1 g. */
  function bouncePeaks(opts: Parameters<typeof synthRep>[0]) {
    const samples = synthRep({ sampleRateHz: 1000, noise: 0, ...opts }).samples;
    const excess = samples.map((s) => mag(s) - G);
    const peaks: { t: number; a: number }[] = [];
    for (let i = 1; i < excess.length - 1; i++) {
      if (excess[i]! > 0.02 && excess[i]! > excess[i - 1]! && excess[i]! >= excess[i + 1]!) {
        peaks.push({ t: samples[i]!.t, a: excess[i]! });
      }
    }
    return peaks;
  }

  it.each([
    [2, 0.4],
    [1, 0.8],
    [3, 0.05],
  ])('at %s Hz and ratio %s, the first two peaks match within 2%%', (bounceHz, bounceRatio) => {
    const [p1, p2] = bouncePeaks({ bounceHz, bounceRatio });
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p2!.a / p1!.a).toBeCloseTo(bounceRatio, 1);
    expect(Math.abs(p2!.a / p1!.a / bounceRatio - 1)).toBeLessThan(0.02);
    expect(Math.abs((1 / (p2!.t - p1!.t)) / bounceHz - 1)).toBeLessThan(0.02);
  });

  it('has no second positive peak when bounceRatio is 0', () => {
    expect(bouncePeaks({ bounceRatio: 0 })).toHaveLength(1);
  });
});

describe('synthRep invalid options', () => {
  it('rejects an impact speed above free fall over dropS', () => {
    expect(() => synthRep({ impactSpeed: 3.1, dropS: 0.3 })).toThrow(RangeError);
  });

  it.each([1, 1.5, -0.1])('rejects bounceRatio %s', (bounceRatio) => {
    expect(() => synthRep({ bounceRatio })).toThrow(RangeError);
  });

  it('says a failure mode is not built yet instead of ignoring it', () => {
    expect(() => synthRep({ failure: 'tilt' })).toThrow(/not implemented/);
  });

  it('accepts failure "none"', () => {
    expect(() => synthRep({ failure: 'none' })).not.toThrow();
  });
});
