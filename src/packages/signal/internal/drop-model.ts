import type { FeatureName, ReferenceStats, RejectReason, RepFeatures, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import type { Score } from './score';

/** |a| this far above 1 g marks the impact, m/s². Above hover wobble, below the weakest real impact. */
export const IMPACT_EXCESS = 1.5;
/**
 * The peak must come this soon after the descent ends, s. Real rises took 0.1 s (chair) to 0.2 s (couch).
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const RISE_WITHIN_S = 0.4;
/** Slack for float error in sample times, s. */
const EPS = 1e-6;

export type Segments = { impact: number; descentStart: number; hoverFrom: number };

/** Start two samples before the hover start, so the window covers the full hover time plus a sample. */
export function hoverFromOf(trace: Trace, descentStart: number, hoverMinS: number): number {
  const hoverStartT = trace.samples[descentStart]!.t - hoverMinS + EPS;
  return Math.max(0, trace.samples.findIndex((s) => s.t > hoverStartT) - 2);
}

/** First local maximum after `end` that clears the impact threshold within RISE_WITHIN_S, or -1. */
export function firstPeakAfter(samples: readonly Sample[], mags: readonly number[], end: number): number {
  let p = end + 1;
  while (p < mags.length && samples[p]!.t - samples[end]!.t <= RISE_WITHIN_S) {
    if (mags[p]! - GRAVITY > IMPACT_EXCESS) {
      // Climb to the top of this rise; a peak is a sample that the next two samples do not exceed.
      while (p + 2 < mags.length && (mags[p + 1]! >= mags[p]! || mags[p + 2]! > mags[p]!)) {
        p += mags[p + 1]! >= mags[p]! ? 1 : 2;
      }
      return p;
    }
    p++;
  }
  return -1;
}

/** Start of the rise to the peak `peak` that follows the descent ending at `end`: the first sample above 1 g. */
export function riseStart(mags: readonly number[], end: number, peak: number): number {
  let impact = peak;
  while (impact - 1 > end && mags[impact - 1]! > GRAVITY) impact--;
  return impact;
}

/** Runs of consecutive samples at index `from` or later with |a| below `threshold`, in time order. */
export function lowRuns(mags: readonly number[], threshold: number, from = 0): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  for (let i = from; i < mags.length; i++) {
    if (mags[i]! >= threshold) continue;
    const start = i;
    while (i + 1 < mags.length && mags[i + 1]! < threshold) i++;
    runs.push({ start, end: i });
  }
  return runs;
}

export type Axis = 'hardness' | 'springiness';

/** What a model needs from the routine and the hover check, so it imports neither. */
export interface DropContext {
  hoverMinS: number;
  /** True when the window is a still hover. */
  isStill(window: readonly Sample[]): boolean;
}

/**
 * A drop that a model found. Its closures hold the model's own segment, so only that model reads it.
 * `flightS` is set by the free-fall model only: the measured time near 0 g before the impact, s.
 */
export interface FoundDrop {
  seg: Segments;
  flightS?: number;
  /** Impact speed in m/s. */
  impactSpeed(): number;
  quality(input: { jitter: number; features: RepFeatures }, ref?: ReferenceStats): Score;
}

/** The slots in which the body and the free-fall rig differ. */
export interface DropModel {
  findDrop(trace: Trace, mags: readonly number[], ctx: DropContext): FoundDrop | RejectReason;
  /** The features that score each axis. A feature not listed is recorded only. */
  axes: Partial<Record<FeatureName, Axis>>;
  /**
   * Share of |μ_ref| below which a spread is treated as noise. The rig drops a fixed mass, so its repeats are tighter than a body's.
   * shortcut: 5% for the rig and 8% for the body are starting values; tune the rig's on the plate-experiment spread.
   */
  relFloor: number;
  /**
   * True when the lean is signed: face-down reads 180 degrees. The body is sign-agnostic.
   * shortcut: only the rig is signed, upgrade the body when a flipped phone must fail it too.
   */
  signedLean: boolean;
}
