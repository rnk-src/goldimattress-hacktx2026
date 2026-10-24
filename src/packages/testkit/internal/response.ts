export const GRAVITY = 9.81;

/**
 * Acceleration above 1 g after a mass hits a damped spring at speed v (m/s), t seconds after impact.
 * The mass-spring-damper x'' + 2σx' + ω²x = 0 starts at x = 0 with x' = v, and the excess is ω²x + 2σx'.
 * It is v·ω²/ω_d · e^(−σt) · sin(ω_d·t + φ). Consecutive peaks of the same sign are one damped
 * period 1/bounceHz apart, and each is e^(−σ/bounceHz) = bounceRatio times the one before.
 * A bounceRatio of 0 is critically damped: one peak and no bounce.
 */
export function excessAcceleration(
  t: number,
  v: number,
  bounceHz: number,
  bounceRatio: number,
): number {
  if (t < 0) return 0;
  const omegaD = 2 * Math.PI * bounceHz;
  if (bounceRatio === 0) {
    return v * Math.exp(-omegaD * t) * (2 * omegaD - omegaD ** 2 * t);
  }
  const sigma = -Math.log(bounceRatio) * bounceHz;
  const omegaSq = omegaD ** 2 + sigma ** 2;
  const phase = Math.atan2(2 * sigma * omegaD, omegaSq - 2 * sigma ** 2);
  return ((v * omegaSq) / omegaD) * Math.exp(-sigma * t) * Math.sin(omegaD * t + phase);
}

/** Largest impact speed (m/s) for which the first negative lobe stays at or above 0 g. */
export function maxContactSpeed(bounceHz: number, bounceRatio: number): number {
  const omegaD = 2 * Math.PI * bounceHz;
  let troughPerSpeed: number;
  if (bounceRatio === 0) {
    troughPerSpeed = excessAcceleration(3 / omegaD, 1, bounceHz, 0);
  } else {
    const sigma = -Math.log(bounceRatio) * bounceHz;
    const omegaSq = omegaD ** 2 + sigma ** 2;
    const phase = Math.atan2(2 * sigma * omegaD, omegaSq - 2 * sigma ** 2);
    const alpha = Math.atan2(omegaD, sigma);
    troughPerSpeed = excessAcceleration((alpha + Math.PI - phase) / omegaD, 1, bounceHz, bounceRatio);
  }
  return GRAVITY / -troughPerSpeed;
}

/**
 * A surface can push but not pull, so |a| cannot go below 0. Throws RangeError when the first
 * negative lobe would, since the trace and its analytic answers would then differ.
 */
export function assertSurfaceStaysInContact(v: number, bounceHz: number, bounceRatio: number): void {
  if (v > maxContactSpeed(bounceHz, bounceRatio)) {
    throw new RangeError('impactSpeed, bounceHz and bounceRatio make the surface pull below 0 g');
  }
}
