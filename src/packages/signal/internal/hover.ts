import type { HoverAssessment, RejectReason, Routine, Sample } from '../../domain';
import { GRAVITY } from './constants';
import { magnitude, std } from './math';
import { routineSpec } from './routine';

/** A hover must read about 1 g, so a window of zeros or free fall is not a hover, m/s². */
const HOVER_G_TOL = 2;

/**
 * Largest sd of |a| over the 0.3 s hover window, m/s². Accepted real hovers measured 0.11 to 0.40; the
 * couch hovers that fail measured 0.57 (legs moving) and 1.19 (bump); the synthetic wobble measures 0.7.
 * The margin is thin on both sides (1.1x above, 1.3x below), so a reference-relative limit may suit better.
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const MAX_JITTER = 0.45;
/** A rep is dropped, not scored, when its hover jitter is above this, m/s². shortcut: a guess above the worst real fail (0.57), check with sloppy sets. */
export const DROP_JITTER = 1.0;

/**
 * How far under hoverMinS a window's covered time may fall, s. Real timestamps are rounded to 1 ms and uneven,
 * so an exact window measured 0.2996 s for 0.3 s. This is a tenth of a sample period at 60 Hz, so a window
 * one sample short (0.0167 s) is still rejected.
 */
const COVERAGE_TOL_S = 0.002;

/** The phone axis that points along gravity when the lean is 0: the torso (y) or the belly normal (z). */
const LEAN_AXIS: Record<Routine, 'ay' | 'az'> = { 'sit-drop': 'ay', 'bridge-drop': 'az', 'rig-drop': 'az' };

/** Angle in degrees between the mean gravity vector and the routine's lean axis. Ignores axis sign. */
function leanOf(window: readonly Sample[], routine: Routine): number {
  if (window.length === 0) return 0;
  const mean = (key: 'ax' | 'ay' | 'az') => window.reduce((sum, s) => sum + s[key], 0) / window.length;
  const m = { ax: mean('ax'), ay: mean('ay'), az: mean('az') };
  const length = magnitude(m);
  const deg = (Math.acos(Math.min(1, Math.abs(m[LEAN_AXIS[routine]]) / length)) * 180) / Math.PI;
  // Zero or non-finite samples have no direction, so the lean is 0.
  return Number.isFinite(deg) ? deg : 0;
}

/**
 * Stillness and lean over a hover window. Lean is degrees from the routine's axis, sign-agnostic.
 * Only stillness is judged; lean is recorded, because it differs by surface.
 */
export function assessHover(
  window: readonly Sample[],
  routine: Routine,
  maxJitter = MAX_JITTER,
): HoverAssessment {
  const jitter = std(window.map(magnitude));
  const n = window.length;
  const coveredS = n < 2 ? 0 : ((window[n - 1]!.t - window[0]!.t) * n) / (n - 1);
  const meanMag = n === 0 ? 0 : window.reduce((sum, s) => sum + magnitude(s), 0) / n;
  const still =
    Math.abs(meanMag - GRAVITY) <= HOVER_G_TOL &&
    jitter <= maxJitter && coveredS >= routineSpec(routine).hoverMinS - COVERAGE_TOL_S;
  const leanDeg = leanOf(window, routine);
  const reasons: RejectReason[] = still ? [] : ['not-still'];
  return { still, jitter, leanDeg, reasons };
}
