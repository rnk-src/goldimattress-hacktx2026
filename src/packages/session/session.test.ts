import { describe, expect, it } from 'vitest';
import type { Cue, ReferenceStats, RejectReason, Sample } from '../domain';
import { synthStream } from '../testkit';
import { createRepSession, rejectMessage } from './index';
import type { SessionEvent } from './index';

function run(session: ReturnType<typeof createRepSession>, samples: Sample[]): SessionEvent[] {
  return samples.flatMap((s) => session.push(s));
}
const cues = (events: SessionEvent[]): Cue[] =>
  events.flatMap((e) => (e.kind === 'cue' ? [e.cue] : []));
const keys = (events: SessionEvent[]) => cues(events).map((c) => c.key);

describe('createRepSession hover coaching', () => {
  it('tells the user to hold still when the hover moves', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'moving-hover' }]).slice(0, 90));
    expect(keys(events)).toContain('hold-still');
    expect(session.state).toBe('holding');
  });

  it('does not arm on a wobbling hover even when some windows look still', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'moving-hover' }]).slice(0, 90));
    expect(events.filter((e) => e.kind === 'state').map((e) => e.kind === 'state' && e.state)).not.toContain('armed');
    expect(keys(events)).not.toContain('drop-when-ready');
  });

  it('arms with a drop cue once the hover is still, then reports capturing at the drop', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{}]).slice(0, 55));
    expect(keys(events)).toEqual(['place-phone', 'drop-when-ready']);
    expect(session.state).toBe('armed');
    const drop = run(session, synthStream([{}]).slice(55, 100));
    expect(drop.filter((e) => e.kind === 'state')).toEqual([{ kind: 'state', state: 'capturing' }]);
  });
});

describe('createRepSession reps', () => {
  it('cuts a rep from the pre-roll through the capture time and accepts a good drop', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{}, {}], 22));
    const reps = events.flatMap((e) => (e.kind === 'rep' ? [e.result] : []));
    expect(reps[0]?.ok).toBe(true);
    expect(session.accepted).toBe(1);
    expect(keys(events).slice(0, 4)).toEqual(['place-phone', 'drop-when-ready', 'captured', 'rep-accepted']);
    const span = reps[0]!.trace.samples.at(-1)!.t - reps[0]!.trace.samples[0]!.t;
    expect(span).toBeGreaterThan(4.5);
    expect(span).toBeLessThan(5.5);
  });

  it('rests after a rep and ignores a drop that arrives during the rest', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{}, {}], 8));
    expect(keys(events)).toEqual(['place-phone', 'drop-when-ready', 'captured', 'rep-accepted', 'rest', 'rest']);
    expect(events.filter((e) => e.kind === 'rep')).toHaveLength(1);
    expect(session.accepted).toBe(1);
    expect(session.state).toBe('resting');
  });

  it('asks for the next rep when the rest is over and takes it', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    // The third rep is cut off by the end of the stream; two complete.
    const events = run(session, synthStream([{}, {}, {}], 22));
    expect(events.filter((e) => e.kind === 'rep')).toHaveLength(2);
    expect(keys(events)).toContain('next-rep');
    expect(session.accepted).toBe(2);
  });

  it('finishes after the goal of five accepted reps and then ignores samples', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const stream = synthStream(Array.from({ length: 6 }, (_, i) => ({ seed: i + 1 })), 22);
    const events = run(session, stream);
    expect(events.filter((e) => e.kind === 'rep')).toHaveLength(5);
    const last = events.at(-1);
    expect(last?.kind).toBe('done');
    expect(last?.kind === 'done' && last.reps).toHaveLength(5);
    expect(keys(events).at(-1)).toBe('done');
    expect(session.state).toBe('done');
    expect(session.push(stream.at(-1)!)).toEqual([]);
  });

  it('honours a smaller goal', () => {
    const session = createRepSession({ routine: 'sit-drop', goal: 2 });
    const events = run(session, synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], 22));
    expect(events.filter((e) => e.kind === 'rep')).toHaveLength(2);
    expect(events.at(-1)?.kind).toBe('done');
  });

  it('returns no events after abort', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const stream = synthStream([{}, {}], 22);
    run(session, stream.slice(0, 55));
    session.abort();
    expect(run(session, stream.slice(55))).toEqual([]);
    expect(session.state).toBe('idle');
    expect(session.accepted).toBe(0);
  });
});

const stats = (median: number) => ({ median, mad: 0.1 });
/** A reference matching the testkit defaults: 15 degree lean, 0.6 m/s impact. */
const REF: ReferenceStats = {
  routine: 'sit-drop',
  repCount: 5,
  createdAt: '2026-10-24T16:00:00.000Z',
  features: { peakOverV: stats(20), stopTime: stats(0.2), bounceRatio: stats(0.4), settleTime: stats(2) },
  leanDeg: stats(15),
  impactSpeed: stats(0.6),
  jitterScale: 0.1,
};

describe('createRepSession rejects', () => {
  it('rejects a caught landing with its fix and does not count it', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'caught-landing' }, {}], 22));
    const rep = events.find((e) => e.kind === 'rep');
    expect(rep?.kind === 'rep' && rep.result.ok && rep.result.issues).toContain('caught-landing');
    expect(cues(events).find((c) => c.key === 'rep-rejected')?.text).toBe(rejectMessage('caught-landing'));
    expect(session.rejected).toBe(1);
    expect(session.accepted).toBe(0);
  });
});

describe('createRepSession lean coaching', () => {
  it('does not ask to match the calibration lean, since another surface invites another lean', () => {
    const session = createRepSession({ routine: 'sit-drop', ref: REF });
    const events = run(session, synthStream([{ leanDeg: 35 }]).slice(0, 90));
    expect(keys(events)).not.toContain('lean-less');
    expect(keys(events)).not.toContain('lean-more');
    expect(session.state).not.toBe('holding');
  });
});

const REASONS: RejectReason[] = [
  'not-still',
  'caught-landing',
  'left-surface',
  'no-drop-found',
  'low-sample-rate',
];

describe('rejectMessage', () => {
  it('gives every reject reason its own short fix', () => {
    const messages = REASONS.map(rejectMessage);
    expect(new Set(messages).size).toBe(REASONS.length);
    messages.forEach((m) => expect(m.length).toBeGreaterThan(0));
  });
});
