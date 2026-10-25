import type { FeatureName, ReferenceStats, RejectReason, RepFeatures, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import { DROP_JITTER, assessHover } from './hover';
import { integrate } from './math';
import { DEFAULT_RIG, routineSpec } from './routine';
import type { DropModelName } from './routine';
import { caughtLandingScore, combine, factor, jitterScore, ramp } from './score';
import type { Score } from './score';

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

export type Segments = { impact: number; descentStart: number; hoverFrom: number };

/** Start two samples before the hover start, so the window covers the full hover time plus a sample. */
function hoverFromOf(trace: Trace, descentStart: number): number {
  const hoverStartT = trace.samples[descentStart]!.t - routineSpec(trace.routine).hoverMinS + EPS;
  return Math.max(0, trace.samples.findIndex((s) => s.t > hoverStartT) - 2);
}

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

/** Start of the rise to the peak `peak` that follows the descent ending at `end`: the first sample above 1 g. */
function riseStart(mags: readonly number[], end: number, peak: number): number {
  let impact = peak;
  while (impact - 1 > end && mags[impact - 1]! > GRAVITY) impact--;
  return impact;
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
    found.push({ impact: riseStart(mags, end, peak), descentStart: start, hoverFrom: hoverFromOf(trace, start) });
  }
  return found;
}

/**
 * Finds the hover, descent and impact, or says why the trace has none. The drop is the first descent
 * that follows a still hover, as the protocol says. When none does, the first descent is reported, and the
 * hover check rejects it as not-still.
 */
function bodySegment(trace: Trace, mags: readonly number[]): Segments | RejectReason {
  const candidates = drops(trace, mags);
  const still = candidates.find(
    (c) => assessHover(trace.samples.slice(c.hoverFrom, c.descentStart), trace.routine, DROP_JITTER).still,
  );
  const chosen = still ?? candidates[0];
  if (chosen === undefined) return 'no-drop-found';
  return chosen;
}

/** A free fall must read below this |a|, m/s². Half of 1 g, so a hand that drags the slab still counts and shows as a flight mismatch. */
const FALL_ACCEL = GRAVITY / 2;
/** Fewest samples in a free fall. A 5 cm fall is about 6 samples at 57 Hz. */
const MIN_FALL_SAMPLES = 3;
/** The fall time may differ from sqrt(2h/g) by this share before the weight drops: timing is good to about 17% at 5 cm. */
const FLIGHT_TOL = 0.25;
/** Fall-time error beyond FLIGHT_TOL at which the weight reaches 0. */
const FLIGHT_FALL = 0.25;
/** The landing may tilt this far from the hover orientation, degrees, before the weight drops. */
const TILT_FREE_DEG = 5;
/** Tilt beyond TILT_FREE_DEG at which the weight reaches 0, degrees. */
const TILT_FALL_DEG = 10;
/** The rest orientation is the mean of the last REST_WINDOW_S of the trace, s. */
const REST_WINDOW_S = 0.3;

/**
 * The first run of at least MIN_FALL_SAMPLES samples below FALL_ACCEL that a rise above the impact threshold
 * follows. `flightS` is the run's length. The first still-to-fall change is the release, so no dip length is needed.
 * shortcut: FALL_ACCEL is half of g, not FLIGHT_ACCEL, so a dragged fall is found and scored; re-check on real rig data.
 */
function freeFallDrop(trace: Trace, mags: readonly number[]): { seg: Segments; flightS: number } | RejectReason {
  const { samples } = trace;
  for (let start = 0; start < mags.length; start++) {
    if (mags[start]! >= FALL_ACCEL) continue;
    let end = start;
    while (end + 1 < mags.length && mags[end + 1]! < FALL_ACCEL) end++;
    const count = end - start + 1;
    const peak = count >= MIN_FALL_SAMPLES ? firstPeakAfter(samples, mags, end) : -1;
    if (peak >= 0) {
      const flightS = ((samples[end]!.t - samples[start]!.t) * count) / (count - 1);
      const seg = { impact: riseStart(mags, end, peak), descentStart: start, hoverFrom: hoverFromOf(trace, start) };
      return { seg, flightS };
    }
    start = end;
  }
  return 'no-drop-found';
}

