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
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const MIN_DESCENT_S = 0.1;
/**
 * Samples this close in time (s) to a dip still belong to its descent. One bounce sample before the impact
 * is 0.017 s at 60 Hz; the couch set had one per rep.
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const DESCENT_GAP_S = 0.05;
/**
 * The peak must come this soon after the descent ends, s. Real rises took 0.1 s (chair) to 0.2 s (couch).
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const RISE_WITHIN_S = 0.4;
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

type Run = { start: number; end: number };

/**
 * Runs of samples more than DESCENT_DEFICIT below 1 g, in time order. Samples closer than DESCENT_GAP_S
 * join one run, so a single bounce sample does not split a descent.
 */
function dipRuns(samples: readonly Sample[], mags: readonly number[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < mags.length; i++) {
    if (GRAVITY - mags[i]! <= DESCENT_DEFICIT) continue;
    const last = runs[runs.length - 1];
    if (last && samples[i]!.t - samples[last.end]!.t <= DESCENT_GAP_S) last.end = i;
    else runs.push({ start: i, end: i });
  }
  return runs;
}

/**
 * The strongest impact that follows a descent of at least MIN_DESCENT_S, or null. The impact is the start
 * of the rise to the peak, and the descent start is the first sample of the dip. A bump in the hover has
 * no descent before it, and when movement before the drop also makes a dip and a bump, the harder hit wins.
 */
function strongestDrop(trace: Trace, mags: readonly number[]) {
  const { samples } = trace;
  let best: { impact: number; descentStart: number; peak: number } | null = null;
  for (const { start, end } of dipRuns(samples, mags)) {
    if (samples[end]!.t - samples[start]!.t < MIN_DESCENT_S) continue;
    let peak = -1;
    for (let i = end + 1; i < mags.length && samples[i]!.t - samples[end]!.t <= RISE_WITHIN_S; i++) {
      if (peak < 0 || mags[i]! > mags[peak]!) peak = i;
    }
    if (peak < 0 || mags[peak]! - GRAVITY <= IMPACT_EXCESS || (best && mags[peak]! <= best.peak)) continue;
    let impact = peak;
    while (impact - 1 > end && mags[impact - 1]! > GRAVITY) impact--;
    best = { impact, descentStart: start, peak: mags[peak]! };
  }
  return best;
}

/** Finds the hover, descent and impact, or says why the trace has none. */
function segment(trace: Trace, mags: readonly number[]): Segments | RejectReason {
  const found = strongestDrop(trace, mags);
  if (found === null) return 'no-drop-found';
  const { impact, descentStart } = found;
  // Start one sample before the hover start, so the window always covers the full hover time.
  const hoverStartT = trace.samples[descentStart]!.t - routineSpec(trace.routine).hoverMinS + EPS;
  const firstAfter = trace.samples.findIndex((s) => s.t > hoverStartT);
  const hoverFrom = Math.max(0, firstAfter - 2);
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
