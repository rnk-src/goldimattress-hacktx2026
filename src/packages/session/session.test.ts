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
  it('tells the user to hold still when the hover is too violent to score', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'moving-hover', failureSize: 2 }]).slice(0, 90));
    expect(keys(events)).toContain('hold-still');
    expect(session.state).toBe('holding');
  });

  it('does not arm on a violent hover even when some windows look still', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'moving-hover', failureSize: 2 }]).slice(0, 90));
    expect(events.filter((e) => e.kind === 'state').map((e) => e.kind === 'state' && e.state)).not.toContain('armed');
    expect(keys(events)).not.toContain('drop-when-ready');
  });

  it('captures a moderately moving hover and scores it at low weight', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ failure: 'moving-hover', seed: 1 }, { seed: 1 }], 22));
    const rep = events.find((event) => event.kind === 'rep');

    expect(rep?.kind === 'rep' && rep.result.ok && rep.result.issues[0]).toBe('not-still');
    expect(rep?.kind === 'rep' && rep.result.ok && rep.result.weight).toBeLessThan(0.5);
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

  it('records the default twenty-second rest on the next valid rep', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], 22));
    const reps = events.flatMap((event) => (event.kind === 'rep' && event.result.ok ? [event.result] : []));

    expect(reps[1]).toMatchObject({ restS: 20, restSkipped: false });
  });

  it('lets the user skip rest and records the skip on the next valid rep', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events: SessionEvent[] = [];
    let skipped = false;
    for (const sample of synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], 8)) {
      const next = session.push(sample);
      events.push(...next);
      if (!skipped && next.some((event) => event.kind === 'rep')) {
        events.push(...session.skipRest());
        skipped = true;
      }
    }
    const reps = events.flatMap((event) => (event.kind === 'rep' && event.result.ok ? [event.result] : []));

    expect(reps).toHaveLength(2);
    expect(reps[1]).toMatchObject({ restS: 0, restSkipped: true });
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

  it('lets the user finish at three usable reps with low confidence', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    run(session, synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 4 }], 22));

    const events = session.finishNow();

    expect(session.accepted).toBe(3);
    expect(events.at(-1)).toMatchObject({ kind: 'done', outcome: 'low-confidence' });
    expect(session.state).toBe('done');
  });

  it('stops after ten attempts with a retry outcome when fewer than three are usable', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const attempts = Array.from({ length: 12 }, () => ({ failure: 'caught-landing' as const, seed: 1 }));
    const events = run(session, synthStream(attempts, 22));

    expect(events.filter((event) => event.kind === 'rep')).toHaveLength(10);
    expect(events.at(-1)).toMatchObject({ kind: 'done', outcome: 'retry' });
    expect(cues(events).at(-1)?.text).toContain('technique or surface is not working');
    expect(session.state).toBe('done');
  });

  it('finishes with low confidence after ten attempts when three are usable', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const usable = [{ seed: 1 }, { seed: 1 }, { seed: 1 }];
    const lowWeight = Array.from({ length: 9 }, () => ({ failure: 'caught-landing' as const, seed: 1 }));
    const events = run(session, synthStream([...usable, ...lowWeight], 22));

    expect(events.filter((event) => event.kind === 'rep')).toHaveLength(10);
    expect(events.at(-1)).toMatchObject({ kind: 'done', outcome: 'low-confidence' });
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

  it('rejects a drop that is too fast for the reference', () => {
    const session = createRepSession({ routine: 'sit-drop', ref: REF });
    const events = run(session, synthStream([{ impactSpeed: 1.0 }, {}], 22));
    const rep = events.find((e) => e.kind === 'rep');
    expect(rep?.kind === 'rep' && rep.result.ok && rep.result.issues).toContain('too-fast');
    expect(cues(events).find((c) => c.key === 'rep-rejected')?.text).toBe(rejectMessage('too-fast'));
  });
});

describe('createRepSession lean scoring', () => {
  it('captures a lean mismatch and coaches from its first scoring issue', () => {
    const session = createRepSession({ routine: 'sit-drop', ref: REF });
    const events = run(session, synthStream([{ leanDeg: 40, seed: 1 }, { seed: 1 }], 22));
    const rep = events.find((event) => event.kind === 'rep');

    expect(rep?.kind === 'rep' && rep.result.ok && rep.result.issues[0]).toBe('lean-too-much');
    expect(cues(events).find((cue) => cue.key === 'rep-rejected')?.text).toBe(rejectMessage('lean-too-much'));
  });
});

const REASONS: RejectReason[] = [
  'not-still',
  'lean-too-much',
  'lean-too-little',
  'too-fast',
  'too-slow',
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
    expect(rejectMessage('lean-too-much')).toBe('Lean a bit less.');
    expect(rejectMessage('lean-too-little')).toBe('Lean a bit more.');
  });
});
