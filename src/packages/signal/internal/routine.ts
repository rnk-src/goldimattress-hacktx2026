import type { Routine, RoutineSpec } from '../../domain';

const BASE = { hoverMinS: 0.3, preRollS: 1.0, restS: 20 };

const SPECS: Record<Routine, Readonly<RoutineSpec>> = {
  // shortcut: 55 degrees separates 3 real sets (leans 2 to 44) from phones lying flat (58 to 78); re-check with more people.
  'sit-drop': Object.freeze({ ...BASE, captureS: 4, maxLeanDeg: 55 }),
  // The bridge drop settles slower on a mattress, so it captures longer.
  // shortcut: no bridge-drop data yet, so the position check is off (90 degrees is the largest lean).
  'bridge-drop': Object.freeze({ ...BASE, captureS: 6, maxLeanDeg: 90 }),
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. The object is shared and frozen. */
export function routineSpec(routine: Routine): Readonly<RoutineSpec> {
  return SPECS[routine];
}
