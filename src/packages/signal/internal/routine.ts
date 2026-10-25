import type { RigSetup, Routine, RoutineSpec } from '../../domain';

const BASE = { hoverMinS: 0.3, preRollS: 1.0, restS: 20 };

/** The rig as built: a 1.9 kg slab plus a 0.2 kg phone, released from 5 cm. */
export const DEFAULT_RIG: Readonly<RigSetup> = Object.freeze({
  massKg: 2.1,
  baseCm: [17.5, 9] as [number, number],
  dropHeightCm: 5,
  spot: 'center',
});

const SPECS: Record<Routine, Readonly<RoutineSpec>> = {
  // shortcut: 55 degrees separates 3 real sets (leans 2 to 44) from phones lying flat (58 to 78); re-check with more people.
  'sit-drop': Object.freeze({ ...BASE, captureS: 4, maxLeanDeg: 55 }),
  // The bridge drop settles slower on a mattress, so it captures longer.
  // shortcut: no bridge-drop data yet, so the position check is off (90 degrees is the largest lean).
  'bridge-drop': Object.freeze({ ...BASE, captureS: 6, maxLeanDeg: 90 }),
  // shortcut: 20 degrees is a guess for holding the slab level; tune on plate-experiment data.
  'rig-drop': Object.freeze({ ...BASE, captureS: 3, maxLeanDeg: 20 }),
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. The object is shared and frozen. */
export function routineSpec(routine: Routine): Readonly<RoutineSpec> {
  return SPECS[routine];
}
