import type { Sample, Trace } from '../../domain';
import type { SensorSource } from './source';

const MIN_SAMPLES_FOR_RATE = 20;

/**
 * Replays a recorded trace through the live `SensorSource` interface.
 * Synchronous by default (tests); `realtime` paces samples by their `t` (demo).
 */
export function createReplaySource(trace: Trace, opts: { realtime?: boolean } = {}): SensorSource {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let emitted = 0;
  let firstT = 0;
  let lastT = 0;

  const emit = (s: Sample, onSample: (s: Sample) => void) => {
    if (emitted === 0) firstT = s.t;
    lastT = s.t;
    emitted += 1;
    onSample(s);
  };

  return {
    requestAccess: () => Promise.resolve('granted'),
    start(onSample) {
      emitted = 0;
      const t0 = trace.samples[0]?.t ?? 0;
      for (const s of trace.samples) {
        const delayMs = (s.t - t0) * 1000;
        if (!opts.realtime || delayMs <= 0) emit(s, onSample);
        else timers.push(setTimeout(() => emit(s, onSample), delayMs));
      }
    },
    stop() {
      timers.forEach(clearTimeout);
      timers = [];
    },
    get sampleRateHz() {
      if (emitted < MIN_SAMPLES_FOR_RATE || lastT <= firstT) return null;
      return (emitted - 1) / (lastT - firstT);
    },
  };
}
