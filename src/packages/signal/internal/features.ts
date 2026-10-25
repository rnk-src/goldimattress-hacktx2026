import type { RepFeatures, Sample } from '../../domain';
import { GRAVITY } from './constants';
import { findPeaks, magnitude, smooth3 } from './math';

/** Rest band around 1 g, m/s² (0.05 g). */
const SETTLE_BAND = 0.05 * GRAVITY;
/** A bounce peak below this is noise, m/s² (4 σ of a 0.05 m/s² noise floor, smoothed). */
const MIN_BOUNCE_PEAK = 0.12;

/**
 * The five rep features from the samples at and after the impact (`impact` indexes `samples`, and
 * is at least 1). Everything is the excess of |a| over 1 g, and times count from the impact, which
 * falls midway between the last descent sample and the first impact sample.
 * `peakOverV` is the first lobe's peak over the impact speed. Null when there is no positive first lobe or any feature is not finite.
 */
export function repFeatures(
  samples: readonly Sample[],
  impact: number,
  impactSpeed: number,
): RepFeatures | null {
  const impactT = (samples[impact - 1]!.t + samples[impact]!.t) / 2;
  const t = samples.slice(impact).map((s) => s.t);
  const excess = samples.slice(impact).map((s) => magnitude(s) - GRAVITY);

  const firstLobeEnd = excess.findIndex((e) => e <= 0);
  // No positive first lobe: the impact sample is already at or below 1 g, so the features are undefined.
  if (firstLobeEnd === 0) return null;
  const peak = Math.max(...excess.slice(0, firstLobeEnd < 0 ? undefined : firstLobeEnd));
  // Linear crossing of 1 g between the last positive and the first non-positive sample.
  const crossing =
    firstLobeEnd < 0
      ? t[t.length - 1]!
      : t[firstLobeEnd - 1]! +
        ((t[firstLobeEnd]! - t[firstLobeEnd - 1]!) * excess[firstLobeEnd - 1]!) /
          (excess[firstLobeEnd - 1]! - excess[firstLobeEnd]!);
  const features = {
    peak,
    peakOverV: peak / impactSpeed,
    stopTime: crossing - impactT,
    bounceRatio: bounceRatioOf(excess, firstLobeEnd),
    settleTime: settleTimeOf(t, excess) - impactT,
  };
  return Object.values(features).every(Number.isFinite) ? features : null;
}

/**
 * A₂/A₁ of the first two positive lobes of the smoothed excess. A₂ is the highest value of the first
 * lobe after `firstLobeEnd` whose peak clears the noise. 0 when there is none.
 */
function bounceRatioOf(excess: readonly number[], firstLobeEnd: number): number {
  const smooth = smooth3(excess);
  const a1 = Math.max(...smooth.slice(0, firstLobeEnd < 0 ? undefined : firstLobeEnd));
  const first = findPeaks(smooth, { minHeight: MIN_BOUNCE_PEAK }).find((i) => i > firstLobeEnd);
  if (firstLobeEnd < 0 || first === undefined) return 0;
  let a2 = 0;
  for (let i = first; i < smooth.length && smooth[i]! > 0; i++) a2 = Math.max(a2, smooth[i]!);
  return a2 / a1;
}

/**
 * Time of the last sample whose smoothed excess is outside the rest band; the first sample if none.
 * shortcut: a trace that ends before the rep settles reports the trace end, so use traces long enough.
 */
function settleTimeOf(t: readonly number[], excess: readonly number[]): number {
  const smooth = smooth3(excess);
  let last = 0;
  smooth.forEach((e, i) => {
    if (Math.abs(e) > SETTLE_BAND) last = i;
  });
  return t[last]!;
}
