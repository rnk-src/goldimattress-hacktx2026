import type { FeatureName, Routine } from '../../domain';
import type { Axis } from './drop-model';
import { profileOf } from './routine';

/**
 * One row per feature. `sign` is +1 when a higher value means firmer (hardness) or springier (springiness).
 * `absFloor` is the smallest σ in the feature's unit, needed when μ_ref is near 0 (dead foam: bounceRatio ≈ 0).
 * Which axis a feature scores belongs to the drop model (`DropModel.axes`); see `featuresOf`.
 * shortcut: references and tests saved before `peak` existed lack it, so `compare` throws on them; clear local data or add a migration if real users hold old data.
 * shortcut: floors are starting values, not tuned on real G2 fixtures; peak (m/s²) is a guess of 0.1; peakOverV (1/s) is a guess of ~2.5% of a typical 20/s. Tune on G2 recordings.
 */
export const FEATURES: readonly { name: FeatureName; absFloor: number; sign: 1 | -1 }[] = [
  { name: 'peak', absFloor: 0.1, sign: 1 },
  { name: 'peakOverV', absFloor: 0.5, sign: 1 },
  { name: 'stopTime', absFloor: 0.02, sign: -1 },
  { name: 'bounceRatio', absFloor: 0.03, sign: 1 },
  // shortcut: settleTime saturates (breathing keeps |a| outside the band) and varied 1.5 to 2.9 s on one surface, so it scores nothing; replace with a whole-trace decay feature.
  { name: 'settleTime', absFloor: 0.02, sign: 1 },
];

/** `FEATURES` with the axis each feature scores under the routine's drop model (null: reported, not scored). */
export function featuresOf(routine: Routine): (typeof FEATURES[number] & { axis: Axis | null })[] {
  const { axes } = profileOf(routine).model;
  return FEATURES.map((f) => ({ ...f, axis: axes[f.name] ?? null }));
}
