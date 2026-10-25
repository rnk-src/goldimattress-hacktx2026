import type { Coach } from '../../coach';
import type { FeatureName, Person, Routine, Trace } from '../../domain';
import { createRepSession, rejectMessage } from '../../session';
import type { RepSession, SessionEvent } from '../../session';
import { buildReference, isUsable, routineSpec } from '../../signal';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';

/** Accepted reps that finish a calibration. */
// shortcut: one app-wide constant, not per routine, so change it here if a routine needs another count.
const CALIBRATION_REPS = 5;

const PLACEMENT: Record<Routine, { label: string; text: string }> = {
  'sit-drop': {
    label: 'Sit-drop: couches, chairs and cushions',
    text: 'Hold the phone flat on your sternum, screen out, arms crossed over it. Stand with your back to the surface and squat to hover about 10 cm (a fist) above it. Lean forward naturally, hold still, relax your legs and drop.',
  },
  'bridge-drop': {
    label: 'Bridge drop: mattresses',
    text: 'Lie on your back in the middle of the bed. Hold the phone flat on your lower belly over the hip bones with both hands. Lift your hips about 10 cm, hold still, go limp and drop.',
  },
};

const FEATURE_UNITS: Record<FeatureName, string> = {
  peakOverV: '1/s',
  stopTime: 's',
  bounceRatio: '',
  settleTime: 's',
};

const BUILD_FAILURE = {
  'too-few': 'Too few accepted reps.',
} as const;

const droppedNote = (count: number): string =>
  count === 0 ? '' : `<p>dropped ${count} ${count === 1 ? 'rep' : 'reps'} that didn't match the others</p>`;

