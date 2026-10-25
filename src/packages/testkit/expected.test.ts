import { describe, expect, it } from 'vitest';
import type { Sample } from '../domain';
import { expectedFeatures, synthRep } from './index';
import type { SynthOptions } from './index';

const G = 9.81;
const mag = (s: Sample) => Math.hypot(s.ax, s.ay, s.az);

/** Reads the four features straight off a clean, long, 1 kHz trace. */
function measure(opts: SynthOptions) {
  const hoverS = 1;
  const dropS = 0.3;
  const impactT = hoverS + dropS;
  const samples = synthRep({
    sampleRateHz: 1000,
    noise: 0,
    durationS: 20,
    hoverS,
    dropS,
    ...opts,
  }).samples.filter((s) => s.t >= impactT - 1e-9);
  const excess = samples.map((s) => mag(s) - G);
  const peakIndex = excess.indexOf(Math.max(...excess));
  const stopIndex = excess.findIndex((e, i) => i > peakIndex && e <= 0);
  let settleIndex = 0;
  excess.forEach((e, i) => {
    if (Math.abs(e) > 0.05 * G) settleIndex = i;
  });
  const v = opts.impactSpeed ?? 0.6;
  return {
    peak: excess[peakIndex]!,
    peakOverV: excess[peakIndex]! / v,
    stopTime: samples[stopIndex]!.t - impactT,
    settleTime: samples[settleIndex]!.t - impactT,
  };
}

describe('expectedFeatures', () => {
  it.each([
    [2, 0.4],
    [1, 0.8],
    [3, 0.05],
    [2, 0],
  ])('at %s Hz and ratio %s, matches the waveform synthRep generates', (bounceHz, bounceRatio) => {
    const opts = { bounceHz, bounceRatio };
    const expected = expectedFeatures(opts);
    const measured = measure(opts);
    expect(expected.bounceRatio).toBe(bounceRatio);
    expect(Math.abs(expected.peak / measured.peak - 1)).toBeLessThan(0.01);
    expect(Math.abs(expected.peakOverV / measured.peakOverV - 1)).toBeLessThan(0.01);
    expect(Math.abs(expected.stopTime - measured.stopTime)).toBeLessThan(0.003);
    expect(Math.abs(expected.settleTime - measured.settleTime)).toBeLessThan(0.003);
  });

  it('does not depend on impact speed for peakOverV and stopTime (a_peak / v is a property of the surface)', () => {
    const slow = expectedFeatures({ impactSpeed: 0.4 });
    const fast = expectedFeatures({ impactSpeed: 0.8 });
    expect(fast.peakOverV).toBeCloseTo(slow.peakOverV, 9);
    expect(fast.stopTime).toBeCloseTo(slow.stopTime, 9);
  });

  it('settles later after a faster impact, because the ±0.05 g band is absolute', () => {
    expect(expectedFeatures({ impactSpeed: 0.8 }).settleTime).toBeGreaterThan(
      expectedFeatures({ impactSpeed: 0.4 }).settleTime,
    );
  });

  it('gives a firmer surface a higher peakOverV and a shorter stopTime', () => {
    const soft = expectedFeatures({ bounceRatio: 0.7, bounceHz: 1.5 });
    const firm = expectedFeatures({ bounceRatio: 0.7, bounceHz: 3 });
    expect(firm.peakOverV).toBeGreaterThan(soft.peakOverV);
    expect(firm.stopTime).toBeLessThan(soft.stopTime);
  });

  it('gives a springier surface a longer settleTime', () => {
    const dead = expectedFeatures({ bounceRatio: 0.1 });
    const springy = expectedFeatures({ bounceRatio: 0.7 });
    expect(springy.settleTime).toBeGreaterThan(dead.settleTime);
  });
});

describe('expectedFeatures contact limit', () => {
  it('rejects options synthRep cannot generate', () => {
    expect(() => expectedFeatures({ impactSpeed: 2.5, bounceHz: 5, bounceRatio: 0.9 })).toThrow(
      RangeError,
    );
  });
});
