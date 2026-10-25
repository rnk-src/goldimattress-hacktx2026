import type { Routine, RoutineSpec } from '../../domain';
import { body } from './body-drop';
import type { DropModel } from './drop-model';
import { freeFall } from './free-fall';

const BASE = { hoverMinS: 0.3, preRollS: 1.0, restS: 20 };

/** Everything signal knows about one routine. Private to signal: the public `RoutineSpec` is only `spec`. */
interface Profile {
  spec: Readonly<RoutineSpec>;
  model: DropModel;
  /** The phone axis that points along gravity when the lean is 0: the torso (y) or the belly normal (z). */
  leanAxis: 'ay' | 'az';
}

const SPECS: Record<Routine, Profile> = {
  // shortcut: 55 degrees separates 3 real sets (leans 2 to 44) from phones lying flat (58 to 78); re-check with more people.
  'sit-drop': { spec: Object.freeze({ ...BASE, captureS: 4, maxLeanDeg: 55 }), model: body, leanAxis: 'ay' },
  // The bridge drop settles slower on a mattress, so it captures longer.
  // shortcut: no bridge-drop data yet, so the position check is off (90 degrees is the largest lean).
  'bridge-drop': { spec: Object.freeze({ ...BASE, captureS: 6, maxLeanDeg: 90 }), model: body, leanAxis: 'az' },
  // shortcut: 20 degrees is a guess for holding the slab level; tune on plate-experiment data.
  'rig-drop': { spec: Object.freeze({ ...BASE, captureS: 3, maxLeanDeg: 20 }), model: freeFall, leanAxis: 'az' },
};

/** Timing and limits per routine. `preRollS` ≥ 1.0 so the hover is inside the trace. The object is shared and frozen. */
export function routineSpec(routine: Routine): Readonly<RoutineSpec> {
  return SPECS[routine].spec;
}

/** The profile of a routine: its spec, drop model and lean axis. */
export const profileOf = (routine: Routine): Readonly<Profile> => SPECS[routine];
