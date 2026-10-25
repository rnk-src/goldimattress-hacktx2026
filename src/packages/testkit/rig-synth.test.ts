import { describe, expect, it } from 'vitest';
import type { Sample } from '../domain';
import { expectedFeatures, synthRep } from './index';
import type { SynthOptions } from './index';

const G = 9.81;
const mag = (s: Sample) => Math.hypot(s.ax, s.ay, s.az);
const angleFromZ = (s: Sample) => (Math.acos(s.az / mag(s)) * 180) / Math.PI;
const fallS = (cm: number, frac = 1) => Math.sqrt((2 * (cm / 100)) / (G * frac));
const rig = (opts: SynthOptions) =>
  synthRep({ routine: 'rig-drop', noise: 0, hoverS: 1, ...opts });

describe('synthRep rig-drop free fall', () => {
  it.each([
    [57, 5],
    [57, 10],
    [60, 5],
    [60, 10],
  ])('at %s Hz and %s cm, |a| is near 0 g for about sqrt(2h/g)', (sampleRateHz, dropHeightCm) => {
    const { samples } = rig({ sampleRateHz, dropHeightCm });
    const flight = samples.filter((s) => s.t < 1.2 && mag(s) < 0.1 * G);
    expect(Math.abs(flight.length - fallS(dropHeightCm) * sampleRateHz)).toBeLessThanOrEqual(1);
    expect(flight[0]!.t).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('hovers flat at 1 g before the release', () => {
    const hover = rig({ dropHeightCm: 10 }).samples.filter((s) => s.t < 0.9);
    for (const s of hover) {
      expect(mag(s)).toBeCloseTo(G, 9);
      expect(angleFromZ(s)).toBeCloseTo(0, 6);
    }
  });

  it.each([5, 10])('gains v = sqrt(2gh) over the fall at %s cm', (cm) => {
    const fall = rig({ sampleRateHz: 1000, dropHeightCm: cm }).samples.filter(
      (s) => s.t >= 1 && s.t < 1 + fallS(cm),
    );
    const speed = fall.reduce((sum, s) => sum + (G - mag(s)) * 0.001, 0);
    expect(speed).toBeCloseTo(Math.sqrt(2 * G * (cm / 100)), 1);
  });
});

describe('expectedFeatures for rig-drop', () => {
  /** Peak and bounce ratio read off a clean 1 kHz trace. */
  function measure(opts: SynthOptions) {
    const impactT = 1 + fallS(opts.dropHeightCm!);
    const samples = rig({ sampleRateHz: 1000, durationS: 6, ...opts }).samples.filter(
      (s) => s.t >= impactT,
    );
    const excess = samples.map((s) => mag(s) - G);
    const peaks: number[] = [];
    for (let i = 1; i < excess.length - 1; i++) {
      if (excess[i]! > 0.02 && excess[i]! > excess[i - 1]! && excess[i]! >= excess[i + 1]!) {
        peaks.push(excess[i]!);
      }
    }
    return { peak: Math.max(...excess), ratio: peaks[1]! / peaks[0]! };
  }

  it.each([5, 10])('at %s cm, matches the peak and bounce the trace has', (cm) => {
    const opts = { dropHeightCm: cm, bounceHz: 2, bounceRatio: 0.4 };
    const expected = expectedFeatures({ routine: 'rig-drop', ...opts });
    const measured = measure(opts);
    expect(Math.abs(expected.peak / measured.peak - 1)).toBeLessThan(0.01);
    expect(Math.abs(measured.ratio / expected.bounceRatio - 1)).toBeLessThan(0.02);
  });

  it('gives a 10 cm drop a higher peak than a 5 cm drop on the same surface, by about sqrt(2)', () => {
    const low = expectedFeatures({ routine: 'rig-drop', dropHeightCm: 5 }).peak;
    const high = expectedFeatures({ routine: 'rig-drop', dropHeightCm: 10 }).peak;
    expect(high / low).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe('expectedFeatures ignores a rig failure', () => {
  it.each([
    ['height-error', 1.5],
    ['hand-drag', 0.3],
  ] as const)('"%s" gives the clean-rep answer', (failure, failureSize) => {
    const clean = expectedFeatures({ routine: 'rig-drop', dropHeightCm: 10 });
    expect(expectedFeatures({ routine: 'rig-drop', dropHeightCm: 10, failure, failureSize })).toEqual(clean);
  });
});

describe('synthRep rig-drop failures', () => {
  it('"hand-drag" rejects a failureSize outside [0, 1)', () => {
    for (const failureSize of [1, 1.5, -0.2]) {
      expect(() => rig({ failure: 'hand-drag', failureSize })).toThrow(RangeError);
    }
  });

  it('"tilt" holds the phone failureSize degrees off flat for the whole trace', () => {
    const { samples } = rig({ dropHeightCm: 5, failure: 'tilt', failureSize: 12 });
    expect(angleFromZ(samples[0]!)).toBeCloseTo(12, 6);
    expect(angleFromZ(samples[samples.length - 1]!)).toBeCloseTo(12, 6);
  });

  it('"tilted-landing" is flat until impact, then tilted by failureSize degrees', () => {
    const { samples } = rig({ dropHeightCm: 5, failure: 'tilted-landing', failureSize: 15 });
    const impactT = 1 + fallS(5);
    const before = samples.filter((s) => s.t < 1 || (s.t > 1.02 && s.t < impactT - 0.02));
    for (const s of before) if (mag(s) > 1) expect(angleFromZ(s)).toBeCloseTo(0, 6);
    const after = samples.filter((s) => s.t > impactT + 0.5);
    for (const s of after) expect(angleFromZ(s)).toBeCloseTo(15, 6);
  });

  it('"hand-drag" falls at failureSize g, so the fall is slower and the impact is softer', () => {
    const dragged = rig({ sampleRateHz: 1000, dropHeightCm: 10, failure: 'hand-drag', failureSize: 0.3 });
    const fall = dragged.samples.filter((s) => s.t >= 1 && s.t < 1 + fallS(10, 0.7) - 0.005);
    for (const s of fall) expect(mag(s)).toBeCloseTo(0.3 * G, 6);
    const clean = rig({ sampleRateHz: 1000, dropHeightCm: 10 });
    const clear = fall.length / 1000;
    expect(clear).toBeGreaterThan(fallS(10) * 1.1);
    const peak = (t: typeof clean) => Math.max(...t.samples.map(mag));
    expect(peak(dragged)).toBeLessThan(peak(clean));
  });

  it('"height-error" releases from failureSize times the nominal height', () => {
    const { samples } = rig({ sampleRateHz: 1000, dropHeightCm: 5, failure: 'height-error', failureSize: 1.5 });
    const flight = samples.filter((s) => s.t < 1.3 && mag(s) < 0.1 * G).length / 1000;
    expect(flight).toBeCloseTo(fallS(7.5), 2);
  });

  it('"left-surface" still gives a 0 g flight after the bounce', () => {
    const flight = rig({ sampleRateHz: 1000, dropHeightCm: 5, failure: 'left-surface', failureSize: 0.2 })
      .samples.filter((s) => s.t > 1.3 && mag(s) < 0.1);
    expect(flight.length).toBeGreaterThanOrEqual(199);
  });

  it('"moving-hover" wobbles |a| during the hover', () => {
    const hover = rig({ dropHeightCm: 5, failure: 'moving-hover', failureSize: 1.2 }).samples.filter((s) => s.t < 1);
    expect(Math.max(...hover.map((s) => Math.abs(mag(s) - G)))).toBeGreaterThan(1.1);
  });

  it('"no-drop" stays at 1 g', () => {
    for (const s of rig({ dropHeightCm: 5, failure: 'no-drop', durationS: 4 }).samples) {
      expect(mag(s)).toBeCloseTo(G, 9);
    }
  });
});
