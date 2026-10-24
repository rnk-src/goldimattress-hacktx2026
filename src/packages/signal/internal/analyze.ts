import type { ReferenceStats, RejectReason, RepResult, Trace } from '../../domain';
import { assessHover } from './hover';
import { estimateRate, magnitude } from './math';
import { routineSpec } from './routine';

const G = 9.81;
/** |a| this far above 1 g marks the impact, m/s². Above hover wobble, below the weakest real impact. */
const IMPACT_EXCESS = 1.5;
/** Walking back from the impact, |a| this far below 1 g still counts as the descent, m/s². */
const DESCENT_DEFICIT = 0.5;
/** Slack for float error in sample times, s. */
const EPS = 1e-6;
/** Below this rate the impact is too coarse to measure, Hz. */
const MIN_RATE_HZ = 40;
/** |a| below this long enough after the impact means the mass left the surface, m/s². */
const FLIGHT_ACCEL = 2;
/** shortcut: a trough near 0 g this long counts as flight, so a rep at the contact limit may be rejected; tune on fixtures. */
const FLIGHT_MIN_S = 0.05;

function reject(trace: Trace, reasons: RejectReason[]): RepResult {
  return { ok: false, reasons, trace };
}

/** True when |a| stays near 0 g for FLIGHT_MIN_S after the impact: a second free fall. */
function leftSurface(trace: Trace, mags: readonly number[], impact: number): boolean {
  let flightStartT: number | null = null;
  for (let i = impact; i < mags.length; i++) {
    if (mags[i]! >= FLIGHT_ACCEL) {
      flightStartT = null;
      continue;
    }
    const t = trace.samples[i]!.t;
    flightStartT ??= t;
    if (t - flightStartT >= FLIGHT_MIN_S) return true;
  }
  return false;
}

/** Full per-rep pipeline. Never throws on bad data. */
export function analyzeRep(trace: Trace, ref?: ReferenceStats): RepResult {
  if (estimateRate(trace.samples.map((s) => s.t)) < MIN_RATE_HZ) {
    return reject(trace, ['low-sample-rate']);
  }
  const mags = trace.samples.map(magnitude);
  const impact = mags.findIndex((m) => m - G > IMPACT_EXCESS);
  if (impact < 0) return reject(trace, ['no-drop-found']);
  let descentStart = impact;
  while (descentStart > 0 && G - mags[descentStart - 1]! > DESCENT_DEFICIT) descentStart--;
  const { hoverMinS } = routineSpec(trace.routine);
  const hoverStartT = trace.samples[descentStart]!.t - hoverMinS;
  const hover = trace.samples.slice(0, descentStart).filter((s) => s.t >= hoverStartT - EPS);
  const reasons: RejectReason[] = assessHover(hover, trace.routine, ref).reasons;
  if (leftSurface(trace, mags, impact)) reasons.push('left-surface');
  if (reasons.length > 0) return reject(trace, reasons);
  // shortcut: placeholder until #10 builds the ok path.
  return reject(trace, []);
}
