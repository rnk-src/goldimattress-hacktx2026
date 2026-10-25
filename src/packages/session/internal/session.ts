import type { Cue, CueKey, LiveState, ReferenceStats, RepResult, Routine, Sample } from '../../domain';
import { GRAVITY, IMPACT_EXCESS, analyzeRep, assessHover, createPositionTracker, isUsable, routineSpec } from '../../signal';
import { rejectMessage } from './messages';

export interface SessionOptions {
  routine: Routine;
  ref?: ReferenceStats;
}

export type SessionOutcome = 'complete' | 'low-confidence' | 'retry';

export type SessionEvent =
  | { kind: 'state'; state: LiveState }
  | { kind: 'cue'; cue: Cue }
  | { kind: 'rep'; result: RepResult }
  | { kind: 'done'; reps: RepResult[]; outcome: SessionOutcome };

export interface RepSession {
  push(s: Sample): SessionEvent[];
  /** Finishes early once at least three usable reps have been captured. */
  finishNow(): SessionEvent[];
  /** Ends the current rest using the latest sample time. */
  skipRest(): SessionEvent[];
  abort(): void;
  readonly state: LiveState;
  readonly accepted: number;
  readonly rejected: number;
}

/** Slack for float error in sample times, s. */
const EPS = 1e-6;
const MAX_ATTEMPTS = 10;
const LOW_CONFIDENCE_TEXT = 'Session complete with low confidence.';
// shortcut: duplicates signal's 1 m/s² drop ceiling, export the shared threshold if either package retunes it.
const SCOREABLE_JITTER = 1;

const CUES: Record<CueKey, Cue> = {
  'place-phone': { key: 'place-phone', text: 'Place the phone on your body, then hold still.' },
  'hold-still': { key: 'hold-still', text: 'Hold still.' },
  'phone-off': { key: 'phone-off', text: 'Hold the phone upright against your breastbone, screen facing out.' },
  'phone-ok': { key: 'phone-ok', text: 'Phone position good. Hold still.' },
  'drop-when-ready': { key: 'drop-when-ready', text: 'Relax your legs and drop.', beep: 'ready' },
  captured: { key: 'captured', text: 'Drop detected. Stay still and hold your breath.', beep: 'captured' },
  'rep-accepted': { key: 'rep-accepted', text: 'Good rep.', beep: 'accepted' },
  'rep-rejected': { key: 'rep-rejected', text: 'Rep rejected.', beep: 'rejected' },
  rest: { key: 'rest', text: 'Rest.' },
  'next-rep': { key: 'next-rep', text: 'Get ready for the next rep.' },
  done: { key: 'done', text: 'All reps done.' },
};

/** The cue for a phone-position event from `createPositionTracker`. */
export const positionCue = (event: 'off' | 'ok'): Cue => CUES[event === 'off' ? 'phone-off' : 'phone-ok'];

export function createRepSession(opts: SessionOptions): RepSession {
  const spec = routineSpec(opts.routine);
  const goal = 5;
  const restText = `Rest for ${spec.restS} seconds. Do not drop yet.`;
  let restEndT = 0;
  let restStartedT = 0;
  let restWarned = false;
  let pendingRestSkipped: boolean | undefined;
  let previousCaptureEndT: number | undefined;
  let aborted = false;
  /** Time of the first evaluation in the current unbroken run of still hovers. */
  let stillSince: number | undefined;
  const position = createPositionTracker(opts.routine);
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
  const finish = (out: SessionEvent[], outcome: SessionOutcome, text = CUES.done.text) => {
    setState('done', out);
    cue('done', out, text);
    out.push({ kind: 'done', reps: [...reps], outcome });
  };

  const finishRep = (out: SessionEvent[]) => {
    const t0 = capture[0]!.t;
    const last = capture[capture.length - 1]!;
    let result = analyzeRep(
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
    if (result.ok && previousCaptureEndT !== undefined && pendingRestSkipped !== undefined) {
      result = { ...result, restS: t0 - previousCaptureEndT, restSkipped: pendingRestSkipped };
    }
    pendingRestSkipped = undefined;
    capture = [];
    buffer = [];
    restStartedT = last.t;
    previousCaptureEndT = last.t;
    restEndT = restStartedT + spec.restS;
    restWarned = false;
    reps.push(result);
    const usable = isUsable(result);
    if (usable) accepted += 1;
    else rejected += 1;
    out.push({ kind: 'rep', result });
    if (usable) cue('rep-accepted', out);
    else cue('rep-rejected', out, rejectMessage((result.ok ? result.issues : result.reasons)[0]!), true);
    if (accepted >= goal) {
      finish(out, 'complete');
      return;
    }
    if (reps.length >= MAX_ATTEMPTS) {
      if (accepted >= 3) finish(out, 'low-confidence', LOW_CONFIDENCE_TEXT);
      else finish(out, 'retry', 'This technique or surface is not working. Try again when you are ready.');
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
          pendingRestSkipped = false;
          setState('positioning', out);
          cue('next-rep', out);
        } else if (!restWarned && Math.hypot(s.ax, s.ay, s.az) - GRAVITY > IMPACT_EXCESS) {
          restWarned = true;
          cue('rest', out, restText, true);
        }
        return out;
      }
      const recent = buffer.filter((w) => s.t - w.t <= spec.hoverMinS + EPS);
      if (recent[0]!.t > s.t - spec.hoverMinS + EPS) return out;
      const hover = assessHover(recent, opts.routine, SCOREABLE_JITTER);
      if (!hover.still) {
        stillSince = undefined;
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
      const placed = position.update(hover.leanDeg);
      if (placed.off) {
        stillSince = undefined;
        setState('holding', out);
        cue('phone-off', out);
        return out;
      }
      if (placed.event === 'ok') cue('phone-ok', out);
      // A wobbling hover can pass single windows, so arm only after a sustained run of still ones.
      stillSince ??= s.t;
      if (s.t - stillSince < spec.hoverMinS - EPS) return out;
      setState('armed', out);
      cue('drop-when-ready', out);
      return out;
    },
    finishNow() {
      const out: SessionEvent[] = [];
      if (aborted || state === 'done' || state === 'capturing' || accepted < 3) return out;
      finish(out, 'low-confidence', LOW_CONFIDENCE_TEXT);
      return out;
    },
    skipRest() {
      const out: SessionEvent[] = [];
      if (aborted || state !== 'resting') return out;
      pendingRestSkipped = true;
      setState('positioning', out);
      cue('next-rep', out);
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
