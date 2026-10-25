import { describe, expect, it } from 'vitest';
import { RIG_SLOPPY, createSimRigUser, rigAttempt } from './index';
import type { RigSurface } from './index';

const surface: RigSurface = { bounceHz: 1.5, bounceRatio: 0.2, dropHeightCm: 10 };

const attempts = (seed: number, n: number, s = surface) => {
  const user = createSimRigUser(seed);
  return Array.from({ length: n }, () => rigAttempt(user, s));
};

describe('rigAttempt', () => {
  it('repeats exactly for the same seed', () => {
    expect(attempts(3, 6)).toEqual(attempts(3, 6));
  });

  it('gives different users different attempts', () => {
    expect(attempts(3, 3)).not.toEqual(attempts(4, 3));
  });

  it('stamps the rig setup with the nominal height on every trace', () => {
    for (const a of attempts(5, 5)) expect(a.trace.rig?.dropHeightCm).toBe(10);
  });

  it('never builds an invalid trace, even on a stiff surface at 10 cm', () => {
    const stiff: RigSurface = { bounceHz: 2.5, bounceRatio: 0.1, dropHeightCm: 10 };
    for (let seed = 0; seed < 40; seed++) {
      for (const a of attempts(seed, 12, stiff)) expect(a.trace.samples.length).toBeGreaterThan(100);
    }
  });

  it('uses every kind of attempt at about the profile rates', () => {
    const all = Array.from({ length: 60 }, (_, seed) => attempts(seed, 20)).flat();
    const share = (kind: string) => all.filter((a) => a.kind === kind).length / all.length;
    expect([...new Set(all.map((a) => a.kind))].sort()).toEqual(['good', 'hand-drag', 'tilted-landing']);
    expect(Math.abs(share('tilted-landing') - RIG_SLOPPY.landingTiltRate)).toBeLessThan(0.04);
    expect(Math.abs(share('hand-drag') - RIG_SLOPPY.handDragRate)).toBeLessThan(0.04);
  });
});
