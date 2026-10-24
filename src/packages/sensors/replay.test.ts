import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sample, Trace } from '../domain';
import { createReplaySource } from './index';

function traceOf(count: number, rateHz = 60): Trace {
  const samples: Sample[] = Array.from({ length: count }, (_, i) => ({
    t: i / rateHz,
    ax: i,
    ay: 9.81,
    az: 0,
  }));
  return {
    routine: 'sit-drop',
    sampleRateHz: rateHz,
    device: 'test',
    startedAt: '2026-10-24T16:00:00.000Z',
    samples,
  };
}

afterEach(() => vi.useRealTimers());

describe('createReplaySource', () => {
  it('grants access without a prompt', async () => {
    expect(await createReplaySource(traceOf(3)).requestAccess()).toBe('granted');
  });

  it('emits every sample in order, synchronously, on start()', () => {
    const seen: number[] = [];
    createReplaySource(traceOf(5)).start((s) => seen.push(s.ax));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('reports no sample rate before 20 samples', () => {
    const source = createReplaySource(traceOf(19));
    source.start(() => {});
    expect(source.sampleRateHz).toBeNull();
  });

  it('measures about 60 Hz after 20 samples', () => {
    const source = createReplaySource(traceOf(20, 60));
    source.start(() => {});
    expect(source.sampleRateHz).toBeCloseTo(60, 0);
  });

  it('with realtime, paces samples by their t', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    createReplaySource(traceOf(4, 10), { realtime: true }).start((s) => seen.push(s.ax));
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([0, 1]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('a second start() replaces the callback and cancels the first run', () => {
    vi.useFakeTimers();
    const first: number[] = [];
    const second: number[] = [];
    const source = createReplaySource(traceOf(4, 10), { realtime: true });
    source.start((s) => first.push(s.ax));
    source.start((s) => second.push(s.ax));
    vi.advanceTimersByTime(1000);
    expect(first).toEqual([0]);
    expect(second).toEqual([0, 1, 2, 3]);
  });

  it('with realtime, stop() ends the replay', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const source = createReplaySource(traceOf(4, 10), { realtime: true });
    source.start((s) => seen.push(s.ax));
    source.stop();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([0]);
  });
});
