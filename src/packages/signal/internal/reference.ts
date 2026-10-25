import type { FeatureStats, ReferenceStats, RepResult, Routine } from '../../domain';
import { FEATURES } from './features-table';
import { summarize } from './summarize';
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

/** What a rep is judged by against the person's other reps: the scored features, lean and impact speed. */
const JUDGED: readonly { value: (r: OkRep) => number; absFloor: number }[] = [
  ...FEATURES.filter(({ axis }) => axis !== null).map(({ name, absFloor }) => ({
    value: (r: OkRep) => r.features[name],
    absFloor,
  })),
  // shortcut: floors of 10 degrees and 0.05 m/s are guesses from three real sets, tune with sloppy sets.
  { value: (r) => r.leanDeg, absFloor: 10 },
  { value: (r) => r.impactSpeed, absFloor: 0.05 },
];

/** How many scaled MADs the rep's farthest judged value sits from the median, floored like the verdict. */
function outlierScore(rep: OkRep, kept: readonly OkRep[]): number {
  return Math.max(
    ...JUDGED.map(({ value, absFloor }) => {
      const s = stats(kept.map(value), kept.map((r) => r.weight));
      return Math.abs(value(rep) - s.median) / Math.max(s.mad, REL_FLOOR * Math.abs(s.median), absFloor);
    }),
  );
}

/** `summarize` of the usable reps after the outlier rule, plus reference metadata, or why there are too few. */
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
  return {
    ok: true,
    dropped: dropped.map((r) => reps.indexOf(r)).sort((a, b) => a - b),
    ref: {
      routine,
      repCount: kept.length,
      // shortcut: createdAt is the last kept rep's trace start, because signal has no clock; the store may overwrite it.
      createdAt: kept[kept.length - 1]!.trace.startedAt,
      features: summarize(kept).features,
      leanDeg: stats(kept.map((r) => r.leanDeg), ws),
      impactSpeed: stats(kept.map((r) => r.impactSpeed), ws),
      jitterScale: weightedMedian(kept.map((r) => r.hoverJitter), ws),
    },
  };
}
