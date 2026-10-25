import type { Routine, Sample, Trace } from '../../domain';
import { GRAVITY, assertSurfaceStaysInContact, excessAcceleration } from './response';
import { createRng } from './rng';

export { GRAVITY };

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

/** Frequency of the hover wobble for the 'moving-hover' failure, Hz. */
const WOBBLE_HZ = 3;

/** Delay from impact to the start of the 'left-surface' flight, s. */
const FLIGHT_AFTER_S = 0.4;

export type SynthFailure =
  | 'none'
  | 'tilt'
  | 'moving-hover'
  | 'caught-landing'
  | 'left-surface'
  | 'no-drop'
  | 'tilted-landing'
  | 'hand-drag'
  | 'height-error';

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
  /** 'rig-drop' only: nominal release height, cm. Default 10. Sets the free fall and v = √(2gh). */
  dropHeightCm?: number;
  /** Degrees from the gravity axis. Default 15 (0 for 'rig-drop', where the phone is flat). */
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
  /**
   * Strength of `failure`. 'tilt': extra degrees of lean, default 10 (negative leans less).
   * 'caught-landing': frequency of the smeared hump, Hz, default 0.4 (stops after 1/(π·f) s).
   * 'left-surface': length of the 0 g flight 0.4 s after impact, s, default 0.2.
   * 'moving-hover': amplitude of a 3 Hz wobble of |a| during the hover, m/s², default 1.
   * 'tilted-landing' (rig): degrees the phone tilts at impact, default 10.
   * 'hand-drag' (rig): |a| during the fall as a fraction of g, default 0.3.
   * 'height-error' (rig): actual release height divided by the nominal one, default 1.5.
   */
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

/** Release height of a rig drop when no `dropHeightCm` is given, cm. */
const RIG_HEIGHT_CM = 10;

/**
 * Fall time and impact speed of the descent. A body drop uses `dropS` and `impactSpeed`.
 * A rig drop falls from `dropHeightCm` (scaled by 'height-error', slowed by 'hand-drag').
 */
export function descentOf(opts: SynthOptions): { dropS: number; impactSpeed: number } {
  if ((opts.routine ?? DEFAULTS.routine) !== 'rig-drop') {
    return { dropS: opts.dropS ?? DEFAULTS.dropS, impactSpeed: opts.impactSpeed ?? DEFAULTS.impactSpeed };
  }
  const failure = opts.failure ?? 'none';
  const scale = failure === 'height-error' ? (opts.failureSize ?? 1.5) : 1;
  const metres = ((opts.dropHeightCm ?? RIG_HEIGHT_CM) * scale) / 100;
  // shortcut: a rig fall is one constant |a| (0 g, or the hand-drag value). Real hands add release noise.
  // |a| = m·g during the fall, so the net acceleration is g(1 − m).
  const drag = failure === 'hand-drag' ? (opts.failureSize ?? 0.3) : 0;
  if (!(drag >= 0 && drag < 1)) throw new RangeError('hand-drag failureSize must be in [0, 1)');
  const net = GRAVITY * (1 - drag);
  const dropS = Math.sqrt((2 * metres) / net);
  return { dropS, impactSpeed: net * dropS };
}

/** One rep: a still hover, then a drop onto a damped spring. Same options and seed give the same trace. */
export function synthRep(opts: SynthOptions = {}): Trace {
  const routine = opts.routine ?? DEFAULTS.routine;
  const sampleRateHz = opts.sampleRateHz ?? DEFAULTS.sampleRateHz;
  const durationS = opts.durationS ?? DEFAULTS.durationS;
  const noise = opts.noise ?? DEFAULTS.noise;
  const rotation = opts.rotation ?? [0, 0, 0];
  const failure = opts.failure ?? 'none';
  const isRig = routine === 'rig-drop';
  const tilt = failure === 'tilt' ? (opts.failureSize ?? 10) : 0;
  const landingTilt = failure === 'tilted-landing' ? (opts.failureSize ?? 10) : 0;
  const wobble = failure === 'moving-hover' ? (opts.failureSize ?? 1) : 0;
  const leanDeg = (opts.leanDeg ?? (isRig ? 0 : DEFAULTS.leanDeg)) + tilt;
  const up = upAxis(routine, leanDeg);
  const landingUp = upAxis(routine, leanDeg + landingTilt);
  const { dropS, impactSpeed } = descentOf(opts);
  const bounceHz = opts.bounceHz ?? DEFAULTS.bounceHz;
  const bounceRatio = opts.bounceRatio ?? DEFAULTS.bounceRatio;
  const hoverS = opts.hoverS ?? DEFAULTS.hoverS;
  for (const [name, value] of [
    ['dropS', dropS],
    ['hoverS', hoverS],
    ['durationS', durationS],
    ['sampleRateHz', sampleRateHz],
  ] as const) {
    if (!(value > 0)) throw new RangeError(`${name} must be positive`);
  }
  if (impactSpeed > GRAVITY * dropS * (1 + 1e-9)) {
    throw new RangeError('impactSpeed cannot exceed free fall over dropS');
  }
  if (bounceRatio < 0 || bounceRatio >= 1) throw new RangeError('bounceRatio must be in [0, 1)');
  // Tensed legs smear the hit into one slow hump: critically damped at a low frequency.
  const caught = failure === 'caught-landing';
  const surfaceHz = caught ? (opts.failureSize ?? 0.4) : bounceHz;
  const surfaceRatio = caught ? 0 : bounceRatio;
  assertSurfaceStaysInContact(impactSpeed, surfaceHz, surfaceRatio);
  const impactT = hoverS + dropS;
  /** |a| in m/s² at signal time t. A surface can push but not pull, so it never goes below 0. */
  const total = (t: number) => {
    if (failure === 'no-drop') return GRAVITY;
    if (t < hoverS) return GRAVITY + wobble * Math.sin(2 * Math.PI * WOBBLE_HZ * t);
    if (t < impactT) return GRAVITY - impactSpeed / dropS;
    const flightStart = impactT + FLIGHT_AFTER_S;
    if (failure === 'left-surface' && t >= flightStart && t < flightStart + (opts.failureSize ?? 0.2)) return 0;
    return Math.max(0, GRAVITY + excessAcceleration(t - impactT, impactSpeed, surfaceHz, surfaceRatio));
  };
  const rng = createRng(opts.seed ?? DEFAULTS.seed);

  const count = Math.round(durationS * sampleRateHz);
  const samples: Sample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / sampleRateHz;
    const axis = t >= impactT ? landingUp : up;
    const [x, y, z] = rotate(axis.map((u) => u * total(t)) as Vec, rotation);
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
