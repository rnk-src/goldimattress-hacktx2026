import type { Sample, Trace } from '../../domain';
import { createRateMeter } from './rate-meter';
import type { SensorSource } from './source';

/**
 * Replays a recorded trace through the live `SensorSource` interface.
 * Synchronous by default (tests); `realtime` paces samples by their `t` (demo).
 */
export function createReplaySource(trace: Trace, opts: { realtime?: boolean } = {}): SensorSource {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const meter = createRateMeter();

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const emit = (s: Sample, onSample: (s: Sample) => void) => {
    meter.add(s.t);
    onSample(s);
  };

  return {
    requestAccess: () => Promise.resolve('granted'),
    start(onSample) {
      stop();
      meter.reset();
      const t0 = trace.samples[0]?.t ?? 0;
      for (const s of trace.samples) {
        const delayMs = (s.t - t0) * 1000;
        if (!opts.realtime || delayMs <= 0) emit(s, onSample);
        else timers.push(setTimeout(() => emit(s, onSample), delayMs));
      }
    },
    stop,
    get sampleRateHz() {
      return meter.hz;
    },
  };
}
