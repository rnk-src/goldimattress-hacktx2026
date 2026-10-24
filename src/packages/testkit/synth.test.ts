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

  it('accepts failure "none"', () => {
    expect(() => synthRep({ failure: 'none' })).not.toThrow();
  });
});

describe('synthRep timing and contact limits', () => {
  it.each([
    ['dropS', { dropS: 0 }],
    ['hoverS', { hoverS: -1 }],
    ['durationS', { durationS: 0 }],
    ['sampleRateHz', { sampleRateHz: 0 }],
  ])('rejects a non-positive %s', (_name, opts) => {
    expect(() => synthRep(opts)).toThrow(RangeError);
  });

  it('rejects options where the surface would have to pull below 0 g', () => {
    expect(() => synthRep({ impactSpeed: 2.5, bounceHz: 5, bounceRatio: 0.9 })).toThrow(RangeError);
  });
});

describe('synthRep failure "tilt"', () => {
  it('leans failureSize degrees further from the axis than leanDeg', () => {
    const s = synthRep({ noise: 0, leanDeg: 15, failure: 'tilt', failureSize: 7 }).samples[0]!;
    expect(angleFrom(s, 'ay')).toBeCloseTo(22, 6);
  });
});

describe('synthRep failure "moving-hover"', () => {
  const hoverMag = (opts: Parameters<typeof synthRep>[0]) =>
    synthRep({ noise: 0, hoverS: 1, ...opts }).samples.filter((s) => s.t < 1).map(mag);

  it('wobbles |a| by failureSize m/s² during the hover', () => {
    const wobble = hoverMag({ failure: 'moving-hover', failureSize: 1.2 }).map((m) => m - G);
    expect(Math.max(...wobble)).toBeGreaterThan(1.1);
    expect(Math.min(...wobble)).toBeLessThan(-1.1);
    expect(Math.max(...wobble)).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  it('leaves the descent and the response unchanged', () => {
    const still = synthRep({ noise: 0 }).samples.filter((s) => s.t >= 1);
    const moving = synthRep({ noise: 0, failure: 'moving-hover' }).samples.filter((s) => s.t >= 1);
    expect(moving).toEqual(still);
  });
});

describe('synthRep failure "no-drop"', () => {
  it('stays at 1 g for the whole trace', () => {
    const { samples } = synthRep({ noise: 0, durationS: 6, failure: 'no-drop' });
    for (const s of samples) expect(mag(s)).toBeCloseTo(G, 9);
  });
});

describe('synthRep failure "left-surface"', () => {
  const run = (opts: Parameters<typeof synthRep>[0]) =>
    synthRep({ sampleRateHz: 1000, noise: 0, ...opts }).samples.filter((s) => s.t > 1.3);

  it('drops |a| to 0 g for failureSize seconds after the first bounce', () => {
    const flight = run({ failure: 'left-surface', failureSize: 0.2 }).filter((s) => mag(s) < 0.1);
    expect(flight.length).toBeGreaterThanOrEqual(199);
    expect(flight.length).toBeLessThanOrEqual(201);
  });

  it('keeps the normal response above 0.1 g otherwise', () => {
    expect(run({}).filter((s) => mag(s) < 0.1)).toHaveLength(0);
  });
});

describe('synthRep failure "caught-landing"', () => {
  const excessAfterImpact = (opts: Parameters<typeof synthRep>[0]) =>
    synthRep({ sampleRateHz: 1000, noise: 0, ...opts })
      .samples.filter((s) => s.t >= 1.3)
      .map((s) => mag(s) - G);

  it('smears the impact into one slow hump that returns to 1 g after 1/(π·failureSize) s', () => {
    const excess = excessAfterImpact({ failure: 'caught-landing', failureSize: 0.5, bounceRatio: 0.4 });
    const stop = excess.findIndex((e) => e <= 0) / 1000;
    expect(stop).toBeCloseTo(1 / (Math.PI * 0.5), 1);
    const later = excess.slice(Math.round(stop * 1000) + 50);
    expect(Math.max(...later)).toBeLessThan(0.1);
  });

  it('is softer than the same rep landed normally', () => {
    const caught = Math.max(...excessAfterImpact({ failure: 'caught-landing' }));
    const normal = Math.max(...excessAfterImpact({}));
    expect(caught).toBeLessThan(normal / 2);
  });
});
