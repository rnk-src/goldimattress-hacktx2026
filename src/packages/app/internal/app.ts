import type { Coach } from '../../coach';
import type { Recording, Sample, Trace } from '../../domain';
import { serializeRecording } from '../../sensors';
import type { Access } from '../../sensors';
import { positionCue } from '../../session';
import { assessHover, createPositionTracker, routineSpec } from '../../signal';
import { calibrateView } from './calibrate';
import { shortDeviceModel, withRepMetadata } from './metadata';
import { mountProfileScreen } from './profile';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';

export type { AppDeps };

// Raw capture records sit-drops, so it reads the sit-drop timings.
const CAPTURE_SPEC = routineSpec('sit-drop');
/** Extra seconds so a drop that comes a little late still lands inside the window. */
const LATE_DROP_MARGIN_S = 1;
/**
 * Seconds to get into the hover before the first window opens.
 * shortcut: fixed 10 s, not a setting; make it an input if people need longer to get into position.
 */
const READY_S = 10;
const REPS = 5;
/** The last seconds before a window opens that each get a beep. */
const COUNT_IN_BEEPS = 3;
const WINDOW_S = CAPTURE_SPEC.preRollS + CAPTURE_SPEC.captureS + LATE_DROP_MARGIN_S;
const REST_S = CAPTURE_SPEC.restS;


/** Lowercase letters and digits only, dashes between words, capped at 30 characters. */
function fileNamePart(text: string, fallback: string): string {
  const part = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30)
    .replace(/^-+|-+$/g, '');
  return part || fallback;
}

