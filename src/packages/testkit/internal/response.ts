export const GRAVITY = 9.81;

/**
 * Constants of the underdamped response (bounceRatio > 0) shared by the generator and the
 * analytic answers. The excess is v·ω²/ω_d · e^(−σt) · sin(ω_d·t + φ), so:
 * - σ = −ln(bounceRatio)·bounceHz, because consecutive same-sign peaks are 1/bounceHz apart
 *   and each is e^(−σ/bounceHz) = bounceRatio times the one before;
 * - the k-th extremum is at t = (α + kπ − φ)/ω_d, with even k positive.
 */
export function underdamped(bounceHz: number, bounceRatio: number) {
  const omegaD = 2 * Math.PI * bounceHz;
  const sigma = -Math.log(bounceRatio) * bounceHz;
  const omegaSq = omegaD ** 2 + sigma ** 2;
  const phase = Math.atan2(2 * sigma * omegaD, omegaSq - 2 * sigma ** 2);
  const alpha = Math.atan2(omegaD, sigma);
  return {
    omegaD,
    sigma,
    omegaSq,
    phase,
    extremum: (k: number) => (alpha + k * Math.PI - phase) / omegaD,
  };
}

/**
 * Acceleration above 1 g after a mass hits a damped spring at speed v (m/s), t seconds after impact.
 * The mass-spring-damper x'' + 2σx' + ω²x = 0 starts at x = 0 with x' = v, and the excess is ω²x + 2σx'.
 * A bounceRatio of 0 is critically damped (ω = 2π·bounceHz): one peak and no bounce.
 */
export function excessAcceleration(
  t: number,
  v: number,
  bounceHz: number,
  bounceRatio: number,
): number {
  if (t < 0) return 0;
  if (bounceRatio === 0) {
    const omega = 2 * Math.PI * bounceHz;
    return v * Math.exp(-omega * t) * (2 * omega - omega ** 2 * t);
  }
  const { omegaD, sigma, omegaSq, phase } = underdamped(bounceHz, bounceRatio);
  return ((v * omegaSq) / omegaD) * Math.exp(-sigma * t) * Math.sin(omegaD * t + phase);
}

/** Largest impact speed (m/s) for which the first negative lobe stays at or above 0 g. */
export function maxContactSpeed(bounceHz: number, bounceRatio: number): number {
  const troughTime =
    bounceRatio === 0 ? 3 / (2 * Math.PI * bounceHz) : underdamped(bounceHz, bounceRatio).extremum(1);
  return GRAVITY / -excessAcceleration(troughTime, 1, bounceHz, bounceRatio);
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
