import type { ReferenceStats, RepResult, Routine } from '../../domain';
import { featuresOf } from './features-table';
import { profileOf } from './routine';
import { type UsableRep, columnStats, summarize, usableReps } from './summarize';

const MIN_REPS = 3;
/** Outliers are only dropped from this many usable reps up. */
const DROP_FROM_REPS = 5;
const OUTLIER_MADS = 3;

type Result = { ok: true; ref: ReferenceStats; dropped: number[] } | { ok: false; reason: 'too-few' };

/** What a rep is judged by against the person's other reps: the scored features, lean and impact speed. */
const judgedOf = (routine: Routine): readonly { value: (r: UsableRep) => number; absFloor: number }[] => [
  ...featuresOf(routine).filter(({ axis }) => axis !== null).map(({ name, absFloor }) => ({
    value: (r: UsableRep) => r.features[name],
    absFloor,
  })),
  // shortcut: floors of 10 degrees and 0.05 m/s are guesses from three real sets, tune with sloppy sets.
  { value: (r) => r.leanDeg, absFloor: 10 },
  { value: (r) => r.impactSpeed, absFloor: 0.05 },
];

/**
 * How many scaled MADs the rep's farthest judged value sits from the centre, floored like the verdict.
 * The judge uses the same `columnStats` centre as the reference and the verdict, so a rep is judged from the value it would shift.
 */
function outlierScore(rep: UsableRep, kept: readonly UsableRep[], relFloor: number, judged: ReturnType<typeof judgedOf>): number {
  return Math.max(
    ...judged.map(({ value, absFloor }) => {
      const s = columnStats(kept.map(value), kept.map((r) => r.weight));
      return Math.abs(value(rep) - s.center) / Math.max(s.mad, relFloor * Math.abs(s.center), absFloor);
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
  let kept = usableReps(reps);
  if (kept.length < MIN_REPS) return { ok: false, reason: 'too-few' };

  const { relFloor } = profileOf(routine).model;
  const judged = judgedOf(routine);
  const dropped: UsableRep[] = [];
  if (kept.length >= DROP_FROM_REPS) {
    // Farthest first, one at a time, so a dropped rep stops skewing the median that judges the next.
    while (kept.length > MIN_REPS) {
      const scored = kept.map((r) => ({ r, score: outlierScore(r, kept, relFloor, judged) }));
      const worst = scored.reduce((a, b) => (b.score > a.score ? b : a));
      if (worst.score <= OUTLIER_MADS) break;
      dropped.push(worst.r);
      kept = kept.filter((r) => r !== worst.r);
    }
  }

  const summary = summarize(kept);
  return {
    ok: true,
    dropped: dropped.map((r) => reps.indexOf(r)).sort((a, b) => a - b),
    ref: {
      routine,
      repCount: kept.length,
      // shortcut: createdAt is the last kept rep's trace start, because signal has no clock; the store may overwrite it.
      createdAt: kept[kept.length - 1]!.trace.startedAt,
      features: summary.features,
      leanDeg: summary.leanDeg,
      impactSpeed: summary.impactSpeed,
      jitterScale: summary.hoverJitter.center,
    },
  };
}
