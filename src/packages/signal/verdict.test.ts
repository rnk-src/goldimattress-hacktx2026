import { describe, expect, it } from 'vitest';
import type { FeatureName, ReferenceStats, RepFeatures, RepResult, Routine } from '../domain';
import { buildReference, compare } from './index';

const trace = (routine: Routine = 'sit-drop') => ({
  routine,
  sampleRateHz: 60,
  device: 'test',
  startedAt: '2026-01-01T00:00:00.000Z',
  samples: [],
});

const BASE: RepFeatures = { peakOverV: 20, stopTime: 0.2, bounceRatio: 0.4, settleTime: 1.5 };

function rep(
  f: Partial<RepFeatures> = {},
  o: { impactSpeed?: number; leanDeg?: number; routine?: Routine; weight?: number; hoverJitter?: number } = {},
): RepResult {
  return {
    ok: true,
    features: { ...BASE, ...f },
    impactSpeed: o.impactSpeed ?? 0.6,
    leanDeg: o.leanDeg ?? 15,
    hoverJitter: o.hoverJitter ?? 0.1,
    weight: o.weight ?? 1,
    trace: trace(o.routine),
  };
}

/** Reference with chosen per-feature std (default 10% of the mean). */
function ref(std: Partial<Record<FeatureName, number>> = {}, base: RepFeatures = BASE): ReferenceStats {
  const features = {} as ReferenceStats['features'];
  for (const k of Object.keys(base) as FeatureName[]) features[k] = { median: base[k], mad: std[k] ?? 0.1 * base[k] };
  return {
    routine: 'sit-drop',
    repCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    features,
    leanDeg: { median: 15, mad: 1 },
    impactSpeed: { median: 0.6, mad: 0.02 },
    jitterScale: 0.1,
  };
}

describe('compare', () => {
  it('gives H = S = 0 and match 100 when test equals reference', () => {
    const v = compare([rep(), rep()], ref());
    expect(v.hardness).toBeCloseTo(0);
    expect(v.springiness).toBeCloseTo(0);
    expect(v.match).toBeCloseTo(100);
  });

  it('gives match 61 for H = 2, S = 0 and 37 for H = S = 2', () => {
    // 10% ref std, so a 20% shift is z = 2.
    const harder = rep({ peakOverV: 24, stopTime: 0.16 });
    const h = compare([harder], ref());
    expect(h.hardness).toBeCloseTo(2);
    expect(h.springiness).toBeCloseTo(0);
    expect(Math.round(h.match)).toBe(61);
    const both = compare([rep({ peakOverV: 24, stopTime: 0.16, bounceRatio: 0.48, settleTime: 1.8 })], ref());
    expect(both.springiness).toBeCloseTo(2);
    expect(Math.round(both.match)).toBe(37);
  });

  it('labels hardness just-right below 2, slightly from 2 to 3, much above 3', () => {
    const at = (shift: number) =>
      compare([rep({ peakOverV: 20 * (1 + 0.1 * shift), stopTime: 0.2 * (1 - 0.1 * shift) })], ref());
    expect(at(1.9).hardnessLabel).toBe('just-right');
    expect(at(2.1).hardnessLabel).toBe('slightly');
    expect(at(2.9).hardnessLabel).toBe('slightly');
    expect(at(3.1).hardnessLabel).toBe('much');
  });

  it('reports firmer for higher peakOverV and bouncier for higher bounceRatio', () => {
    const firm = compare([rep({ peakOverV: 30, stopTime: 0.1 })], ref());
    expect(firm.firmer).toBe(true);
    expect(firm.hardness).toBeGreaterThan(0);
    const soft = compare([rep({ peakOverV: 10, stopTime: 0.4 })], ref());
    expect(soft.firmer).toBe(false);
    expect(soft.hardness).toBeLessThan(0);
    expect(compare([rep({ bounceRatio: 0.7, settleTime: 2.5 })], ref()).bouncier).toBe(true);
    expect(compare([rep({ bounceRatio: 0.1, settleTime: 0.5 })], ref()).bouncier).toBe(false);
  });

  it('calls a 5% shift just right on a very consistent reference (8% floor)', () => {
    const v = compare([rep({ peakOverV: 21, stopTime: 0.19, bounceRatio: 0.42, settleTime: 1.575 })], ref({
      peakOverV: 0.01, stopTime: 0.0001, bounceRatio: 0.0001, settleTime: 0.0001,
    }));
    expect(v.hardnessLabel).toBe('just-right');
    expect(v.springinessLabel).toBe('just-right');
    expect(v.perFeatureZ.peakOverV).toBeCloseTo(1 / (0.08 * 20));
  });

  it('uses the absolute floor when bounceRatio is near 0', () => {
    const dead = { ...BASE, bounceRatio: 0 };
    const v = compare([rep({ bounceRatio: 0.03 })], ref({ bounceRatio: 0 }, dead));
    expect(v.perFeatureZ.bounceRatio).toBeCloseTo(1); // 0.03 / floor 0.03
  });

  it('ignores rejected reps', () => {
    const bad: RepResult = { ok: false, reasons: ['not-still'], trace: trace() };
    const v = compare([bad, rep(), bad], ref());
    expect(v.match).toBeCloseTo(100);
  });

  it('throws RangeError with no ok reps', () => {
    const bad: RepResult = { ok: false, reasons: ['not-still'], trace: trace() };
    expect(() => compare([bad], ref())).toThrow(RangeError);
    expect(() => compare([], ref())).toThrow(RangeError);
  });

  it('throws RangeError when the routine differs from the reference', () => {
    expect(() => compare([rep({}, { routine: 'bridge-drop' })], ref())).toThrow(RangeError);
  });

  it('labels springiness at the same thresholds', () => {
    const at = (shift: number) =>
      compare([rep({ bounceRatio: 0.4 * (1 + 0.1 * shift), settleTime: 1.5 * (1 + 0.1 * shift) })], ref());
    expect(at(1.9).springinessLabel).toBe('just-right');
    expect(at(2.1).springinessLabel).toBe('slightly');
    expect(at(3.1).springinessLabel).toBe('much');
  });
});

