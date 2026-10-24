import type { ReferenceStats, RejectReason, RepResult, Sample, Trace } from '../../domain';
import { repFeatures } from './features';
import { assessHover } from './hover';
import { estimateRate, integrate, magnitude } from './math';
import { routineSpec } from './routine';

const G = 9.81;
/** |a| this far above 1 g marks the impact, m/s². Above hover wobble, below the weakest real impact. */
const IMPACT_EXCESS = 1.5;
/** |a| this far below 1 g counts as the descent, m/s². */
const DESCENT_DEFICIT = 0.5;
/** Slack for float error in sample times, s. */
const EPS = 1e-6;
/** Below this rate the impact is too coarse to measure, Hz. */
const MIN_RATE_HZ = 40;
/**
 * A first lobe longer than this means tensed legs smeared the impact, s. The slowest real surface in
 * the synthetic grid (1 Hz bounce) stops after 0.49 s.
 * shortcut: absolute limit, a soft foam may be flagged; compare with the reference stopTime when real fixtures exist.
 */
const CAUGHT_STOP_S = 0.6;
/** |a| below this long enough after the impact means the mass left the surface, m/s². */
const FLIGHT_ACCEL = 2;
/** shortcut: a trough near 0 g this long counts as flight, so a rep at the contact limit may be rejected; tune on fixtures. */
const FLIGHT_MIN_S = 0.05;

/**
 * Largest gap between samples that may sit between the hover window and 1 s after the impact, s.
 * shortcut: 0.1 s from real iPhone captures with 195 ms and 326 ms gaps at about 60 Hz, tune on G2 fixtures.
 */
const MAX_GAP_S = 0.1;
/** Gaps later than this after the impact are ignored, s. */
const GAP_WINDOW_AFTER_IMPACT_S = 1;

function reject(trace: Trace, reasons: RejectReason[]): RepResult {
  return { ok: false, reasons, trace };
}

/** True when two neighbouring samples from index `from` up to time `untilT` are more than MAX_GAP_S apart. */
function hasGap(samples: readonly Sample[], from: number, untilT: number): boolean {
  for (let i = from + 1; i < samples.length && samples[i - 1]!.t <= untilT; i++) {
    if (samples[i]!.t - samples[i - 1]!.t > MAX_GAP_S) return true;
  }
  return false;
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

/**
 * v = −∫(|a| − g)dt from the last hover sample to the impact. The impact falls somewhere between
 * the last descent sample and the first impact sample, so half a step of that deficit is added.
 */
function impactSpeedOf(trace: Trace, mags: readonly number[], descentStart: number, impact: number): number {
  const from = Math.max(0, descentStart - 1);
  const t = trace.samples.slice(from, impact).map((s) => s.t);
  const excess = mags.slice(from, impact).map((m) => m - G);
  const step = trace.samples[impact]!.t - trace.samples[impact - 1]!.t;
  return -(integrate(t, excess) + (step / 2) * excess[excess.length - 1]!);
}

/** Full per-rep pipeline. Never throws on bad data. */
export function analyzeRep(trace: Trace, ref?: ReferenceStats): RepResult {
  if (estimateRate(trace.samples.map((s) => s.t)) < MIN_RATE_HZ) {
    return reject(trace, ['low-sample-rate']);
  }
  const mags = trace.samples.map(magnitude);
  const trigger = mags.findIndex((m) => m - G > IMPACT_EXCESS);
  if (trigger < 0) return reject(trace, ['no-drop-found']);
  // A light-damped impact rises slowly, so back up over the rise to the end of the descent.
  // shortcut: a descent with less than DESCENT_DEFICIT of deficit is not seen, so the rep is rejected as not-still.
  let impact = trigger;
  while (impact > 0 && G - mags[impact - 1]! <= DESCENT_DEFICIT) impact--;
  if (impact < 1) return reject(trace, ['no-drop-found']);
  let descentStart = impact;
  while (descentStart > 0 && G - mags[descentStart - 1]! > DESCENT_DEFICIT) descentStart--;
  const { hoverMinS, speedTol } = routineSpec(trace.routine);
  const hoverStartT = trace.samples[descentStart]!.t - hoverMinS - EPS;
  const hoverFrom = trace.samples.findIndex((s) => s.t >= hoverStartT);
  const hover = trace.samples.slice(hoverFrom, descentStart);
  if (hasGap(trace.samples, hoverFrom, trace.samples[impact]!.t + GAP_WINDOW_AFTER_IMPACT_S)) {
    return reject(trace, ['low-sample-rate']);
  }
  const assessment = assessHover(hover, trace.routine, ref);
  const reasons: RejectReason[] = [...assessment.reasons];
  if (leftSurface(trace, mags, impact)) reasons.push('left-surface');
  if (reasons.length > 0) return reject(trace, reasons);
  const impactSpeed = impactSpeedOf(trace, mags, descentStart, impact);
  if (!(impactSpeed > 0 && Number.isFinite(impactSpeed))) return reject(trace, ['no-drop-found']);
  const features = repFeatures(trace.samples, impact, impactSpeed);
  if (features === null || !Object.values(features).every(Number.isFinite)) {
    return reject(trace, ['no-drop-found']);
  }
  if (!Number.isFinite(assessment.leanDeg)) return reject(trace, ['no-drop-found']);
  if (features.stopTime > CAUGHT_STOP_S) reasons.push('caught-landing');
  if (ref) {
    const ratio = impactSpeed / ref.impactSpeed.mean;
    if (ratio > 1 + speedTol) reasons.push('too-fast');
    else if (ratio < 1 - speedTol) reasons.push('too-slow');
  }
  if (reasons.length > 0) return reject(trace, reasons);
  return { ok: true, features, impactSpeed, leanDeg: assessment.leanDeg, trace };
}
