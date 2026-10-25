import type { ReferenceStats, RejectReason, RepFeatures, RepResult, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import { repFeatures } from './features';
import { assessHover } from './hover';
import { estimateRate, integrate, magnitude } from './math';
import { routineSpec } from './routine';

/** |a| this far above 1 g marks the impact, m/s². Above hover wobble, below the weakest real impact. */
const IMPACT_EXCESS = 1.5;
/** |a| this far below 1 g counts as the descent, m/s². */
const DESCENT_DEFICIT = 0.5;
/**
 * A descent shorter than this is not a drop, s. Real descents lasted 0.22 to 0.33 s (|a| more than 0.5
 * below 1 g); a hover bump has none or a one-sample dip.
 * shortcut: tuned on one 5-rep desk-chair set, re-tune with more surfaces.
 */
const MIN_DESCENT_S = 0.1;
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
  const excess = mags.slice(from, impact).map((m) => m - GRAVITY);
  const step = trace.samples[impact]!.t - trace.samples[impact - 1]!.t;
  return -(integrate(t, excess) + (step / 2) * excess[excess.length - 1]!);
}

type Segments = { impact: number; descentStart: number; hoverFrom: number };

/**
 * The impact and descent start for the rise at sample `trigger`, or null when no descent of at least
 * MIN_DESCENT_S leads into it. A bump in the hover has no such descent.
 */
function descentInto(trace: Trace, mags: readonly number[], trigger: number) {
  // A light-damped impact rises slowly, so back up over the rise to the end of the descent.
  // shortcut: a descent with less than DESCENT_DEFICIT of deficit is not seen, so the rep is rejected as not-still.
  let impact = trigger;
  while (impact > 0 && GRAVITY - mags[impact - 1]! <= DESCENT_DEFICIT) impact--;
  if (impact < 1) return null;
  let descentStart = impact;
  while (descentStart > 0 && GRAVITY - mags[descentStart - 1]! > DESCENT_DEFICIT) descentStart--;
  const lastT = trace.samples[impact - 1]!.t;
  return lastT - trace.samples[descentStart]!.t >= MIN_DESCENT_S ? { impact, descentStart } : null;
}

/** Finds the hover, descent and impact, or says why the trace has none. */
function segment(trace: Trace, mags: readonly number[]): Segments | RejectReason {
  let found: ReturnType<typeof descentInto> = null;
  for (let i = 0; i < mags.length && found === null; i++) {
    if (mags[i]! - GRAVITY > IMPACT_EXCESS) found = descentInto(trace, mags, i);
  }
  if (found === null) return 'no-drop-found';
  const { impact, descentStart } = found;
  // Start at the last sample at or before the hover start, so the window covers the full hover time.
  const hoverStartT = trace.samples[descentStart]!.t - routineSpec(trace.routine).hoverMinS + EPS;
  const firstAfter = trace.samples.findIndex((s) => s.t > hoverStartT);
  const hoverFrom = Math.max(0, firstAfter - 1);
  if (hasGap(trace.samples, hoverFrom, trace.samples[impact]!.t + GAP_WINDOW_AFTER_IMPACT_S)) {
    return 'low-sample-rate';
  }
  return { impact, descentStart, hoverFrom };
}

/** Impact speed, features and lean, or null when any of them is not a finite, positive-speed number. */
function measure(
  trace: Trace,
  mags: readonly number[],
  { impact, descentStart }: Segments,
  leanDeg: number,
) {
  const impactSpeed = impactSpeedOf(trace, mags, descentStart, impact);
  if (!(impactSpeed > 0 && Number.isFinite(impactSpeed))) return null;
  const features = repFeatures(trace.samples, impact, impactSpeed);
  return features === null ? null : { features, impactSpeed, leanDeg };
}

/** Reasons from the caught-landing limit and, with a reference, the impact-speed window. */
function gate(trace: Trace, m: { features: RepFeatures; impactSpeed: number }, ref?: ReferenceStats) {
  const reasons: RejectReason[] = [];
  if (m.features.stopTime > CAUGHT_STOP_S) reasons.push('caught-landing');
  if (ref) {
    const ratio = m.impactSpeed / ref.impactSpeed.mean;
    const { speedTol } = routineSpec(trace.routine);
    if (ratio > 1 + speedTol) reasons.push('too-fast');
    else if (ratio < 1 - speedTol) reasons.push('too-slow');
  }
  return reasons;
}

/** Full per-rep pipeline. Never throws on bad data. */
export function analyzeRep(trace: Trace, ref?: ReferenceStats): RepResult {
  if (estimateRate(trace.samples.map((s) => s.t)) < MIN_RATE_HZ) {
    return reject(trace, ['low-sample-rate']);
  }
  const mags = trace.samples.map(magnitude);
  const seg = segment(trace, mags);
  if (typeof seg === 'string') return reject(trace, [seg]);

  const assessment = assessHover(trace.samples.slice(seg.hoverFrom, seg.descentStart), trace.routine, ref);
  const early = [...assessment.reasons];
  if (leftSurface(trace, mags, seg.impact)) early.push('left-surface');
  if (early.length > 0) return reject(trace, early);

  const measured = measure(trace, mags, seg, assessment.leanDeg);
  if (measured === null) return reject(trace, ['no-drop-found']);
  const late = gate(trace, measured, ref);
  if (late.length > 0) return reject(trace, late);
  return { ok: true, ...measured, trace };
}
