import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Coach } from '../coach';
import type { Cue, Sample, Trace } from '../domain';
import { createReplaySource, parseRecording } from '../sensors';
import type { SensorSource } from '../sensors';
import type { Store } from '../store';
import { startApp } from './index';

function coach(): Coach {
  return {
    play() {},
    async keepAwake() {},
    setMuted() {},
    dispose() {},
  };
}

function store(): Store {
  return {
    listPeople: () => Promise.resolve([]),
    savePerson: () => Promise.resolve(),
    findSurfaces: () => Promise.resolve([]),
    saveSurface: () => Promise.resolve(),
    saveTest: () => Promise.resolve(),
    listTests: () => Promise.resolve([]),
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  window.location.hash = '';
});

function replayTrace(rateHz = 2, durationS = 130): Trace {
  const samples: Sample[] = Array.from({ length: rateHz * durationS + 1 }, (_, index) => ({
    t: index / rateHz,
    ax: index,
    ay: 9.81,
    az: 0,
  }));
  return {
    routine: 'sit-drop',
    sampleRateHz: rateHz,
    device: 'Replay phone',
    startedAt: '2026-10-24T16:00:00.000Z',
    samples,
  };
}

describe('startApp', () => {
  it('requests motion access from a tap and opens capture when granted', async () => {
    let requests = 0;
    const source: SensorSource = {
      requestAccess: () => {
        requests += 1;
        return Promise.resolve('granted');
      },
      start() {},
      stop() {},
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/permission';

    startApp(root, {
      source,
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    const button = root.querySelector<HTMLButtonElement>('button[data-action="request-motion"]');
    expect(button).not.toBeNull();
    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(requests).toBe(1);
    expect(window.location.hash).toBe('#/capture');
    expect(root.textContent).toContain('Phone capture');
  });

  it('shows recovery instructions when motion access is denied', async () => {
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('denied'),
      start() {},
      stop() {},
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/permission';

    startApp(root, {
      source,
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="request-motion"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Motion access is blocked');
    expect(root.textContent).toContain('Settings');
    expect(root.textContent).toContain('reload');
  });

  it('explains how to recover when the browser has no motion API', async () => {
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('unsupported'),
      start() {},
      stop() {},
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/permission';

    startApp(root, {
      source,
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="request-motion"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('does not support motion sensors');
    expect(root.textContent).toContain('Safari or Chrome over HTTPS');
  });

  it('runs five six-second captures with twenty-second rests from one tap', async () => {
    vi.useFakeTimers();
    const cues: Cue[] = [];
    const fakeCoach: Coach = {
      play(cue) {
        cues.push(cue);
      },
      async keepAwake() {},
      setMuted() {},
      dispose() {},
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source: createReplaySource(replayTrace(), { realtime: true }),
      store: store(),
      makeCoach: () => fakeCoach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });

    const start = root.querySelector<HTMLButtonElement>('[data-action="start-capture"]');
    expect(start).not.toBeNull();
    start?.click();

    expect(start?.disabled).toBe(true);
    expect(cues.map((cue) => cue.beep)).toEqual(['ready']);

    for (let repetition = 0; repetition < 5; repetition += 1) {
      await vi.advanceTimersByTimeAsync(6_000);
      expect(cues.at(-1)?.beep).toBe('captured');
      await vi.advanceTimersByTimeAsync(20_000);
      if (repetition < 4) expect(cues.at(-1)?.beep).toBe('ready');
    }

    expect(cues.map((cue) => cue.beep)).toEqual([
      'ready',
      'captured',
      'ready',
      'captured',
      'ready',
      'captured',
      'ready',
      'captured',
      'ready',
      'captured',
    ]);
    expect(root.textContent).toContain('Capture complete');
  });

  it('exports the five captured windows as a parseable Recording', async () => {
    vi.useFakeTimers();
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source: createReplaySource(replayTrace(), { realtime: true }),
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });

    const label = root.querySelector<HTMLInputElement>('[name="label"]');
    const surface = root.querySelector<HTMLInputElement>('[name="surface"]');
    expect(label).not.toBeNull();
    expect(surface).not.toBeNull();
    if (label) label.value = 'showroom set 1';
    if (surface) surface.value = 'Blue couch';
    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    await vi.advanceTimersByTimeAsync(130_000);

    const download = root.querySelector<HTMLAnchorElement>('[data-action="export-recording"]');
    expect(download).not.toBeNull();
    const href = download?.getAttribute('href') ?? '';
    const json = decodeURIComponent(href.slice(href.indexOf(',') + 1));
    const recording = parseRecording(JSON.parse(json));

    expect(recording.label).toBe('showroom set 1');
    expect(recording.surface).toBe('Blue couch');
    expect(recording.traces).toHaveLength(5);
    expect(recording.traces.every((trace) => trace.samples.length > 0)).toBe(true);
  });

  it('shows the measured sample rate and event interval', async () => {
    vi.useFakeTimers();
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source: createReplaySource(replayTrace(5), { realtime: true }),
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(root.querySelector('[data-sample-rate]')?.textContent).toContain('5.0 Hz');
    expect(root.querySelector('[data-event-interval]')?.textContent).toContain('200.0 ms');
  });

  it('shows which of the five repetitions is active and complete', async () => {
    vi.useFakeTimers();
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source: createReplaySource(replayTrace(), { realtime: true }),
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });

    const progress = root.querySelector('[data-repetition-progress]');
    expect(progress?.children).toHaveLength(5);
    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    expect(progress?.querySelector('[data-state="active"]')?.textContent).toContain('1');

    await vi.advanceTimersByTimeAsync(26_000);
    expect(progress?.querySelector('[data-state="complete"]')?.textContent).toContain('1');
    expect(progress?.querySelector('[data-state="active"]')?.textContent).toContain('2');
  });

  it('returns to the permission screen when capture starts without motion access', () => {
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start() {
        throw new Error('Motion access has not been granted');
      },
      stop() {},
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    const stop = startApp(root, {
      source,
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(window.location.hash).toBe('#/permission');
    expect(root.querySelector('[data-action="request-motion"]')).not.toBeNull();
    stop();
  });

  it('lets the user mute and restore audio cues', () => {
    const muted: boolean[] = [];
    const fakeCoach: Coach = {
      play() {},
      async keepAwake() {},
      setMuted(value) {
        muted.push(value);
      },
      dispose() {},
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source: createReplaySource(replayTrace()),
      store: store(),
      makeCoach: () => fakeCoach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });

    const toggle = root.querySelector<HTMLButtonElement>('[data-action="toggle-sound"]');
    expect(toggle?.textContent).toContain('Mute cues');
    toggle?.click();
    expect(muted).toEqual([true]);
    expect(toggle?.textContent).toContain('Unmute cues');
    toggle?.click();
    expect(muted).toEqual([true, false]);
  });

  it('stops capture and releases the wake lock when navigating away', async () => {
    vi.useFakeTimers();
    let stops = 0;
    const awake: boolean[] = [];
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start() {},
      stop() {
        stops += 1;
      },
      sampleRateHz: null,
    };
    const fakeCoach: Coach = {
      play() {},
      async keepAwake(on) {
        awake.push(on);
      },
      setMuted() {},
      dispose() {},
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source,
      store: store(),
      makeCoach: () => fakeCoach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    window.location.hash = '#/permission';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(stops).toBe(1);
    expect(awake).toEqual([true, false]);
    expect(root.textContent).toContain('Enable motion');
    await vi.advanceTimersByTimeAsync(130_000);
    expect(stops).toBe(1);
    expect(root.textContent).not.toContain('Capture complete');
  });
});
