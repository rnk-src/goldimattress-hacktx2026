import type { Trace } from '../../domain';
import { GRAVITY, maxContactSpeed } from './response';
import { createRng } from './rng';
import { synthRep } from './synth';

/** The surface a simulated rig user drops the slab onto. */
export interface RigSurface {
  bounceHz: number;
  bounceRatio: number;
  /** Nominal release height, cm. */
  dropHeightCm: number;
}

/** How a simulated rig user varies from drop to drop. */
export interface RigProfile {
  /** Relative sd of the actual release height about the nominal one. */
  heightSd: number;
  /** Sd of the slab tilt while held, degrees. */
  holdTiltSd: number;
  /** Share of drops where the slab lands tilted. */
  landingTiltRate: number;
  /** Share of drops where the hand drags the slab during the fall. */
  handDragRate: number;
  /** Relative sd of the response (frequency and bounce ratio) from landing on a slightly different spot. */
  spotSd: number;
}

// shortcut: every rate and sd is an estimate; replace with spread measured in the plate experiment.
export const RIG_SLOPPY: RigProfile = {
  heightSd: 0.06,
  holdTiltSd: 4,
  landingTiltRate: 0.1,
  handDragRate: 0.1,
  spotSd: 0.02,
};

export type RigAttemptKind = 'good' | 'tilted-landing' | 'hand-drag';

export interface SimRigUser {
  profile: RigProfile;
  rng: ReturnType<typeof createRng>;
  attempts: number;
}

export function createSimRigUser(seed: number, profile: RigProfile = RIG_SLOPPY): SimRigUser {
  return { profile, rng: createRng(seed ^ 0x9e3779b9), attempts: 0 };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One drop by this user on this surface. Advances the user's random stream. */
export function rigAttempt(user: SimRigUser, surface: RigSurface): { trace: Trace; kind: RigAttemptKind } {
  const { rng, profile } = user;
  const seed = (user.attempts++ + 1) * 7919 + Math.floor(rng.next() * 1e6);
  const roll = rng.next();
  const kind: RigAttemptKind =
    roll < profile.landingTiltRate
      ? 'tilted-landing'
      : roll < profile.landingTiltRate + profile.handDragRate
        ? 'hand-drag'
        : 'good';

  const bounceHz = clamp(surface.bounceHz * (1 + profile.spotSd * rng.gaussian()), 0.8, 4);
  const bounceRatio = clamp(surface.bounceRatio * (1 + profile.spotSd * rng.gaussian()), 0.03, 0.9);
  // The release height may not push the surface below 0 g, so cap it like a person who drops lower on a stiff surface.
  const safe = 0.99 * maxContactSpeed(bounceHz, bounceRatio);
  const maxScale = safe ** 2 / (2 * GRAVITY) / (surface.dropHeightCm / 100);
  const heightScale = clamp(1 + profile.heightSd * rng.gaussian(), 0.5, maxScale);
  const holdTilt = Math.abs(profile.holdTiltSd * rng.gaussian());

  const failure =
    kind === 'tilted-landing'
      ? { failure: 'tilted-landing' as const, failureSize: 10 + 10 * rng.next() }
      : kind === 'hand-drag'
        ? { failure: 'hand-drag' as const, failureSize: 0.2 + 0.2 * rng.next() }
        : { failure: 'height-error' as const, failureSize: heightScale };
  const trace = synthRep({
    routine: 'rig-drop',
    seed,
    bounceHz,
    bounceRatio,
    dropHeightCm: surface.dropHeightCm,
    leanDeg: holdTilt,
    ...failure,
  });
  // shortcut: the mass and base are the default rig; the analysis reads only dropHeightCm.
  return {
    trace: { ...trace, rig: { massKg: 2.1, baseCm: [17.5, 9], dropHeightCm: surface.dropHeightCm, spot: 'center' } },
    kind,
  };
}
