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
