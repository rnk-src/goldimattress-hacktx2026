import type { Cue, CueKey, LiveState, ReferenceStats, RepResult, Routine, Sample } from '../../domain';
import { analyzeRep, assessHover, routineSpec } from '../../signal';
import { rejectMessage } from './messages';

export interface SessionOptions {
  routine: Routine;
  ref?: ReferenceStats;
  /** Accepted reps that end the session. Default 5. */
  goal?: number;
}

export type SessionEvent =
  | { kind: 'state'; state: LiveState }
  | { kind: 'cue'; cue: Cue }
  | { kind: 'rep'; result: RepResult }
  | { kind: 'done'; reps: RepResult[] };

export interface RepSession {
  push(s: Sample): SessionEvent[];
  abort(): void;
  readonly state: LiveState;
  readonly accepted: number;
  readonly rejected: number;
}

/** Slack for float error in sample times, s. */
const EPS = 1e-6;

/** |a| this far above 1 g marks a drop landing during a rest, m/s². Same value signal uses for an impact. */
const IMPACT_EXCESS = 1.5;
const G = 9.81;

const CUES: Record<CueKey, Cue> = {
  'place-phone': { key: 'place-phone', text: 'Place the phone on your body, then hold still.' },
  'hold-still': { key: 'hold-still', text: 'Hold still.' },
  'lean-less': { key: 'lean-less', text: 'Lean a bit less.' },
  'lean-more': { key: 'lean-more', text: 'Lean a bit more.' },
  'drop-when-ready': { key: 'drop-when-ready', text: 'Relax your legs and drop.', beep: 'ready' },
  captured: { key: 'captured', text: 'Drop detected. Stay still and hold your breath.', beep: 'captured' },
  'rep-accepted': { key: 'rep-accepted', text: 'Good rep.', beep: 'accepted' },
  'rep-rejected': { key: 'rep-rejected', text: 'Rep rejected.', beep: 'rejected' },
  rest: { key: 'rest', text: 'Rest.' },
  'next-rep': { key: 'next-rep', text: 'Get ready for the next rep.' },
  done: { key: 'done', text: 'All reps done.' },
};

export function createRepSession(opts: SessionOptions): RepSession {
  const spec = routineSpec(opts.routine);
  const goal = opts.goal ?? 5;
  const restText = `Rest for ${spec.restS} seconds. Do not drop yet.`;
  let restEndT = 0;
  let restWarned = false;
  let aborted = false;
  let state: LiveState = 'idle';
  let lastCue: CueKey | undefined;
  let buffer: Sample[] = [];
  let capture: Sample[] = [];
  let captureEndT = 0;
  let accepted = 0;
  let rejected = 0;
  const reps: RepResult[] = [];

  const setState = (next: LiveState, out: SessionEvent[]) => {
    if (next === state) return;
    state = next;
    out.push({ kind: 'state', state });
  };
  /** Emits a cue unless it repeats the last one. `text` replaces the default wording. */
  const cue = (key: CueKey, out: SessionEvent[], text?: string, force = false) => {
    if (key === lastCue && !force) return;
    lastCue = key;
    out.push({ kind: 'cue', cue: text === undefined ? CUES[key] : { ...CUES[key], text } });
  };

  const finishRep = (out: SessionEvent[]) => {
    const t0 = capture[0]!.t;
    const last = capture[capture.length - 1]!;
    const result = analyzeRep(
      {
        routine: opts.routine,
        sampleRateHz: (capture.length - 1) / (last.t - t0),
        // shortcut: the session has no clock or device name, so the app fills these when it saves a rep (#14).
        device: '',
        startedAt: '',
        samples: capture.map((c) => ({ ...c, t: c.t - t0 })),
      },
      opts.ref,
    );
    capture = [];
    buffer = [];
    restEndT = last.t + spec.restS;
    restWarned = false;
    reps.push(result);
    if (result.ok) accepted += 1;
    else rejected += 1;
    out.push({ kind: 'rep', result });
    if (result.ok) cue('rep-accepted', out);
    else cue('rep-rejected', out, rejectMessage(result.reasons[0]!), true);
    if (accepted >= goal) {
      setState('done', out);
      cue('done', out);
      out.push({ kind: 'done', reps: [...reps] });
      return;
    }
    setState('resting', out);
    cue('rest', out, restText);
  };

  return {
    push(s) {
      const out: SessionEvent[] = [];
      if (state === 'done' || aborted) return out;
      if (state === 'idle') {
        setState('positioning', out);
        cue('place-phone', out);
      }
      if (state === 'capturing') {
        capture.push(s);
        if (s.t < captureEndT - EPS) return out;
        finishRep(out);
        return out;
      }
      buffer.push(s);
      buffer = buffer.filter((w) => s.t - w.t <= spec.preRollS + EPS);
      if (state === 'resting') {
        if (s.t >= restEndT - EPS) {
          setState('positioning', out);
          cue('next-rep', out);
        } else if (!restWarned && Math.hypot(s.ax, s.ay, s.az) - G > IMPACT_EXCESS) {
          restWarned = true;
          cue('rest', out, restText, true);
        }
        return out;
      }
      const recent = buffer.filter((w) => s.t - w.t <= spec.hoverMinS + EPS);
      if (recent[0]!.t > s.t - spec.hoverMinS + EPS) return out;
      const hover = assessHover(recent, opts.routine, opts.ref);
      if (!hover.still) {
        if (state === 'armed') {
          setState('capturing', out);
          cue('captured', out);
          capture = buffer.filter((w) => w.t >= s.t - spec.preRollS - EPS);
          captureEndT = s.t + spec.captureS;
          return out;
        }
        setState('holding', out);
        cue('hold-still', out);
        return out;
      }
      const leanFix = hover.reasons.find((r) => r === 'lean-too-much' || r === 'lean-too-little');
      if (leanFix) {
        setState('holding', out);
        cue(leanFix === 'lean-too-much' ? 'lean-less' : 'lean-more', out);
        return out;
      }
      setState('armed', out);
      cue('drop-when-ready', out);
      return out;
    },
    abort() {
      aborted = true;
      state = 'idle';
    },
    get state() {
      return state;
    },
    get accepted() {
      return accepted;
    },
    get rejected() {
      return rejected;
    },
  };
}
