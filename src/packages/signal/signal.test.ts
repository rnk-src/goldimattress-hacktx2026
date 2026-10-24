import { describe, expect, it } from 'vitest';
import type { ReferenceStats, Routine, Sample } from '../domain';
import { synthRep } from '../testkit';
import type { SynthOptions } from '../testkit';
import { analyzeRep, assessHover, routineSpec } from './index';

/** The still part of a synthetic rep: everything before the drop. */
function hoverOf(opts: SynthOptions): Sample[] {
  const hoverS = opts.hoverS ?? 1;
  return synthRep(opts).samples.filter((s) => s.t < hoverS - 0.05);
}

/** A reference whose only used field is the lean. */
function refWithLean(routine: Routine, mean: number): ReferenceStats {
  const flat = { mean: 0, std: 0 };
  return {
    routine,
    repCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    features: { peakOverV: flat, stopTime: flat, bounceRatio: flat, settleTime: flat },
    leanDeg: { mean, std: 1 },
    impactSpeed: { mean: 0.6, std: 0.03 },
  };
}

describe('routineSpec', () => {
  it.each(['sit-drop', 'bridge-drop'] as const)('gives %s a usable timing and tolerances', (routine) => {
    const spec = routineSpec(routine);
    expect(spec.preRollS).toBeGreaterThanOrEqual(1);
    expect(spec.hoverMinS).toBeGreaterThanOrEqual(0.3);
    expect(spec.restS).toBe(20);
    expect(spec.leanTolDeg).toBe(5);
    expect(spec.speedTol).toBe(0.2);
  });

  it('gives the bridge drop a longer capture than the sit-drop', () => {
    expect(routineSpec('bridge-drop').captureS).toBeGreaterThan(routineSpec('sit-drop').captureS);
  });
});

describe('assessHover', () => {
  it('calls a still hover still and reports its lean within 1 degree', () => {
    const result = assessHover(hoverOf({ leanDeg: 15 }), 'sit-drop');
    expect(result.still).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(Math.abs(result.leanDeg - 15)).toBeLessThan(1);
  });

  it('measures the bridge-drop lean from the belly normal', () => {
    const result = assessHover(hoverOf({ routine: 'bridge-drop', leanDeg: 8 }), 'bridge-drop');
    expect(Math.abs(result.leanDeg - 8)).toBeLessThan(1);
  });

  it('rejects a moving hover as not-still', () => {
    const result = assessHover(hoverOf({ failure: 'moving-hover' }), 'sit-drop');
    expect(result.still).toBe(false);
    expect(result.reasons).toEqual(['not-still']);
  });

  it('rejects a lean 7 degrees above the reference as lean-too-much', () => {
    const result = assessHover(hoverOf({ leanDeg: 22 }), 'sit-drop', refWithLean('sit-drop', 15));
    expect(result.reasons).toEqual(['lean-too-much']);
  });

  it('rejects a lean 7 degrees below the reference as lean-too-little', () => {
    const result = assessHover(hoverOf({ leanDeg: 8 }), 'sit-drop', refWithLean('sit-drop', 15));
    expect(result.reasons).toEqual(['lean-too-little']);
  });

  it('accepts a lean within 5 degrees of the reference', () => {
    const result = assessHover(hoverOf({ leanDeg: 19 }), 'sit-drop', refWithLean('sit-drop', 15));
    expect(result.reasons).toEqual([]);
  });

  it('ignores the lean when there is no reference', () => {
    expect(assessHover(hoverOf({ leanDeg: 60 }), 'sit-drop').reasons).toEqual([]);
  });

  it('gives the same jitter and lean for a phone turned about its torso axis or with flipped axes', () => {
    const plain = assessHover(hoverOf({ leanDeg: 12, seed: 5 }), 'sit-drop');
    const turned = assessHover(hoverOf({ leanDeg: 12, seed: 5, rotation: [0, 70, 0] }), 'sit-drop');
    const flipped = assessHover(
      hoverOf({ leanDeg: 12, seed: 5 }).map((s) => ({ ...s, ax: -s.ax, ay: -s.ay })),
      'sit-drop',
    );
    for (const other of [turned, flipped]) {
      expect(other.leanDeg).toBeCloseTo(plain.leanDeg, 0);
      expect(other.jitter).toBeCloseTo(plain.jitter, 1);
    }
  });

  it('calls a window shorter than 0.3 s not-still, since stillness is unproven', () => {
    const result = assessHover(hoverOf({}).slice(0, 10), 'sit-drop');
    expect(result.reasons).toEqual(['not-still']);
  });
});

describe('analyzeRep rejection', () => {
  it('finds no drop in a trace that only hovers', () => {
    const result = analyzeRep(synthRep({ failure: 'no-drop', durationS: 4 }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasons).toEqual(['no-drop-found']);
  });

  it.each([0.5, 1, 3, 4.5])('finds a drop that starts %s s into a 6 s trace and judges its hover', (hoverS) => {
    const result = analyzeRep(synthRep({ hoverS, durationS: 6, leanDeg: 15 }));
    expect(result.ok === false && result.reasons).toEqual([]);
  });

  it('rejects a moving hover as not-still', () => {
    const result = analyzeRep(synthRep({ failure: 'moving-hover', hoverS: 2, durationS: 6 }));
    expect(result.ok === false && result.reasons).toEqual(['not-still']);
  });

  it('rejects a lean 7 degrees past the reference as lean-too-much', () => {
    const trace = synthRep({ leanDeg: 15, failure: 'tilt', failureSize: 7 });
    const result = analyzeRep(trace, refWithLean('sit-drop', 15));
    expect(result.ok === false && result.reasons).toEqual(['lean-too-much']);
  });

  it('rejects a rep whose mass leaves the surface as left-surface', () => {
    const result = analyzeRep(synthRep({ failure: 'left-surface' }));
    expect(result.ok === false && result.reasons).toEqual(['left-surface']);
  });

  it('rejects a 30 Hz trace as low-sample-rate', () => {
    const result = analyzeRep(synthRep({ sampleRateHz: 30 }));
    expect(result.ok === false && result.reasons).toEqual(['low-sample-rate']);
  });

  it('does not throw on an empty trace', () => {
    const trace = { ...synthRep(), samples: [] };
    expect(analyzeRep(trace).ok).toBe(false);
  });
});
