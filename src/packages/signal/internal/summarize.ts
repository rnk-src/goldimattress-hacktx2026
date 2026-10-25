import type { FeatureName, FeatureStats, RepResult } from '../../domain';
import { FEATURES } from './features-table';
import { scaledMad, weightedMedian, weightedTrimmedMean } from './math';

/** Share of the total weight dropped at each end before averaging. */
const TRIM = 0.2;
/** Fewer reps than this use the weighted median instead. */
const TRIM_FROM_REPS = 5;

/**
 * The one place that computes the robust centre and spread of usable reps.
 * Centre: weighted trimmed mean. Spread: scaled MAD about the median, with no outlier dropping.
 */
export function summarize(reps: readonly RepResult[]): {
  features: Record<FeatureName, FeatureStats>;
  n: number;
  meanWeight: number;
} {
  const ok = reps.flatMap((r) => (r.ok ? [r] : []));
  if (ok.length === 0) throw new RangeError('summarize needs at least one rep');
  const ws = ok.map((r) => r.weight);
  const features = Object.fromEntries(
    FEATURES.map(({ name }) => {
      const xs = ok.map((r) => r.features[name]);
      return [name, { center: weightedTrimmedMean(xs, ws, TRIM, TRIM_FROM_REPS), mad: scaledMad(xs, ws, weightedMedian(xs, ws)) }];
    }),
  ) as Record<FeatureName, FeatureStats>;
  return { features, n: ok.length, meanWeight: ws.reduce((s, w) => s + w, 0) / ws.length };
}
