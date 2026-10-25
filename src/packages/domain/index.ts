export type Routine = 'sit-drop' | 'bridge-drop' | 'rig-drop';

/** The weight rig used for a `rig-drop`: a slab with the phone strapped on, released by hand. */
export interface RigSetup {
  /** Slab plus phone, kg. */
  massKg: number;
  /** Footprint of the slab, cm. */
  baseCm: [number, number];
  /** Nominal release height, cm. */
  dropHeightCm: number;
  spot: 'center' | 'seat-middle' | 'other';
}
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
  /** Rig used for a `rig-drop` trace. */
  rig?: RigSetup;
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
  | 'caught-landing'
  | 'left-surface'
  | 'no-drop-found'
  | 'low-sample-rate'
  | 'flight-mismatch'
  | 'tilted-landing';

export type RepResult =
  | {
      ok: true;
      features: RepFeatures;
      /** m/s. */
      impactSpeed: number;
      leanDeg: number;
      /** Measured free-fall time before the impact, s. Rig covariate. */
      flightS?: number;
      /** Hover RMS jitter before the drop, m/s². */
      hoverJitter: number;
      /** Quality weight, 0..1. A rep is usable at 0.5 or more. */
      weight: number;
      /** What lowered the weight, as the fix to show: hold still or relax the legs. Empty at weight 1. */
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
  /** Hover lean past this many degrees from the phone's upright axis means the phone is not on the body part that drops. */
  maxLeanDeg: number;
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
  /** False until the hardness axis is verified across surfaces. While false, the match ignores hardness and the label should read "can't tell yet". */
  hardnessReliable: boolean;
  caveats: Caveat[];
}

export interface Person {
  id: string;
  name: string;
  bodyMassKg?: number;
  /** The consumer's rig, with any mass override. */
  rig?: RigSetup;
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
  /** Rig index: the stats of the usable reps, shown "for this rig". */
  index?: Record<FeatureName, FeatureStats>;
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
  | 'phone-off'
  | 'phone-ok'
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
