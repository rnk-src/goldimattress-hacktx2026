import type { Person, RigSetup, Routine } from '../../domain';
import { DEFAULT_RIG } from '../../signal';

/** The rig a person uses: their saved setup, or the standard rig. A fresh copy, so callers may not change the default. */
export const personRig = (person?: Person): RigSetup => {
  const rig = person?.rig ?? DEFAULT_RIG;
  return { ...rig, baseCm: [rig.baseCm[0], rig.baseCm[1]] };
};

const SPOT_TEXT: Record<RigSetup['spot'], string> = {
  center: 'middle of the mattress',
  'seat-middle': 'middle of the seat',
  other: 'another spot',
};

/** One line for the screens: mass, release height and test spot. */
export const rigSummary = (rig: RigSetup): string => `${rig.massKg} kg, ${rig.dropHeightCm} cm drop, ${SPOT_TEXT[rig.spot]}`;

/** Compares mass, height and spot. The footprint is fixed by the slab, so it is not compared. */
export const sameRig = (a: RigSetup | undefined, b: RigSetup | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.massKg === b.massKg &&
  a.dropHeightCm === b.dropHeightCm &&
  a.spot === b.spot;

/** The rig the reference reps were recorded with, read from their traces. */
export const referenceRig = (reference: NonNullable<Person['references'][Routine]>): RigSetup | undefined =>
  reference.reps.find((rep) => rep.trace.rig !== undefined)?.trace.rig;
