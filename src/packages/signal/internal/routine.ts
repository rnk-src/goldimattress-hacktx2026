import type { Routine, RoutineSpec } from '../../domain';
import { body } from './body-drop';
import type { DropModel } from './drop-model';
import { freeFall } from './free-fall';

const BASE = { hoverMinS: 0.3, preRollS: 1.0, restS: 20 };

/** Which drop model analyzes a routine. Private to signal: the public `RoutineSpec` does not expose it. */
export type DropModelName = 'body' | 'free-fall';

const SPECS: Record<Routine, { spec: Readonly<RoutineSpec>; dropModel: DropModelName }> = {
  // shortcut: 55 degrees separates 3 real sets (leans 2 to 44) from phones lying flat (58 to 78); re-check with more people.
  'sit-drop': { spec: Object.freeze({ ...BASE, captureS: 4, maxLeanDeg: 55 }), dropModel: 'body' },
  // The bridge drop settles slower on a mattress, so it captures longer.
  // shortcut: no bridge-drop data yet, so the position check is off (90 degrees is the largest lean).
  'bridge-drop': { spec: Object.freeze({ ...BASE, captureS: 6, maxLeanDeg: 90 }), dropModel: 'body' },
  // shortcut: 20 degrees is a guess for holding the slab level; tune on plate-experiment data.
  'rig-drop': { spec: Object.freeze({ ...BASE, captureS: 3, maxLeanDeg: 20 }), dropModel: 'free-fall' },
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. The object is shared and frozen. */
export function routineSpec(routine: Routine): Readonly<RoutineSpec> {
  return SPECS[routine].spec;
}

/** The drop model for a routine. */
export function dropModelOf(routine: Routine): DropModelName {
  return SPECS[routine].dropModel;
}

/**
 * Share of |μ_ref| below which a spread is treated as noise. The rig drops a fixed mass, so its repeats are tighter than a body's.
 * shortcut: 5% for the rig and 8% for the body are starting values; tune the rig's on the plate-experiment spread.
 */
export function relFloorOf(routine: Routine): number {
  return routine === 'rig-drop' ? 0.05 : 0.08;
}

export const DROP_MODELS: Record<DropModelName, DropModel> = { body, 'free-fall': freeFall };
