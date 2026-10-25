import type { FeatureStats, ReferenceStats, RepResult, Routine } from '../../domain';
import { FEATURES } from './features-table';
import { scaledMad, weightedMedian } from './math';

/** A rep with at least this weight counts toward a reference and a verdict. */
export const USABLE_WEIGHT = 0.5;
/** True for a valid rep with enough weight to count. */
export const isUsable = (r: RepResult): boolean => r.ok && r.weight >= USABLE_WEIGHT;
const MIN_REPS = 3;
/** Outliers are only dropped from this many usable reps up. */
const DROP_FROM_REPS = 5;
const OUTLIER_MADS = 3;
/** Same relative floor as the verdict's sigma floor. */
const REL_FLOOR = 0.08;

type OkRep = Extract<RepResult, { ok: true }>;
type Result = { ok: true; ref: ReferenceStats; dropped: number[] } | { ok: false; reason: 'too-few' };

const stats = (xs: readonly number[], ws: readonly number[]): FeatureStats => {
  const median = weightedMedian(xs, ws);
  return { median, mad: scaledMad(xs, ws, median) };
};

/** How many scaled MADs the rep's farthest feature sits from the median, floored like the verdict. */
function outlierScore(rep: OkRep, kept: readonly OkRep[]): number {
  return Math.max(
    ...FEATURES.map(({ name, absFloor }) => {
      const s = stats(
        kept.map((r) => r.features[name]),
        kept.map((r) => r.weight),
      );
      return Math.abs(rep.features[name] - s.median) / Math.max(s.mad, REL_FLOOR * Math.abs(s.median), absFloor);
    }),
  );
}

/** Weighted median and scaled MAD per feature over the usable reps, or why there are too few. */
export function buildReference(reps: readonly RepResult[], routine: Routine): Result {
  const ok = reps.flatMap((r) => (r.ok ? [r] : []));
  if (ok.some((r) => r.trace.routine !== routine)) {
    // The declared failure union has no routine reason, so this throws like compare.
    throw new RangeError(`rep routine does not match ${routine}`);
  }
  let kept = ok.filter((r) => r.weight >= USABLE_WEIGHT);
  if (kept.length < MIN_REPS) return { ok: false, reason: 'too-few' };

  const dropped: OkRep[] = [];
  if (kept.length >= DROP_FROM_REPS) {
    // Farthest first, one at a time, so a dropped rep stops skewing the median that judges the next.
    while (kept.length > MIN_REPS) {
      const scored = kept.map((r) => ({ r, score: outlierScore(r, kept) }));
      const worst = scored.reduce((a, b) => (b.score > a.score ? b : a));
      if (worst.score <= OUTLIER_MADS) break;
      dropped.push(worst.r);
      kept = kept.filter((r) => r !== worst.r);
    }
  }

  const ws = kept.map((r) => r.weight);
  const features = Object.fromEntries(
    FEATURES.map(({ name }) => [name, stats(kept.map((r) => r.features[name]), ws)]),
  ) as ReferenceStats['features'];
  return {
    ok: true,
    dropped: dropped.map((r) => reps.indexOf(r)).sort((a, b) => a - b),
    ref: {
      routine,
      repCount: kept.length,
      // shortcut: createdAt is the last kept rep's trace start, because signal has no clock; the store may overwrite it.
      createdAt: kept[kept.length - 1]!.trace.startedAt,
      features,
      leanDeg: stats(kept.map((r) => r.leanDeg), ws),
      impactSpeed: stats(kept.map((r) => r.impactSpeed), ws),
      jitterScale: weightedMedian(kept.map((r) => r.hoverJitter), ws),
    },
  };
}
