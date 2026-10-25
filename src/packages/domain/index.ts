export type Routine = 'sit-drop' | 'bridge-drop';
export type SurfaceType = 'mattress' | 'couch' | 'chair' | 'cushion' | 'pad';

/** One accelerometer reading. */
export interface Sample {
  /** Seconds since the start of the trace. */
  t: number;
  /** m/s², gravity included. */
  ax: number;
  ay: number;
  az: number;
}

export interface Trace {
  routine: Routine;
  sampleRateHz: number;
  device: string;
  /** ISO 8601 timestamp. */
  startedAt: string;
  samples: Sample[];
}

export interface Recording {
  version: 1;
  label: string;
  surface: string;
  notes?: string;
  traces: Trace[];
}

export interface RepFeatures {
  /** a_peak / v_impact, 1/s. Higher = firmer. */
  peakOverV: number;
  /** Impact to first return to 1 g, s. Shorter = firmer. */
  stopTime: number;
  /** A₂/A₁, 0..1. Higher = springier. 0 when there is no second peak. */
  bounceRatio: number;
  /** Time until within ±0.05 g of rest, s. Longer = springier. */
  settleTime: number;
}
export type FeatureName = keyof RepFeatures;

export type RejectReason =
  | 'not-still'
  | 'lean-too-much'
  | 'lean-too-little'
  | 'too-fast'
  | 'too-slow'
  | 'caught-landing'
  | 'left-surface'
  | 'no-drop-found'
  | 'low-sample-rate';

export type RepResult =
  | {
      ok: true;
      features: RepFeatures;
      /** m/s. */
      impactSpeed: number;
      leanDeg: number;
      /** Hover RMS jitter before the drop, m/s². */
      hoverJitter: number;
      /** Quality weight, 0..1. A rep is usable at 0.5 or more. */
      weight: number;
      /** What lowered the weight, as the fix to show: lean, speed, hold still, relax. Empty at weight 1. */
      issues: RejectReason[];
      /** Seconds the person rested before this rep. Set by the session, not by `analyzeRep`. Unset for the first rep. */
      restS?: number;
      /** True when the person skipped the rest. Set by the session. */
      restSkipped?: boolean;
      trace: Trace;
    }
  /** Dropped: no usable signal. Never scored. */
  | { ok: false; reasons: RejectReason[]; trace: Trace };

export interface HoverAssessment {
  still: boolean;
  /** RMS jitter, m/s². */
  jitter: number;
  leanDeg: number;
  reasons: RejectReason[];
}

export interface RoutineSpec {
  hoverMinS: number;
  preRollS: number;
  captureS: number;
  restS: number;
  leanTolDeg: number;
}

export interface FeatureStats {
  /** Quality-weighted median. */
  median: number;
  /** Quality-weighted MAD × 1.4826, comparable to a standard deviation. */
  mad: number;
}

export interface ReferenceStats {
  routine: Routine;
  repCount: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
  features: Record<FeatureName, FeatureStats>;
  leanDeg: FeatureStats;
  impactSpeed: FeatureStats;
  /** Median hover jitter of the reps behind the reference, m/s². The person's own jitter scale. */
  jitterScale: number;
}

export type Label = 'just-right' | 'slightly' | 'much';

/** How far a verdict can be trusted. */
export type Confidence = 'confident' | 'close-call' | 'not-enough-data';
/** Something that makes the verdict less reliable than the number says. */
export type Caveat = 'lean-differs' | 'rest-skipped';

export interface Verdict {
  hardness: number;
  springiness: number;
  hardnessLabel: Label;
  springinessLabel: Label;
  firmer: boolean;
  bouncier: boolean;
  /** 0..100. */
  match: number;
  perFeatureZ: Record<FeatureName, number>;
  /** One standard error either side of the score. */
  hardnessInterval: [number, number];
  springinessInterval: [number, number];
  confidence: Confidence;
  /** False until the hardness axis is verified across surfaces; then the label and match ignore it. */
  hardnessReliable: boolean;
  caveats: Caveat[];
}

export interface Person {
  id: string;
  name: string;
  bodyMassKg?: number;
  references: Partial<Record<Routine, { stats: ReferenceStats; reps: RepResult[] }>>;
}

export interface Surface {
  id: string;
  name: string;
  type: SurfaceType;
}

export interface TestRecord {
  id: string;
  personId: string;
  surfaceId: string;
  routine: Routine;
  /** ISO 8601 timestamp. */
  createdAt: string;
  device: string;
  sampleRateHz: number;
  /** Accepted and rejected reps, with raw traces. */
  reps: RepResult[];
  verdict: Verdict;
}

export type LiveState =
  | 'idle'
  | 'positioning'
  | 'holding'
  | 'armed'
  | 'capturing'
  | 'resting'
  | 'done';

export type CueKey =
  | 'place-phone'
  | 'hold-still'
  | 'lean-less'
  | 'lean-more'
  | 'drop-when-ready'
  | 'captured'
  | 'rep-accepted'
  | 'rep-rejected'
  | 'rest'
  | 'next-rep'
  | 'done';

export type BeepPattern = 'ready' | 'captured' | 'accepted' | 'rejected';

export interface Cue {
  key: CueKey;
  text: string;
  beep?: BeepPattern;
}
