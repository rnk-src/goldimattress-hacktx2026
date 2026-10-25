/** Standard gravity, m/s². The one value signal uses; testkit keeps its own so the generator stays independent. */
export const GRAVITY = 9.81;

/**
 * Two thresholds for "near 0 g", m/s². The body's second flight after the impact must be unmistakable, so it
 * reads below 2 (FLIGHT_ACCEL): a body in contact never drops that low. The rig's first fall reads below half
 * of 1 g (FALL_ACCEL), so a hand that drags the slab is still found and then scored as a flight mismatch.
 */
export const FLIGHT_ACCEL = 2;
export const FALL_ACCEL = GRAVITY / 2;
