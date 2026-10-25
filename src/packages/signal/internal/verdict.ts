import type { Caveat, Confidence, FeatureName, Label, ReferenceStats, RepResult, Verdict } from '../../domain';
import { FEATURES } from './features-table';
import { weightedMedian } from './math';
import { relFloorOf } from './routine';
import { summarize } from './summarize';
import { isUsable } from './reference';

/** A reference of fewer reps than this has an unreliable MAD, so its floors widen. */
const FULL_REFERENCE_REPS = 5;
const SMALL_REFERENCE_FLOOR_FACTOR = 1.5;
/** Fewer usable reps than this, or a lower mean weight, gives no confident label. */
const MIN_REPS = 3;
const MIN_MEAN_WEIGHT = 0.6;
/** Label boundaries on a score. */
const BOUNDARIES = [2, 3];
/** A test lean this far from the reference lean is a caveat, degrees. */
const LEAN_CAVEAT_DEG = 10;

function label(score: number): Label {
  const a = Math.abs(score);
  return a < 2 ? 'just-right' : a <= 3 ? 'slightly' : 'much';
}

const average = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** True when the interval of |score| spans a label boundary. */
const straddles = ([lo, hi]: [number, number]) => {
  const [a, b] = lo <= 0 && hi >= 0 ? [0, 0] : [Math.min(Math.abs(lo), Math.abs(hi)), Math.max(Math.abs(lo), Math.abs(hi))];
  return BOUNDARIES.some((x) => a < x && x < b);
};

/**
 * Verdict of the usable test reps (the summarize centre) against the reference.
 * Hardness is left out of the match until `hardnessReliable` is true.
 * shortcut: hardnessReliable defaults to false because the hardness axis reads wrong across surfaces; flip it after the multi-surface data fixes the axis.
 */
export function compare(
  reps: readonly RepResult[],
  ref: ReferenceStats,
  { hardnessReliable = false }: { hardnessReliable?: boolean } = {},
): Verdict {
  const usable = reps.flatMap((r) => (r.ok && isUsable(r) ? [r] : []));
  if (usable.length === 0) throw new RangeError('compare needs at least one usable rep');
  if (usable.some((r) => r.trace.routine !== ref.routine)) {
    throw new RangeError(`rep routine does not match reference routine ${ref.routine}`);
  }
  const weights = usable.map((r) => r.weight);
  const floorFactor = ref.repCount < FULL_REFERENCE_REPS ? SMALL_REFERENCE_FLOOR_FACTOR : 1;
  const summary = summarize(usable);
  const z: Partial<Record<FeatureName, number>> = {};
  const axes = { hardness: [] as number[], springiness: [] as number[] };
  for (const { name, absFloor, axis, sign } of FEATURES) {
    const { center: mu, mad } = ref.features[name];
    const sigmaEff = Math.max(mad, floorFactor * Math.max(relFloorOf(ref.routine) * Math.abs(mu), absFloor));
    const value = (summary.features[name].center - mu) / sigmaEff;
    z[name] = value;
    if (axis !== null) axes[axis].push(sign * value);
  }
  const hardness = average(axes.hardness);
  const springiness = average(axes.springiness);
  // shortcut: the standard error is 1/√n in sigma_eff units, treating each rep as one draw of that spread; check with the simulator.
  const se = 1 / Math.sqrt(usable.length);
  const hardnessInterval: [number, number] = [hardness - se, hardness + se];
  const springinessInterval: [number, number] = [springiness - se, springiness + se];

  let confidence: Confidence = 'confident';
  if (usable.length < MIN_REPS || average(weights) < MIN_MEAN_WEIGHT) confidence = 'not-enough-data';
  else if (straddles(springinessInterval) || (hardnessReliable && straddles(hardnessInterval))) confidence = 'close-call';

  const caveats: Caveat[] = [];
  if (Math.abs(weightedMedian(usable.map((r) => r.leanDeg), weights) - ref.leanDeg.center) > LEAN_CAVEAT_DEG) {
    caveats.push('lean-differs');
  }
  if (usable.some((r) => r.restSkipped)) caveats.push('rest-skipped');

  return {
    hardness,
    springiness,
    hardnessLabel: label(hardness),
    springinessLabel: label(springiness),
    firmer: hardness > 0,
    bouncier: springiness > 0,
    match: 100 * Math.exp(-((hardnessReliable ? hardness ** 2 : 0) + springiness ** 2) / 8),
    perFeatureZ: z as Record<FeatureName, number>,
    hardnessInterval,
    springinessInterval,
    confidence,
    hardnessReliable,
    caveats,
  };
}
