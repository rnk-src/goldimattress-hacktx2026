import type { Sample } from '../../domain';

export type Access = 'granted' | 'denied' | 'unsupported';

export interface SensorSource {
  /** iOS: call from a user tap over HTTPS. Android: resolves 'granted' without a prompt. */
  requestAccess(): Promise<Access>;
  /** Throws if access is not granted. A second call replaces the callback. */
  start(onSample: (s: Sample) => void): void;
  stop(): void;
  /** Measured from sample times once at least 20 samples arrived; null before that. */
  readonly sampleRateHz: number | null;
  /** The device's own `event.interval` in ms, when the source reports one. */
  readonly eventIntervalMs?: number | null;
}
