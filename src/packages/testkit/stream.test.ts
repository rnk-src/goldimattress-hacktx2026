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

  it('keeps a tilted rep pose through its rest, so the gravity direction does not jump', () => {
    const stream = synthStream([{ failure: 'tilt', failureSize: 10, leanDeg: 15, noise: 0 }, {}], 2);
    const lean = (s: Sample) => (Math.acos(s.ay / mag(s)) * 180) / Math.PI;
    expect(lean(stream[209]!)).toBeCloseTo(25, 4);
    expect(lean(stream[210]!)).toBeCloseTo(25, 4);
  });

  it('keeps a rig rep flat through its rest, so the slab does not seem to tilt', () => {
    const rig = { routine: 'rig-drop' as const, dropHeightCm: 5 };
    const stream = synthStream([{ ...rig, noise: 0 }, rig], 2);
    const n = synthRep(rig).samples.length;
    const angleFromZ = (s: Sample) => (Math.acos(s.az / mag(s)) * 180) / Math.PI;
    expect(angleFromZ(stream[n - 1]!)).toBeCloseTo(0, 4);
    expect(angleFromZ(stream[n + 2]!)).toBeCloseTo(0, 4);
  });
});
