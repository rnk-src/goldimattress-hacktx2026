import type { Caveat, Confidence, FeatureName, FeatureStats, Verdict } from '../../domain';
import { GRAVITY } from '../../signal';

const CONFIDENCE: Record<Confidence, string> = {
  confident: 'confident',
  'close-call': 'close call',
  'not-enough-data': 'not enough data',
};

const CAVEAT: Record<Caveat, string> = {
  'lean-differs': 'Your lean differed from calibration.',
  'rest-skipped': 'You skipped a rest between reps.',
};

const strength = (label: Verdict['springinessLabel']): string => (label === 'much' ? 'much ' : 'slightly ');

export const matchText = (verdict: Verdict): string => `${Math.round(verdict.match)}% match`;

export const springinessText = (verdict: Verdict): string =>
  verdict.springinessLabel === 'just-right'
    ? 'same bounce'
    : `${strength(verdict.springinessLabel)}${verdict.bouncier ? 'bouncier' : 'less bouncy'}`;

export const hardnessText = (verdict: Verdict): string =>
  !verdict.hardnessReliable
    ? "hardness: can't tell yet"
    : verdict.hardnessLabel === 'just-right'
      ? 'same hardness'
      : `${strength(verdict.hardnessLabel)}${verdict.firmer ? 'firmer' : 'softer'}`;

export const confidenceText = (verdict: Verdict): string => CONFIDENCE[verdict.confidence];

export const caveatTexts = (verdict: Verdict): string[] => verdict.caveats.map((caveat) => CAVEAT[caveat]);

/** The rig index: peak in g and the bounce ratio, labelled so nobody reads it as a stiffness. */
export const indexText = (index: Record<FeatureName, FeatureStats>): string =>
  `Rig index (for this rig): peak ${(index.peak.center / GRAVITY).toFixed(2)} g, bounce ratio ${index.bounceRatio.center.toFixed(2)}`;
