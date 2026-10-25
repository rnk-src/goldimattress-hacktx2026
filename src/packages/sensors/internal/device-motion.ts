import type { Sample } from '../../domain';
import type { Access, SensorSource } from './source';

export interface MotionEnv {
  target: EventTarget;
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

type MotionEventConstructor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** The browser's own motion API, or null where DeviceMotionEvent does not exist. */
function detectBrowserEnv(): MotionEnv | null {
  const ctor = (window as { DeviceMotionEvent?: MotionEventConstructor }).DeviceMotionEvent;
  if (!ctor) return null;
  const { requestPermission } = ctor;
  return {
    target: window,
    ...(requestPermission ? { requestPermission: () => requestPermission.call(ctor) } : {}),
  };
}

export function createDeviceMotionSource(injected?: MotionEnv): SensorSource {
  const env = injected ?? detectBrowserEnv();
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
      if (!env) access = 'unsupported';
      else access = env.requestPermission ? await env.requestPermission() : 'granted';
      return access;
    },
    start(callback) {
      if (access !== 'granted' || !env) throw new Error('Motion access has not been granted');
      onSample = callback;
      emitted = 0;
      firstT = 0;
      lastT = 0;
      intervalMs = null;
      env.target.addEventListener('devicemotion', onMotion);
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
