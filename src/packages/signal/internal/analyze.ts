import type { ReferenceStats, RejectReason, RepResult, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import { repFeatures } from './features';
import { DROP_JITTER, assessHover } from './hover';
import { estimateRate, integrate, magnitude } from './math';
import { routineSpec } from './routine';
import { scoreRep } from './score';

/** |a| this far above 1 g marks the impact, m/s². Above hover wobble, below the weakest real impact. */
export const IMPACT_EXCESS = 1.5;
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
/**
 * At most this share of a descent run may be bridged non-dip samples, so noise dips do not chain into one.
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const MAX_BRIDGED_SHARE = 0.25;
/** Slack for float error in sample times, s. */
const EPS = 1e-6;
/** Below this rate the impact is too coarse to measure, Hz. */
const MIN_RATE_HZ = 40;
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

type Run = { start: number; end: number; bridged: number };

/**
 * Runs of samples more than DESCENT_DEFICIT below 1 g, in time order. One sample that is not a dip may join
 * two dips (a bounce) when it is within DESCENT_GAP_S and below the impact threshold. A run is at most
 * MAX_BRIDGED_SHARE bridged, so scattered noise dips do not chain into a descent, and an impact rise ends it.
 */
function dipRuns(samples: readonly Sample[], mags: readonly number[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < mags.length; i++) {
    if (GRAVITY - mags[i]! <= DESCENT_DEFICIT) continue;
    const last = runs[runs.length - 1];
    const skipped = last ? i - last.end - 1 : 0;
    const bridgeable =
      last !== undefined &&
      skipped <= 1 &&
      samples[i]!.t - samples[last.end]!.t <= DESCENT_GAP_S &&
      (skipped === 0 || mags[i - 1]! - GRAVITY <= IMPACT_EXCESS) &&
      (last.bridged + skipped) / (i - last.start + 1) <= MAX_BRIDGED_SHARE;
    if (last && bridgeable) {
      last.bridged += skipped;
      last.end = i;
    } else runs.push({ start: i, end: i, bridged: 0 });
  }
  return runs;
}

/** First local maximum after `end` that clears the impact threshold within RISE_WITHIN_S, or -1. */
function firstPeakAfter(samples: readonly Sample[], mags: readonly number[], end: number): number {
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

/**
 * Every descent of at least MIN_DESCENT_S that a rise above the impact threshold follows, in time order.
 * The impact is the start of the rise to its first peak. A bump in the hover has no descent before it.
 */
function drops(trace: Trace, mags: readonly number[]): Segments[] {
  const { samples } = trace;
  const found: Segments[] = [];
  for (const { start, end } of dipRuns(samples, mags)) {
    if (samples[end]!.t - samples[start]!.t < MIN_DESCENT_S) continue;
    const peak = firstPeakAfter(samples, mags, end);
    if (peak < 0) continue;
    let impact = peak;
    while (impact - 1 > end && mags[impact - 1]! > GRAVITY) impact--;
    // Start two samples before the hover start, so the window covers the full hover time plus a sample.
    const hoverStartT = samples[start]!.t - routineSpec(trace.routine).hoverMinS + EPS;
    const hoverFrom = Math.max(0, samples.findIndex((s) => s.t > hoverStartT) - 2);
    found.push({ impact, descentStart: start, hoverFrom });
  }
  return found;
}

/**
 * Finds the hover, descent and impact, or says why the trace has none. The drop is the first descent
 * that follows a still hover, as the protocol says. When none does, the first descent is reported, and the
 * hover check rejects it as not-still.
 */
function segment(trace: Trace, mags: readonly number[]): Segments | RejectReason {
  const candidates = drops(trace, mags);
  const still = candidates.find(
    (c) => assessHover(trace.samples.slice(c.hoverFrom, c.descentStart), trace.routine, undefined, DROP_JITTER).still,
  );
  const chosen = still ?? candidates[0];
  if (chosen === undefined) return 'no-drop-found';
  if (hasGap(trace.samples, chosen.hoverFrom, trace.samples[chosen.impact]!.t + GAP_WINDOW_AFTER_IMPACT_S)) {
    return 'low-sample-rate';
  }
  return chosen;
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

/** Full per-rep pipeline. Never throws on bad data. */
export function analyzeRep(trace: Trace, ref?: ReferenceStats): RepResult {
  if (estimateRate(trace.samples.map((s) => s.t)) < MIN_RATE_HZ) {
    return reject(trace, ['low-sample-rate']);
  }
  const mags = trace.samples.map(magnitude);
  const seg = segment(trace, mags);
  if (typeof seg === 'string') return reject(trace, [seg]);

  const assessment = assessHover(trace.samples.slice(seg.hoverFrom, seg.descentStart), trace.routine, undefined, DROP_JITTER);
  // Only a hover too violent to be a hover is dropped; the rest of the hover quality is scored below.
  const early: RejectReason[] = assessment.still ? [] : ['not-still'];
  if (leftSurface(trace, mags, seg.impact)) early.push('left-surface');
  if (early.length > 0) return reject(trace, early);

  const measured = measure(trace, mags, seg, assessment.leanDeg);
  if (measured === null) return reject(trace, ['no-drop-found']);
  const { weight, issues } = scoreRep(
    { jitter: assessment.jitter, leanDeg: measured.leanDeg, impactSpeed: measured.impactSpeed, stopTime: measured.features.stopTime },
    ref,
  );
  return { ok: true, ...measured, hoverJitter: assessment.jitter, weight, issues, trace };
}
