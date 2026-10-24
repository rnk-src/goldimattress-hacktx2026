import type { Sample } from '../../domain';
import type { Access, SensorSource } from './source';

export interface MotionEnv {
  target: EventTarget;
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function createDeviceMotionSource(env?: MotionEnv): SensorSource {
  let access: Access | null = null;
  let onSample: ((sample: Sample) => void) | null = null;
  let emitted = 0;
  let firstT = 0;
  let lastT = 0;
  let intervalMs: number | null = null;
  const onMotion = (event: Event) => {
    const motion = event as Event & {
      interval?: number;
      accelerationIncludingGravity: {
        x: number | null;
        y: number | null;
        z: number | null;
      } | null;
    };
    const acceleration = motion.accelerationIncludingGravity;
    if (
      acceleration === null ||
      acceleration.x === null ||
      acceleration.y === null ||
      acceleration.z === null
    ) {
      return;
    }
    const t = motion.timeStamp / 1000;
    if (emitted === 0) firstT = t;
    lastT = t;
    emitted += 1;
    if (typeof motion.interval === 'number') intervalMs = motion.interval;
    onSample?.({
      t,
      ax: acceleration.x,
      ay: acceleration.y,
      az: acceleration.z,
    });
  };

  return {
    async requestAccess() {
      access = env?.requestPermission ? await env.requestPermission() : env ? 'granted' : 'unsupported';
      return access;
    },
    start(callback) {
      if (access !== 'granted') throw new Error('Motion access has not been granted');
      onSample = callback;
      emitted = 0;
      firstT = 0;
      lastT = 0;
      intervalMs = null;
      env!.target.addEventListener('devicemotion', onMotion);
    },
    stop() {
      env?.target.removeEventListener('devicemotion', onMotion);
      onSample = null;
    },
    get eventIntervalMs() {
      return intervalMs;
    },
    get sampleRateHz() {
      if (emitted < 20 || lastT <= firstT) return null;
      return (emitted - 1) / (lastT - firstT);
    },
  };
}
