import { describe, expect, it } from 'vitest';
import type { RepResult, Trace } from '../domain';
import { expectedFeatures, synthRep } from '../testkit';
import type { SynthOptions } from '../testkit';
import { DEFAULT_RIG, analyzeRep } from './index';

/** A surface that keeps contact up to 16 cm drops (2 Hz and 0.4 would near 0 g at 10 cm). */
const SURFACE = { bounceHz: 1.5, bounceRatio: 0.2 };
const rig = (opts: SynthOptions): Trace => ({
  ...synthRep({ routine: 'rig-drop', noise: 0.05, hoverS: 1, ...SURFACE, ...opts }),
  rig: { ...DEFAULT_RIG, dropHeightCm: opts.dropHeightCm ?? 10 },
});

function usable(result: RepResult) {
  if (!result.ok) throw new Error(`rejected: ${result.reasons.join()}`);
  return result;
}

describe('analyzeRep on a rig-drop', () => {
  it.each([
    [57, 5],
    [57, 10],
    [60, 5],
    [60, 10],
  ])('at %s Hz and %s cm, matches the expected peak and bounce', (sampleRateHz, dropHeightCm) => {
    const opts = { sampleRateHz, dropHeightCm };
    const r = usable(analyzeRep(rig(opts)));
    const expected = expectedFeatures({ routine: 'rig-drop', ...SURFACE, ...opts });
    expect(r.weight).toBe(1);
    expect(r.issues).toEqual([]);
    // 57 Hz can sample past the peak, so allow 20%.
    expect(Math.abs(r.features.peak / expected.peak - 1)).toBeLessThan(0.2);
    expect(Math.abs(r.features.bounceRatio - expected.bounceRatio)).toBeLessThan(0.1);
  });

  it('takes the impact speed sqrt(2gh) from the trace rig height', () => {
    const r = usable(analyzeRep(rig({ dropHeightCm: 10 })));
    expect(r.impactSpeed).toBeCloseTo(Math.sqrt(2 * 9.81 * 0.1), 6);
  });

  it('falls back to the default 5 cm rig height and records the measured flight time', () => {
    const bare = synthRep({ routine: 'rig-drop', noise: 0.05, hoverS: 1, ...SURFACE, dropHeightCm: 5 });
    const r = usable(analyzeRep(bare));
    expect(r.impactSpeed).toBeCloseTo(Math.sqrt(2 * 9.81 * 0.05), 6);
    expect(Math.abs(r.flightS! / Math.sqrt((2 * 0.05) / 9.81) - 1)).toBeLessThan(0.2);
  });

  it.each(['hand-drag', 'height-error'] as const)('flags %s as flight-mismatch', (failure) => {
    const size = failure === 'hand-drag' ? 0.4 : 1.6;
    const r = usable(analyzeRep(rig({ dropHeightCm: 10, failure, failureSize: size })));
    expect(r.issues).toContain('flight-mismatch');
    expect(r.weight).toBeLessThan(1);
  });

  it('flags a tilted landing', () => {
    const r = usable(analyzeRep(rig({ dropHeightCm: 10, failure: 'tilted-landing' })));
    expect(r.issues).toContain('tilted-landing');
  });

  it('rejects a rep that leaves the surface again', () => {
    const r = analyzeRep(rig({ dropHeightCm: 10, failure: 'left-surface' }));
    expect(r.ok === false && r.reasons).toContain('left-surface');
  });

  it('finds no drop when nothing is released', () => {
    const r = analyzeRep(rig({ failure: 'no-drop' }));
    expect(r.ok === false && r.reasons).toEqual(['no-drop-found']);
  });

  it('scores a moving hover below full weight', () => {
    const r = usable(analyzeRep(rig({ dropHeightCm: 10, failure: 'moving-hover' })));
    expect(r.issues).toContain('not-still');
  });

});
