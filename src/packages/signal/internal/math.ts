import type { Sample } from '../../domain';

/** |a| = √(ax² + ay² + az²). Independent of how the phone faces. */
export function magnitude(s: Pick<Sample, 'ax' | 'ay' | 'az'>): number {
  return Math.hypot(s.ax, s.ay, s.az);
}

/** Sample standard deviation (n − 1). 0 for fewer than 2 values. */
export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const sumSq = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0);
  return Math.sqrt(sumSq / (xs.length - 1));
}

/** Median of `xs` where each value counts `ws[i]` times. Equals the plain median when all weights match. */
export function weightedMedian(xs: readonly number[], ws: readonly number[]): number {
  const order = xs.map((x, i) => ({ x, w: ws[i]! })).sort((a, b) => a.x - b.x);
  const half = order.reduce((sum, o) => sum + o.w, 0) / 2;
  let cum = 0;
  for (let i = 0; i < order.length; i++) {
    cum += order[i]!.w;
    if (Math.abs(cum - half) < 1e-9 && i + 1 < order.length) return (order[i]!.x + order[i + 1]!.x) / 2;
    if (cum > half) return order[i]!.x;
  }
  return order[order.length - 1]!.x;
}

/** Weighted MAD about `center`, scaled by 1.4826 so it matches the std of a normal distribution. */
export function scaledMad(xs: readonly number[], ws: readonly number[], center: number): number {
  return 1.4826 * weightedMedian(xs.map((x) => Math.abs(x - center)), ws);
}

/** Trapezoid rule over uneven spacing. 0 for fewer than 2 points. */
export function integrate(t: readonly number[], y: readonly number[]): number {
  if (t.length !== y.length) throw new RangeError('t and y must have the same length');
  let area = 0;
  for (let i = 1; i < t.length; i++) {
    area += ((y[i]! + y[i - 1]!) / 2) * (t[i]! - t[i - 1]!);
  }
  return area;
}

/**
 * Indexes of local maxima at or above `minHeight`. A flat top counts once, at its first index.
 * The first and last sample are never peaks.
 */
export function findPeaks(ys: readonly number[], opts: { minHeight?: number } = {}): number[] {
  const minHeight = opts.minHeight ?? -Infinity;
  const peaks: number[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    let end = i;
    while (end < ys.length - 1 && ys[end + 1] === ys[i]) end++;
    const rises = ys[i - 1]! < ys[i]!;
    const falls = end < ys.length - 1 && ys[end + 1]! < ys[i]!;
    if (rises && falls && ys[i]! >= minHeight) peaks.push(i);
    i = end;
  }
  return peaks;
}

/** Samples per second from the first and last sample time. 0 for fewer than 2 times. */
export function estimateRate(times: readonly number[]): number {
  if (times.length < 2) return 0;
  return (times.length - 1) / (times[times.length - 1]! - times[0]!);
}

/** Moving average over each value and its neighbours. Ends average over the two values they have. */
export function smooth3(ys: readonly number[]): number[] {
  return ys.map((_, i) => {
    const window = ys.slice(Math.max(0, i - 1), i + 2);
    return window.reduce((sum, y) => sum + y, 0) / window.length;
  });
}

/**
 * Mean of `xs` after dropping the lowest and highest `trim` share of the total weight. A value on the cut line is split.
 * Falls back to the weighted median below `minReps` values.
 */
export function weightedTrimmedMean(xs: readonly number[], ws: readonly number[], trim: number, minReps: number): number {
  const total = ws.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) throw new RangeError('total weight must be positive');
  if (xs.length < minReps) return weightedMedian(xs, ws);
  const order = xs.map((x, i) => ({ x, w: ws[i]! })).sort((a, b) => a.x - b.x);
  const lo = trim * total;
  const hi = (1 - trim) * total;
  let cum = 0;
  let kept = 0;
  let sum = 0;
  for (const { x, w } of order) {
    const w2 = Math.max(0, Math.min(cum + w, hi) - Math.max(cum, lo));
    kept += w2;
    sum += w2 * x;
    cum += w;
  }
  return sum / kept;
}
