import type { Routine, RoutineSpec } from '../../domain';

const SPECS: Record<Routine, RoutineSpec> = {
  'sit-drop': { hoverMinS: 0.3, preRollS: 1.0, captureS: 4, restS: 20, leanTolDeg: 5, speedTol: 0.2 },
  // The bridge drop settles slower on a mattress, so it captures longer.
  'bridge-drop': { hoverMinS: 0.3, preRollS: 1.0, captureS: 6, restS: 20, leanTolDeg: 5, speedTol: 0.2 },
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. */
export function routineSpec(routine: Routine): RoutineSpec {
  return { ...SPECS[routine] };
}