function permissionView(root: HTMLElement, deps: AppDeps, getCoach: () => Coach): void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Raw capture')}
      <main class="app-main permission-view">
        <section class="permission-copy" aria-labelledby="permission-title">
          <h1 id="permission-title">Enable motion</h1>
          <p class="lead">Your phone’s accelerometer records five hands-free sit-drop windows. Access begins only after you tap below.</p>
          <div class="protocol" aria-label="Five repetitions, each ${WINDOW_S} seconds with a ${REST_S}-second rest">
            <span>5 repetitions</span><span>${WINDOW_S} s record</span><span>${REST_S} s rest</span>
          </div>
        </section>
        <section class="permission-action" aria-label="Motion permission">
          <button class="button button--primary" type="button" data-action="request-motion">Allow motion access</button>
          <p data-permission-status class="permission-status" role="status" aria-live="polite"></p>
          <p class="privacy-note">Raw acceleration stays on this device unless you export the JSON file.</p>
        </section>
        <nav class="home-links" aria-label="Screens">
          <a href="#/calibrate">Calibrate a surface</a>
          <a href="#/profile">Profiles</a>
          <a href="#/capture">Raw capture</a>
        </nav>
        <aside class="safety-note" aria-labelledby="safety-title">
          <h2 id="safety-title">Before you drop</h2>
          <ul>
            <li>Hover no more than 10 cm above the surface.</li>
            <li>Check beneath loose cushions before testing.</li>
            <li>Skip this test if dropping could aggravate back pain.</li>
          </ul>
        </aside>
      </main>
    </div>
  `;

  const button = root.querySelector<HTMLButtonElement>('[data-action="request-motion"]');
  const status = root.querySelector<HTMLElement>('[data-permission-status]');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (status) status.textContent = 'Requesting motion access…';
    getCoach();
    let access: Access;
    try {
      access = await deps.source.requestAccess();
    } catch {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (status) status.textContent = 'Could not request motion access. Reload this page and tap the button again.';
      return;
    }
    if (access === 'granted') {
      window.location.hash = '#/capture';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (status) {
      status.textContent =
        access === 'denied'
          ? 'Motion access is blocked. Open Settings, enable Motion & Orientation Access for Safari, then reload this page.'
          : 'This browser does not support motion sensors. Try Safari or Chrome over HTTPS on your phone.';
    }
  });
}

/** The phone angle is read from this much recent time, and only once it holds this many samples, s. */
const POSITION_WINDOW_S = 0.5;
const POSITION_MIN_SAMPLES = 10;

function captureView(
  root: HTMLElement,
  deps: AppDeps,
  getCoach: () => Coach,
  later: (callback: () => void, delayMs: number) => void,
): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Raw capture')}
      <main class="app-main capture-view">
        <header class="capture-heading">
          <div>
            <h1 id="capture-title">Phone capture</h1>
            <p>Hold the phone flat against your sternum. One tap runs the full set.</p>
          </div>
          <button class="button button--quiet" type="button" data-action="toggle-sound" aria-pressed="false">Mute cues</button>
        </header>
        <section class="cue-panel" aria-labelledby="capture-title">
          <p data-rep-label class="rep-label">Rep 1 of ${REPS}</p>
          <p data-countdown class="countdown"></p>
          <p data-capture-status class="cue-panel__text" role="status" aria-live="polite">Ready for ${REPS} repetitions.</p>
          <p data-phone-position data-state="idle" class="cue-panel__text" role="status" aria-live="polite">Phone angle appears here once the capture starts.</p>
          <ol class="repetition-rail" data-repetition-progress aria-label="Capture progress">
            ${Array.from({ length: REPS }, (_, i) => `<li data-state="pending"><span>${i + 1}</span><span class="sr-only">Repetition ${i + 1}</span></li>`).join('')}
          </ol>
        </section>
        <dl class="measurement-strip" aria-label="Live sensor timing">
          <div><dt>Sample rate</dt><dd data-sample-rate>Measuring…</dd></div>
          <div><dt>Event interval</dt><dd data-event-interval>Measuring…</dd></div>
        </dl>
        <section class="capture-setup" aria-labelledby="setup-title">
          <h2 id="setup-title">Recording details</h2>
          <div class="field-grid">
            <label><span>Recording label</span><input name="label" value="Raw capture" maxlength="80" autocomplete="off"></label>
            <label><span>Surface</span><input name="surface" value="Unnamed surface" maxlength="80" autocomplete="off"></label>
          </div>
          <button class="button button--primary" type="button" data-action="start-capture">Start ${REPS}-rep capture</button>
          <div class="export-slot" data-export></div>
        </section>
        <p class="capture-footnote">Keep this page visible until all ${REPS} markers are complete. Audio and on-screen cues occur together.</p>
      </main>
    </div>
  `;

  const button = root.querySelector<HTMLButtonElement>('[data-action="start-capture"]');
  const status = root.querySelector<HTMLElement>('[data-capture-status]');
  const label = root.querySelector<HTMLInputElement>('[name="label"]');
  const surface = root.querySelector<HTMLInputElement>('[name="surface"]');
  const exportSlot = root.querySelector<HTMLElement>('[data-export]');
  const sampleRate = root.querySelector<HTMLElement>('[data-sample-rate]');
  const eventInterval = root.querySelector<HTMLElement>('[data-event-interval]');
  const progress = Array.from(root.querySelectorAll<HTMLElement>('[data-repetition-progress] li'));
  const sound = root.querySelector<HTMLButtonElement>('[data-action="toggle-sound"]');
  const countdown = root.querySelector<HTMLElement>('[data-countdown]');
  const repLabel = root.querySelector<HTMLElement>('[data-rep-label]');
  const position = root.querySelector<HTMLElement>('[data-phone-position]');
  let muted = false;
  let running = false;
  let exportUrl: string | undefined;
  sound?.addEventListener('click', () => {
    muted = !muted;
    getCoach().setMuted(muted);
    sound.setAttribute('aria-pressed', String(muted));
    sound.textContent = muted ? 'Unmute cues' : 'Mute cues';
  });
  button?.addEventListener('click', () => {
    const traces: Trace[] = [];
    let activeSamples: Sample[] | undefined;
    let startedAt = '';
    let received = 0;
    let aborted = false;
    const tracker = createPositionTracker('sit-drop');
    /** The last half second of samples outside a drop window, to read the phone angle from. */
    const recent: Sample[] = [];
    const judgePosition = (sample: Sample) => {
      recent.push(sample);
      while (recent[0]!.t < sample.t - POSITION_WINDOW_S) recent.shift();
      if (recent.length < POSITION_MIN_SAMPLES) return;
      const hover = assessHover(recent, 'sit-drop');
      // A phone being picked up or set down has no angle to judge.
      if (!hover.still) return;
      const angle = Math.round(hover.leanDeg);
      const placed = tracker.update(angle);
      if (position) {
        position.dataset.state = placed.off ? 'off' : 'ok';
        position.textContent = placed.off
          ? `Phone angle ${angle}°. Hold it upright against your breastbone, screen facing out.`
          : `Phone angle ${angle}°. Good.`;
      }
      if (placed.event) getCoach().play(positionCue(placed.event));
    };
    try {
      deps.source.start((sample) => {
        received += 1;
        if (activeSamples) activeSamples.push(sample);
        else judgePosition(sample);
        const rate = deps.source.sampleRateHz;
        if (rate !== null) {
          if (sampleRate) sampleRate.textContent = `${rate.toFixed(1)} Hz`;
          const interval = deps.source.eventIntervalMs ?? 1_000 / rate;
          if (eventInterval) eventInterval.textContent = `${interval.toFixed(1)} ms`;
        }
      });
    } catch {
      // Motion access is missing (for example after a reload on this route).
      window.location.hash = '#/permission';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    button.disabled = true;
    running = true;
    const coach = getCoach();
    void coach.keepAwake(true);
    let repetition = 0;

    /** Bumped when a phase ends or starts, so the old phase's display ticks stop. */
    let phaseId = 0;
    const resetDisplay = () => {
      if (countdown) countdown.textContent = '';
      if (repLabel) repLabel.textContent = `Rep 1 of ${REPS}`;
    };

    /**
     * Runs one phase. A single timer ends it after the real length, so the window is exact.
     * The display ticks only render: they read the time left from a deadline, so a late tick still shows the truth.
     * With `beepLast`, the last 3 seconds each play one short beep, since the person cannot look at the screen.
     */
    const phase = (seconds: number, text: (left: number) => string, then: () => void, beepLast = false) => {
      phaseId += 1;
      const id = phaseId;
      const deadline = deps.now().getTime() + seconds * 1_000;
      const beeped = new Set<number>();
      const render = () => {
        if (aborted || id !== phaseId) return;
        const left = Math.max(0, Math.ceil((deadline - deps.now().getTime()) / 1_000));
        if (countdown) countdown.textContent = text(left);
        if (beepLast && left >= 1 && left <= COUNT_IN_BEEPS && !beeped.has(left)) {
          beeped.add(left);
          coach.play({ key: 'next-rep', text: '', beep: 'ready' });
        }
        later(render, 1_000);
      };
      render();
      later(() => {
        if (aborted) return;
        phaseId += 1;
        then();
      }, seconds * 1_000);
    };

    const finish = () => {
      resetDisplay();
      deps.source.stop();
      void coach.keepAwake(false);
      running = false;
      if (traces.length === REPS) {
        progress.forEach((item) => {
          item.dataset.state = 'complete';
          item.removeAttribute('aria-current');
        });
      }
      if (traces.length > 0) {
        const recording: Recording = {
          version: 1,
          label: label?.value.trim() || 'Raw capture',
          surface: surface?.value.trim() || 'Unnamed surface',
          traces,
        };
        const fileName = `goldimattress-recording-${fileNamePart(recording.label, 'raw-capture')}-${fileNamePart(recording.surface, 'unnamed-surface')}.json`;
        if (exportUrl) URL.revokeObjectURL(exportUrl);
        exportUrl = URL.createObjectURL(new Blob([serializeRecording(recording)], { type: 'application/json' }));
        if (exportSlot) {
          exportSlot.innerHTML = `<a class="button button--export" data-action="export-recording" download="${fileName}">Export Recording JSON</a>`;
          exportSlot.querySelector('a')?.setAttribute('href', exportUrl);
        }
        if (status) {
          status.textContent =
            traces.length === REPS
              ? 'Capture complete'
              : `Captured ${traces.length} of ${REPS} repetitions. Some windows had no motion events; export what was recorded or try again.`;
        }
      } else if (status) {
        status.textContent = 'Capture ended without enough motion events. Keep this page visible and try again.';
      }
    };

    const record = () => {
      repetition += 1;
      progress.forEach((item, index) => {
        const state = index < repetition - 1 ? 'complete' : index === repetition - 1 ? 'active' : 'pending';
        item.dataset.state = state;
        if (state === 'active') item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      activeSamples = [];
      recent.length = 0;
      startedAt = deps.now().toISOString();
      const readyText = `Repetition ${repetition} of ${REPS}. Recording for ${WINDOW_S} seconds.`;
      if (status) status.textContent = readyText;
      if (repLabel) repLabel.textContent = `Rep ${repetition} of ${REPS}`;
      coach.play({ key: 'drop-when-ready', text: readyText, beep: 'ready' });
      phase(WINDOW_S, (n) => `Recording: ${n} s left, drop now when ready`, () => {
        const samples = activeSamples;
        activeSamples = undefined;
        const first = samples?.[0];
        const last = samples?.at(-1);
        if (samples && first && last && last.t > first.t) {
          traces.push({
            routine: 'sit-drop',
            sampleRateHz: (samples.length - 1) / (last.t - first.t),
            device: shortDeviceModel(deps.device),
            startedAt,
            samples: samples.map((sample) => ({ ...sample, t: sample.t - first.t })),
          });
        }
        const item = progress[repetition - 1];
        if (item) {
          item.dataset.state = 'complete';
          item.removeAttribute('aria-current');
        }
        const finalRep = repetition === REPS;
        const capturedText = finalRep
          ? `Repetition ${repetition} captured.`
          : `Repetition ${repetition} captured. Rest for ${REST_S} seconds.`;
        if (status) status.textContent = capturedText;
        coach.play({ key: 'captured', text: capturedText, beep: 'captured' });
        if (finalRep) {
          finish();
          return;
        }
        if (repLabel) repLabel.textContent = `Next: rep ${repetition + 1} of ${REPS}`;
        phase(REST_S, (n) => `Rest: next rep opens in ${n} s. Get back into the hover.`, record, true);
      });
    };

    if (status) status.textContent = 'Get ready. Hold the phone flat on your sternum and get into the hover.';
    coach.play({ key: 'place-phone', text: 'Get ready. Get into the hover.' });
    phase(READY_S, (n) => `Get ready: first drop window opens in ${n} s`, record, true);

    later(() => {
      if (received > 0) return;
      aborted = true;
      running = false;
      deps.source.stop();
      void coach.keepAwake(false);
      progress.forEach((item) => {
        item.dataset.state = 'pending';
        item.removeAttribute('aria-current');
      });
      resetDisplay();
      if (status) status.textContent = 'No motion events arrived. Use a phone with motion sensors and try again.';
      button.disabled = false;
    }, 2_000);
  });

  return () => {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    if (!running) return;
    running = false;
    deps.source.stop();
    void getCoach().keepAwake(false);
  };
}

const ROUTES = ['#/permission', '#/capture', '#/calibrate', '#/profile'];

function profileView(root: HTMLElement, deps: AppDeps): () => void {
  root.innerHTML = `<div class="app-shell">${brandHeader('Profiles')}<main class="app-main profile-view"><h1>Profiles</h1></main></div>`;
  const main = root.querySelector<HTMLElement>('main')!;
  const mounted = mountProfileScreen(main, deps).catch(() => {
    main.insertAdjacentHTML('beforeend', '<p role="alert">Could not load the saved profiles.</p>');
    return undefined;
  });
  return () => void mounted.then((unmount) => unmount?.());
}

export function startApp(root: HTMLElement, deps: AppDeps): () => void {
  const appDeps = { ...deps, store: withRepMetadata(deps.store, deps.device, deps.now) };
  root.classList.add('app-root');
  let coach: Coach | undefined;
  let renderedRoute = '';
  let leaveRoute: (() => void) | undefined;
  const timers = new Set<number>();
  const getCoach = () => (coach ??= deps.makeCoach());
  const later = (callback: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
  };
  const clearTimers = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  };

  const render = () => {
    const route = ROUTES.find((r) => r === window.location.hash) ?? '#/permission';
    if (route === renderedRoute) return;
    leaveRoute?.();
    leaveRoute = undefined;
    clearTimers();
    renderedRoute = route;
    if (route === '#/capture') leaveRoute = captureView(root, appDeps, getCoach, later);
    else if (route === '#/calibrate') leaveRoute = calibrateView(root, appDeps, getCoach);
    else if (route === '#/profile') leaveRoute = profileView(root, appDeps);
    else permissionView(root, appDeps, getCoach);
  };

  window.addEventListener('hashchange', render);
  render();

  return () => {
    window.removeEventListener('hashchange', render);
    leaveRoute?.();
    leaveRoute = undefined;
    clearTimers();
    coach?.dispose();
    root.replaceChildren();
    root.classList.remove('app-root');
  };
}
