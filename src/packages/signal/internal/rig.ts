import type { RigSetup } from '../../domain';

/** The rig as built: a 1.9 kg slab plus a 0.2 kg phone, released from 5 cm. */
export const DEFAULT_RIG: Readonly<RigSetup> = Object.freeze({
  massKg: 2.1,
  baseCm: [17.5, 9] as [number, number],
  dropHeightCm: 5,
  spot: 'center',
});
