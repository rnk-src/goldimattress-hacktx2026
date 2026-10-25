import type { FeatureName, Label, ReferenceStats, RepResult, Verdict } from '../../domain';
import { FEATURES } from './features-table';

/** Share of |μ_ref| below which a spread is treated as noise. */
const REL_FLOOR = 0.08;

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
  const z: Partial<Record<FeatureName, number>> = {};
  const axes = { hardness: [] as number[], springiness: [] as number[] };
  for (const { name, absFloor, axis, sign } of FEATURES) {
    const mean = ok.reduce((s, r) => s + r.features[name], 0) / ok.length;
    const { median: mu, mad: std } = ref.features[name];
    const sigmaEff = Math.max(std, REL_FLOOR * Math.abs(mu), absFloor);
    const value = (mean - mu) / sigmaEff;
    z[name] = value;
    axes[axis].push(sign * value);
  }
  const average = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const hardness = average(axes.hardness);
  const springiness = average(axes.springiness);
  return {
    hardness,
    springiness,
    hardnessLabel: label(hardness),
    springinessLabel: label(springiness),
    firmer: hardness > 0,
    bouncier: springiness > 0,
    match: 100 * Math.exp(-(hardness ** 2 + springiness ** 2) / 8),
    perFeatureZ: z as Record<FeatureName, number>,
  };
}
