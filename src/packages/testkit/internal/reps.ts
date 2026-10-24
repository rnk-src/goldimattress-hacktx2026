import type { Trace } from '../../domain';
import { createRng } from './rng';
import { DEFAULTS, GRAVITY, synthRep, type SynthOptions } from './synth';

type SpreadKey = 'impactSpeed' | 'bounceHz' | 'bounceRatio' | 'leanDeg';

const keys = ['impactSpeed', 'bounceHz', 'bounceRatio', 'leanDeg'] as const;

/** Keeps a drawn value inside what `synthRep` accepts. */
const limits = (dropS: number): Record<SpreadKey, [number, number]> => ({
  impactSpeed: [0.05, GRAVITY * dropS],
  bounceHz: [0.5, 6],
  bounceRatio: [0.01, 0.95],
  leanDeg: [0, 80],
});

/**
 * n reps of one surface, as one person would do them. Each rep gets its own noise.
 * `spread` is the standard deviation of a per-rep Gaussian draw around the nominal value.
 * Same options, spread and seed give the same traces.
 */
export function synthReps(
  n: number,
  opts: SynthOptions = {},
  spread: Partial<Record<SpreadKey, number>> = {},
): Trace[] {
  const seed = opts.seed ?? DEFAULTS.seed;
  const rng = createRng(seed ^ 0x5bd1e995);
  const bounds = limits(opts.dropS ?? DEFAULTS.dropS);
  return Array.from({ length: n }, (_, i) => {
    const rep: SynthOptions = { ...opts, seed: seed + i };
    for (const key of keys) {
      const sigma = spread[key];
      if (!sigma) continue;
      const [lo, hi] = bounds[key];
      const drawn = (opts[key] ?? DEFAULTS[key]) + sigma * rng.gaussian();
      rep[key] = Math.min(hi, Math.max(lo, drawn));
    }
    return synthRep(rep);
  });
}
