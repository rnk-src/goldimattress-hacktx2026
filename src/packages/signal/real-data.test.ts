import { describe, expect, it } from 'vitest';
import type { RepResult, Trace } from '../domain';
import { loadFixture } from '../testkit';
import { analyzeRep, assessHover, buildReference } from './index';

/** Hover lean of a trace whether or not analyzeRep accepts it: the window 0.6 to 1.0 s before the |a| peak. */
function hoverLean(trace: Trace): number {
  const mag = (s: Trace['samples'][number]) => Math.hypot(s.ax, s.ay, s.az);
  const peak = trace.samples.reduce((best, s) => (mag(s) > mag(best) ? s : best));
  const window = trace.samples.filter((s) => s.t >= peak.t - 1.0 && s.t < peak.t - 0.6);
  return assessHover(window, trace.routine).leanDeg;
}

/** Index of the rep with the largest hover lean: the badly placed one. The one shared selection. */
function oddRepOf(traces: readonly Trace[]): number {
  const leans = traces.map(hoverLean);
  return leans.indexOf(Math.max(...leans));
}

/**
 * Two real sets of five sit-drops, iPhone in Firefox: a desk chair (rep 1 done badly on purpose, the
 * phone was off the sternum) and a soft living-room couch (rep 1 has a bump in the hover).
 */
const accepted = (trace: Trace) => {
  const result = analyzeRep(trace);
  if (!result.ok) throw new Error(`rejected: ${result.reasons.join(', ')}`);
  return result;
};
const verdictOf = (trace: Trace) => {
  const r = analyzeRep(trace);
  return r.ok ? 'ok' : r.reasons.join(',');
};

describe('analyzeRep on the real desk-chair set', () => {
  it('accepts the four good reps', () => {
    const traces = loadFixture('desk-chair-set1').traces.slice(1);
    expect(traces.map(verdictOf)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('gives the good reps finite, plausible features', () => {
    for (const trace of loadFixture('desk-chair-set1').traces.slice(1)) {
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
    const speeds = loadFixture('desk-chair-set1')
      .traces.slice(1)
      .map((t) => accepted(t).impactSpeed)
      .sort((a, b) => a - b);
    const median = (speeds[1]! + speeds[2]!) / 2;
    for (const v of speeds) expect(Math.abs(v - median) / median).toBeLessThan(0.35);
  });

  it('accepts the good reps when every time is 100 s later', () => {
    for (const trace of loadFixture('desk-chair-set1').traces.slice(1)) {
      const shifted = { ...trace, samples: trace.samples.map((s) => ({ ...s, t: s.t + 100 })) };
      expect(accepted(shifted).impactSpeed).toBeCloseTo(accepted(trace).impactSpeed, 6);
    }
  });

  it('flags the badly placed rep first when the five reps form a reference', () => {
    const traces = loadFixture('desk-chair-set1').traces;
    const odd = oddRepOf(traces);
    expect(hoverLean(traces[odd]!)).toBeGreaterThan(30);
    const results: RepResult[] = traces.map((t) => analyzeRep(t));
    expect(results.every((r) => r.ok)).toBe(true);
    const reference = buildReference(results, 'sit-drop');
    expect(reference.ok).toBe(false);
    if (!reference.ok) expect(reference.outliers[0]).toBe(odd);
  });

  it('builds a reference from the good reps', () => {
    const good = loadFixture('desk-chair-set1').traces.slice(1);
    const results = [...good, good[0]!].map((t) => analyzeRep(t));
    expect(buildReference(results, 'sit-drop').ok).toBe(true);
  });
});

describe('analyzeRep on the real couch set', () => {
  const couch = () => loadFixture('couch-set1').traces;

  it('accepts the reps with a clean hover and a shallow, broken descent', () => {
    const t = couch();
    expect([1, 2, 4].map((i) => verdictOf(t[i]!))).toEqual(['ok', 'ok', 'ok']);
  });

  it('rejects the rep with a bump in the hover as not-still', () => {
    expect(verdictOf(couch()[0]!)).toBe('not-still');
  });

  it('rejects the rep whose legs were still moving in the hover as not-still', () => {
    expect(verdictOf(couch()[3]!)).toBe('not-still');
  });

  it('keeps the soft-couch features finite and plausible', () => {
    for (const i of [1, 2, 4]) {
      const { features, impactSpeed } = accepted(couch()[i]!);
      expect(impactSpeed).toBeGreaterThan(0.3);
      expect(impactSpeed).toBeLessThan(2);
      expect(features.stopTime).toBeLessThan(0.6);
      expect(features.peakOverV).toBeGreaterThan(3);
    }
  });
});

describe('analyzeRep with gaps in the real sets', () => {
  it('does not reject a rep for a stall that falls long after the impact', () => {
    let checked = 0;
    const goodReps = [
      ['desk-chair-set1', [1, 2, 3, 4]],
      ['couch-set1', [1, 2, 4]],
    ] as const;
    for (const [set, reps] of goodReps) {
      const all = loadFixture(set).traces;
      for (const trace of reps.map((i) => all[i]!)) {
        const { samples } = trace;
        const peak = samples.reduce((best, s, i) => (Math.hypot(s.ax, s.ay, s.az) > Math.hypot(samples[best]!.ax, samples[best]!.ay, samples[best]!.az) ? i : best), 0);
        const stall = samples.findIndex((s, i) => i > 0 && s.t - samples[i - 1]!.t > 0.3);
        if (stall < 0 || samples[stall]!.t - samples[peak]!.t < 2) continue;
        checked++;
        expect(verdictOf(trace)).toBe('ok');
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
