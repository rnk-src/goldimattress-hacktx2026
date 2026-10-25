import type { Coach } from '../../coach';
import type { Cue, LiveState, ReferenceStats, RepResult, Routine, Trace } from '../../domain';
import { createRepSession } from '../../session';
import type { RepSession, SessionEvent, SessionOutcome } from '../../session';
import { shortDeviceModel } from './metadata';
import type { AppDeps } from './shell';

const BLOCKED_TEXT = {
  denied:
    'Motion access is blocked. Open Settings, enable Motion & Orientation Access for Safari, then reload this page.',
  unsupported: 'This browser does not support motion sensors. Try Safari or Chrome over HTTPS on your phone.',
} as const;

export interface RepRunHandlers {
  /** The cue is already played through the coach. */
  onCue(cue: Cue): void;
  onState(state: LiveState): void;
  /** `accepted` counts usable reps including this one. */
  onRep(result: RepResult, accepted: number): void;
  /** The sensor and wake lock are already released. Reps carry the time each one started. */
  onDone(reps: RepResult[], outcome: SessionOutcome): void;
  /** Motion access was refused or is missing; nothing started. */
  onBlocked(message: string): void;
}

export interface RepRun {
  start(routine: Routine, ref?: ReferenceStats): Promise<void>;
  finishNow(): void;
  skipRest(): void;
  readonly accepted: number;
  readonly state: LiveState | 'idle';
  /** Stops the sensor and wake lock and ignores anything still in flight. */
  dispose(): void;
}

/**
 * Drives one rep session on the phone sensor for the calibrate and test screens: motion permission,
 * the session, coaching, wake lock, and dating each rep. The screens keep only their own form and result.
 */
export function createRepRun(deps: AppDeps, getCoach: () => Coach, handlers: RepRunHandlers): RepRun {
  let session: RepSession | undefined;
  let running = false;
  let disposed = false;
  /** Wall-clock time of sample time 0, and the latest sample time, so each rep can be dated when it ends. */
  let clockBase: number | undefined;
  let latestT = 0;
  /** When each rep started, in rep order. Traces are rebased per rep, so the start comes from the rep's end. */
  let startedAts: string[] = [];

  const startedAtOf = (trace: Trace): string => {
    const first = trace.samples[0];
    const last = trace.samples.at(-1);
    const durationS = first && last ? last.t - first.t : 0;
    return new Date((clockBase ?? deps.now().getTime()) + (latestT - durationS) * 1_000).toISOString();
  };

  const release = () => {
    running = false;
    deps.source.stop();
    void getCoach().keepAwake(false);
  };

  const handle = (events: SessionEvent[]) => {
    for (const event of events) {
      if (event.kind === 'cue') {
        handlers.onCue(event.cue);
        getCoach().play(event.cue);
      } else if (event.kind === 'state') {
        handlers.onState(event.state);
      } else if (event.kind === 'rep') {
        startedAts.push(startedAtOf(event.result.trace));
        handlers.onRep(event.result, session?.accepted ?? 0);
      } else {
        release();
        const reps = event.reps.map((rep, i) => ({
          ...rep,
          trace: {
            ...rep.trace,
            device: rep.trace.device || shortDeviceModel(deps.device),
            startedAt: startedAts[i] ?? rep.trace.startedAt,
          },
        }));
        handlers.onDone(reps, event.outcome);
      }
    }
  };

  return {
    async start(routine, ref) {
      let access;
      try {
        access = await deps.source.requestAccess();
      } catch {
        access = 'denied' as const;
      }
      if (disposed) return;
      if (access !== 'granted') {
        handlers.onBlocked(BLOCKED_TEXT[access]);
        return;
      }
      session = createRepSession(ref ? { routine, ref } : { routine });
      running = true;
      void getCoach().keepAwake(true);
      clockBase = undefined;
      startedAts = [];
      deps.source.start((sample) => {
        clockBase ??= deps.now().getTime() - sample.t * 1_000;
        latestT = sample.t;
        handle(session!.push(sample));
      });
    },
    finishNow: () => session && handle(session.finishNow()),
    skipRest: () => session && handle(session.skipRest()),
    get accepted() {
      return session?.accepted ?? 0;
    },
    get state() {
      return session?.state ?? 'idle';
    },
    dispose() {
      disposed = true;
      session?.abort();
      if (running) release();
    },
  };
}
