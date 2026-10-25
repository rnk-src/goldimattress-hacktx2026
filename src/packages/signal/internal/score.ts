import type { ReferenceStats, RejectReason } from '../../domain';

/** Hover jitter scale used before a person has a reference, m/s²; twice this was the old hard limit. */
const PRIOR_JITTER_SCALE = 0.225;
/** A first lobe longer than this means tensed legs smeared the impact, s. It falls to zero over CAUGHT_FALL_S. */
const CAUGHT_STOP_S = 0.6;
const CAUGHT_FALL_S = 0.3;

export interface Measures {
  jitter: number;
  stopTime: number;
}

/** 1 up to `free`, then straight down to 0 over `fall`. */
const ramp = (excess: number, fall: number) => Math.min(1, Math.max(0, 1 - excess / fall));

/**
 * Quality weight in 0..1 and the issues behind it, from how still the hover was and whether the legs caught
 * the landing. Lean and impact speed are not scored here: they differ by surface, so only a person's own
 * reps are compared on them (see `buildReference`).
 * shortcut: the ramps are guesses from three sets of one person, tune with the simulator and sloppy sets.
 */
export function scoreRep(m: Measures, ref?: ReferenceStats): { weight: number; issues: RejectReason[] } {
  const issues: RejectReason[] = [];
  const factor = (f: number, issue: RejectReason) => {
    if (f < 1) issues.push(issue);
    return f;
  };
  // A calm person is judged no stricter than the prior, so a still reference cannot make a normal hover unusable.
  const jitterScale = Math.max(ref?.jitterScale ?? 0, PRIOR_JITTER_SCALE);
  const still = factor(ramp(m.jitter - 2 * jitterScale, 2 * jitterScale), 'not-still');
  const landing = factor(ramp(m.stopTime - CAUGHT_STOP_S, CAUGHT_FALL_S), 'caught-landing');
  return { weight: still * landing, issues };
}
