import type { FeatureName, Label, ReferenceStats, RepResult, Verdict } from '../../domain';

const NAMES: FeatureName[] = ['peakOverV', 'stopTime', 'bounceRatio', 'settleTime'];

/** Share of |μ_ref| below which a spread is treated as noise. */
const REL_FLOOR = 0.08;

/**
 * Absolute σ floors, in each feature's unit. Needed when μ_ref is near 0 (dead foam: bounceRatio ≈ 0).
 * shortcut: starting values, not tuned on real G2 fixtures; peakOverV (1/s) is a guess of ~2.5% of a typical 20/s. Tune on G2 recordings.
 */
const ABS_FLOOR: Record<FeatureName, number> = {
  peakOverV: 0.5,
  stopTime: 0.02,
  bounceRatio: 0.03,
  settleTime: 0.02,
};

function label(score: number): Label {
  const a = Math.abs(score);
  return a < 2 ? 'just-right' : a <= 3 ? 'slightly' : 'much';
}

/** Verdict of the mean of the ok test reps against the reference. */
export function compare(reps: readonly RepResult[], ref: ReferenceStats): Verdict {
  const ok = reps.flatMap((r) => (r.ok ? [r] : []));
  if (ok.length === 0) throw new RangeError('compare needs at least one ok rep');
  if (ok.some((r) => r.trace.routine !== ref.routine)) {
    throw new RangeError(`rep routine does not match reference routine ${ref.routine}`);
  }
  const z = {} as Record<FeatureName, number>;
  for (const k of NAMES) {
    const mean = ok.reduce((s, r) => s + r.features[k], 0) / ok.length;
    const { mean: mu, std } = ref.features[k];
    const sigmaEff = Math.max(std, REL_FLOOR * Math.abs(mu), ABS_FLOOR[k]);
    z[k] = (mean - mu) / sigmaEff;
  }
  const hardness = (z.peakOverV - z.stopTime) / 2;
  const springiness = (z.bounceRatio + z.settleTime) / 2;
  return {
    hardness,
    springiness,
    hardnessLabel: label(hardness),
    springinessLabel: label(springiness),
    firmer: hardness > 0,
    bouncier: springiness > 0,
    match: 100 * Math.exp(-(hardness ** 2 + springiness ** 2) / 8),
    perFeatureZ: z,
  };
}
