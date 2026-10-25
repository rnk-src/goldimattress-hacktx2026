import type { Coach } from '../../coach';
import type { FeatureName, Person, Routine } from '../../domain';
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
        <ol data-rep-dots aria-label="Accepted reps">
          ${Array.from({ length: CALIBRATION_REPS }, (_, i) => `<li data-state="pending"><span>${i + 1}</span></li>`).join('')}
        </ol>
        <ul data-rejected-reps aria-label="Rejected reps"></ul>
        <button class="button button--primary" type="button" data-action="start-calibration">Start calibration</button>
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
      button.disabled = true;
      profilePrompt.innerHTML = 'Create a profile before calibrating. <a href="#/profile">Create a profile</a>';
    }
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
    finishButton.hidden = true;
    finishButton.disabled = true;
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

  const show = (events: SessionEvent[]) => {
    for (const event of events) {
      if (event.kind === 'cue') {
        // The rep verdict has its own line, so the rest or done cue that follows it cannot hide the fix.
        if (event.cue.key === 'rep-accepted' || event.cue.key === 'rep-rejected') feedback.textContent = event.cue.text;
        else cueText.textContent = event.cue.text;
        getCoach().play(event.cue);
      } else if (event.kind === 'rep') {
        if (isUsable(event.result)) {
          dots[(session?.accepted ?? 1) - 1]?.setAttribute('data-state', 'accepted');
          if ((session?.accepted ?? 0) >= 3) {
            finishButton.hidden = false;
            finishButton.disabled = false;
          }
        } else {
          const item = document.createElement('li');
          item.textContent = rejectMessage((event.result.ok ? event.result.issues : event.result.reasons)[0]!);
          rejectedList.append(item);
        }
      } else if (event.kind === 'done') {
        finish();
        const built = buildReference(event.reps, routine());
        const accepted = event.reps.filter(isUsable).length;
        if (built.ok && selectedPerson) {
          const person = selectedPerson;
          const currentRoutine = routine();
          person.references[currentRoutine] = {
            stats: { ...built.ref, createdAt: deps.now().toISOString() },
            reps: event.reps,
          };
          void deps.store.savePerson(person);
        }
        result.hidden = false;
        result.innerHTML = built.ok
          ? `<p>${accepted} accepted reps${event.outcome === 'low-confidence' ? ' — low confidence' : ''}</p>${droppedNote(built.dropped.length)}<dl>${(Object.keys(built.ref.features) as FeatureName[])
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
    deps.source.start((sample) => show(session!.push(sample)));
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
