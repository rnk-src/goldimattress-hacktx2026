import type { RejectReason } from '../../domain';

const MESSAGES: Record<RejectReason, string> = {
  'not-still': 'Hold still before you drop.',
  'caught-landing': 'Relax your legs completely when you drop.',
  'left-surface': 'You bounced off the surface. Hover a little lower.',
  'no-drop-found': 'No drop found. Hold still, then relax and drop.',
  'low-sample-rate': 'This phone reads its motion sensor too slowly for this test.',
  'flight-mismatch': 'The drop was not a clean release. Let go with both hands at the same moment.',
  'tilted-landing': 'The slab landed tilted. Keep it flat as you let go.',
};

/** User-facing fix for a reject reason. */
export function rejectMessage(reason: RejectReason): string {
  return MESSAGES[reason];
}
