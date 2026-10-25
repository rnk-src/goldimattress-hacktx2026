import { describe, expect, it } from 'vitest';
import { SLOPPY, createSimPerson, humanAttempt } from './index';
import type { HumanSurface } from './index';

const chair: HumanSurface = { bounceHz: 2, bounceRatio: 0.4, impactSpeed: 0.9, leanDeg: 10 };

const attempts = (seed: number, n: number, surface = chair) => {
  const person = createSimPerson(seed);
  return Array.from({ length: n }, () => humanAttempt(person, surface));
};

describe('humanAttempt', () => {
  it('repeats exactly for the same seed', () => {
    expect(attempts(3, 6)).toEqual(attempts(3, 6));
  });

  it('gives different people different attempts', () => {
    expect(attempts(3, 3)).not.toEqual(attempts(4, 3));
  });

  it('never builds an invalid trace over many attempts and people', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const a of attempts(seed, 12)) expect(a.trace.samples.length).toBeGreaterThan(100);
    }
  });

  it('makes about the profile share of attempts bad', () => {
    const all = Array.from({ length: 60 }, (_, seed) => attempts(seed, 20)).flat();
    const bad = all.filter((a) => a.kind !== 'good').length / all.length;
    expect(bad).toBeGreaterThan(SLOPPY.badRate - 0.05);
    expect(bad).toBeLessThan(SLOPPY.badRate + 0.05);
  });

  it('uses every kind of bad attempt', () => {
    const kinds = new Set(Array.from({ length: 60 }, (_, seed) => attempts(seed, 20)).flat().map((a) => a.kind));
    expect([...kinds].sort()).toEqual(['caught', 'fast', 'good', 'left', 'no-drop', 'slow', 'sway', 'tilt']);
  });

  it('keeps a person sway between attempts of the same person', () => {
    const person = createSimPerson(11);
    expect(person.sway).toBeGreaterThanOrEqual(SLOPPY.swayJitter[0]);
    expect(person.sway).toBeLessThanOrEqual(SLOPPY.swayJitter[1]);
  });
});