/** Mean gravity direction of `samples`, as a unit vector, or null when empty or zero. */
function meanDirection(samples: readonly Sample[]): [number, number, number] | null {
  const sum = samples.reduce<[number, number, number]>((a, s) => [a[0] + s.ax, a[1] + s.ay, a[2] + s.az], [0, 0, 0]);
  const length = Math.hypot(...sum);
  return length > 0 ? [sum[0] / length, sum[1] / length, sum[2] / length] : null;
}

/** Degrees between the hover orientation and the rest orientation after the landing; 0 when either is unknown. */
function landingTiltDeg(trace: Trace, seg: Segments): number {
  const { samples } = trace;
  const restFrom = samples[samples.length - 1]!.t - REST_WINDOW_S;
  const hover = meanDirection(samples.slice(seg.hoverFrom, seg.descentStart));
  const rest = meanDirection(samples.filter((s) => s.t >= restFrom && s.t > samples[seg.impact]!.t));
  if (hover === null || rest === null) return 0;
  const cos = hover[0] * rest[0] + hover[1] * rest[1] + hover[2] * rest[2];
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export type Axis = 'hardness' | 'springiness';

/**
 * A drop that a model found. Its closures hold the model's own segment, so only that model reads it.
 * `flightS` is set by the free-fall model only: the measured time near 0 g before the impact, s.
 */
export interface FoundDrop {
  seg: Segments;
  flightS?: number;
  /** Impact speed in m/s. */
  impactSpeed(): number;
  quality(input: { jitter: number; features: RepFeatures }, ref?: ReferenceStats): Score;
}

/** The slots in which the body and the free-fall rig differ. */
export interface DropModel {
  findDrop(trace: Trace, mags: readonly number[]): FoundDrop | RejectReason;
  /** The features that score each axis. A feature not listed is recorded only. */
  axes: Partial<Record<FeatureName, Axis>>;
}

const body: DropModel = {
  findDrop(trace, mags) {
    const seg = bodySegment(trace, mags);
    if (typeof seg === 'string') return seg;
    return {
      seg,
      impactSpeed: () => impactSpeedOf(trace, mags, seg.descentStart, seg.impact),
      quality: ({ jitter, features }, ref) => combine(jitterScore(jitter, ref), caughtLandingScore(features.stopTime)),
    };
  },
  axes: { peakOverV: 'hardness', stopTime: 'hardness', bounceRatio: 'springiness' },
};

/** Nominal release height in m, from the trace rig or the default rig. */
const rigHeightM = (trace: Trace) => (trace.rig ?? DEFAULT_RIG).dropHeightCm / 100;

const freeFall: DropModel = {
  findDrop(trace, mags) {
    const found = freeFallDrop(trace, mags);
    if (typeof found === 'string') return found;
    const { seg, flightS } = found;
    return {
      seg,
      flightS,
      impactSpeed: () => Math.sqrt(2 * GRAVITY * rigHeightM(trace)),
      quality({ jitter }, ref) {
        const expectedS = Math.sqrt((2 * rigHeightM(trace)) / GRAVITY);
        return combine(
          jitterScore(jitter, ref),
          factor(ramp(Math.abs(flightS / expectedS - 1) - FLIGHT_TOL, FLIGHT_FALL), 'flight-mismatch'),
          factor(ramp(landingTiltDeg(trace, seg) - TILT_FREE_DEG, TILT_FALL_DEG), 'tilted-landing'),
        );
      },
      // Raw peak: the rig's speed is nominal and its stop time is the lobe width, so neither is scored.
    };
  },
  axes: { peak: 'hardness', bounceRatio: 'springiness' },
};

export const DROP_MODELS: Record<DropModelName, DropModel> = { body, 'free-fall': freeFall };
