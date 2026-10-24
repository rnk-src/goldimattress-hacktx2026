import { describe, expect, it } from 'vitest';
import type { Sample } from '../domain';
import { synthRep, synthStream } from './index';

const G = 9.81;
const mag = (s: Sample) => Math.hypot(s.ax, s.ay, s.az);

describe('synthStream', () => {
  const reps = [{ seed: 1 }, { seed: 2, leanDeg: 20 }, { seed: 3 }];

  it('joins the reps with a rest between each, on one continuous clock', () => {
    const stream = synthStream(reps, 2);
    expect(stream).toHaveLength(3 * 210 + 2 * 120);
    stream.forEach((s, i) => expect(s.t).toBeCloseTo(i / 60, 9));
  });

  it('has one drop per rep and stays at 1 g through each rest', () => {
    const stream = synthStream(reps, 2);
    // A drop starts when |a| steps from about 1 g to well below it.
    const drops = stream.filter((s, i) => i > 0 && mag(s) < G - 1.5 && Math.abs(mag(stream[i - 1]!) - G) < 0.5);
    expect(drops).toHaveLength(3);
    const rest = stream.slice(210 + 30, 210 + 120 - 30);
    for (const s of rest) expect(Math.abs(mag(s) - G)).toBeLessThan(0.5);
  });

  it('starts with the first rep unchanged', () => {
    expect(synthStream(reps, 2).slice(0, 210)).toEqual(synthRep(reps[0]).samples);
  });

  it('is empty for no reps and rests 20 s by default', () => {
    expect(synthStream([])).toEqual([]);
    expect(synthStream([{}, {}])).toHaveLength(2 * 210 + 20 * 60);
  });
});
