import type { Sample } from '../../domain';
import { DEFAULTS, synthRep, type SynthOptions } from './synth';

/**
 * One continuous sample stream for session and app tests: each rep, then `restS` seconds
 * (default 20) of the person lying or sitting still at 1 g in that rep's pose, then the next rep.
 * Times run on one clock at the first rep's rate.
 * shortcut: all reps must share one sampleRateHz, since the stream has a single clock.
 */
export function synthStream(reps: readonly SynthOptions[], restS = 20): Sample[] {
  const stream: Sample[] = [];
  reps.forEach((rep, i) => {
    const pieces = [synthRep(rep).samples];
    if (i < reps.length - 1) {
      const seed = (rep.seed ?? DEFAULTS.seed) + 1000;
      // 'tilt' is a lean change, so bake it into leanDeg to keep the pose through the rest.
      const tilt = rep.failure === 'tilt' ? (rep.failureSize ?? 10) : 0;
      const leanDeg = (rep.leanDeg ?? DEFAULTS.leanDeg) + tilt;
      pieces.push(synthRep({ ...rep, leanDeg, failure: 'no-drop', durationS: restS, seed }).samples);
    }
    for (const piece of pieces) {
      const rate = rep.sampleRateHz ?? DEFAULTS.sampleRateHz;
      for (const s of piece) stream.push({ ...s, t: stream.length / rate });
    }
  });
  return stream;
}