export function calibrateView(root: HTMLElement, deps: AppDeps, getCoach: () => Coach): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Calibrate')}
      <main class="app-main calibrate-view">
        <h1>Calibrate on a surface you like</h1>
        <label>Routine
          <select name="routine">
            ${(Object.keys(PLACEMENT) as Routine[]).map((r) => `<option value="${r}">${PLACEMENT[r].label}</option>`).join('')}
          </select>
        </label>
        <label data-profile-control hidden>Profile
          <select name="person"></select>
        </label>
        <section data-placement aria-label="Phone placement"></section>
        <p data-cue-text class="cue-panel__text" role="status" aria-live="polite"></p>
        <p data-rep-feedback role="status" aria-live="polite"></p>
        <p data-usable-count>0 of 5 usable reps</p>
        <ol data-rep-dots aria-label="Accepted reps">
          ${Array.from({ length: CALIBRATION_REPS }, (_, i) => `<li data-state="pending"><span>${i + 1}</span></li>`).join('')}
        </ol>
        <ul data-rejected-reps aria-label="Rejected reps"></ul>
        <button class="button button--primary" type="button" data-action="start-calibration" disabled>Start calibration</button>
        <button class="button button--quiet" type="button" data-action="finish-calibration" hidden disabled>Finish with 3 reps</button>
        <p data-profile-prompt role="status">Loading profiles…</p>
        <section data-calibration-result aria-label="Calibration result" hidden></section>
      </main>
    </div>
  `;
  const routineSelect = root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
  const profileControl = root.querySelector<HTMLElement>('[data-profile-control]')!;
  const profileSelect = root.querySelector<HTMLSelectElement>('select[name="person"]')!;
  const placement = root.querySelector<HTMLElement>('[data-placement]')!;
  const cueText = root.querySelector<HTMLElement>('[data-cue-text]')!;
  const feedback = root.querySelector<HTMLElement>('[data-rep-feedback]')!;
  const dots = Array.from(root.querySelectorAll<HTMLElement>('[data-rep-dots] li'));
  const usableCount = root.querySelector<HTMLElement>('[data-usable-count]')!;
  const rejectedList = root.querySelector<HTMLElement>('[data-rejected-reps]')!;
  const button = root.querySelector<HTMLButtonElement>('[data-action="start-calibration"]')!;
  const finishButton = root.querySelector<HTMLButtonElement>('[data-action="finish-calibration"]')!;
  const profilePrompt = root.querySelector<HTMLElement>('[data-profile-prompt]')!;
  const result = root.querySelector<HTMLElement>('[data-calibration-result]')!;
  let running = false;
  let mounted = true;
  let session: RepSession | undefined;
  let profiles: Person[] = [];
  let selectedPerson: Person | undefined;

  void deps.store.listPeople().then((people) => {
    if (!mounted) return;
    profiles = people;
    selectedPerson = people[0];
    if (selectedPerson) {
      profileSelect.replaceChildren(
        ...people.map((person) => {
          const option = document.createElement('option');
          option.value = person.id;
          option.textContent = person.name;
          return option;
        }),
      );
      profileControl.hidden = false;
      profilePrompt.textContent = `Calibrating for ${selectedPerson.name}`;
    } else {
      profilePrompt.innerHTML = 'Create a profile before calibrating. <a href="#/profile">Create a profile</a>';
    }
    button.disabled = !selectedPerson;
  }).catch(() => {
    if (mounted) profilePrompt.textContent = 'Could not load profiles. Reload this page to try again.';
  });
  profileSelect.addEventListener('change', () => {
    selectedPerson = profiles.find((person) => person.id === profileSelect.value);
    if (selectedPerson) profilePrompt.textContent = `Calibrating for ${selectedPerson.name}`;
  });

  const routine = () => routineSelect.value as Routine;
  const showPlacement = () => {
    const spec = routineSpec(routine());
    placement.innerHTML = `<p>${PLACEMENT[routine()].text}</p><p>Stay still for ${spec.captureS} s after each drop. Rest ${spec.restS} s between reps. Do ${CALIBRATION_REPS} good reps.</p>`;
  };
  const clearProgress = () => {
    result.hidden = true;
    rejectedList.replaceChildren();
    feedback.textContent = '';
    usableCount.textContent = '0 of 5 usable reps';
    finishButton.hidden = true;
    finishButton.disabled = true;
    finishButton.textContent = 'Finish with 3 reps';
    dots.forEach((dot) => dot.setAttribute('data-state', 'pending'));
  };
  showPlacement();
  routineSelect.addEventListener('change', () => {
    showPlacement();
    clearProgress();
  });

  const finish = () => {
    button.disabled = false;
    finishButton.hidden = true;
    finishButton.disabled = true;
    routineSelect.disabled = false;
    profileSelect.disabled = false;
    running = false;
    deps.source.stop();
    void getCoach().keepAwake(false);
  };

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

  /** Re-reads the person so only this routine changes, then reports the real outcome. */
  const saveReference = async (
    personId: string,
    currentRoutine: Routine,
    reference: NonNullable<Person['references'][Routine]>,
  ) => {
    let message = 'Reference saved.';
    try {
      const fresh = (await deps.store.listPeople()).find((person) => person.id === personId);
      if (!fresh) throw new Error('profile missing');
      await deps.store.savePerson({ ...fresh, references: { ...fresh.references, [currentRoutine]: reference } });
    } catch (error) {
      message = `Could not save: ${error instanceof Error ? error.message : 'unknown error'}. Calibration not stored.`;
    }
    const status = root.querySelector('[data-save-status]');
    if (mounted && status) status.textContent = message;
  };

  const show = (events: SessionEvent[]) => {
    for (const event of events) {
      if (event.kind === 'cue') {
        // The rep verdict has its own line, so the rest or done cue that follows it cannot hide the fix.
        if (event.cue.key === 'rep-accepted' || event.cue.key === 'rep-rejected') feedback.textContent = event.cue.text;
        else cueText.textContent = event.cue.text;
        getCoach().play(event.cue);
      } else if (event.kind === 'state') {
        finishButton.disabled = session === undefined || session.accepted < 3 || event.state === 'capturing' || event.state === 'done';
      } else if (event.kind === 'rep') {
        startedAts.push(startedAtOf(event.result.trace));
        if (isUsable(event.result)) {
          dots[(session?.accepted ?? 1) - 1]?.setAttribute('data-state', 'accepted');
          usableCount.textContent = `${session?.accepted ?? 0} of 5 usable reps`;
          finishButton.textContent = `Finish with ${session?.accepted ?? 0} reps`;
          finishButton.disabled = (session?.accepted ?? 0) < 3 || session?.state === 'capturing';
          if ((session?.accepted ?? 0) >= 3) finishButton.hidden = false;
        } else {
          const item = document.createElement('li');
          item.textContent = rejectMessage((event.result.ok ? event.result.issues : event.result.reasons)[0]!);
          rejectedList.append(item);
        }
      } else if (event.kind === 'done') {
        finish();
        const built = buildReference(event.reps, routine());
        const accepted = event.reps.filter(isUsable).length;
        const saveStatus = built.ok && selectedPerson ? 'Saving…' : '';
        if (built.ok && selectedPerson) {
          const reference = {
            stats: { ...built.ref, createdAt: deps.now().toISOString() },
            reps: event.reps.map((rep, i) => ({ ...rep, trace: { ...rep.trace, startedAt: startedAts[i] ?? rep.trace.startedAt } })),
          };
          void saveReference(selectedPerson.id, routine(), reference);
        }
        result.hidden = false;
        result.innerHTML = built.ok
          ? `<p>${accepted} accepted reps${event.outcome === 'low-confidence' ? ' — low confidence' : ''}</p>${droppedNote(built.dropped.length)}<p data-save-status role="status">${saveStatus}</p><dl>${(Object.keys(built.ref.features) as FeatureName[])
              .map(
                (name) =>
                  `<div><dt>${name}</dt><dd>${built.ref.features[name].median.toFixed(3)} ${FEATURE_UNITS[name]}</dd></div>`,
              )
              .join('')}</dl>`
          : `<p>${accepted} accepted reps. ${BUILD_FAILURE[built.reason]}</p>`;
      }
    }
  };

  button.addEventListener('click', async () => {
    if (!selectedPerson) return;
    button.disabled = true;
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
      button.disabled = false;
      return;
    }
    routineSelect.disabled = true;
    profileSelect.disabled = true;
    clearProgress();
    session = createRepSession({ routine: routine() });
    running = true;
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
    if (running) finish();
  };
}
