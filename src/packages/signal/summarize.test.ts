import { describe, expect, it } from 'vitest';
import type { RepResult } from '../domain';
import { summarize } from './index';

const rep = (peakOverV: number, weight = 1, extra: { leanDeg?: number; impactSpeed?: number; hoverJitter?: number } = {}): RepResult => ({
  ok: true,
  features: { peak: 5, peakOverV, stopTime: 0.2, bounceRatio: 0.4, settleTime: 1.5 },
  impactSpeed: 0.6,
  leanDeg: 15,
  hoverJitter: 0.1,
  ...extra,
  weight,
  issues: [],
  trace: { routine: 'sit-drop', sampleRateHz: 60, device: 'test', startedAt: '2026-01-01T00:00:00.000Z', samples: [] },
});

describe('summarize', () => {
  it('moves less than the mean and lands closer to the truth than the median on 5 reps with one outlier', () => {
    const truth = 20;
    const values = [19, 19.8, 20.4, 20.6, 30];
    const centre = summarize(values.map((v) => rep(v))).features.peakOverV.center;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(centre - truth)).toBeLessThan(Math.abs(mean - truth));
    expect(Math.abs(centre - truth)).toBeLessThan(Math.abs(20.4 - truth));
  });

  it('falls back to the weighted median below 5 reps', () => {
    const s = summarize([19, 20, 20.4, 30].map((v) => rep(v)));
    expect(s.features.peakOverV.center).toBeCloseTo(20.2);
  });

  it('reports n and the mean weight', () => {
    const s = summarize([rep(20, 1), rep(20, 0.5), rep(20, 0.9)]);
    expect(s.n).toBe(3);
    expect(s.meanWeight).toBeCloseTo(0.8);
  });

  it('keeps the scaled MAD free of trimming', () => {
    const s = summarize([19, 19.8, 20.4, 20.6, 30].map((v) => rep(v)));
    // median 20.4; deviations 1.4 0.6 0 0.2 9.6; MAD 0.6; scaled 0.8896
    expect(s.features.peakOverV.mad).toBeCloseTo(1.4826 * 0.6);
  });

  it('splits a value on the trim cut line by weight', () => {
    // weights 1 1 2 1 0.5, total 5.5, keep [1.1, 4.4]: 20 x0.9, 30 x2, 40 x0.4
    const reps = [10, 20, 30, 40, 50].map((v, i) => rep(v, [1, 1, 2, 1, 0.5][i]!));
    expect(summarize(reps).features.peakOverV.center).toBeCloseTo((18 + 60 + 16) / 3.3);
  });

  it('throws on zero total weight instead of returning NaN', () => {
    expect(() => summarize([rep(20, 0), rep(21, 0)])).toThrow(RangeError);
  });

  it('gives lean, impact speed and hover jitter the same centre rule as the features', () => {
    const lean = [10, 11, 14, 20, 60];
    const s = summarize(lean.map((leanDeg, i) => rep(20, 1, { leanDeg, hoverJitter: [0.1, 0.1, 0.2, 0.4, 0.9][i]!, impactSpeed: 0.5 + 0.1 * i })));
    expect(s.leanDeg.center).toBeCloseTo(15); // trimmed mean of 11 14 20; the median is 14
    expect(s.hoverJitter.center).toBeCloseTo((0.1 + 0.2 + 0.4) / 3);
    expect(s.impactSpeed.center).toBeCloseTo(0.7);
    expect(s.leanDeg.mad).toBeCloseTo(1.4826 * 4); // about the median 14
  });

  it('counts only usable reps: a rep under the usable weight is ignored', () => {
    const s = summarize([rep(20), rep(20), rep(20), rep(99, 0.3)]);
    expect(s.n).toBe(3);
    expect(s.features.peakOverV.center).toBeCloseTo(20);
  });
});
