import { describe, expect, it } from 'vitest';
import type { Recording } from '../domain';
import { RecordingFormatError, parseRecording, serializeRecording } from './index';

const recording: Recording = {
  version: 1,
  label: 'cushion A, rep set 1',
  surface: 'Couch cushion',
  notes: 'shoes off',
  traces: [
    {
      routine: 'sit-drop',
      sampleRateHz: 60,
      device: 'iPhone 15',
      startedAt: '2026-10-24T16:00:00.000Z',
      samples: [
        { t: 0, ax: 0, ay: 9.81, az: 0 },
        { t: 1 / 60, ax: 0.1, ay: 9.7, az: 0.2 },
      ],
    },
  ],
};

const catchError = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('recording format', () => {
  it('round-trips through serialize and parse', () => {
    expect(parseRecording(JSON.parse(serializeRecording(recording)))).toEqual(recording);
  });

  it('names the field path when samples is missing', () => {
    const bad = JSON.parse(serializeRecording(recording));
    delete bad.traces[0].samples;
    const error = catchError(() => parseRecording(bad));
    expect(error).toBeInstanceOf(RecordingFormatError);
    expect((error as RecordingFormatError).message).toContain('traces[0].samples');
  });

  it('names the field path when a sample axis is not a number', () => {
    const bad = JSON.parse(serializeRecording(recording));
    bad.traces[0].samples[1].ax = 'high';
    expect((catchError(() => parseRecording(bad)) as Error).message).toContain(
      'traces[0].samples[1].ax',
    );
  });

  it('rejects an unknown routine', () => {
    const bad = JSON.parse(serializeRecording(recording));
    bad.traces[0].routine = 'back-flop';
    expect((catchError(() => parseRecording(bad)) as Error).message).toContain(
      'traces[0].routine',
    );
  });

  it('rejects an unsupported version', () => {
    const bad = { ...JSON.parse(serializeRecording(recording)), version: 2 };
    expect((catchError(() => parseRecording(bad)) as Error).message).toContain('version');
  });

  it('rejects a non-positive sample rate', () => {
    const bad = JSON.parse(serializeRecording(recording));
    bad.traces[0].sampleRateHz = 0;
    expect((catchError(() => parseRecording(bad)) as Error).message).toContain(
      'traces[0].sampleRateHz',
    );
  });

  it('rejects sample times that do not increase', () => {
    const bad = JSON.parse(serializeRecording(recording));
    bad.traces[0].samples[1].t = 0;
    expect((catchError(() => parseRecording(bad)) as Error).message).toContain(
      'traces[0].samples[1].t',
    );
  });

  it('rejects a value that is not an object', () => {
    expect(catchError(() => parseRecording(null))).toBeInstanceOf(RecordingFormatError);
  });
});

describe('parseRecording rig-drop', () => {
  const rig = { massKg: 2.1, baseCm: [17.5, 9], dropHeightCm: 5, spot: 'center' } as const;
  const rigRecording = (r: unknown): unknown => ({
    ...recording,
    traces: [{ ...recording.traces[0], routine: 'rig-drop', rig: r }],
  });

  it('round-trips a rig-drop trace with its rig', () => {
    const parsed = parseRecording(JSON.parse(serializeRecording(rigRecording(rig) as Recording)));
    expect(parsed.traces[0]!.routine).toBe('rig-drop');
    expect(parsed.traces[0]!.rig).toEqual(rig);
  });

  it('rejects a malformed rig', () => {
    const err = catchError(() => parseRecording(rigRecording({ ...rig, massKg: 'heavy' })));
    expect(err).toBeInstanceOf(RecordingFormatError);
    expect((err as RecordingFormatError).path).toBe('traces[0].rig.massKg');
  });
});
