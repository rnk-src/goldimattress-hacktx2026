import { describe, expect, it } from 'vitest';
import type { Sample } from '../domain';
import { createDeviceMotionSource } from './index';

function motionEvent(timeStamp: number, x: number | null, y: number | null, z: number | null) {
  const event = new Event('devicemotion');
  Object.defineProperties(event, {
    timeStamp: { value: timeStamp },
    accelerationIncludingGravity: { value: { x, y, z } },
  });
  return event;
}

describe('createDeviceMotionSource', () => {
  it('throws when capture starts before motion access is granted', () => {
    const source = createDeviceMotionSource({ target: new EventTarget() });

    expect(() => source.start(() => undefined)).toThrow('Motion access has not been granted');
  });

  it('returns denied when iOS denies motion permission', async () => {
    const source = createDeviceMotionSource({
      target: new EventTarget(),
      requestPermission: () => Promise.resolve('denied'),
    });

    await expect(source.requestAccess()).resolves.toBe('denied');
  });

  it('grants motion access when the Android permission method is absent', async () => {
    const source = createDeviceMotionSource({ target: new EventTarget() });

    await expect(source.requestAccess()).resolves.toBe('granted');
  });

  it('emits a seconds-based sample after iOS grants motion access', async () => {
    const target = new EventTarget();
    const source = createDeviceMotionSource({
      target,
      requestPermission: () => Promise.resolve('granted'),
    });
    const samples: Sample[] = [];

    await source.requestAccess();
    source.start((sample) => samples.push(sample));
    target.dispatchEvent(motionEvent(1250, 1, 2, 3));

    expect(samples).toEqual([{ t: 1.25, ax: 1, ay: 2, az: 3 }]);
  });

  it('drops motion events whose acceleration has a null axis', async () => {
    const target = new EventTarget();
    const source = createDeviceMotionSource({ target });
    const samples: Sample[] = [];

    await source.requestAccess();
    source.start((sample) => samples.push(sample));
    target.dispatchEvent(motionEvent(1250, null, 2, 3));

    expect(samples).toEqual([]);
  });

  it('removes the motion listener when stopped', async () => {
    const target = new EventTarget();
    const source = createDeviceMotionSource({ target });
    const samples: Sample[] = [];

    await source.requestAccess();
    source.start((sample) => samples.push(sample));
    source.stop();
    target.dispatchEvent(motionEvent(1250, 1, 2, 3));

    expect(samples).toEqual([]);
  });

  it('reports the measured sample rate after twenty valid events', async () => {
    const target = new EventTarget();
    const source = createDeviceMotionSource({ target });

    await source.requestAccess();
    source.start(() => undefined);
    for (let index = 0; index < 19; index += 1) {
      target.dispatchEvent(motionEvent(index * 20, 1, 2, 3));
    }
    expect(source.sampleRateHz).toBeNull();

    target.dispatchEvent(motionEvent(380, 1, 2, 3));
    expect(source.sampleRateHz).toBeCloseTo(50);
  });
});
