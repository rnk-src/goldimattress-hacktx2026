import type { RepFeatures } from '../../domain';
import { assertSurfaceStaysInContact, excessAcceleration } from './response';
import { DEFAULTS, GRAVITY, type SynthOptions } from './synth';

const SETTLE_BAND = 0.05 * GRAVITY;

/** t in [lo, hi] where f crosses zero. f(lo) > 0 and f(hi) < 0. */
function bisect(f: (t: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Analytic answers for the trace `synthRep(opts)` makes, with no noise and no sampling error.
 * Times are seconds after impact. Accelerations are the excess over 1 g, so
 * `peakOverV` = (a_peak − g) / v. `settleTime` is the last time the excess exceeds ±0.05 g.
 */
export function expectedFeatures(opts: SynthOptions = {}): RepFeatures {
  const v = opts.impactSpeed ?? DEFAULTS.impactSpeed;
  const bounceHz = opts.bounceHz ?? DEFAULTS.bounceHz;
  const bounceRatio = opts.bounceRatio ?? DEFAULTS.bounceRatio;
  assertSurfaceStaysInContact(v, bounceHz, bounceRatio);
  const excess = (t: number) => excessAcceleration(t, v, bounceHz, bounceRatio);
  const overBand = (t: number) => Math.abs(excess(t)) - SETTLE_BAND;
  const omegaD = 2 * Math.PI * bounceHz;

  if (bounceRatio === 0) {
    // Critically damped: one positive lobe to 2/ω, then one shallow negative lobe with its minimum at 3/ω.
    const stopTime = 2 / omegaD;
    const settleTime =
      overBand(3 / omegaD) > 0
        ? bisect(overBand, 3 / omegaD, 60 / omegaD)
        : overBand(0) > 0
          ? bisect(overBand, 0, stopTime)
          : 0;
    return { peakOverV: excess(0) / v, stopTime, bounceRatio, settleTime };
  }

  const sigma = -Math.log(bounceRatio) * bounceHz;
  const omegaSq = omegaD ** 2 + sigma ** 2;
  const phase = Math.atan2(2 * sigma * omegaD, omegaSq - 2 * sigma ** 2);
  const alpha = Math.atan2(omegaD, sigma);
  /** Time of the k-th extremum. Even k are positive peaks. */
  const extremum = (k: number) => (alpha + k * Math.PI - phase) / omegaD;

  const peakOverV = (extremum(0) > 0 ? excess(extremum(0)) : excess(0)) / v;
  const stopTime = (Math.PI - phase) / omegaD;

  let last = overBand(0) > 0 ? 0 : null;
  for (let k = 0; k < 100_000; k++) {
    const t = extremum(k);
    if (t <= 0) continue;
    if (overBand(t) <= 0) break;
    last = t;
  }
  if (last === null) return { peakOverV, stopTime, bounceRatio, settleTime: 0 };
  // The next zero crossing is below the band, and |excess| falls steadily until it.
  const nextZero = (Math.floor((last * omegaD + phase) / Math.PI) + 1) * Math.PI - phase;
  return { peakOverV, stopTime, bounceRatio, settleTime: bisect(overBand, last, nextZero / omegaD) };
}
