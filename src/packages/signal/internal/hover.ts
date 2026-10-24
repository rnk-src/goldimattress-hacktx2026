import type { HoverAssessment, ReferenceStats, RejectReason, Routine, Sample } from '../../domain';
import { magnitude, std } from './math';
import { routineSpec } from './routine';

/** A hover must read about 1 g, so a window of zeros or free fall is not a hover, m/s². */
const HOVER_G_TOL = 2;

// shortcut: fixed jitter limit from synthetic noise (0.05 m/s²), tune on real G2 fixtures.
const MAX_JITTER = 0.15;

/** The phone axis that points along gravity when the lean is 0: the torso (y) or the belly normal (z). */
const LEAN_AXIS: Record<Routine, 'ay' | 'az'> = { 'sit-drop': 'ay', 'bridge-drop': 'az' };

/** Angle in degrees between the mean gravity vector and the routine's lean axis. Ignores axis sign. */
function leanOf(window: readonly Sample[], routine: Routine): number {
  if (window.length === 0) return 0;
  const mean = (key: 'ax' | 'ay' | 'az') => window.reduce((sum, s) => sum + s[key], 0) / window.length;
  const m = { ax: mean('ax'), ay: mean('ay'), az: mean('az') };
  const length = magnitude(m);
  if (!(length > 0)) return 0;
  return (Math.acos(Math.min(1, Math.abs(m[LEAN_AXIS[routine]]) / length)) * 180) / Math.PI;
}

/**
 * Stillness and lean over a hover window. Lean is degrees from the routine's axis, sign-agnostic.
 * Without a reference only stillness is judged; with one, lean must stay within the routine tolerance.
 */
export function assessHover(
  window: readonly Sample[],
  routine: Routine,
  ref?: ReferenceStats,
): HoverAssessment {
  const jitter = std(window.map(magnitude));
  const n = window.length;
  const coveredS = n < 2 ? 0 : ((window[n - 1]!.t - window[0]!.t) * n) / (n - 1);
  const meanMag = n === 0 ? 0 : window.reduce((sum, s) => sum + magnitude(s), 0) / n;
  const still =
    Math.abs(meanMag - 9.81) <= HOVER_G_TOL &&
    jitter <= MAX_JITTER && coveredS >= routineSpec(routine).hoverMinS - 1e-6;
  const leanDeg = leanOf(window, routine);
  const reasons: RejectReason[] = still ? [] : ['not-still'];
  if (ref) {
    const off = leanDeg - ref.leanDeg.mean;
    const tol = routineSpec(routine).leanTolDeg;
    if (off > tol) reasons.push('lean-too-much');
    else if (off < -tol) reasons.push('lean-too-little');
  }
  return { still, jitter, leanDeg, reasons };
}
