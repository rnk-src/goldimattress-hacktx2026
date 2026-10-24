import type { Coach } from '../../coach';
import type { Recording, Sample, Trace } from '../../domain';
import { serializeRecording } from '../../sensors';
import type { Access, SensorSource } from '../../sensors';
import type { Store } from '../../store';

export interface AppDeps {
  source: SensorSource;
  store: Store;
  makeCoach: () => Coach;
  now: () => Date;
  device: string;
  newId: () => string;
}

const brandHeader = `
  <header class="product-bar">
    <a class="brand" href="#/permission" aria-label="GoldiMattress home">
      <svg class="brand__mark" viewBox="0 0 36 24" aria-hidden="true">
        <path d="M2 8c4-5 8 5 12 0s8 5 12 0 6 0 8 2" />
        <path d="M2 15c4-5 8 5 12 0s8 5 12 0 6 0 8 2" />
      </svg>
      <span>GoldiMattress</span>
    </a>
    <span class="product-bar__mode">Raw capture</span>
  </header>
`;

function permissionView(root: HTMLElement, deps: AppDeps, getCoach: () => Coach): void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader}
      <main class="app-main permission-view">
        <section class="permission-copy" aria-labelledby="permission-title">
          <h1 id="permission-title">Enable motion</h1>
          <p class="lead">Your phone’s accelerometer records five hands-free sit-drop windows. Access begins only after you tap below.</p>
          <div class="protocol" aria-label="Five repetitions, each six seconds with a twenty-second rest">
            <span>5 repetitions</span><span>6 s record</span><span>20 s rest</span>
          </div>
        </section>
        <section class="permission-action" aria-label="Motion permission">
          <button class="button button--primary" type="button" data-action="request-motion">Allow motion access</button>
          <p data-permission-status class="permission-status" role="status" aria-live="polite"></p>
          <p class="privacy-note">Raw acceleration stays on this device unless you export the JSON file.</p>
        </section>
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

function captureView(
  root: HTMLElement,
  deps: AppDeps,
  getCoach: () => Coach,
  later: (callback: () => void, delayMs: number) => void,
): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader}
      <main class="app-main capture-view">
        <header class="capture-heading">
          <div>
            <h1 id="capture-title">Phone capture</h1>
            <p>Hold the phone flat against your sternum. One tap runs the full set.</p>
          </div>
          <button class="button button--quiet" type="button" data-action="toggle-sound" aria-pressed="false">Mute cues</button>
        </header>
        <section class="cue-panel" aria-labelledby="capture-title">
          <p data-capture-status class="cue-panel__text" role="status" aria-live="polite">Ready for five repetitions.</p>
          <ol class="repetition-rail" data-repetition-progress aria-label="Capture progress">
            <li data-state="pending"><span>1</span><span class="sr-only">Repetition 1</span></li>
            <li data-state="pending"><span>2</span><span class="sr-only">Repetition 2</span></li>
            <li data-state="pending"><span>3</span><span class="sr-only">Repetition 3</span></li>
            <li data-state="pending"><span>4</span><span class="sr-only">Repetition 4</span></li>
            <li data-state="pending"><span>5</span><span class="sr-only">Repetition 5</span></li>
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
          <button class="button button--primary" type="button" data-action="start-capture">Start five-rep capture</button>
          <div class="export-slot" data-export></div>
        </section>
        <p class="capture-footnote">Keep this page visible until all five markers are complete. Audio and on-screen cues occur together.</p>
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
    try {
      deps.source.start((sample) => {
        received += 1;
        activeSamples?.push(sample);
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
      if (status) status.textContent = 'No motion events arrived. Use a phone with motion sensors and try again.';
      button.disabled = false;
    }, 2_000);

    const record = () => {
      repetition += 1;
      progress.forEach((item, index) => {
        const state = index < repetition - 1 ? 'complete' : index === repetition - 1 ? 'active' : 'pending';
        item.dataset.state = state;
        if (state === 'active') item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      activeSamples = [];
      startedAt = deps.now().toISOString();
      const readyText = `Repetition ${repetition} of 5. Recording for six seconds.`;
      if (status) status.textContent = readyText;
      coach.play({ key: 'drop-when-ready', text: readyText, beep: 'ready' });
      later(() => {
        if (aborted) return;
        const samples = activeSamples;
        activeSamples = undefined;
        const first = samples?.[0];
        const last = samples?.at(-1);
        if (samples && first && last && last.t > first.t) {
          traces.push({
            routine: 'sit-drop',
            sampleRateHz: (samples.length - 1) / (last.t - first.t),
            device: deps.device,
            startedAt,
            samples,
          });
        }
        const capturedText = `Repetition ${repetition} captured. Rest for twenty seconds.`;
        if (status) status.textContent = capturedText;
        coach.play({ key: 'captured', text: capturedText, beep: 'captured' });
        later(() => {
          if (aborted) return;
          if (repetition < 5) record();
          else {
            deps.source.stop();
            coach.keepAwake(false);
            running = false;
            if (traces.length === 5) {
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
              if (exportUrl) URL.revokeObjectURL(exportUrl);
              exportUrl = URL.createObjectURL(
                new Blob([serializeRecording(recording)], { type: 'application/json' }),
              );
              if (exportSlot) {
                exportSlot.innerHTML = `<a class="button button--export" data-action="export-recording" download="goldimattress-recording.json">Export Recording JSON</a>`;
                exportSlot.querySelector('a')?.setAttribute('href', exportUrl);
              }
              if (status) {
                status.textContent =
                  traces.length === 5
                    ? 'Capture complete'
                    : `Captured ${traces.length} of 5 repetitions. Some windows had no motion events; export what was recorded or try again.`;
              }
            } else if (status) {
              status.textContent = 'Capture ended without enough motion events. Keep this page visible and try again.';
            }
          }
        }, 20_000);
      }, 6_000);
    };

    record();
  });

  return () => {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    if (!running) return;
    running = false;
    deps.source.stop();
    void getCoach().keepAwake(false);
  };
}

export function startApp(root: HTMLElement, deps: AppDeps): () => void {
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
    const route = window.location.hash === '#/capture' ? '#/capture' : '#/permission';
    if (route === renderedRoute) return;
    leaveRoute?.();
    leaveRoute = undefined;
    clearTimers();
    renderedRoute = route;
    if (route === '#/capture') leaveRoute = captureView(root, deps, getCoach, later);
    else permissionView(root, deps, getCoach);
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
