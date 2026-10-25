import { describe, expect, it } from 'vitest';
import type { RepResult } from '../domain';
import { summarize } from './index';

const rep = (peakOverV: number, weight = 1): RepResult => ({
  ok: true,
  features: { peakOverV, stopTime: 0.2, bounceRatio: 0.4, settleTime: 1.5 },
  impactSpeed: 0.6,
  leanDeg: 15,
  hoverJitter: 0.1,
  weight,
  issues: [],
  trace: { routine: 'sit-drop', sampleRateHz: 60, device: 'test', startedAt: '2026-01-01T00:00:00.000Z', samples: [] },
});

describe('summarize', () => {
  it('moves less than the mean and lands closer to the truth than the median on 5 reps with one outlier', () => {
    const truth = 20;
    const values = [19, 19.8, 20.4, 20.6, 30];
    const centre = summarize(values.map((v) => rep(v))).features.peakOverV.median;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(centre - truth)).toBeLessThan(Math.abs(mean - truth));
    expect(Math.abs(centre - truth)).toBeLessThan(Math.abs(20.4 - truth));
  });

  it('falls back to the weighted median below 5 reps', () => {
    const s = summarize([19, 20, 20.4, 30].map((v) => rep(v)));
    expect(s.features.peakOverV.median).toBeCloseTo(20.2);
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
});
