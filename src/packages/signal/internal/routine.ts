import type { Routine, RoutineSpec } from '../../domain';

const BASE = { hoverMinS: 0.3, preRollS: 1.0, restS: 20, leanTolDeg: 5, speedTol: 0.2 };

const SPECS: Record<Routine, Readonly<RoutineSpec>> = {
  'sit-drop': Object.freeze({ ...BASE, captureS: 4 }),
  // The bridge drop settles slower on a mattress, so it captures longer.
  'bridge-drop': Object.freeze({ ...BASE, captureS: 6 }),
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. The object is shared and frozen. */
export function routineSpec(routine: Routine): Readonly<RoutineSpec> {
  return SPECS[routine];
}
