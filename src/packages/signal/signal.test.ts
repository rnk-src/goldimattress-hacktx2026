import { describe, expect, it } from 'vitest';
import type { ReferenceStats, Routine, Sample } from '../domain';
import { expectedFeatures, synthRep } from '../testkit';
import type { SynthOptions } from '../testkit';
import { DEFAULT_RIG, analyzeRep, assessHover, createPositionTracker, routineSpec } from './index';

/** The still part of a synthetic rep: everything before the drop. */
function hoverOf(opts: SynthOptions): Sample[] {
  const hoverS = opts.hoverS ?? 1;
  return synthRep(opts).samples.filter((s) => s.t < hoverS - 0.05);
}

/** A reference whose only used field is the lean. */
function refWithLean(routine: Routine, median: number): ReferenceStats {
  const flat = { median: 0, mad: 0 };
  return {
    routine,
    repCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    features: { peakOverV: flat, stopTime: flat, bounceRatio: flat, settleTime: flat },
    leanDeg: { median, mad: 1 },
    impactSpeed: { median: 0.6, mad: 0.03 },
    jitterScale: 0.1,
  };
}

describe('routineSpec', () => {
  it.each(['sit-drop', 'bridge-drop'] as const)('gives %s a usable timing and tolerances', (routine) => {
    const spec = routineSpec(routine);
    expect(spec.preRollS).toBeGreaterThanOrEqual(1);
    expect(spec.hoverMinS).toBeGreaterThanOrEqual(0.3);
    expect(spec.restS).toBe(20);
    expect(spec.maxLeanDeg).toBeGreaterThan(0);
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

  it.each([0.5, 1, 3, 4.5])('accepts a rep whose drop starts %s s into a 6 s trace', (hoverS) => {
    const result = analyzeRep(synthRep({ hoverS, durationS: 6, leanDeg: 15 }));
    expect(result.ok).toBe(true);
  });

  it('drops a hover far too violent to be a hover as not-still', () => {
    const result = analyzeRep(synthRep({ failure: 'moving-hover', failureSize: 4, hoverS: 2, durationS: 6 }));
    expect(result.ok === false && result.reasons).toEqual(['not-still']);
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

describe('analyzeRep impact speed', () => {
  it.each([0.3, 0.6, 1.0])('measures an impact speed of %s m/s within 10%%', (impactSpeed) => {
    const result = analyzeRep(synthRep({ impactSpeed, bounceHz: 1.5, bounceRatio: 0.3 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Math.abs(result.impactSpeed / impactSpeed - 1)).toBeLessThan(0.1);
  });
});

/** The rate x bounce grid from the spec. A seeded fraction of a sample shifts the drop between samples. */
const GRID = [60, 100].flatMap((sampleRateHz) =>
  [1, 1.5, 2, 3].flatMap((bounceHz) =>
    [0.05, 0.2, 0.4, 0.8].map((bounceRatio, i) => {
      const phase = ((bounceHz * 7 + i * 3 + sampleRateHz) % 10) / 10;
      const opts: SynthOptions = {
        sampleRateHz,
        bounceHz,
        bounceRatio,
        // A fast hit on a springy surface nearly leaves it, which analyzeRep rejects as left-surface.
        impactSpeed: bounceRatio >= 0.8 ? 0.4 : 0.6,
        hoverS: 1 + phase / sampleRateHz,
        durationS: 16,
        seed: 100 * bounceHz + i,
      };
      return [`${sampleRateHz} Hz, ${bounceHz} Hz bounce, ratio ${bounceRatio}`, opts] as const;
    }),
  ),
);

describe('analyzeRep features against the analytic answers', () => {
  it.each(GRID.map(([name, opts]) => ({ name, opts })))('peakOverV within 10% at $name', ({ opts }) => {
    const result = analyzeRep(synthRep(opts));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.features.peakOverV / expectedFeatures(opts).peakOverV - 1)).toBeLessThan(0.1);
  });

  it.each(GRID.map(([name, opts]) => ({ name, opts })))('stopTime within 0.03 s at $name', ({ opts }) => {
    const result = analyzeRep(synthRep(opts));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.features.stopTime - expectedFeatures(opts).stopTime)).toBeLessThan(0.03);
  });

  it.each(GRID.map(([name, opts]) => ({ name, opts })))('bounceRatio within 0.05 at $name', ({ opts }) => {
    const result = analyzeRep(synthRep(opts));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.features.bounceRatio - expectedFeatures(opts).bounceRatio)).toBeLessThan(0.05);
  });

  it.each(GRID.map(([name, opts]) => ({ name, opts })))('settleTime within 0.6 bounce periods at $name', ({ opts }) => {
    const result = analyzeRep(synthRep(opts));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The last marginal peak decides the answer, so noise can move it by about half a bounce period.
    expect(Math.abs(result.features.settleTime - expectedFeatures(opts).settleTime)).toBeLessThan(
      0.6 / opts.bounceHz!,
    );
  });

  it.each(GRID.map(([name, opts]) => ({ name, opts })))('impact speed within 10% at $name', ({ opts }) => {
    const result = analyzeRep(synthRep(opts));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Math.abs(result.impactSpeed / opts.impactSpeed! - 1)).toBeLessThan(0.1);
  });

  it('reports bounceRatio 0 when there is no second bounce peak', () => {
    const result = analyzeRep(synthRep({ bounceRatio: 0, seed: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.features.bounceRatio).toBe(0);
  });

  it('gives the same features for a phone turned about its torso axis or with flipped axes', () => {
    const opts: SynthOptions = { bounceHz: 1.5, bounceRatio: 0.3, seed: 9, noise: 0 };
    const plain = analyzeRep(synthRep(opts));
    const turned = analyzeRep(synthRep({ ...opts, rotation: [0, 70, 0] }));
    const base = synthRep(opts);
    const flipped = analyzeRep({
      ...base,
      samples: base.samples.map((s) => ({ ...s, ax: -s.ax, ay: -s.ay })),
    });
    expect(plain.ok && turned.ok && flipped.ok).toBe(true);
    if (!plain.ok || !turned.ok || !flipped.ok) return;
    for (const other of [turned, flipped]) {
      for (const key of ['peakOverV', 'stopTime', 'bounceRatio', 'settleTime'] as const) {
        expect(other.features[key]).toBeCloseTo(plain.features[key], 6);
      }
      expect(other.impactSpeed).toBeCloseTo(plain.impactSpeed, 6);
    }
  });
});

describe('createPositionTracker', () => {
  const max = routineSpec('sit-drop').maxLeanDeg;

  it('confirms the position once when the phone is first upright', () => {
    const tracker = createPositionTracker('sit-drop');
    expect(tracker.update(20)).toEqual({ off: false, event: 'ok' });
    expect(tracker.update(25)).toEqual({ off: false });
  });

  it('reports off once when the lean passes the limit, and stays quiet while off', () => {
    const tracker = createPositionTracker('sit-drop');
    tracker.update(20);
    expect(tracker.update(max + 5)).toEqual({ off: true, event: 'off' });
    expect(tracker.update(max + 10)).toEqual({ off: true });
  });

  it('needs a margin inside the limit before it confirms again', () => {
    const tracker = createPositionTracker('sit-drop');
    tracker.update(max + 5);
    expect(tracker.update(max - 2)).toEqual({ off: true });
    expect(tracker.update(max - 6)).toEqual({ off: false, event: 'ok' });
  });

  it('never reports a bridge drop off', () => {
    expect(createPositionTracker('bridge-drop').update(90).off).toBe(false);
  });
});

describe('analyzeRep plausibility', () => {
  it('drops a rep whose impact speed is below 0.2 m/s as no real drop', () => {
    const result = analyzeRep(synthRep({ impactSpeed: 0.12, seed: 4 }));
    expect(result.ok === false && result.reasons).toEqual(['no-drop-found']);
  });

  it('still accepts a slow soft-surface drop of 0.3 m/s', () => {
    expect(analyzeRep(synthRep({ impactSpeed: 0.3, seed: 4 })).ok).toBe(true);
  });
});

describe('analyzeRep scoring', () => {
  const ref = (lean = 15) => refWithLean('sit-drop', lean);
  const scored = (trace: Parameters<typeof analyzeRep>[0], r?: ReferenceStats) => {
    const result = analyzeRep(trace, r);
    if (!result.ok) throw new Error(`expected a valid rep, got ${result.reasons}`);
    return result;
  };
  const USABLE = 0.5;

  it('weighs a clean rep 1 with no issues', () => {
    const rep = scored(synthRep({ seed: 5, impactSpeed: 0.6 }), ref());
    expect(rep.weight).toBe(1);
    expect(rep.issues).toEqual([]);
  });

  it.each([
    [55, 0.9],
    [2, 0.9],
    [15, 0.3],
    [15, 1.1],
  ])('keeps full weight at a %s degree lean and %s m/s against a 15 degree, 0.6 m/s reference', (leanDeg, impactSpeed) => {
    const rep = scored(synthRep({ leanDeg, impactSpeed }), ref());
    expect(rep.weight).toBe(1);
    expect(rep.issues).toEqual([]);
  });

  it('lowers the weight of a smeared impact and names caught-landing', () => {
    const rep = scored(synthRep({ failure: 'caught-landing' }));
    expect(rep.weight).toBeLessThan(USABLE);
    expect(rep.issues).toContain('caught-landing');
  });

  it('does not judge the impact speed or lean without a reference', () => {
    const rep = scored(synthRep({ impactSpeed: 1.2, bounceHz: 1.5, leanDeg: 40 }));
    expect(rep.weight).toBe(1);
  });

  it('lowers the weight of a wobbling hover and names not-still', () => {
    const rep = scored(synthRep({ failure: 'moving-hover', hoverS: 2, durationS: 6 }));
    expect(rep.weight).toBeLessThan(USABLE);
    expect(rep.issues).toContain('not-still');
  });

  it('never judges the jitter stricter than the global prior, even for a still reference person', () => {
    const trace = synthRep({ failure: 'moving-hover', failureSize: 0.4 });
    const still = scored(trace, { ...ref(), jitterScale: 0 });
    expect(Number.isFinite(still.weight)).toBe(true);
    expect(still.weight).toBe(scored(trace, { ...ref(), jitterScale: 0.225 }).weight);
  });

  it('judges the hover jitter against the reference person own jitter scale', () => {
    const trace = synthRep({ failure: 'moving-hover', failureSize: 0.8, hoverS: 2, durationS: 6 });
    const strict = scored(trace, { ...ref(), jitterScale: 0.05 });
    const loose = scored(trace, { ...ref(), jitterScale: 0.5 });
    expect(strict.weight).toBeLessThan(loose.weight);
    expect(loose.weight).toBe(1);
  });
});

describe('analyzeRep on bad data', () => {
  const rejected = (trace: Parameters<typeof analyzeRep>[0]) => {
    const result = analyzeRep(trace);
    expect(result.ok).toBe(false);
    return result;
  };
  const base = synthRep({ noise: 0 });
  const hoverOnly = synthRep({ noise: 0, failure: 'no-drop' });

  it.each([
    ['an empty trace', { ...base, samples: [] }],
    ['a one-sample trace', { ...base, samples: base.samples.slice(0, 1) }],
    ['a trace of zeros', { ...base, samples: base.samples.map((s) => ({ ...s, ax: 0, ay: 0, az: 0 })) }],
    [
      'a spike with no descent',
      {
        ...base,
        samples: base.samples.map((s, i) => (i === 40 ? { ...s, ay: 30 } : { ...s, ay: 9.81, az: 0 })),
      },
    ],
    [
      'a spike at the first sample with no drop after it',
      { ...hoverOnly, samples: hoverOnly.samples.map((s, i) => (i === 0 ? { ...s, ay: 30 } : s)) },
    ],
  ])('rejects %s without throwing', (_name, trace) => {
    expect(() => rejected(trace)).not.toThrow();
  });

  it('assessHover gives a finite lean and not-still for an empty or zero window', () => {
    const zero = base.samples.slice(0, 20).map((s) => ({ ...s, ax: 0, ay: 0, az: 0 }));
    for (const window of [[], zero]) {
      const result = assessHover(window, 'sit-drop');
      expect(Number.isFinite(result.leanDeg)).toBe(true);
      expect(result.reasons).toEqual(['not-still']);
    }
  });

  it('treats a first impact sample at or below 1 g as part of the descent and keeps the numbers finite', () => {
    const samples = base.samples.map((s, i) => {
      if (i !== 78) return s;
      const k = (9.81 - 0.2) / Math.hypot(s.ax, s.ay, s.az);
      return { ...s, ax: s.ax * k, ay: s.ay * k, az: s.az * k };
    });
    const result = analyzeRep({ ...base, samples });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.values(result.features).every(Number.isFinite)).toBe(true);
  });

  it('never accepts a rep with a non-finite number in it', () => {
    for (let i = 0; i < base.samples.length; i += 7) {
      const samples = base.samples.map((s, j) => (j === i ? { ...s, ay: NaN } : s));
      const result = analyzeRep({ ...base, samples });
      if (!result.ok) continue;
      const numbers = [...Object.values(result.features), result.impactSpeed, result.leanDeg];
      expect(numbers.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('analyzeRep sample gaps', () => {
  const trace = synthRep({ durationS: 4 });
  const without = (from: number, to: number) => ({
    ...trace,
    samples: trace.samples.filter((s) => s.t <= from || s.t >= to),
  });

  it('rejects a 0.2 s gap around the impact as low-sample-rate', () => {
    const result = analyzeRep(without(1.2, 1.4));
    expect(result.ok === false && result.reasons).toEqual(['low-sample-rate']);
  });

  it('accepts a gap that starts more than 1 s after the impact', () => {
    expect(analyzeRep(without(3.0, 3.3)).ok).toBe(true);
  });
});

describe('analyzeRep segmentation', () => {
  /** Scales |a| of the samples in [from, to) to `mag`, keeping the direction. */
  const withMagnitude = (trace: ReturnType<typeof synthRep>, from: number, to: number, mag: number) => ({
    ...trace,
    samples: trace.samples.map((s) => {
      if (s.t < from || s.t >= to) return s;
      const k = mag / Math.hypot(s.ax, s.ay, s.az);
      return { ...s, ax: s.ax * k, ay: s.ay * k, az: s.az * k };
    }),
  });

  it('ignores a spike at the first sample when a real drop follows', () => {
    const trace = synthRep({ noise: 0 });
    const spiked = { ...trace, samples: trace.samples.map((s, i) => (i === 0 ? { ...s, ay: 30 } : s)) };
    expect(analyzeRep(spiked).ok).toBe(true);
  });

  it('follows a descent that a single bounce sample interrupts', () => {
    const trace = synthRep({ dropS: 0.3 });
    const dropAt = 1.3 - 0.05;
    const bounced = withMagnitude(trace, dropAt - 0.017, dropAt, 10.2);
    expect(analyzeRep(bounced).ok).toBe(true);
  });

  it('accepts an exact hover window and rejects one a sample too short', () => {
    expect(assessHover(hoverOf({}).slice(0, 18), 'sit-drop').reasons).toEqual([]);
    expect(assessHover(hoverOf({}).slice(0, 17), 'sit-drop').reasons).toEqual(['not-still']);
  });
});

describe('analyzeRep drop selection', () => {
  const setMagnitude = (trace: ReturnType<typeof synthRep>, mag: (t: number) => number | null) => ({
    ...trace,
    samples: trace.samples.map((s) => {
      const m = mag(s.t);
      if (m === null) return s;
      const k = m / Math.hypot(s.ax, s.ay, s.az);
      return { ...s, ax: s.ax * k, ay: s.ay * k, az: s.az * k };
    }),
  });

  it('measures a hard surface whose rebound dips right after the 2-3 sample peak', () => {
    const result = analyzeRep(synthRep({ bounceHz: 5, bounceRatio: 0.1, noise: 0.02, durationS: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impactSpeed).toBeCloseTo(0.6, 1);
  });

  it('finds no descent in a noisy hover at the jitter limit', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const result = analyzeRep(synthRep({ failure: 'no-drop', noise: 0.45, durationS: 20, seed }));
      expect(result.ok === false && result.reasons).toContain('no-drop-found');
    }
  });

  it('takes the drop that follows a still hover, not wobble with a dip and bump before it', () => {
    const wobble = (t: number) => (t < 1.2 ? 9.81 + 2.5 * Math.sin(2 * Math.PI * 3 * t) : null);
    const result = analyzeRep(setMagnitude(synthRep({ hoverS: 2.5, durationS: 6 }), wobble));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impactSpeed).toBeCloseTo(0.6, 1);
  });

  it('takes a soft drop whose peak is lower than a bump before it', () => {
    const bump = (t: number) =>
      t < 1.2
        ? 9.81 + 2.5 * Math.sin(2 * Math.PI * 3 * t)
        : t >= 1.5 && t < 1.6
          ? 9.81 + 14
          : t >= 1.35 && t < 1.5
            ? 6
            : null;
    const soft = synthRep({ impactSpeed: 0.3, bounceHz: 1, bounceRatio: 0.3, hoverS: 2.5, durationS: 6 });
    const result = analyzeRep(setMagnitude(soft, bump));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impactSpeed).toBeCloseTo(0.3, 1);
  });

  it('takes the first peak after the descent, not a taller later bounce', () => {
    const springy = synthRep({ bounceHz: 2, bounceRatio: 0.8, durationS: 5 });
    const later = (t: number) => (t >= 1.62 && t < 1.65 ? 9.81 + 25 : null);
    const result = analyzeRep(setMagnitude(springy, later));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impactSpeed).toBeCloseTo(0.6, 1);
  });
});

describe('analyzeRep covariates', () => {
  it('reports the hover jitter and a full weight on a clean rep', () => {
    const opts: SynthOptions = { seed: 5 };
    const rep = analyzeRep(synthRep(opts));
    if (!rep.ok) throw new Error('expected an ok rep');
    expect(rep.hoverJitter).toBeCloseTo(assessHover(hoverOf(opts), 'sit-drop').jitter, 1);
    expect(rep.weight).toBe(1);
  });
});

describe('rig-drop contract', () => {
  it('gives rig-drop a 20 degree level limit and a 3 s capture', () => {
    const spec = routineSpec('rig-drop');
    expect(spec.maxLeanDeg).toBe(20);
    expect(spec.captureS).toBe(3);
    expect(spec.preRollS).toBeGreaterThanOrEqual(1);
  });

  it('exports the default rig: 1.9 kg slab plus 0.2 kg phone', () => {
    expect(DEFAULT_RIG).toEqual({ massKg: 2.1, baseCm: [17.5, 9], dropHeightCm: 5, spot: 'center' });
  });

  it('measures the rig-drop lean on the flat axis (az)', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ t: i / 60, ax: 0, ay: 0, az: 9.81 }));
    expect(assessHover(flat, 'rig-drop').leanDeg).toBeCloseTo(0, 5);
    const onEnd = flat.map((s) => ({ ...s, ay: 9.81, az: 0 }));
    expect(assessHover(onEnd, 'rig-drop').leanDeg).toBeCloseTo(90, 5);
  });

  it('returns no-drop-found for a rig-drop trace until the free-fall model exists', () => {
    const trace = { ...synthRep({}), routine: 'rig-drop' as const };
    const result = analyzeRep(trace);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toEqual(['no-drop-found']);
  });
});
