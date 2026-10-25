import type { RejectReason, Sample, Trace } from '../../domain';
import { GRAVITY } from './constants';
import { firstPeakAfter, hoverFromOf, riseStart } from './drop-model';
import type { DropModel, Segments } from './drop-model';
import { DEFAULT_RIG } from './rig';
import { combine, factor, jitterScore, ramp } from './score';

/** A free fall must read below this |a|, m/s². Half of 1 g, so a hand that drags the slab still counts and shows as a flight mismatch. */
const FALL_ACCEL = GRAVITY / 2;
/** Fewest samples in a free fall. A 5 cm fall is about 6 samples at 57 Hz. */
const MIN_FALL_SAMPLES = 3;
/** The fall time may differ from sqrt(2h/g) by this share before the weight drops: timing is good to about 17% at 5 cm. */
const FLIGHT_TOL = 0.25;
/** Fall-time error beyond FLIGHT_TOL at which the weight reaches 0. */
const FLIGHT_FALL = 0.25;
/** The landing may tilt this far from the hover orientation, degrees, before the weight drops. */
const TILT_FREE_DEG = 5;
/** Tilt beyond TILT_FREE_DEG at which the weight reaches 0, degrees. */
const TILT_FALL_DEG = 10;
/** The rest orientation is the mean of the last REST_WINDOW_S of the trace, s. */
const REST_WINDOW_S = 0.3;

/**
 * The first run of at least MIN_FALL_SAMPLES samples below FALL_ACCEL that a rise above the impact threshold
 * follows. `flightS` is the run's length. The first still-to-fall change is the release, so no dip length is needed.
 * shortcut: FALL_ACCEL is half of g, not FLIGHT_ACCEL, so a dragged fall is found and scored; re-check on real rig data.
 */
function freeFallDrop(trace: Trace, mags: readonly number[], hoverMinS: number): { seg: Segments; flightS: number } | RejectReason {
  const { samples } = trace;
  for (let start = 0; start < mags.length; start++) {
    if (mags[start]! >= FALL_ACCEL) continue;
    let end = start;
    while (end + 1 < mags.length && mags[end + 1]! < FALL_ACCEL) end++;
    const count = end - start + 1;
    const peak = count >= MIN_FALL_SAMPLES ? firstPeakAfter(samples, mags, end) : -1;
    if (peak >= 0) {
      const flightS = ((samples[end]!.t - samples[start]!.t) * count) / (count - 1);
      const seg = { impact: riseStart(mags, end, peak), descentStart: start, hoverFrom: hoverFromOf(trace, start, hoverMinS) };
      return { seg, flightS };
    }
    start = end;
  }
  return 'no-drop-found';
}

/** Mean gravity direction of `samples`, as a unit vector, or null when empty or zero. */
function meanDirection(samples: readonly Sample[]): [number, number, number] | null {
  const sum = samples.reduce<[number, number, number]>((a, s) => [a[0] + s.ax, a[1] + s.ay, a[2] + s.az], [0, 0, 0]);
  const length = Math.hypot(...sum);
  return length > 0 ? [sum[0] / length, sum[1] / length, sum[2] / length] : null;
}

/** Degrees between the hover orientation and the rest orientation after the landing; 0 when either is unknown. */
function landingTiltDeg(trace: Trace, seg: Segments): number {
  const { samples } = trace;
  const restFrom = samples[samples.length - 1]!.t - REST_WINDOW_S;
  const hover = meanDirection(samples.slice(seg.hoverFrom, seg.descentStart));
  const rest = meanDirection(samples.filter((s) => s.t >= restFrom && s.t > samples[seg.impact]!.t));
  if (hover === null || rest === null) return 0;
  const cos = hover[0] * rest[0] + hover[1] * rest[1] + hover[2] * rest[2];
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Nominal release height in m, from the trace rig or the default rig. */
const rigHeightM = (trace: Trace) => (trace.rig ?? DEFAULT_RIG).dropHeightCm / 100;

export const freeFall: DropModel = {
  findDrop(trace, mags, ctx) {
    const found = freeFallDrop(trace, mags, ctx.hoverMinS);
    if (typeof found === 'string') return found;
    const { seg, flightS } = found;
    return {
      seg,
      flightS,
      impactSpeed: () => Math.sqrt(2 * GRAVITY * rigHeightM(trace)),
      quality({ jitter }, ref) {
        const expectedS = Math.sqrt((2 * rigHeightM(trace)) / GRAVITY);
        return combine(
          jitterScore(jitter, ref),
          factor(ramp(Math.abs(flightS / expectedS - 1) - FLIGHT_TOL, FLIGHT_FALL), 'flight-mismatch'),
          factor(ramp(landingTiltDeg(trace, seg) - TILT_FREE_DEG, TILT_FALL_DEG), 'tilted-landing'),
        );
      },
      // Raw peak is scored; the rig's speed is nominal and its stop time is the lobe width, so neither is.
    };
  },
  axes: { peak: 'hardness', bounceRatio: 'springiness' },
};
