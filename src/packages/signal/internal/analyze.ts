import type { ReferenceStats, RejectReason, RepResult, Sample, Trace } from '../../domain';
import { FLIGHT_ACCEL } from './constants';
import { DROP_MODELS } from './drop-model';
import type { DropModel, Segments } from './drop-model';
import { repFeatures } from './features';
import { DROP_JITTER, assessHover } from './hover';
import { estimateRate, magnitude } from './math';
import { dropModelOf } from './routine';

/**
 * A drop slower than this is not a drop, m/s. Real accepted reps measured 0.35 to 1.13; a rep that read 0.10 had
 * a plausible shape but a nonsense bounce ratio.
 * shortcut: from three real sets, re-check with softer surfaces.
 */
const MIN_IMPACT_SPEED = 0.2;
/** Below this rate the impact is too coarse to measure, Hz. */
const MIN_RATE_HZ = 40;
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

/** Impact speed, features, lean and flight time, or null when the speed or a feature is not a finite number. */
function measure(model: DropModel, trace: Trace, mags: readonly number[], seg: Segments, leanDeg: number) {
  const impactSpeed = model.impactSpeed(trace, mags, seg);
  if (!(impactSpeed >= MIN_IMPACT_SPEED && Number.isFinite(impactSpeed))) return null;
  const features = repFeatures(trace.samples, seg.impact, impactSpeed);
  if (features === null) return null;
  return { features, impactSpeed, leanDeg, ...(seg.flightS === undefined ? {} : { flightS: seg.flightS }) };
}

/** Full per-rep pipeline: the shared shell around the routine's drop model. Never throws on bad data. */
export function analyzeRep(trace: Trace, ref?: ReferenceStats): RepResult {
  if (estimateRate(trace.samples.map((s) => s.t)) < MIN_RATE_HZ) {
    return reject(trace, ['low-sample-rate']);
  }
  const model = DROP_MODELS[dropModelOf(trace.routine)];
  const mags = trace.samples.map(magnitude);
  const seg = model.findDrop(trace, mags);
  if (typeof seg === 'string') return reject(trace, [seg]);
  if (hasGap(trace.samples, seg.hoverFrom, trace.samples[seg.impact]!.t + GAP_WINDOW_AFTER_IMPACT_S)) {
    return reject(trace, ['low-sample-rate']);
  }

  const assessment = assessHover(trace.samples.slice(seg.hoverFrom, seg.descentStart), trace.routine, DROP_JITTER);
  // Only a hover too violent to be a hover is dropped; the rest of the hover quality is scored below.
  const early: RejectReason[] = assessment.still ? [] : ['not-still'];
  if (leftSurface(trace, mags, seg.impact)) early.push('left-surface');
  if (early.length > 0) return reject(trace, early);

  const measured = measure(model, trace, mags, seg, assessment.leanDeg);
  if (measured === null) return reject(trace, ['no-drop-found']);
  const { weight, issues } = model.quality(
    { trace, seg, jitter: assessment.jitter, stopTime: measured.features.stopTime },
    ref,
  );
  return { ok: true, ...measured, hoverJitter: assessment.jitter, weight, issues, trace };
}
