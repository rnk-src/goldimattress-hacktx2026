import { describe, expect, it } from 'vitest';
import { findPeaks, integrate, magnitude, std } from './math';

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
