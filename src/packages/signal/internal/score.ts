import type { ReferenceStats, RejectReason } from '../../domain';

/** Hover jitter scale used before a person has a reference, m/s²; twice this was the old hard limit. */
const PRIOR_JITTER_SCALE = 0.225;
/** Lean this far from the reference median costs nothing, then falls to zero over LEAN_FALL_DEG. */
const LEAN_FREE_DEG = 10;
const LEAN_FALL_DEG = 20;
/** Impact speed within this share of the reference median costs nothing, then falls to zero over SPEED_FALL. */
const SPEED_FREE = 0.3;
const SPEED_FALL = 0.5;
/** A first lobe longer than this means tensed legs smeared the impact, s. It falls to zero over CAUGHT_FALL_S. */
export const CAUGHT_STOP_S = 0.6;
const CAUGHT_FALL_S = 0.3;

export interface Measures {
  jitter: number;
  leanDeg: number;
  impactSpeed: number;
  stopTime: number;
}

/** 1 up to `free`, then straight down to 0 over `fall`. */
const ramp = (excess: number, fall: number) => Math.min(1, Math.max(0, 1 - excess / fall));

/**
 * Quality weight in 0..1 and the issues behind it. Each check costs a share of the weight; the weight is
 * their product. The weights are provisional until the human-error simulator and more people tune them.
 * shortcut: the ramps are guesses from two sets of one person, tune with the simulator and sloppy sets.
 */
export function scoreRep(m: Measures, ref?: ReferenceStats): { weight: number; issues: RejectReason[] } {
  const issues: RejectReason[] = [];
  const factor = (f: number, issue: RejectReason) => {
    if (f < 1) issues.push(issue);
    return f;
  };
  const jitterScale = ref?.jitterScale ?? PRIOR_JITTER_SCALE;
  let weight = factor(ramp(m.jitter - 2 * jitterScale, 2 * jitterScale), 'not-still');
  if (ref) {
    const lean = m.leanDeg - ref.leanDeg.median;
    weight *= factor(
      ramp(Math.abs(lean) - LEAN_FREE_DEG, LEAN_FALL_DEG),
      lean > 0 ? 'lean-too-much' : 'lean-too-little',
    );
    const speed = m.impactSpeed / ref.impactSpeed.median - 1;
    weight *= factor(ramp(Math.abs(speed) - SPEED_FREE, SPEED_FALL), speed > 0 ? 'too-fast' : 'too-slow');
  }
  weight *= factor(ramp(m.stopTime - CAUGHT_STOP_S, CAUGHT_FALL_S), 'caught-landing');
  return { weight, issues };
}
