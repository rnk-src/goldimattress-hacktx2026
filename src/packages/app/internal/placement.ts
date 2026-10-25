import type { Routine } from '../../domain';

export const PLACEMENT: Record<Routine, { label: string; text: string }> = {
  'sit-drop': {
    label: 'Sit-drop: couches, chairs and cushions',
    text: 'Hold the phone flat on your sternum, screen out, arms crossed over it. Stand with your back to the surface and squat to hover about 10 cm (a fist) above it. Lean forward naturally, hold still, relax your legs and drop.',
  },
  'bridge-drop': {
    label: 'Bridge drop: mattresses',
    text: 'Lie on your back in the middle of the bed. Hold the phone flat on your lower belly over the hip bones with both hands. Lift your hips about 10 cm, hold still, go limp and drop.',
  },
};
