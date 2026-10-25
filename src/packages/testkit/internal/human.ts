import type { Trace } from '../../domain';
import { maxContactSpeed } from './response';
import { createRng } from './rng';
import { synthRep, type SynthOptions } from './synth';

/** The surface a simulated person drops onto. */
export interface HumanSurface {
  bounceHz: number;
  bounceRatio: number;
  /** Typical impact speed on this surface, m/s. */
  impactSpeed: number;
  /** The lean this surface invites, degrees. */
  leanDeg: number;
}

/** How a simulated person varies from rep to rep. Defaults come from the real sets (one person) and the lead's estimate. */
export interface HumanProfile {
  /** Relative sd of the impact speed. */
  speedSd: number;
  /** Sd of the lean about the surface lean, degrees. */
  leanSd: number;
  /** Range of the person's hover jitter, m/s². Real accepted hovers measured 0.11 to 0.40. */
  swayJitter: [number, number];
  /** Share of attempts that go wrong. */
  badRate: number;
  /** Relative sd of the surface response (bounce ratio and frequency) from drop to drop. */
  responseCv: number;
}

// shortcut: speedSd, leanSd and badRate are estimates; replace with sloppy sets from several people. responseCv is a guess; real couch bounce ratios spread far wider.
export const SLOPPY: HumanProfile = {
  speedSd: 0.25,
  leanSd: 6,
  swayJitter: [0.11, 0.4],
  badRate: 0.35,
  responseCv: 0.15,
};

/**
 * Kinds of attempt. 'tilt', 'fast' and 'slow' are sloppy but the policy tolerates them (lean and speed are not scored against
 * the reference), so they count as usable reps; about 20% of attempts are ones the policy drops or down-weights.
 */
export type AttemptKind = 'good' | 'sway' | 'caught' | 'tilt' | 'fast' | 'slow' | 'left' | 'no-drop';
const BAD_KINDS: readonly AttemptKind[] = ['sway', 'caught', 'tilt', 'fast', 'slow', 'left', 'no-drop'];

export interface SimPerson {
  profile: HumanProfile;
  /** This person's usual hover jitter, m/s². */
  sway: number;
  rng: ReturnType<typeof createRng>;
  attempts: number;
}

/** The jitter (RMS) of a 3 Hz wobble of amplitude A is A/√2. */
const AMPLITUDE_PER_JITTER = Math.SQRT2;

export function createSimPerson(seed: number, profile: HumanProfile = SLOPPY): SimPerson {
  const rng = createRng(seed ^ 0x9e3779b9);
  const [lo, hi] = profile.swayJitter;
  return { profile, sway: lo + (hi - lo) * rng.next(), rng, attempts: 0 };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One attempt by this person on this surface. Advances the person's random stream. */
export function humanAttempt(person: SimPerson, surface: HumanSurface): { trace: Trace; kind: AttemptKind } {
  const { rng, profile } = person;
  const seed = (person.attempts++ + 1) * 7919 + Math.floor(rng.next() * 1e6);
  const kind: AttemptKind =
    rng.next() < profile.badRate ? BAD_KINDS[Math.floor(rng.next() * BAD_KINDS.length)]! : 'good';

  const bounceHz = clamp(surface.bounceHz * (1 + profile.responseCv * rng.gaussian()), 0.8, 4);
  const bounceRatio = clamp(surface.bounceRatio * (1 + profile.responseCv * rng.gaussian()), 0.03, 0.9);
  const safeSpeed = 0.99 * maxContactSpeed(bounceHz, bounceRatio);
  let speed = surface.impactSpeed * (1 + profile.speedSd * rng.gaussian());
  if (kind === 'fast') speed = surface.impactSpeed * 1.8;
  if (kind === 'slow') speed = surface.impactSpeed * 0.4;
  speed = clamp(speed, 0.1, safeSpeed);

  const jitter = person.sway * (1 + 0.2 * rng.gaussian());
  const opts: SynthOptions = {
    seed,
    bounceHz,
    bounceRatio,
    impactSpeed: speed,
    leanDeg: clamp(surface.leanDeg + profile.leanSd * rng.gaussian(), 0, 70),
    failure: 'moving-hover',
    failureSize: Math.max(0, jitter) * AMPLITUDE_PER_JITTER,
  };
  if (kind === 'sway') opts.failureSize = (0.6 + 0.6 * rng.next()) * AMPLITUDE_PER_JITTER;
  if (kind === 'caught') Object.assign(opts, { failure: 'caught-landing', failureSize: undefined });
  if (kind === 'tilt') Object.assign(opts, { failure: 'tilt', failureSize: 25 });
  if (kind === 'left') Object.assign(opts, { failure: 'left-surface', failureSize: undefined });
  if (kind === 'no-drop') Object.assign(opts, { failure: 'no-drop', failureSize: undefined, durationS: 4 });
  return { trace: synthRep(opts), kind };
}
