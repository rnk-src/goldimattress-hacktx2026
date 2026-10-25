import type { ReferenceStats, RejectReason } from '../../domain';
import { clamp } from './math';

/** Hover jitter scale used before a person has a reference, m/s²; twice this was the old hard limit. */
const PRIOR_JITTER_SCALE = 0.225;
/** A first lobe longer than this means tensed legs smeared the impact, s. It falls to zero over CAUGHT_FALL_S. */
const CAUGHT_STOP_S = 0.6;
const CAUGHT_FALL_S = 0.3;

/** A quality weight in 0..1 and the issues behind it. */
export interface Score {
  weight: number;
  issues: RejectReason[];
}

/** 1 up to `free`, then straight down to 0 over `fall`. */
export const ramp = (excess: number, fall: number) => clamp(1 - excess / fall, 0, 1);

/** One factor as a score: it names `issue` when the factor is below 1. */
export const factor = (f: number, issue: RejectReason): Score => ({ weight: f, issues: f < 1 ? [issue] : [] });

/** The product of the weights and the issues of every part, in order. */
export const combine = (...parts: Score[]): Score => ({
  weight: parts.reduce((w, p) => w * p.weight, 1),
  issues: parts.flatMap((p) => p.issues),
});

/**
 * How still the hover was. Lean and impact speed are not scored: they differ by surface, so only a person's
 * own reps are compared on them (see `buildReference`).
 * shortcut: the ramps are guesses from three sets of one person, tune with the simulator and sloppy sets.
 */
export function jitterScore(jitter: number, ref?: ReferenceStats): Score {
  // A calm person is judged no stricter than the prior, so a still reference cannot make a normal hover unusable.
  const jitterScale = Math.max(ref?.jitterScale ?? 0, PRIOR_JITTER_SCALE);
  return factor(ramp(jitter - 2 * jitterScale, 2 * jitterScale), 'not-still');
}

/** Whether the legs caught the landing, from the first lobe's length. The body model only. */
export const caughtLandingScore = (stopTime: number): Score =>
  factor(ramp(stopTime - CAUGHT_STOP_S, CAUGHT_FALL_S), 'caught-landing');
