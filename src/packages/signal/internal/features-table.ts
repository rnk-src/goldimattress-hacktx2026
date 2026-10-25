import type { FeatureName } from '../../domain';

/**
 * One row per feature. `axis` is the property it scores (null: reported but not scored, too noisy), and `sign` is +1 when a higher value means
 * firmer (hardness) or springier (springiness). `absFloor` is the smallest σ in the feature's unit,
 * needed when μ_ref is near 0 (dead foam: bounceRatio ≈ 0).
 * shortcut: floors are starting values, not tuned on real G2 fixtures; peak (m/s²) is a guess of 0.1; peakOverV (1/s) is a guess of ~2.5% of a typical 20/s. Tune on G2 recordings.
 */
export const FEATURES: readonly {
  name: FeatureName;
  absFloor: number;
  axis: 'hardness' | 'springiness' | null;
  sign: 1 | -1;
}[] = [
  { name: 'peak', absFloor: 0.1, axis: 'hardness', sign: 1 },
  // Recorded only: peakOverV divides by a body-drop speed estimate and stopTime is the lobe width.
  { name: 'peakOverV', absFloor: 0.5, axis: null, sign: 1 },
  { name: 'stopTime', absFloor: 0.02, axis: null, sign: -1 },
  { name: 'bounceRatio', absFloor: 0.03, axis: 'springiness', sign: 1 },
  // shortcut: settleTime saturates (breathing keeps |a| outside the band) and varied 1.5 to 2.9 s on one surface, so it scores nothing; replace with a whole-trace decay feature.
  { name: 'settleTime', absFloor: 0.02, axis: null, sign: 1 },
];
