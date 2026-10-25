import { describe, expect, it } from 'vitest';
import type { RepResult, Trace } from '../domain';
import { loadFixture } from '../testkit';
import { analyzeRep, buildReference } from './index';

/** Five sit-drops on a desk chair, iPhone. Rep 1 was done badly on purpose: the phone sat off the sternum. */
const traces = loadFixture('desk-chair-set1').traces;
const good = traces.slice(1);

const accepted = (trace: Trace) => {
  const result = analyzeRep(trace);
  if (!result.ok) throw new Error(`rejected: ${result.reasons.join(', ')}`);
  return result;
};

describe('analyzeRep on the real desk-chair recording', () => {
  it('accepts the four good reps', () => {
    const got = good.map((t) => {
      const r = analyzeRep(t);
      return r.ok ? 'ok' : r.reasons.join(',');
    });
    expect(got).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('gives the good reps finite, plausible features', () => {
    for (const trace of good) {
      const { features, impactSpeed, leanDeg } = accepted(trace);
      expect(impactSpeed).toBeGreaterThan(0.3);
      expect(impactSpeed).toBeLessThan(2);
      expect(leanDeg).toBeLessThan(15);
      expect(features.peakOverV).toBeGreaterThan(5);
      expect(features.peakOverV).toBeLessThan(40);
      expect(features.stopTime).toBeGreaterThan(0.05);
      expect(features.stopTime).toBeLessThan(0.6);
      expect(features.bounceRatio).toBeGreaterThanOrEqual(0);
      expect(features.bounceRatio).toBeLessThan(1);
      expect(Number.isFinite(features.settleTime)).toBe(true);
    }
  });

  it('measures impact speeds within 35% of their median across the good reps', () => {
    const speeds = good.map((t) => accepted(t).impactSpeed).sort((a, b) => a - b);
    const median = (speeds[1]! + speeds[2]!) / 2;
    for (const v of speeds) expect(Math.abs(v - median) / median).toBeLessThan(0.35);
  });

  it('accepts the good reps when every time is 100 s later', () => {
    for (const trace of good) {
      const shifted = { ...trace, samples: trace.samples.map((s) => ({ ...s, t: s.t + 100 })) };
      expect(accepted(shifted).impactSpeed).toBeCloseTo(accepted(trace).impactSpeed, 6);
    }
  });

  it('ignores the 0.3 s stalls that fall long after the impact', () => {
    const stalled = good.filter((t) => t.samples.some((s, i) => i > 0 && s.t - t.samples[i - 1]!.t > 0.3));
    expect(stalled).toHaveLength(3);
    for (const trace of stalled) expect(analyzeRep(trace).ok).toBe(true);
  });

  it('does not let the badly placed rep 1 through as a normal rep of the set', () => {
    const results: RepResult[] = traces.map((t) => analyzeRep(t));
    const reference = buildReference(results, 'sit-drop');
    expect(reference.ok).toBe(false);
    if (!reference.ok) expect(reference.outliers[0]).toBe(0);
  });

  it('builds a reference from the good reps with a fifth good rep added', () => {
    const results = [...good, good[0]!].map((t) => analyzeRep(t));
    expect(buildReference(results, 'sit-drop').ok).toBe(true);
  });
});
