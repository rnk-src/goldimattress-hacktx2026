import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Coach } from '../coach';
import type { Cue, Sample, Trace } from '../domain';
import { createReplaySource, parseRecording } from '../sensors';
import { DEFAULT_RIG, analyzeRep, routineSpec } from '../signal';
import type { SensorSource } from '../sensors';
import type { Store } from '../store';
import { startApp } from './index';

const spec = routineSpec('sit-drop');
const WINDOW_MS = (spec.preRollS + spec.captureS + 1) * 1_000;
const REST_MS = spec.restS * 1_000;
const READY_MS = 10_000;

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
  vi.restoreAllMocks();
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

/** A 60 Hz still hover whose lean from the phone's y axis steps from `before` to `after` degrees at `switchS`. */
function leanTrace(before: number, after: number, switchS: number, durationS = 40): Trace {
  const samples: Sample[] = Array.from({ length: durationS * 60 + 1 }, (_, index) => {
    const t = index / 60;
    const rad = ((t < switchS ? before : after) * Math.PI) / 180;
    return { t, ax: 0, ay: 9.81 * Math.cos(rad), az: 9.81 * Math.sin(rad) };
  });
  return { routine: 'sit-drop', sampleRateHz: 60, device: 'Replay phone', startedAt: '2026-10-24T16:00:00.000Z', samples };
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

  it('runs five routine-length captures with routine rests from one tap', async () => {
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
    const windows = () => cues.filter((cue) => cue.key === 'drop-when-ready' || cue.key === 'captured');
    expect(cues.map((cue) => cue.key)).toEqual(['place-phone']);
    await vi.advanceTimersByTimeAsync(READY_MS);
    expect(windows().map((cue) => cue.beep)).toEqual(['ready']);

    for (let repetition = 0; repetition < 5; repetition += 1) {
      await vi.advanceTimersByTimeAsync(WINDOW_MS);
      expect(windows().at(-1)?.beep).toBe('captured');
      if (repetition === 4) break;
      await vi.advanceTimersByTimeAsync(REST_MS);
      expect(windows().at(-1)?.beep).toBe('ready');
    }

    expect(windows().map((cue) => cue.beep)).toEqual([
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
    const exported: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exported.push(blob as Blob);
      return 'blob:test';
    });
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
    await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS + 1_000);

    const download = root.querySelector<HTMLAnchorElement>('[data-action="export-recording"]');
    expect(download?.getAttribute('href')).toBe('blob:test');
    const recording = parseRecording(JSON.parse(await exported[0]!.text()));

    expect(recording.label).toBe('showroom set 1');
    expect(recording.surface).toBe('Blue couch');
    expect(recording.traces).toHaveLength(5);
    expect(recording.traces.every((trace) => trace.samples.length > 0)).toBe(true);
    // The window keeps a margin beyond preRollS + captureS so a late drop is still recorded.
    const span = recording.traces[0]!.samples.at(-1)!.t - recording.traces[0]!.samples[0]!.t;
    expect(span).toBeGreaterThan(spec.preRollS + spec.captureS);
  });

  describe('rig-drop capture', () => {
    async function captureRig(setup: (root: HTMLElement) => void): Promise<Trace[]> {
      vi.useFakeTimers();
      const exported: Blob[] = [];
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        exported.push(blob as Blob);
        return 'blob:test';
      });
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
      const routine = root.querySelector<HTMLSelectElement>('[name="routine"]');
      expect(routine).not.toBeNull();
      if (routine) {
        routine.value = 'rig-drop';
        routine.dispatchEvent(new Event('change'));
      }
      setup(root);
      root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
      await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS + 1_000);
      return parseRecording(JSON.parse(await exported[0]!.text())).traces;
    }

    it('records the default rig on each rig-drop trace', async () => {
      const traces = await captureRig(() => {});
      expect(traces).toHaveLength(5);
      for (const trace of traces) {
        expect(trace.routine).toBe('rig-drop');
        expect(trace.rig).toEqual(DEFAULT_RIG);
        expect(() => analyzeRep(trace)).not.toThrow();
      }
    });

    it('tells the user to strap the phone on the slab, not hold it on the chest', async () => {
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
      const routine = root.querySelector<HTMLSelectElement>('[name="routine"]')!;
      routine.value = 'rig-drop';
      routine.dispatchEvent(new Event('change'));
      root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
      expect(root.querySelector('[data-capture-status]')?.textContent).toContain('slab');
      expect(root.querySelector('[data-capture-status]')?.textContent).not.toContain('sternum');
    });

    it.each([
      ['a mistyped mass', 'massKg', '2,5', 'massKg'],
      ['an empty mass', 'massKg', '', 'massKg'],
      ['a zero drop height', 'dropHeightCm', '0', 'dropHeightCm'],
    ])('shows an error and does not start for %s', async (_name, field, value, shown) => {
      vi.useFakeTimers();
      const root = document.createElement('main');
      document.body.append(root);
      window.location.hash = '#/capture';
      const source = createReplaySource(replayTrace(), { realtime: true });
      const start = vi.spyOn(source, 'start');
      startApp(root, {
        source,
        store: store(),
        makeCoach: coach,
        now: () => new Date('2026-10-24T16:00:00.000Z'),
        device: 'Replay phone',
        newId: () => 'test-id',
      });
      const routine = root.querySelector<HTMLSelectElement>('[name="routine"]')!;
      routine.value = 'rig-drop';
      routine.dispatchEvent(new Event('change'));
      root.querySelector<HTMLInputElement>(`[name="${field}"]`)!.value = value;
      const button = root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')!;
      button.click();
      await vi.advanceTimersByTimeAsync(READY_MS);
      expect(root.querySelector('[data-capture-status]')?.textContent).toContain(shown);
      expect(start).not.toHaveBeenCalled();
      expect(button.disabled).toBe(false);
    });

    it('records the mass, height and spot the user sets', async () => {
      const traces = await captureRig((root) => {
        const set = (name: string, value: string) => {
          root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!.value = value;
        };
        set('massKg', '2.5');
        set('dropHeightCm', '7');
        set('spot', 'seat-middle');
      });
      expect(traces[0]!.rig).toEqual({ ...DEFAULT_RIG, massKg: 2.5, dropHeightCm: 7, spot: 'seat-middle' });
    });
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
    expect(progress?.querySelector('[data-state="active"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(READY_MS);
    expect(progress?.querySelector('[data-state="active"]')?.textContent).toContain('1');

    await vi.advanceTimersByTimeAsync(WINDOW_MS + REST_MS + 1_000);
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

  it('lets the user retry when the motion permission request rejects', async () => {
    const source: SensorSource = {
      requestAccess: () => Promise.reject(new Error('NotAllowedError')),
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

    const button = root.querySelector<HTMLButtonElement>('[data-action="request-motion"]');
    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button?.disabled).toBe(false);
    expect(root.textContent).toContain('Could not request motion access');
  });

  it('stops early when no motion events arrive', async () => {
    vi.useFakeTimers();
    const awake: boolean[] = [];
    let stops = 0;
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start() {},
      stop() {
        stops += 1;
      },
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source,
      store: store(),
      makeCoach: () => ({
        play() {},
        keepAwake: (on) => {
          awake.push(on);
          return Promise.resolve();
        },
        setMuted() {},
        dispose() {},
      }),
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    const start = root.querySelector<HTMLButtonElement>('[data-action="start-capture"]');
    start?.click();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(root.textContent).toContain('No motion events arrived');
    expect(start?.disabled).toBe(false);
    expect(stops).toBe(1);
    expect(awake).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS + 1_000);
    expect(root.textContent).not.toContain('Capture complete');
  });

  it('exports the repetitions it did capture when some windows are empty', async () => {
    vi.useFakeTimers();
    const exported: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exported.push(blob as Blob);
      return 'blob:partial';
    });
    let onSample: ((sample: Sample) => void) | undefined;
    const source: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start(callback) {
        onSample = callback;
      },
      stop() {},
      sampleRateHz: null,
    };
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source,
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'test phone',
      newId: () => 'test-id',
    });

    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    let t = 0;
    onSample?.({ t, ax: 0, ay: 9.81, az: 0 });
    await vi.advanceTimersByTimeAsync(READY_MS);
    // Samples flow during the first three windows only.
    for (let rep = 0; rep < 5; rep += 1) {
      if (rep < 3) {
        for (let i = 0; i < 4; i += 1) {
          t += 1;
          onSample?.({ t, ax: 0, ay: 9.81, az: 0 });
          await vi.advanceTimersByTimeAsync(1_000);
        }
        await vi.advanceTimersByTimeAsync(WINDOW_MS - 4_000);
      } else {
        await vi.advanceTimersByTimeAsync(WINDOW_MS);
      }
      await vi.advanceTimersByTimeAsync(REST_MS);
    }

    expect(root.textContent).toContain('Captured 3 of 5');
    const recording = parseRecording(JSON.parse(await exported[0]!.text()));
    expect(recording.traces).toHaveLength(3);
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
    await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS + 1_000);
    expect(stops).toBe(1);
    expect(root.textContent).not.toContain('Capture complete');
  });
});

