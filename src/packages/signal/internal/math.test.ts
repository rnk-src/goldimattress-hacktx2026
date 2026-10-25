import { describe, expect, it } from 'vitest';
import { estimateRate, findPeaks, integrate, magnitude, smooth3, std, weightedTrimmedMean } from './math';

describe('magnitude', () => {
  it('is the Euclidean norm of the axes', () => {
    expect(magnitude({ ax: 3, ay: 4, az: 12 })).toBe(13);
  });

  it('does not depend on the sign of an axis', () => {
    expect(magnitude({ ax: -3, ay: 4, az: -12 })).toBe(13);
  });
});

describe('std', () => {
  it('is the sample standard deviation (n - 1)', () => {
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('is 0 for a constant signal', () => {
    expect(std([9.81, 9.81, 9.81])).toBe(0);
  });

  it('is 0 for fewer than 2 values', () => {
    expect(std([])).toBe(0);
    expect(std([5])).toBe(0);
  });
});

describe('integrate', () => {
  it('integrates y = t over [0, 2] to 2', () => {
    const t = [0, 0.5, 1, 1.5, 2];
    expect(integrate(t, t)).toBeCloseTo(2, 10);
  });

  it('handles uneven spacing', () => {
    expect(integrate([0, 1, 4], [3, 3, 3])).toBe(12);
  });

  it('is 0 for fewer than 2 points', () => {
    expect(integrate([1], [5])).toBe(0);
  });

  it('throws when the arrays differ in length', () => {
    expect(() => integrate([0, 1], [1])).toThrow(RangeError);
  });
});

describe('findPeaks', () => {
  const sine = Array.from({ length: 81 }, (_, i) => Math.sin((2 * Math.PI * i) / 40));

  it('finds the maxima of two sine periods', () => {
    expect(findPeaks(sine)).toEqual([10, 50]);
  });

  it('keeps only peaks at or above minHeight', () => {
    expect(findPeaks([0, 1, 0, 3, 0, 2, 0], { minHeight: 2 })).toEqual([3, 5]);
  });

  it('reports a flat-topped peak once', () => {
    expect(findPeaks([0, 2, 2, 2, 0])).toEqual([1]);
  });

  it('ignores the first and last sample', () => {
    expect(findPeaks([5, 1, 0, 1, 5])).toEqual([]);
  });
});

describe('estimateRate', () => {
  it('is the sample count between first and last time over their span', () => {
    expect(estimateRate([0, 0.1, 0.2, 0.3, 0.4])).toBeCloseTo(10, 9);
  });

  it('is 0 for fewer than 2 times', () => {
    expect(estimateRate([0.5])).toBe(0);
  });
});

describe('smooth3', () => {
  it('averages each value with its neighbours', () => {
    expect(smooth3([0, 3, 0, 3, 0])).toEqual([1.5, 1, 2, 1, 1.5]);
  });

  it('keeps the length and handles a single value', () => {
    expect(smooth3([4])).toEqual([4]);
    expect(smooth3([])).toEqual([]);
  });
});

describe('weightedTrimmedMean guards', () => {
  it('throws on zero total weight instead of returning NaN', () => {
    expect(() => weightedTrimmedMean([1, 2, 3, 4, 5], [0, 0, 0, 0, 0], 0.2, 5)).toThrow(RangeError);
    expect(() => weightedTrimmedMean([1, 2], [0, 0], 0.2, 5)).toThrow(RangeError);
  });

  it('throws when trim is 0.5 or more', () => {
    expect(() => weightedTrimmedMean([1, 2, 3, 4, 5], [1, 1, 1, 1, 1], 0.5, 5)).toThrow(RangeError);
    expect(() => weightedTrimmedMean([1, 2, 3, 4, 5], [1, 1, 1, 1, 1], 0.7, 5)).toThrow(RangeError);
  });

  it('throws when values and weights differ in length', () => {
    expect(() => weightedTrimmedMean([1, 2, 3], [1, 1], 0.2, 5)).toThrow(RangeError);
    expect(() => weightedTrimmedMean([1, 2, 3, 4, 5], [1, 1, 1, 1], 0.2, 5)).toThrow(RangeError);
  });
});
