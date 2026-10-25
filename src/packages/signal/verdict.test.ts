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

const BASE: RepFeatures = { peak: 12, peakOverV: 20, stopTime: 0.2, bounceRatio: 0.4, settleTime: 1.5 };

function rep(
  f: Partial<RepFeatures> = {},
  o: { impactSpeed?: number; leanDeg?: number; routine?: Routine; weight?: number; hoverJitter?: number; restSkipped?: boolean } = {},
): RepResult {
  return {
    ok: true,
    features: { ...BASE, ...f },
    impactSpeed: o.impactSpeed ?? 0.6,
    leanDeg: o.leanDeg ?? 15,
    hoverJitter: o.hoverJitter ?? 0.1,
    weight: o.weight ?? 1,
    issues: [],
    ...(o.restSkipped === undefined ? {} : { restSkipped: o.restSkipped }),
    trace: trace(o.routine),
  };
}

/** Reference with chosen per-feature std (default 10% of the mean). */
function ref(std: Partial<Record<FeatureName, number>> = {}, base: RepFeatures = BASE): ReferenceStats {
  const features = {} as ReferenceStats['features'];
  for (const k of Object.keys(base) as FeatureName[]) features[k] = { center: base[k], mad: std[k] ?? 0.1 * base[k] };
  return {
    routine: 'sit-drop',
    repCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    features,
    leanDeg: { center: 15, mad: 1 },
    impactSpeed: { center: 0.6, mad: 0.02 },
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

  it('gives match 61 for H = 2, S = 0 and 37 for H = S = 2 once hardness is reliable', () => {
    const opts = { hardnessReliable: true };
    // 10% ref std, so a 20% shift is z = 2.
    const harder = rep({ peak: 14.4 });
    const h = compare([harder], ref(), opts);
    expect(h.hardness).toBeCloseTo(2);
    expect(h.springiness).toBeCloseTo(0);
    expect(Math.round(h.match)).toBe(61);
    const both = compare([rep({ peak: 14.4, bounceRatio: 0.48, settleTime: 1.8 })], ref(), opts);
    expect(both.springiness).toBeCloseTo(2);
    expect(Math.round(both.match)).toBe(37);
  });

  it('labels hardness just-right below 2, slightly from 2 to 3, much above 3', () => {
    const at = (shift: number) =>
      compare([rep({ peak: 12 * (1 + 0.1 * shift) })], ref());
    expect(at(1.9).hardnessLabel).toBe('just-right');
    expect(at(2.1).hardnessLabel).toBe('slightly');
    expect(at(2.9).hardnessLabel).toBe('slightly');
    expect(at(3.1).hardnessLabel).toBe('much');
  });

  it('reports firmer for higher peak and bouncier for higher bounceRatio', () => {
    const firm = compare([rep({ peak: 18 })], ref());
    expect(firm.firmer).toBe(true);
    expect(firm.hardness).toBeGreaterThan(0);
    const soft = compare([rep({ peak: 6 })], ref());
    expect(soft.firmer).toBe(false);
    expect(soft.hardness).toBeLessThan(0);
    expect(compare([rep({ bounceRatio: 0.7, settleTime: 2.5 })], ref()).bouncier).toBe(true);
    expect(compare([rep({ bounceRatio: 0.1, settleTime: 0.5 })], ref()).bouncier).toBe(false);
  });

  it('scores hardness on peak alone and records peakOverV and stopTime without scoring them', () => {
    const v = compare([rep({ peakOverV: 40, stopTime: 0.05 })], ref());
    expect(v.hardness).toBeCloseTo(0);
    expect(v.perFeatureZ.peakOverV).toBeGreaterThan(3);
    expect(v.perFeatureZ.stopTime).toBeLessThan(-3);
  });

  it('calls a 5% shift just right on a very consistent reference (8% floor)', () => {
    const v = compare([rep({ peak: 12.6, bounceRatio: 0.42, settleTime: 1.575 })], ref({
      peak: 0.01, stopTime: 0.0001, bounceRatio: 0.0001, settleTime: 0.0001,
    }));
    expect(v.hardnessLabel).toBe('just-right');
    expect(v.springinessLabel).toBe('just-right');
    expect(v.perFeatureZ.peak).toBeCloseTo(0.6 / (0.08 * 12));
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

describe('compare uncertainty', () => {
  const fiveOf = (f: Partial<RepFeatures> = {}, o: Parameters<typeof rep>[1] = {}) =>
    [0, 1, 2, 3, 4].map(() => rep(f, o));
  /** A 10% shift of both springiness features is z = 1 against the 10% reference spread. */
  const bouncy = (z: number) => ({ bounceRatio: 0.4 * (1 + 0.1 * z), settleTime: 1.5 * (1 + 0.1 * z) });

  it('matches on springiness alone until hardness is reliable', () => {
    const harder = compare([rep({ peak: 14.4 })], ref());
    expect(harder.hardnessReliable).toBe(false);
    expect(harder.match).toBeCloseTo(100);
    const bouncier = compare([rep(bouncy(2))], ref());
    expect(Math.round(bouncier.match)).toBe(61);
    expect(compare([rep()], ref(), { hardnessReliable: true }).hardnessReliable).toBe(true);
  });

  it('is confident with 5 usable reps that match the reference', () => {
    expect(compare(fiveOf(), ref()).confidence).toBe('confident');
  });

  it('says not-enough-data below 3 usable reps', () => {
    expect(compare([rep(), rep()], ref()).confidence).toBe('not-enough-data');
  });

  it('says not-enough-data when the usable reps are barely usable', () => {
    expect(compare(fiveOf({}, { weight: 0.5 }), ref()).confidence).toBe('not-enough-data');
  });

  it('calls a springiness score near a label boundary a close call', () => {
    expect(compare(fiveOf(bouncy(2)), ref()).confidence).toBe('close-call');
    expect(compare(fiveOf(bouncy(3.1)), ref()).confidence).toBe('close-call');
  });

  it('is confident when the springiness interval sits inside one label', () => {
    expect(compare(fiveOf(bouncy(0.5)), ref()).confidence).toBe('confident');
    expect(compare(fiveOf(bouncy(5)), ref()).confidence).toBe('confident');
  });

  it('ignores hardness for confidence while hardness is unreliable', () => {
    const harder = fiveOf({ peak: 14.4 });
    expect(compare(harder, ref()).confidence).toBe('confident');
  });

  it('gives each axis an interval of one standard error about the score', () => {
    const v = compare([rep(bouncy(1)), rep(bouncy(1)), rep(bouncy(1)), rep(bouncy(1))], ref());
    expect(v.springinessInterval[0]).toBeCloseTo(v.springiness - 0.5);
    expect(v.springinessInterval[1]).toBeCloseTo(v.springiness + 0.5);
  });

  it('widens the spread floor by 1.5 for a reference built from 3 or 4 reps', () => {
    const tight = { bounceRatio: 0.0001, settleTime: 0.0001 };
    const full = compare(fiveOf(bouncy(2)), ref(tight));
    const small = compare(fiveOf(bouncy(2)), { ...ref(tight), repCount: 3 });
    expect(small.springiness).toBeCloseTo(full.springiness / 1.5);
  });

  it('leaves the settle time out of the springiness score but still reports its z', () => {
    const v = compare(fiveOf({ settleTime: 3 }), ref());
    expect(v.springiness).toBeCloseTo(0);
    expect(v.perFeatureZ.settleTime).toBeGreaterThan(3);
  });

  it('takes the weighted median of the test reps, not the mean', () => {
    const v = compare([rep({ peakOverV: 20 }), rep({ peakOverV: 20 }), rep({ peakOverV: 40 })], ref());
    expect(v.perFeatureZ.peakOverV).toBeCloseTo(0);
  });

  it('does not count a rep below the usable weight', () => {
    const v = compare([rep(), rep(), rep(), rep({ bounceRatio: 0.9, settleTime: 5 }, { weight: 0.2 })], ref());
    expect(v.springiness).toBeCloseTo(0);
  });

  it('adds a lean caveat when the test lean differs from the reference by more than 10 degrees', () => {
    expect(compare(fiveOf({}, { leanDeg: 30 }), ref()).caveats).toContain('lean-differs');
    expect(compare(fiveOf({}, { leanDeg: 20 }), ref()).caveats).not.toContain('lean-differs');
  });

  it('adds a rest caveat when any rep skipped its rest', () => {
    const reps = [...fiveOf().slice(0, 4), rep({}, { restSkipped: true })];
    expect(compare(reps, ref()).caveats).toContain('rest-skipped');
    expect(compare(fiveOf(), ref()).caveats).toEqual([]);
  });
});

describe('buildReference', () => {
  const five = (over: (i: number) => RepResult = () => rep()) => [0, 1, 2, 3, 4].map(over);
  const peaks = (xs: number[], o: Parameters<typeof rep>[1] = {}) => xs.map((peak) => rep({ peak }, o));

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
    expect(r.ref.features.peakOverV.center).toBeCloseTo(20);
    expect(r.ref.features.peakOverV.mad).toBeCloseTo(1.4826);
    expect(r.ref.features.stopTime.mad).toBeCloseTo(0);
    expect(r.ref.leanDeg.center).toBeCloseTo(16);
    expect(r.ref.impactSpeed.center).toBeCloseTo(0.62);
  });

  it('weights the median by rep weight', () => {
    const reps = [rep({ peakOverV: 10 }), rep({ peakOverV: 20 }), rep({ peakOverV: 30 }, { weight: 1 })];
    const even = buildReference(reps, 'sit-drop');
    const heavy = buildReference([reps[0]!, reps[1]!, { ...(reps[2] as object), weight: 3 } as RepResult], 'sit-drop');
    if (!even.ok || !heavy.ok) throw new Error('expected ok');
    expect(even.ref.features.peakOverV.center).toBeCloseTo(20);
    expect(heavy.ref.features.peakOverV.center).toBeCloseTo(30);
  });

  it('drops a far outlier by itself when 5 or more reps are usable', () => {
    const r = buildReference(peaks([20, 20.2, 19.8, 20.1, 40]), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([4]);
    expect(r.ref.repCount).toBe(4);
    expect(r.ref.features.peak.center).toBeCloseTo(20.05);
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

  it('drops a rep whose lean differs from the person own other reps', () => {
    const leans = [10, 10, 11, 10, 45];
    const r = buildReference(leans.map((leanDeg) => rep({}, { leanDeg })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([4]);
  });

  it('keeps a rep that leans 16 degrees more than the person usual lean, which is ordinary', () => {
    const leans = [10, 10, 10, 10, 26];
    const r = buildReference(leans.map((leanDeg) => rep({}, { leanDeg })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
  });

  it('keeps reps that lean 27 to 44 degrees, as one person did on a chair', () => {
    const leans = [27, 28, 41, 42, 44];
    const r = buildReference(leans.map((leanDeg) => rep({}, { leanDeg })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
  });

  it('drops a rep whose impact speed differs from the person own other reps', () => {
    const speeds = [0.9, 1.0, 0.95, 1.0, 0.3];
    const r = buildReference(speeds.map((impactSpeed) => rep({}, { impactSpeed })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([4]);
  });

  it('keeps reps of a dead-foam reference whose bounce ratio is near 0', () => {
    const reps = [0, 0, 0.01, 0, 0.02].map((bounceRatio) => rep({ bounceRatio }));
    const r = buildReference(reps, 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
  });

  it('does not drop a rep for a wild settle time, which is too noisy to judge by', () => {
    const settles = [1, 1.1, 0.9, 1, 6];
    const r = buildReference(settles.map((settleTime) => rep({ settleTime })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
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

  it('stores the trimmed mean of 5 reps as the centre', () => {
    const r = buildReference([19, 19.8, 20.4, 20.6, 23].map((peakOverV) => rep({ peakOverV })), 'sit-drop');
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toEqual([]);
    expect(r.ref.features.peakOverV.center).toBeCloseTo((19.8 + 20.4 + 20.6) / 3);
  });
});

describe('compare centre', () => {
  it('uses the trimmed mean of 5 test reps', () => {
    const outlier = [19, 19.8, 20.4, 20.6, 30].map((peakOverV) => rep({ peakOverV }));
    const withTrim = compare(outlier, ref({ peakOverV: 1 }, { ...BASE, peakOverV: 20 }));
    expect(withTrim.perFeatureZ.peakOverV).toBeCloseTo(((19.8 + 20.4 + 20.6) / 3 - 20) / 1.6, 5);
  });
});

describe('5-rep reference against a short test', () => {
  // shortcut: the reference uses the trimmed mean at 5 reps and the test uses the median at 3 to 4; only finiteness is checked.
  it.each([3, 4])('gives a finite verdict for %i test reps', (n) => {
    const r = buildReference([19, 19.8, 20, 20.4, 21].map((v) => rep({ peakOverV: v })), 'sit-drop');
    if (!r.ok) throw new Error('reference should build');
    const v = compare(Array.from({ length: n }, (_, i) => rep({ peakOverV: 20 + i })), r.ref);
    for (const x of [...Object.values(v.perFeatureZ), v.hardness, v.springiness, v.match]) expect(Number.isFinite(x)).toBe(true);
  });
});