describe('raw capture countdown and timing', () => {
  function mountCapture(label = '', surface = '', source: SensorSource = createReplaySource(replayTrace(), { realtime: true })) {
    vi.useFakeTimers();
    const cues: Cue[] = [];
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    startApp(root, {
      source,
      store: store(),
      makeCoach: () => ({ ...coach(), play: (cue) => void cues.push(cue) }),
      now: () => new Date(),
      device: 'Replay phone',
      newId: () => 'test-id',
    });
    const set = (name: string, value: string) => {
      const input = root.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) input.value = value;
    };
    if (label !== '') set('label', label);
    if (surface !== '') set('surface', surface);
    const countdown = () => root.querySelector('[data-countdown]')?.textContent ?? '';
    const start = () => root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    return { root, countdown, start, cues };
  }

  it('shows the phone angle and asks to hold it upright when it lies flat', async () => {
    const { root, start, cues } = mountCapture('', '', createReplaySource(leanTrace(70, 70, 0), { realtime: true }));
    start();
    await vi.advanceTimersByTimeAsync(2_000);
    const position = root.querySelector('[data-phone-position]');
    expect(position?.getAttribute('data-state')).toBe('off');
    expect(position?.textContent).toContain('70');
    expect(cues.find((c) => c.key === 'phone-off')?.text).toContain('breastbone');
  });

  it('confirms an upright phone once', async () => {
    const { root, start, cues } = mountCapture('', '', createReplaySource(leanTrace(20, 20, 0), { realtime: true }));
    start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(root.querySelector('[data-phone-position]')?.getAttribute('data-state')).toBe('ok');
    expect(cues.filter((c) => c.key === 'phone-ok')).toHaveLength(1);
    expect(cues.some((c) => c.key === 'phone-off')).toBe(false);
  });

  it('does not judge the angle while a drop window records, but does again during the rest', async () => {
    const { start, cues } = mountCapture('', '', createReplaySource(leanTrace(20, 70, 10.5), { realtime: true }));
    start();
    await vi.advanceTimersByTimeAsync(READY_MS + 3_000);
    expect(cues.some((c) => c.key === 'phone-off')).toBe(false);
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(cues.some((c) => c.key === 'phone-off')).toBe(true);
  });

  it('does not cue the phone angle while the phone is being moved', async () => {
    const shaky = leanTrace(70, 70, 0);
    shaky.samples.forEach((s, i) => (s.ay += i % 2 === 0 ? 4 : -4));
    const { root, start, cues } = mountCapture('', '', createReplaySource(shaky, { realtime: true }));
    start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cues.some((c) => c.key === 'phone-off' || c.key === 'phone-ok')).toBe(false);
    expect(root.querySelector('[data-phone-position]')?.getAttribute('data-state')).toBe('idle');
  });

  it('counts down the get-ready period before the first window', async () => {
    const { root, countdown, start } = mountCapture();
    start();
    expect(countdown()).toBe('Get ready: first drop window opens in 10 s');
    expect(root.querySelector('[data-rep-label]')?.textContent).toBe('Rep 1 of 5');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(countdown()).toBe('Get ready: first drop window opens in 7 s');
  });

  it('counts down the recording window and the rest between reps', async () => {
    const { root, countdown, start } = mountCapture();
    start();
    await vi.advanceTimersByTimeAsync(READY_MS);
    const windowS = WINDOW_MS / 1_000;
    expect(countdown()).toBe(`Recording: ${windowS} s left, drop now when ready`);
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 4_000);
    expect(countdown()).toBe('Recording: 4 s left, drop now when ready');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(countdown()).toBe(`Rest: next rep opens in ${REST_MS / 1_000} s. Get back into the hover.`);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(countdown()).toContain(`opens in ${REST_MS / 1_000 - 3} s`);
    expect(root.querySelector('[data-rep-label]')?.textContent).toContain('2 of 5');
    await vi.advanceTimersByTimeAsync(REST_MS - 3_000);
    expect(countdown()).toContain('Recording:');
    expect(root.querySelector('[data-rep-label]')?.textContent).toBe('Rep 2 of 5');
  });

  it('finishes straight after the fifth window with no rest or countdown', async () => {
    const { root, countdown, start } = mountCapture();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:done');
    start();
    await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS);
    expect(root.querySelector('[data-action="export-recording"]')).not.toBeNull();
    expect(root.textContent).toContain('Capture complete');
    expect(countdown()).toBe('');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(countdown()).toBe('');
  });

  it('beeps the last 3 seconds before each window and cues the get-ready start', async () => {
    const { cues, start } = mountCapture();
    start();
    expect(cues.map((c) => [c.key, c.beep])).toEqual([['place-phone', undefined]]);
    expect(cues[0]?.text).toContain('Get ready');
    await vi.advanceTimersByTimeAsync(READY_MS - 4_000);
    expect(cues).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    const ticks = () => cues.filter((c) => c.key === 'next-rep');
    expect(ticks().map((c) => c.beep)).toEqual(['ready', 'ready', 'ready']);
    expect(ticks().every((c) => c.text === '')).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cues.at(-1)?.key).toBe('drop-when-ready');
    // No count-in beeps inside the window; three more before rep 2.
    await vi.advanceTimersByTimeAsync(WINDOW_MS + REST_MS - 4_000);
    expect(ticks()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(ticks()).toHaveLength(6);
  });

  it('keeps the window exact and the countdown true when display ticks run late', async () => {
    const { countdown, start, cues } = mountCapture();
    start();
    await vi.advanceTimersByTimeAsync(READY_MS);
    vi.setSystemTime(Date.now() + 3_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(countdown()).toBe(`Recording: ${WINDOW_MS / 1_000 - 4} s left, drop now when ready`);
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1_001);
    expect(cues.some((c) => c.key === 'captured')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(cues.some((c) => c.key === 'captured')).toBe(true);
  });

  it('marks a rep complete when its window closes and leaves the next one pending', async () => {
    const { root, start } = mountCapture();
    start();
    await vi.advanceTimersByTimeAsync(READY_MS + WINDOW_MS);
    const rail = root.querySelector('[data-repetition-progress]');
    expect(rail?.querySelectorAll('li')).toHaveLength(5);
    expect(rail?.children[0]?.getAttribute('data-state')).toBe('complete');
    expect(rail?.children[1]?.getAttribute('data-state')).toBe('pending');
    expect(rail?.querySelector('[aria-current]')).toBeNull();
  });

  it('clears the countdown and rep label when the no-motion check aborts', async () => {
    const silent: SensorSource = {
      requestAccess: () => Promise.resolve('granted'),
      start() {},
      stop() {},
      sampleRateHz: null,
    };
    const { root, countdown, start } = mountCapture('', '', silent);
    start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(root.textContent).toContain('No motion events arrived');
    expect(countdown()).toBe('');
    expect(root.querySelector('[data-rep-label]')?.textContent).toBe('Rep 1 of 5');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(countdown()).toBe('');
  });

  it('announces phases in the live region and keeps the ticking number out of it', () => {
    const { root, start } = mountCapture();
    start();
    const countdown = root.querySelector('[data-countdown]');
    expect(countdown?.closest('[aria-live]')).toBeNull();
    expect(root.querySelector('[data-capture-status]')?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('export file name', () => {
  async function exportedName(label: string, surface: string) {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:name');
    const root = document.createElement('main');
    document.body.append(root);
    window.location.hash = '#/capture';
    vi.useFakeTimers();
    startApp(root, {
      source: createReplaySource(replayTrace(), { realtime: true }),
      store: store(),
      makeCoach: coach,
      now: () => new Date('2026-10-24T16:00:00.000Z'),
      device: 'Replay phone',
      newId: () => 'test-id',
    });
    const set = (name: string, value: string) => {
      root.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    };
    set('label', label);
    set('surface', surface);
    root.querySelector<HTMLButtonElement>('[data-action="start-capture"]')?.click();
    await vi.advanceTimersByTimeAsync(READY_MS + 5 * WINDOW_MS + 4 * REST_MS);
    return root.querySelector('[data-action="export-recording"]')?.getAttribute('download');
  }

  it.each([
    ['Showroom set 1', 'Blue couch', 'goldimattress-recording-showroom-set-1-blue-couch.json'],
    ['  A&B!!  ', 'Café #2 (new)', 'goldimattress-recording-a-b-caf-2-new.json'],
    ['sofa 🛋️ test', '😴', 'goldimattress-recording-sofa-test-unnamed-surface.json'],
    ['', '   ', 'goldimattress-recording-raw-capture-unnamed-surface.json'],
    ['x'.repeat(80), 'y'.repeat(80), `goldimattress-recording-${'x'.repeat(30)}-${'y'.repeat(30)}.json`],
  ])('names the download from %j and %j', async (label, surface, expected) => {
    expect(await exportedName(label, surface)).toBe(expected);
  });
});
