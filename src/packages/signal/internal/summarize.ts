import type { FeatureName, FeatureStats, RepResult } from '../../domain';
import { scaledMad, weightedMedian, weightedTrimmedMean } from './math';

/** Share of the total weight dropped at each end before averaging. */
const TRIM = 0.2;
/** Fewer reps than this use the weighted median instead. */
const TRIM_FROM_REPS = 5;
/** A rep with at least this weight counts toward a reference and a verdict. */
export const USABLE_WEIGHT = 0.5;

export type UsableRep = Extract<RepResult, { ok: true }>;
const asUsable = (r: RepResult): UsableRep | undefined => (r.ok && r.weight >= USABLE_WEIGHT ? r : undefined);
/** True for a valid rep with enough weight to count. Not a type guard, so callers still narrow the else branch to the failed reps. */
export const isUsable = (r: RepResult): boolean => asUsable(r) !== undefined;
/** The usable reps of `reps`, in order. */
export const usableReps = (reps: readonly RepResult[]): UsableRep[] => reps.flatMap((r) => asUsable(r) ?? []);

/**
 * The one definition of `FeatureStats`, for every column.
 * center: weighted trimmed mean (weighted median below 5 values).
 * mad: scaled MAD about the weighted median, never about `center`, so trimming does not change the spread.
 */
export function columnStats(xs: readonly number[], ws: readonly number[]): FeatureStats {
  return { center: weightedTrimmedMean(xs, ws, TRIM, TRIM_FROM_REPS), mad: scaledMad(xs, ws, weightedMedian(xs, ws)) };
}

/** `columnStats` of each column of the usable reps in `reps` (the rest are ignored). Throws RangeError when none are usable. */
export function summarize(reps: readonly RepResult[]): {
  features: Record<FeatureName, FeatureStats>;
  leanDeg: FeatureStats;
  impactSpeed: FeatureStats;
  hoverJitter: FeatureStats;
  n: number;
  meanWeight: number;
} {
  const usable = usableReps(reps);
  if (usable.length === 0) throw new RangeError('summarize needs at least one usable rep');
  const ws = usable.map((r) => r.weight);
  const col = (value: (r: UsableRep) => number) => columnStats(usable.map(value), ws);
  return {
    // Listed by name so a new feature fails typecheck here instead of hiding behind a cast.
    features: {
      peak: col((r) => r.features.peak),
      peakOverV: col((r) => r.features.peakOverV),
      stopTime: col((r) => r.features.stopTime),
      bounceRatio: col((r) => r.features.bounceRatio),
      settleTime: col((r) => r.features.settleTime),
    },
    leanDeg: col((r) => r.leanDeg),
    impactSpeed: col((r) => r.impactSpeed),
    hoverJitter: col((r) => r.hoverJitter),
    n: usable.length,
    meanWeight: ws.reduce((s, w) => s + w, 0) / ws.length,
  };
}