describe('buildReference', () => {
  const five = (over: (i: number) => RepResult = () => rep()) => [0, 1, 2, 3, 4].map(over);
  const peaks = (xs: number[], o: Parameters<typeof rep>[1] = {}) => xs.map((peakOverV) => rep({ peakOverV }, o));

  it('rejects fewer than 3 usable reps as too-few', () => {
    const bad: RepResult = { ok: false, reasons: ['not-still'], trace: trace() };
    expect(buildReference([rep(), rep(), bad], 'sit-drop')).toEqual({ ok: false, reason: 'too-few' });
  });

  it('does not count a rep below the usable weight of 0.5', () => {
    const r = buildReference([rep(), rep(), rep({}, { weight: 0.4 })], 'sit-drop');
    expect(r).toEqual({ ok: false, reason: 'too-few' });
  });

  it('builds a reference from 3 usable reps', () => {
    const r = buildReference([rep(), rep(), rep()], 'sit-drop');
    expect(r.ok).toBe(true);
  });

  it('computes the median and the scaled MAD per feature, lean and impact speed', () => {
    const reps = five((i) => rep({ peakOverV: 18 + i }, { impactSpeed: 0.6 + 0.01 * i, leanDeg: 14 + i }));
    const r = buildReference(reps, 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.ref.routine).toBe('sit-drop');
    expect(r.ref.repCount).toBe(5);
    expect(r.ref.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(r.ref.features.peakOverV.median).toBeCloseTo(20);
    expect(r.ref.features.peakOverV.mad).toBeCloseTo(1.4826);
    expect(r.ref.features.stopTime.mad).toBeCloseTo(0);
    expect(r.ref.leanDeg.median).toBeCloseTo(16);
    expect(r.ref.impactSpeed.median).toBeCloseTo(0.62);
  });

  it('weights the median by rep weight', () => {
    const reps = [rep({ peakOverV: 10 }), rep({ peakOverV: 20 }), rep({ peakOverV: 30 }, { weight: 1 })];
    const even = buildReference(reps, 'sit-drop');
    const heavy = buildReference([reps[0]!, reps[1]!, { ...(reps[2] as object), weight: 3 } as RepResult], 'sit-drop');
    if (!even.ok || !heavy.ok) throw new Error('expected ok');
    expect(even.ref.features.peakOverV.median).toBeCloseTo(20);
    expect(heavy.ref.features.peakOverV.median).toBeCloseTo(30);
  });

  it('drops a far outlier by itself when 5 or more reps are usable', () => {
    const r = buildReference(peaks([20, 20.2, 19.8, 20.1, 40]), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([4]);
    expect(r.ref.repCount).toBe(4);
    expect(r.ref.features.peakOverV.median).toBeCloseTo(20.05);
  });

  it('keeps every rep when fewer than 5 are usable', () => {
    const r = buildReference(peaks([20, 20.2, 40]), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
    expect(r.ref.repCount).toBe(3);
  });

  it('never drops below 3 reps', () => {
    const r = buildReference(peaks([20, 20, 20, 60, 90]), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.ref.repCount).toBeGreaterThanOrEqual(3);
  });

  it('reports dropped indexes into the input, counting rejected reps', () => {
    const bad: RepResult = { ok: false, reasons: ['not-still'], trace: trace() };
    const r = buildReference([bad, ...peaks([20, 20.2, 19.8, 20.1, 40])], 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([5]);
  });

  it('stores the median hover jitter of the kept reps as the jitter scale', () => {
    const reps = [0.1, 0.2, 0.3].map((hoverJitter) => rep({}, { hoverJitter }));
    const r = buildReference(reps, 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.ref.jitterScale).toBeCloseTo(0.2);
  });

  it('accepts a wide spread of impact speed and lean without failing', () => {
    const r = buildReference(five((i) => rep({}, { impactSpeed: 0.4 + 0.2 * i, leanDeg: 5 + 6 * i })), 'sit-drop');
    expect(r.ok).toBe(true);
  });

  it('throws RangeError when a rep routine differs from the routine argument', () => {
    const reps = five((i) => rep({}, { routine: i === 3 ? 'bridge-drop' : 'sit-drop' }));
    expect(() => buildReference(reps, 'sit-drop')).toThrow(RangeError);
  });
});
