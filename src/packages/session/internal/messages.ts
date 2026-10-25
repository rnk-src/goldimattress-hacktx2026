import type { RejectReason } from '../../domain';

const MESSAGES: Record<RejectReason, string> = {
  'not-still': 'Hold still before you drop.',
  'lean-too-much': 'Lean a bit less.',
  'lean-too-little': 'Lean a bit more.',
  'too-fast': 'You landed too hard. Hover a little lower.',
  'too-slow': 'You landed too softly. Hover a little higher, but no more than 10 cm.',
  'caught-landing': 'Relax your legs completely when you drop.',
  'left-surface': 'You bounced off the surface. Hover a little lower.',
  'no-drop-found': 'No drop found. Hold still, then relax and drop.',
  'low-sample-rate': 'This phone reads its motion sensor too slowly for this test.',
};

/** User-facing fix for a reject reason. */
export function rejectMessage(reason: RejectReason): string {
  return MESSAGES[reason];
}
