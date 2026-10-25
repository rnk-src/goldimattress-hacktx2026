import type { Coach } from '../../coach';
import type { Person, RepResult, Routine, Surface, SurfaceType, TestRecord, Trace } from '../../domain';
import { createRepSession, rejectMessage } from '../../session';
import type { RepSession, SessionEvent } from '../../session';
import { compare, isUsable } from '../../signal';
import { shortDeviceModel } from './metadata';
import { PLACEMENT } from './placement';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';
import { caveatTexts, confidenceText, hardnessText, matchText, springinessText } from './wording';

const SURFACE_TYPES: SurfaceType[] = ['mattress', 'couch', 'chair', 'cushion', 'pad'];
const GOAL_REPS = 5;
const MIN_REPS = 3;

/** The surface already saved under this name (case-insensitive), or a new one. */
async function surfaceNamed(deps: AppDeps, name: string, type: SurfaceType): Promise<Surface> {
  const existing = (await deps.store.findSurfaces(name)).find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const surface: Surface = { id: deps.newId(), name, type };
  await deps.store.saveSurface(surface);
  return surface;
}

export function testView(root: HTMLElement, deps: AppDeps, getCoach: () => Coach): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Test a surface')}
      <main class="app-main capture-view">
        <header class="capture-heading"><div><h1>Test a surface</h1><p>Compare it with your reference.</p></div></header>
        <label data-profile-control hidden>Profile <select name="person"></select></label>
        <label>Routine <select name="routine">${(Object.keys(PLACEMENT) as Routine[]).map((r) => `<option value="${r}">${PLACEMENT[r].label}</option>`).join('')}</select></label>
        <div class="field-grid">
          <label><span>Surface name</span><input name="surface" maxlength="80" autocomplete="off"></label>
          <label><span>Type</span><select name="type">${SURFACE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></label>
        </div>
        <section data-placement aria-label="Phone placement"></section>
        <p data-block role="status"></p>
        <p data-cue-text class="cue-panel__text" role="status" aria-live="polite"></p>
        <p data-rep-feedback role="status" aria-live="polite"></p>
        <p data-usable-count>0 of ${GOAL_REPS} usable reps</p>
        <ol data-rep-dots aria-label="Accepted reps">${Array.from({ length: GOAL_REPS }, (_, i) => `<li data-state="pending">${i + 1}</li>`).join('')}</ol>
        <button class="button button--primary" type="button" data-action="start-test" disabled>Start test</button>
        <button class="button button--quiet" type="button" data-action="finish-test" hidden disabled>Finish with ${MIN_REPS} reps</button>
        <p data-form-error role="alert"></p>
        <section data-result aria-label="Test result" hidden></section>
      </main>
    </div>
  `;
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const profileControl = q('[data-profile-control]');
  const profileSelect = q<HTMLSelectElement>('select[name="person"]');
  const routineSelect = q<HTMLSelectElement>('select[name="routine"]');
  const surfaceInput = q<HTMLInputElement>('input[name="surface"]');
  const typeSelect = q<HTMLSelectElement>('select[name="type"]');
  const placement = q('[data-placement]');
  const block = q('[data-block]');
  const cueText = q('[data-cue-text]');
  const feedback = q('[data-rep-feedback]');
  const usableCount = q('[data-usable-count]');
  const dots = Array.from(root.querySelectorAll<HTMLElement>('[data-rep-dots] li'));
  const startButton = q<HTMLButtonElement>('[data-action="start-test"]');
  const finishButton = q<HTMLButtonElement>('[data-action="finish-test"]');
  const formError = q('[data-form-error]');
  const result = q('[data-result]');

  let mounted = true;
  let running = false;
  let session: RepSession | undefined;
  let profiles: Person[] = [];
  let person: Person | undefined;
  let clockBase: number | undefined;
  let latestT = 0;
  let startedAts: string[] = [];

  const routine = () => routineSelect.value as Routine;
  const reference = () => person?.references[routine()];

  const refresh = () => {
    placement.innerHTML = `<p>${PLACEMENT[routine()].text}</p>`;
    if (!person) {
      block.innerHTML = 'Create a profile first. <a href="#/profile">Create a profile</a>';
    } else if (!reference()) {
      block.innerHTML = `${person.name} has no reference for this routine. <a href="#/calibrate">Calibrate</a> it first.`;
    } else {
      block.textContent = '';
    }
    startButton.disabled = running || !reference();
  };

  void deps.store
    .listPeople()
    .then((people) => {
      if (!mounted) return;
      profiles = people;
      person = people[0];
      profileSelect.replaceChildren(
        ...people.map((p) => {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name;
          return option;
        }),
      );
      profileControl.hidden = people.length === 0;
      refresh();
    })
    .catch(() => {
      if (mounted) block.textContent = 'Could not load profiles. Reload this page to try again.';
    });
  profileSelect.addEventListener('change', () => {
    person = profiles.find((p) => p.id === profileSelect.value);
    refresh();
  });
  routineSelect.addEventListener('change', refresh);
  refresh();

  /** Traces are rebased per rep, so a rep's start is dated from the sample that ended it. */
  const startedAtOf = (trace: Trace): string => {
    const first = trace.samples[0];
    const last = trace.samples.at(-1);
    const durationS = first && last ? last.t - first.t : 0;
    return new Date((clockBase ?? deps.now().getTime()) + (latestT - durationS) * 1_000).toISOString();
  };

  const finishRun = () => {
    running = false;
    routineSelect.disabled = false;
    profileSelect.disabled = false;
    finishButton.hidden = true;
    finishButton.disabled = true;
    deps.source.stop();
    void getCoach().keepAwake(false);
    refresh();
  };

  const showResult = (record: TestRecord) => {
    const { verdict } = record;
    result.hidden = false;
    result.innerHTML = `
      <p data-match>${matchText(verdict)}</p>
      <p data-direction>${springinessText(verdict)}</p>
      <p data-hardness>${hardnessText(verdict)}</p>
      <p data-confidence>Confidence: ${confidenceText(verdict)}</p>
      <ul data-caveats>${caveatTexts(verdict).map((c) => `<li>${c}</li>`).join('')}</ul>
      <p data-save-status role="status">Saving…</p>`;
    void (async () => {
      let message = 'Test saved.';
      try {
        const surface = await surfaceNamed(deps, surfaceInput.value.trim(), typeSelect.value as SurfaceType);
        await deps.store.saveTest({ ...record, surfaceId: surface.id });
      } catch (error) {
        message = `Could not save: ${error instanceof Error ? error.message : 'unknown error'}. Test not stored.`;
      }
      const status = root.querySelector('[data-save-status]');
      if (mounted && status) status.textContent = message;
    })();
  };

  const onDone = (reps: RepResult[], outcome: string) => {
    finishRun();
    const stamped = reps.map((rep, i) => ({ ...rep, trace: { ...rep.trace, startedAt: startedAts[i] ?? rep.trace.startedAt } }));
    if (outcome === 'retry' || !stamped.some(isUsable)) {
      result.hidden = false;
      result.innerHTML = '<p data-retry>This technique or surface is not working. Nothing was saved. Try again when you are ready.</p>';
      return;
    }
    showResult({
      id: deps.newId(),
      personId: person!.id,
      surfaceId: '',
      routine: routine(),
      createdAt: deps.now().toISOString(),
      device: shortDeviceModel(deps.device),
      sampleRateHz: deps.source.sampleRateHz ?? stamped[0]!.trace.sampleRateHz,
      reps: stamped,
      verdict: compare(stamped, reference()!.stats),
    });
  };

  const show = (events: SessionEvent[]) => {
    for (const event of events) {
      if (event.kind === 'cue') {
        if (event.cue.key === 'rep-accepted' || event.cue.key === 'rep-rejected') feedback.textContent = event.cue.text;
        else cueText.textContent = event.cue.text;
        getCoach().play(event.cue);
      } else if (event.kind === 'state') {
        finishButton.disabled = (session?.accepted ?? 0) < MIN_REPS || event.state === 'capturing' || event.state === 'done';
      } else if (event.kind === 'rep') {
        startedAts.push(startedAtOf(event.result.trace));
        if (isUsable(event.result)) {
          const accepted = session?.accepted ?? 0;
          dots[accepted - 1]?.setAttribute('data-state', 'accepted');
          usableCount.textContent = `${accepted} of ${GOAL_REPS} usable reps`;
          finishButton.textContent = `Finish with ${accepted} reps`;
          finishButton.hidden = accepted < MIN_REPS;
          finishButton.disabled = accepted < MIN_REPS || session?.state === 'capturing';
        } else {
          feedback.textContent = rejectMessage((event.result.ok ? event.result.issues : event.result.reasons)[0]!);
        }
      } else if (event.kind === 'done') {
        onDone(event.reps, event.outcome);
      }
    }
  };

  startButton.addEventListener('click', async () => {
    const ref = reference();
    const name = surfaceInput.value.trim();
    if (!ref || !person) return;
    if (!name) {
      formError.textContent = 'Enter the name of the surface first.';
      return;
    }
    formError.textContent = '';
    startButton.disabled = true;
    const coach = getCoach();
    let access;
    try {
      access = await deps.source.requestAccess();
    } catch {
      access = 'denied' as const;
    }
    if (!mounted) return;
    if (access !== 'granted') {
      cueText.textContent =
        access === 'denied'
          ? 'Motion access is blocked. Open Settings, enable Motion & Orientation Access for Safari, then reload this page.'
          : 'This browser does not support motion sensors. Try Safari or Chrome over HTTPS on your phone.';
      startButton.disabled = false;
      return;
    }
    running = true;
    routineSelect.disabled = true;
    profileSelect.disabled = true;
    result.hidden = true;
    feedback.textContent = '';
    usableCount.textContent = `0 of ${GOAL_REPS} usable reps`;
    dots.forEach((dot) => dot.setAttribute('data-state', 'pending'));
    session = createRepSession({ routine: routine(), ref: ref.stats });
    void coach.keepAwake(true);
    clockBase = undefined;
    startedAts = [];
    deps.source.start((sample) => {
      clockBase ??= deps.now().getTime() - sample.t * 1_000;
      latestT = sample.t;
      show(session!.push(sample));
    });
  });
  finishButton.addEventListener('click', () => {
    if (session) show(session.finishNow());
  });

  return () => {
    mounted = false;
    session?.abort();
    if (running) {
      deps.source.stop();
      void getCoach().keepAwake(false);
    }
  };
}
