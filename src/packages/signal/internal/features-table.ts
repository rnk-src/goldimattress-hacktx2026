import type { FeatureName } from '../../domain';

/**
 * One row per feature. `axis` is the property it scores, and `sign` is +1 when a higher value means
 * firmer (hardness) or springier (springiness). `absFloor` is the smallest σ in the feature's unit,
 * needed when μ_ref is near 0 (dead foam: bounceRatio ≈ 0).
 * shortcut: floors are starting values, not tuned on real G2 fixtures; peakOverV (1/s) is a guess of ~2.5% of a typical 20/s. Tune on G2 recordings.
 */
export const FEATURES: readonly {
  name: FeatureName;
  absFloor: number;
  axis: 'hardness' | 'springiness';
  sign: 1 | -1;
}[] = [
  { name: 'peakOverV', absFloor: 0.5, axis: 'hardness', sign: 1 },
  { name: 'stopTime', absFloor: 0.02, axis: 'hardness', sign: -1 },
  { name: 'bounceRatio', absFloor: 0.03, axis: 'springiness', sign: 1 },
  { name: 'settleTime', absFloor: 0.02, axis: 'springiness', sign: 1 },
];
