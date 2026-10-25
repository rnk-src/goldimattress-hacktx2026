import { describe, expect, it } from 'vitest';
import type { Cue, ReferenceStats, RejectReason, Sample } from '../domain';
import { synthStream } from '../testkit';
import { createRepSession, positionCue, rejectMessage } from './index';
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

  it('arms with a drop cue once the hover is still, then reports capturing at the drop', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{}]).slice(0, 55));
    expect(keys(events)).toEqual(['place-phone', 'phone-ok', 'drop-when-ready']);
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
    expect(keys(events).slice(0, 5)).toEqual(['place-phone', 'phone-ok', 'drop-when-ready', 'captured', 'rep-accepted']);
    const span = reps[0]!.trace.samples.at(-1)!.t - reps[0]!.trace.samples[0]!.t;
    expect(span).toBeGreaterThan(4.5);
    expect(span).toBeLessThan(5.5);
  });

  it('rests after a rep and ignores a drop that arrives during the rest', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, synthStream([{}, {}], 8));
    expect(keys(events)).toEqual(['place-phone', 'phone-ok', 'drop-when-ready', 'captured', 'rep-accepted', 'rest', 'rest']);
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

    expect(reps[1]?.restSkipped).toBe(false);
    expect(reps[1]?.restS).toBeGreaterThanOrEqual(20);
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
    expect(reps[1]?.restSkipped).toBe(true);
    expect(reps[1]?.restS).toBeGreaterThan(0);
    expect(reps[1]?.restS).toBeLessThan(20);
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

  it('lets the user finish at three usable reps with low confidence', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    let events: SessionEvent[] = [];
    for (const sample of synthStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 4 }], 22)) {
      const next = session.push(sample);
      if (next.some((event) => event.kind === 'rep') && session.accepted === 3) {
        events = session.finishNow();
        break;
      }
    }

    expect(session.accepted).toBe(3);
    expect(events.at(-1)).toMatchObject({ kind: 'done', outcome: 'low-confidence' });
    expect(cues(events).at(-1)?.text).toContain('low confidence');
    expect(session.state).toBe('done');
  });

  it('does not finish while an attempt is being captured', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const stream = synthStream(Array.from({ length: 5 }, (_, index) => ({ seed: index + 1 })), 22);
    for (const sample of stream) {
      session.push(sample);
      if (session.accepted >= 3 && session.state === 'capturing') break;
    }

    expect(session.accepted).toBe(3);
    expect(session.state).toBe('capturing');
    expect(session.finishNow()).toEqual([]);
    expect(session.state).toBe('capturing');
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

const stats = (center: number) => ({ center, mad: 0.1 });
/** A reference matching the testkit defaults: 15 degree lean, 0.6 m/s impact. */
const REF: ReferenceStats = {
  routine: 'sit-drop',
  repCount: 5,
  createdAt: '2026-10-24T16:00:00.000Z',
  features: { peak: stats(12), peakOverV: stats(20), stopTime: stats(0.2), bounceRatio: stats(0.4), settleTime: stats(2) },
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

/** A still hover at a given lean from the phone's y axis (upright on the sternum is 0 degrees), 60 Hz. */
function hoverAt(leanDeg: number, fromT: number, seconds: number): Sample[] {
  const rad = (leanDeg * Math.PI) / 180;
  return Array.from({ length: Math.round(seconds * 60) }, (_, i) => ({
    t: fromT + i / 60,
    ax: 0,
    ay: 9.81 * Math.cos(rad),
    az: 9.81 * Math.sin(rad),
  }));
}

describe('createRepSession phone position cue', () => {
  it('asks to hold the phone against the breastbone when it lies flat, and does not arm', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, hoverAt(70, 0, 2));
    expect(keys(events)).toContain('phone-off');
    expect(cues(events).find((c) => c.key === 'phone-off')?.text).toContain('breastbone');
    expect(keys(events)).not.toContain('drop-when-ready');
    expect(session.state).toBe('holding');
  });

  it('confirms the position once when the phone is upright, then arms', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, hoverAt(30, 0, 2));
    expect(keys(events)).toEqual(['place-phone', 'phone-ok', 'drop-when-ready']);
  });

  it('confirms again after the phone was off, and only once it is clearly back in range', () => {
    const session = createRepSession({ routine: 'sit-drop' });
    const events = run(session, [...hoverAt(60, 0, 1), ...hoverAt(53, 1, 1), ...hoverAt(45, 2, 1)]);
    expect(keys(events)).toEqual(['place-phone', 'phone-off', 'phone-ok', 'drop-when-ready']);
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

describe('rejectMessage for rig reasons', () => {
  it.each(['flight-mismatch', 'tilted-landing'] as const)('gives %s a fix message', (reason) => {
    expect(rejectMessage(reason)).toMatch(/\S/);
  });
});

describe('createRepSession rig-drop', () => {
  const RIG = { massKg: 2.1, baseCm: [17.5, 9] as [number, number], dropHeightCm: 5, spot: 'center' as const };
  const rigRep = { routine: 'rig-drop' as const, dropHeightCm: 5, sampleRateHz: 57, durationS: 5 };

  it('runs synthetic rig reps to done with no taps, stamping the rig on each trace', () => {
    const session = createRepSession({ routine: 'rig-drop', goal: 3, rig: RIG });
    const events = run(session, synthStream([rigRep, rigRep, rigRep], 20));
    expect(session.state).toBe('done');
    expect(events.at(-1)?.kind).toBe('done');
    const reps = events.flatMap((e) => (e.kind === 'rep' ? [e.result] : []));
    expect(reps).toHaveLength(3);
    for (const r of reps) {
      expect(r.ok).toBe(true);
      expect(r.trace.rig).toEqual(RIG);
    }
  });

  it('uses the rig wording for the place, level and release cues', () => {
    const session = createRepSession({ routine: 'rig-drop' });
    const events = run(session, synthStream([rigRep]).slice(0, 80));
    const text = (key: string) => cues(events).find((c) => c.key === key)?.text;
    expect(text('place-phone')).toBe('Strap the phone face up on the slab and rest the slab on the spacer.');
    expect(text('drop-when-ready')).toBe('Let go with both hands.');
    expect(positionCue('off').text).toBe('Hold the phone upright against your breastbone, screen facing out.');
    expect(positionCue('off', 'rig-drop').text).toBe('Hold the slab level.');
    expect(positionCue('ok', 'rig-drop').text).toBe('Slab level. Hold still.');
  });

  it('says to hold the slab level when it tilts past 20 degrees', () => {
    const session = createRepSession({ routine: 'rig-drop' });
    const events = run(session, synthStream([{ ...rigRep, leanDeg: 25 }]).slice(0, 80));
    expect(cues(events).find((c) => c.key === 'phone-off')?.text).toBe('Hold the slab level.');
    expect(session.state).toBe('holding');
  });

  it('does not arm or capture early on a jittery hold', () => {
    const session = createRepSession({ routine: 'rig-drop' });
    const events = run(session, synthStream([{ ...rigRep, failure: 'moving-hover' }]).slice(0, 57));
    const states = events.flatMap((e) => (e.kind === 'state' ? [e.state] : []));
    expect(states).not.toContain('armed');
    expect(states).not.toContain('capturing');
    expect(events.some((e) => e.kind === 'rep')).toBe(false);
    expect(keys(events)).toContain('hold-still');
  });
});
