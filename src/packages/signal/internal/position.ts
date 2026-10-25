import type { Routine } from '../../domain';
import { routineSpec } from './routine';

/** The phone counts as back in position only this many degrees inside the limit, so it does not flicker at the edge. */
const MARGIN_DEG = 5;

/**
 * Follows whether the phone is held where the routine needs it. `update` takes the current lean and returns whether the
 * phone is off, plus an event the first time it goes off or comes back (or is first confirmed in position).
 */
export function createPositionTracker(routine: Routine) {
  const { maxLeanDeg } = routineSpec(routine);
  let off = false;
  let confirmed = false;
  return {
    update(leanDeg: number): { off: boolean; event?: 'off' | 'ok' } {
      if (leanDeg > maxLeanDeg) {
        const event = off ? undefined : 'off';
        off = true;
        confirmed = false;
        return event ? { off, event } : { off };
      }
      if (leanDeg <= maxLeanDeg - MARGIN_DEG) off = false;
      if (off || confirmed) return { off };
      confirmed = true;
      return { off, event: 'ok' };
    },
  };
}
