import { describe, expect, it } from 'vitest';
import { createBrowserCoach } from './index';

function createAudioFake(currentTime = 10) {
  const starts: number[] = [];
  const stops: number[] = [];
  const frequencies: Array<{ value: number; at: number }> = [];
  const gain = {
    gain: {
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    },
    connect: () => undefined,
  };
  const context = {
    currentTime,
    destination: {},
    createGain: () => gain,
    createOscillator: () => ({
      frequency: {
        setValueAtTime: (value: number, at: number) => frequencies.push({ value, at }),
      },
      connect: () => gain,
      start: (at: number) => starts.push(at),
      stop: (at: number) => stops.push(at),
    }),
  } as unknown as AudioContext;

  return { context, frequencies, starts, stops };
}

describe('createBrowserCoach', () => {
  it('speaks the visible coaching text', () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const speech = {
      speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance),
    } as unknown as SpeechSynthesis;
    const coach = createBrowserCoach({
      audio: () => ({}) as AudioContext,
      speech,
    });

    coach.play({ key: 'hold-still', text: 'Hold still' });

    expect(spoken.map((utterance) => utterance.text)).toEqual(['Hold still']);
  });

  it('schedules the requested beep pattern on the audio clock', () => {
    const audio = createAudioFake();
    const coach = createBrowserCoach({ audio: () => audio.context });

    coach.play({ key: 'drop-when-ready', text: 'Begin', beep: 'ready' });

    expect(audio.frequencies).toEqual([{ value: 880, at: 10 }]);
    expect(audio.starts).toEqual([10]);
    expect(audio.stops).toEqual([10.12]);
  });

  it('uses distinct audible contours for captured, accepted, and rejected cues', () => {
    const audio = createAudioFake();
    const coach = createBrowserCoach({ audio: () => audio.context });

    coach.play({ key: 'captured', text: 'Captured', beep: 'captured' });
    coach.play({ key: 'rep-accepted', text: 'Accepted', beep: 'accepted' });
    coach.play({ key: 'rep-rejected', text: 'Try again', beep: 'rejected' });

    expect(audio.frequencies.map(({ value }) => value)).toEqual([660, 740, 988, 330, 260]);
  });

  it('suppresses speech and beeps while muted', () => {
    const audio = createAudioFake();
    const spoken: SpeechSynthesisUtterance[] = [];
    const speech = {
      speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance),
    } as unknown as SpeechSynthesis;
    const coach = createBrowserCoach({ audio: () => audio.context, speech });

    coach.setMuted(true);
    coach.play({ key: 'captured', text: 'Captured', beep: 'captured' });

    expect(spoken).toEqual([]);
    expect(audio.starts).toEqual([]);
  });

  it('acquires and releases the screen wake lock with the session lifecycle', async () => {
    let requests = 0;
    let releases = 0;
    let released = false;
    const sentinel = {
      get released() {
        return released;
      },
      release: () => {
        releases += 1;
        released = true;
        return Promise.resolve();
      },
    } as unknown as WakeLockSentinel;
    const wakeLock = {
      request: async () => {
        requests += 1;
        return sentinel;
      },
    } as WakeLock;
    const coach = createBrowserCoach({
      audio: () => createAudioFake().context,
      wakeLock,
    });

    await coach.keepAwake(true);
    await coach.keepAwake(false);

    expect(requests).toBe(1);
    expect(releases).toBe(1);
  });

  it('re-acquires a released wake lock when the document becomes visible', async () => {
    let requests = 0;
    const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
    const wakeLock = {
      request: async () => {
        requests += 1;
        const sentinel = {
          released: false,
          release: () => {
            sentinel.released = true;
            return Promise.resolve();
          },
        };
        sentinels.push(sentinel);
        return sentinel as WakeLockSentinel;
      },
    } as WakeLock;
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
    const coach = createBrowserCoach({
      audio: () => createAudioFake().context,
      wakeLock,
      doc,
    });

    await coach.keepAwake(true);
    sentinels[0]!.released = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(requests).toBe(2);
  });

  it('releases the wake lock and removes recovery listeners when disposed', async () => {
    let requests = 0;
    let releases = 0;
    let released = false;
    const sentinel = {
      get released() {
        return released;
      },
      release: () => {
        releases += 1;
        released = true;
        return Promise.resolve();
      },
    } as unknown as WakeLockSentinel;
    const wakeLock = {
      request: async () => {
        requests += 1;
        return sentinel;
      },
    } as WakeLock;
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
    const coach = createBrowserCoach({
      audio: () => createAudioFake().context,
      wakeLock,
      doc,
    });

    await coach.keepAwake(true);
    coach.dispose();
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(releases).toBe(1);
    expect(requests).toBe(1);
  });
});
