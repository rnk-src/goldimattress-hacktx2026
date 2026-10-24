import type { Routine, Sample, Trace } from '../../domain';
import { excessAcceleration } from './response';
import { createRng } from './rng';

export const GRAVITY = 9.81;

/** What each `SynthOptions` field means when left out. */
export const DEFAULTS = {
  routine: 'sit-drop',
  sampleRateHz: 60,
  impactSpeed: 0.6,
  bounceHz: 2,
  bounceRatio: 0.4,
  leanDeg: 15,
  hoverS: 1,
  dropS: 0.3,
  durationS: 3.5,
  noise: 0.05,
  seed: 1,
} as const;

export type SynthFailure =
  | 'none'
  | 'tilt'
  | 'moving-hover'
  | 'caught-landing'
  | 'left-surface'
  | 'no-drop';

export interface SynthOptions {
  routine?: Routine;
  /** Hz. Default 60. */
  sampleRateHz?: number;
  /** m/s. Default 0.6. */
  impactSpeed?: number;
  /** Damped bounce frequency, Hz. Default 2. */
  bounceHz?: number;
  /** A₂/A₁ of consecutive bounce peaks. Default 0.4. */
  bounceRatio?: number;
  /** Degrees from the gravity axis. Default 15. */
  leanDeg?: number;
  /** Still hover before the drop, s. Default 1.0. */
  hoverS?: number;
  /** Partial-g descent before impact, s. Default 0.3. */
  dropS?: number;
  /** Trace length, s. Default 3.5. */
  durationS?: number;
  /** Per-axis Gaussian noise σ, m/s². Default 0.05. */
  noise?: number;
  /** Phone orientation, degrees about x, y, z. Leaves |a| unchanged. */
  rotation?: [number, number, number];
  failure?: SynthFailure;
  failureSize?: number;
  seed?: number;
}

type Vec = [number, number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;

function rotate([x, y, z]: Vec, [rx, ry, rz]: Vec): Vec {
  const [cx, sx] = [Math.cos(rad(rx)), Math.sin(rad(rx))];
  const [cy, sy] = [Math.cos(rad(ry)), Math.sin(rad(ry))];
  const [cz, sz] = [Math.cos(rad(rz)), Math.sin(rad(rz))];
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
}

/** Direction of the specific force in the phone frame. Sit-drop rides on the chest (y up); bridge drop lies flat (z up). */
function upAxis(routine: Routine, leanDeg: number): Vec {
  const [s, c] = [Math.sin(rad(leanDeg)), Math.cos(rad(leanDeg))];
  return routine === 'sit-drop' ? [0, c, s] : [0, s, c];
}

/** One rep: a still hover, then a drop onto a damped spring. Same options and seed give the same trace. */
export function synthRep(opts: SynthOptions = {}): Trace {
  const routine = opts.routine ?? DEFAULTS.routine;
  const sampleRateHz = opts.sampleRateHz ?? DEFAULTS.sampleRateHz;
  const durationS = opts.durationS ?? DEFAULTS.durationS;
  const noise = opts.noise ?? DEFAULTS.noise;
  const rotation = opts.rotation ?? [0, 0, 0];
  const up = upAxis(routine, opts.leanDeg ?? DEFAULTS.leanDeg);
  const impactSpeed = opts.impactSpeed ?? DEFAULTS.impactSpeed;
  const bounceHz = opts.bounceHz ?? DEFAULTS.bounceHz;
  const bounceRatio = opts.bounceRatio ?? DEFAULTS.bounceRatio;
  const hoverS = opts.hoverS ?? DEFAULTS.hoverS;
  const dropS = opts.dropS ?? DEFAULTS.dropS;
  if (impactSpeed > GRAVITY * dropS) {
    throw new RangeError('impactSpeed cannot exceed free fall over dropS');
  }
  if (bounceRatio < 0 || bounceRatio >= 1) throw new RangeError('bounceRatio must be in [0, 1)');
  if (opts.failure !== undefined && opts.failure !== 'none') {
    throw new Error(`failure '${opts.failure}' is not implemented yet`);
  }
  const impactT = hoverS + dropS;
  /** |a| in m/s² at signal time t. A surface can push but not pull, so it never goes below 0. */
  const total = (t: number) => {
    if (t < hoverS) return GRAVITY;
    if (t < impactT) return GRAVITY - impactSpeed / dropS;
    return Math.max(0, GRAVITY + excessAcceleration(t - impactT, impactSpeed, bounceHz, bounceRatio));
  };
  const rng = createRng(opts.seed ?? DEFAULTS.seed);

  const count = Math.round(durationS * sampleRateHz);
  const samples: Sample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / sampleRateHz;
    const [x, y, z] = rotate(up.map((u) => u * total(t)) as Vec, rotation);
    samples.push({
      t,
      ax: x + noise * rng.gaussian(),
      ay: y + noise * rng.gaussian(),
      az: z + noise * rng.gaussian(),
    });
  }
  return {
    routine,
    sampleRateHz,
    device: 'synthetic',
    startedAt: '2026-01-01T00:00:00.000Z',
    samples,
  };
}
