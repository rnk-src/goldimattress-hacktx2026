import type { Recording, Routine, Sample, Trace } from '../../domain';

/** Thrown by `parseRecording`. `path` names the bad field, e.g. `traces[0].samples`. */
export class RecordingFormatError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Bad recording at ${path}: ${reason}`);
    this.name = 'RecordingFormatError';
  }
}

const routines: readonly Routine[] = ['sit-drop', 'bridge-drop'];

type Obj = Record<string, unknown>;

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecordingFormatError(path, 'expected an object');
  }
  return value as Obj;
}

function field(obj: Obj, key: string, path: string): unknown {
  const value = obj[key];
  if (value === undefined) throw new RecordingFormatError(`${path}.${key}`, 'missing field');
  return value;
}

function string(obj: Obj, key: string, path: string): string {
  const value = field(obj, key, path);
  if (typeof value !== 'string') throw new RecordingFormatError(`${path}.${key}`, 'expected a string');
  return value;
}

function number(obj: Obj, key: string, path: string): number {
  const value = field(obj, key, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RecordingFormatError(`${path}.${key}`, 'expected a finite number');
  }
  return value;
}

function array(obj: Obj, key: string, path: string): unknown[] {
  const value = field(obj, key, path);
  if (!Array.isArray(value)) throw new RecordingFormatError(`${path}.${key}`, 'expected an array');
  return value;
}

function parseSample(value: unknown, path: string): Sample {
  const obj = object(value, path);
  return {
    t: number(obj, 't', path),
    ax: number(obj, 'ax', path),
    ay: number(obj, 'ay', path),
    az: number(obj, 'az', path),
  };
}

function parseTrace(value: unknown, path: string): Trace {
  const obj = object(value, path);
  const routine = string(obj, 'routine', path);
  if (!routines.includes(routine as Routine)) {
    throw new RecordingFormatError(`${path}.routine`, `unknown routine '${routine}'`);
  }
  const sampleRateHz = number(obj, 'sampleRateHz', path);
  if (sampleRateHz <= 0) throw new RecordingFormatError(`${path}.sampleRateHz`, 'must be positive');
  const samples = array(obj, 'samples', path).map((s, i) => parseSample(s, `${path}.samples[${i}]`));
  samples.forEach((s, i) => {
    if (i > 0 && s.t <= samples[i - 1]!.t) {
      throw new RecordingFormatError(`${path}.samples[${i}].t`, 'times must strictly increase');
    }
  });
  return {
    routine: routine as Routine,
    sampleRateHz,
    device: string(obj, 'device', path),
    startedAt: string(obj, 'startedAt', path),
    samples,
  };
}

/** Validates untrusted JSON. Throws `RecordingFormatError` naming the first bad field path. */
export function parseRecording(json: unknown): Recording {
  const obj = object(json, '$');
  if (field(obj, 'version', '$') !== 1) {
    throw new RecordingFormatError('$.version', 'unsupported version, expected 1');
  }
  const recording: Recording = {
    version: 1,
    label: string(obj, 'label', '$'),
    surface: string(obj, 'surface', '$'),
    traces: array(obj, 'traces', '$').map((t, i) => parseTrace(t, `traces[${i}]`)),
  };
  if (obj.notes !== undefined) recording.notes = string(obj, 'notes', '$');
  return recording;
}

export function serializeRecording(rec: Recording): string {
  return JSON.stringify(rec);
}
