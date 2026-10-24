import type { FeatureStats, ReferenceStats, RepResult, Routine } from '../../domain';
import { FEATURE_NAMES } from './feature-names';
import { std } from './math';

const MIN_REPS = 5;
const MAX_SPEED_CV = 0.2;
const MAX_LEAN_RANGE_DEG = 10;

type OkRep = Extract<RepResult, { ok: true }>;
type Result =
  | { ok: true; ref: ReferenceStats }
  | { ok: false; reason: 'too-few' | 'speed-spread' | 'lean-spread'; outliers: number[] };

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const stats = (xs: readonly number[]): FeatureStats => ({ mean: mean(xs), std: std(xs) });

/** Indexes into `reps` of the ok reps, farthest from the mean of `value` first. */
function worstFirst(reps: readonly RepResult[], value: (r: OkRep) => number): number[] {
  const oks = reps.flatMap((r, i) => (r.ok ? [{ i, v: value(r) }] : []));
  const m = mean(oks.map((o) => o.v));
  return oks.sort((a, b) => Math.abs(b.v - m) - Math.abs(a.v - m)).map((o) => o.i);
}

/** Mean and std per feature over the ok reps, or the reason the reps cannot form a reference. */
export function buildReference(reps: readonly RepResult[], routine: Routine): Result {
  const ok = reps.flatMap((r) => (r.ok ? [r] : []));
  if (ok.some((r) => r.trace.routine !== routine)) {
    // The declared failure union has no routine reason, so this throws like compare.
    throw new RangeError(`rep routine does not match ${routine}`);
  }
  if (ok.length < MIN_REPS) return { ok: false, reason: 'too-few', outliers: [] };

  const speeds = ok.map((r) => r.impactSpeed);
  const meanSpeed = mean(speeds);
  // shortcut: outliers lists every ok rep ordered by distance from the mean, not only the offenders; the caller redoes the first few. Trim when the UI needs a count.
  // A mean speed of 0 or less (or NaN) is not a usable reference; the negated test also catches NaN.
  if (!(meanSpeed > 0) || std(speeds) / meanSpeed > MAX_SPEED_CV) {
    return { ok: false, reason: 'speed-spread', outliers: worstFirst(reps, (r) => r.impactSpeed) };
  }
  const leans = ok.map((r) => r.leanDeg);
  if (Math.max(...leans) - Math.min(...leans) > MAX_LEAN_RANGE_DEG) {
    return { ok: false, reason: 'lean-spread', outliers: worstFirst(reps, (r) => r.leanDeg) };
  }

  const features = {} as ReferenceStats['features'];
  for (const k of FEATURE_NAMES) features[k] = stats(ok.map((r) => r.features[k]));
  return {
    ok: true,
    ref: {
      routine,
      repCount: ok.length,
      // shortcut: createdAt is the last ok rep's trace start, because signal has no clock; the store may overwrite it.
      createdAt: ok[ok.length - 1]!.trace.startedAt,
      features,
      leanDeg: stats(leans),
      impactSpeed: stats(speeds),
    },
  };
}
