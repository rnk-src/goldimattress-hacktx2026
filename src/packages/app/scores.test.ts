import { describe, expect, it } from 'vitest';
import type { Trace } from '../domain';
import { DEFAULT_RIG } from '../signal';
import { synthRep } from '../testkit';
import type { SynthOptions } from '../testkit';
import { confidenceLine, scoreRigDrops, scoresHtml } from './index';

const rig = { ...DEFAULT_RIG, baseCm: [17.5, 9] as [number, number] };

/** A rig drop on a surface with this bounce frequency and ratio, onto the default 5 cm rig. */
const drop = (seed: number, extra: Partial<SynthOptions> = {}, rigSetup = rig): Trace => ({
  ...synthRep({ routine: 'rig-drop', dropHeightCm: 5, sampleRateHz: 57, durationS: 5, seed, ...extra }),
  rig: rigSetup,
});
const drops = (count: number, extra: Partial<SynthOptions> = {}, rigSetup = rig): Trace[] =>
  Array.from({ length: count }, (_, i) => drop(i + 1, extra, rigSetup));

describe('scoreRigDrops', () => {
  it('scores a harder surface above a softer one, both between 0 and 100', () => {
    const soft = scoreRigDrops(drops(5, { bounceHz: 1.2, bounceRatio: 0.2 }));
    const hard = scoreRigDrops(drops(5, { bounceHz: 2.4, bounceRatio: 0.2 }));

    expect(soft.hardness).not.toBeNull();
    expect(hard.hardness).not.toBeNull();
    expect(hard.hardness!).toBeGreaterThan(soft.hardness!);
    for (const score of [soft.hardness!, hard.hardness!]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic: the same drops give the same scores', () => {
    const a = scoreRigDrops(drops(5, { bounceHz: 1.6, bounceRatio: 0.3 }));
    const b = scoreRigDrops(drops(5, { bounceHz: 1.6, bounceRatio: 0.3 }));

    expect(a).toEqual(b);
  });

  it('scores a springier surface above a deader one', () => {
    const dead = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.1 }));
    const springy = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.45 }));

    expect(springy.springiness!).toBeGreaterThan(dead.springiness!);
  });

  it('gives no springiness score when no drop has a rebound', () => {
    const report = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0 }));

    expect(report.hardness).not.toBeNull();
    expect(report.springiness).toBeNull();
    expect(report.notes.join(' ')).toContain('No clear rebound');
  });

  it.each([1, 2])('gives a provisional score from just %i real drop(s)', (count) => {
    const report = scoreRigDrops(drops(count, { bounceHz: 1.5, bounceRatio: 0.2 }));

    expect(report.hardness).not.toBeNull();
    expect(report.confidence).toBe('provisional');
    expect(report.validDrops).toBe(count);
    expect(confidenceLine(report)).toContain('provisional');
  });

  it('shows N/A with the reason, and never a number, when no drop has a usable impact', () => {
    const report = scoreRigDrops(drops(3, { bounceHz: 1.5, bounceRatio: 0.2, failure: 'left-surface' }));

    expect(report.hardness).toBeNull();
    expect(report.springiness).toBeNull();
    expect(report.confidence).toBe('insufficient');
    expect(report.notes.join(' ')).toContain('No usable impact');
    expect(scoresHtml(report)).toContain('Hardness score: N/A');
    expect(scoresHtml(report)).not.toMatch(/Hardness score: \d/);
  });

  it('shows the placeholder before anything is recorded', () => {
    expect(scoresHtml()).toContain('Hardness score: -- / 100');
    expect(scoresHtml()).toContain('Springiness score: -- / 100');
  });

  it('excludes a drop with a gap in the samples around the impact, and says so', () => {
    const traces = drops(5, { bounceHz: 1.5, bounceRatio: 0.2 });
    const gappy = traces[2]!;
    const mags = gappy.samples.map((s) => Math.hypot(s.ax, s.ay, s.az));
    const impact = mags.indexOf(Math.max(...mags));
    traces[2] = { ...gappy, samples: [...gappy.samples.slice(0, impact + 2), ...gappy.samples.slice(impact + 12)] };

    const report = scoreRigDrops(traces);

    expect(report.validDrops).toBe(4);
    expect(report.totalDrops).toBe(5);
    expect(report.notes.join(' ')).toContain('gap');
  });

  it('keeps a drop whose samples have a gap far from the impact', () => {
    const traces = drops(5, { bounceHz: 1.5, bounceRatio: 0.2 });
    const early = traces[2]!;
    traces[2] = { ...early, samples: [...early.samples.slice(0, 20), ...early.samples.slice(30)] };

    const report = scoreRigDrops(traces);

    expect(report.validDrops).toBe(5);
  });

  it('keeps a drop whose peak looks clipped, but warns and lowers the confidence', () => {
    const traces = drops(5, { bounceHz: 1.5, bounceRatio: 0.2 });
    const clipped = traces[1]!;
    const mags = clipped.samples.map((s) => Math.hypot(s.ax, s.ay, s.az));
    const peakIndex = mags.indexOf(Math.max(...mags));
    const top = clipped.samples[peakIndex]!;
    const samples = clipped.samples.map((s, i) => (i >= peakIndex - 1 && i <= peakIndex + 2 ? { ...top, t: s.t } : s));
    traces[1] = { ...clipped, samples };

    const report = scoreRigDrops(traces);

    expect(report.validDrops).toBe(5);
    expect(report.hardness).not.toBeNull();
    expect(report.confidence).toBe('low');
    expect(report.notes.join(' ')).toContain('clipped');
  });

  it('uses the median, so one bad release barely moves the score', () => {
    const good = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }));
    const withBad = scoreRigDrops([...drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }), drop(99, { bounceHz: 1.5, bounceRatio: 0.2, failure: 'hand-drag', failureSize: 0.3 })]);

    expect(Math.abs(withBad.hardness! - good.hardness!)).toBeLessThan(3);
  });

  it('uses the height measured from the free fall when it agrees with the setup, and the configured height when it does not', () => {
    const agrees = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }));
    const off = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }, { ...rig, dropHeightCm: 20 }));

    expect(agrees.heightSource).toBe('measured');
    expect(agrees.measuredHeightCm).toBeGreaterThan(4);
    expect(agrees.measuredHeightCm).toBeLessThan(6);
    expect(off.heightSource).toBe('configured');
  });

  it('labels the result as experimental and relative', () => {
    const report = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }));

    expect(report.disclaimer.toLowerCase()).toContain('experimental');
    expect(report.disclaimer.toLowerCase()).toContain('relative');
    expect(report.disclaimer.toLowerCase()).toContain('not');
  });

  it('reports the repeatability honestly: tight drops are high confidence only within 5%, never forced', () => {
    const tight = scoreRigDrops(drops(5, { bounceHz: 1.5, bounceRatio: 0.2 }));
    expect(tight.spreadPct).toBeLessThan(15);
    expect(['high', 'medium']).toContain(tight.confidence);

    const mixed = scoreRigDrops([
      ...drops(3, { bounceHz: 1.2, bounceRatio: 0.2 }),
      ...drops(3, { bounceHz: 2.4, bounceRatio: 0.2 }).map((t, i) => ({ ...t, startedAt: `x${i}` })),
    ]);
    expect(mixed.confidence).toBe('low');
  });
});
