import type { RejectReason, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import { IMPACT_EXCESS, firstPeakAfter, hoverFromOf, riseStart } from './drop-model';
import type { DropContext, DropModel, Segments } from './drop-model';
import { integrate } from './math';
import { caughtLandingScore, combine, jitterScore } from './score';

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
 * At most this share of a descent run may be bridged non-dip samples, so noise dips do not chain into one.
 * shortcut: tuned on two sets (desk chair, couch), re-tune with more surfaces.
 */
const MAX_BRIDGED_SHARE = 0.25;

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

/**
 * Every descent of at least MIN_DESCENT_S that a rise above the impact threshold follows, in time order.
 * The impact is the start of the rise to its first peak. A bump in the hover has no descent before it.
 */
function drops(trace: Trace, mags: readonly number[], hoverMinS: number): Segments[] {
  const { samples } = trace;
  const found: Segments[] = [];
  for (const { start, end } of dipRuns(samples, mags)) {
    if (samples[end]!.t - samples[start]!.t < MIN_DESCENT_S) continue;
    const peak = firstPeakAfter(samples, mags, end);
    if (peak < 0) continue;
    found.push({ impact: riseStart(mags, end, peak), descentStart: start, hoverFrom: hoverFromOf(trace, start, hoverMinS) });
  }
  return found;
}

/**
 * Finds the hover, descent and impact, or says why the trace has none. The drop is the first descent
 * that follows a still hover, as the protocol says. When none does, the first descent is reported, and the
 * hover check rejects it as not-still.
 */
function bodySegment(trace: Trace, mags: readonly number[], ctx: DropContext): Segments | RejectReason {
  const candidates = drops(trace, mags, ctx.hoverMinS);
  const still = candidates.find((c) => ctx.isStill(trace.samples.slice(c.hoverFrom, c.descentStart)));
  const chosen = still ?? candidates[0];
  if (chosen === undefined) return 'no-drop-found';
  return chosen;
}

export const body: DropModel = {
  findDrop(trace, mags, ctx) {
    const seg = bodySegment(trace, mags, ctx);
    if (typeof seg === 'string') return seg;
    return {
      seg,
      impactSpeed: () => impactSpeedOf(trace, mags, seg.descentStart, seg.impact),
      quality: ({ jitter, features }, ref) => combine(jitterScore(jitter, ref), caughtLandingScore(features.stopTime)),
    };
  },
  axes: { peakOverV: 'hardness', stopTime: 'hardness', bounceRatio: 'springiness' },
  relFloor: 0.08,
  signedLean: false,
};
