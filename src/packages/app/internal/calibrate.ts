import type { Coach } from '../../coach';
import type { FeatureName, Person, Routine } from '../../domain';
import { GOAL_REPS, MIN_REPS, rejectMessage } from '../../session';
import { buildReference, isUsable, routineSpec } from '../../signal';
import { PLACEMENT } from './placement';
import { personRig, rigSummary } from './rig';
import { routinePickerHtml, wireRoutinePicker } from './routines';
import { createRepRun } from './rep-run';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';

const FEATURE_UNITS: Record<FeatureName, string> = {
  peak: 'm/s²',
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
  // shortcut: rig-drop hidden until R7 adds the rig setup screen, remove then
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Calibrate')}
      <main class="app-main calibrate-view">
        <h1>Calibrate on a surface you like</h1>
        ${routinePickerHtml()}
        <p data-rig-line></p>
        <label data-profile-control hidden>Profile
          <select name="person"></select>
        </label>
        <section data-placement aria-label="Phone placement"></section>
        <p data-cue-text class="cue-panel__text" role="status" aria-live="polite"></p>
        <p data-rep-feedback role="status" aria-live="polite"></p>
        <p data-usable-count>0 of ${GOAL_REPS} usable reps</p>
        <ol class="repetition-rail" data-rep-dots aria-label="Accepted reps">
          ${Array.from({ length: GOAL_REPS }, (_, i) => `<li data-state="pending"><span>${i + 1}</span></li>`).join('')}
        </ol>
        <ul data-rejected-reps aria-label="Rejected reps"></ul>
        <button class="button button--primary" type="button" data-action="start-calibration" disabled>Start calibration</button>
        <button class="button button--quiet" type="button" data-action="skip-rest" hidden>Skip rest</button>
        <button class="button button--quiet" type="button" data-action="finish-calibration" hidden disabled>Finish with ${MIN_REPS} reps</button>
        <p data-profile-prompt role="status">Loading profiles…</p>
        <p data-existing-reference role="status"></p>
        <section data-calibration-result aria-label="Calibration result" aria-live="polite" hidden></section>
      </main>
    </div>
  `;
  const routineSelect = root.querySelector<HTMLSelectElement>('select[name="routine"]')!;
  const legacyToggle = root.querySelector<HTMLInputElement>('input[name="legacy"]')!;
  const rigLine = root.querySelector<HTMLElement>('[data-rig-line]')!;
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
  const skipButton = root.querySelector<HTMLButtonElement>('[data-action="skip-rest"]')!;
  const profilePrompt = root.querySelector<HTMLElement>('[data-profile-prompt]')!;
  const existingNote = root.querySelector<HTMLElement>('[data-existing-reference]')!;
  const result = root.querySelector<HTMLElement>('[data-calibration-result]')!;
  let mounted = true;
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
    showExisting();
    showRig();
  }).catch(() => {
    if (mounted) profilePrompt.textContent = 'Could not load profiles. Reload this page to try again.';
  });
  profileSelect.addEventListener('change', () => {
    selectedPerson = profiles.find((person) => person.id === profileSelect.value);
    if (selectedPerson) profilePrompt.textContent = `Calibrating for ${selectedPerson.name}`;
    clearProgress();
    showExisting();
    showRig();
  });

  const routine = () => routineSelect.value as Routine;
  const showExisting = () => {
    const saved = selectedPerson?.references[routine()]?.stats;
    existingNote.textContent = saved
      ? `A reference from ${saved.createdAt.slice(0, 10)} (${saved.repCount} reps) exists. Finishing will replace it.`
      : '';
  };
  const showRig = () => {
    rigLine.replaceChildren();
    if (routine() !== 'rig-drop') return;
    const change = document.createElement('a');
    change.href = '#/rig';
    change.textContent = 'Change rig setup';
    rigLine.append(`Rig: ${rigSummary(personRig(selectedPerson))}. `, change);
  };
  const showPlacement = () => {
    const spec = routineSpec(routine());
    placement.innerHTML = `<p>${PLACEMENT[routine()].text}</p><p>Stay still for ${spec.captureS} s after each drop. Rest ${spec.restS} s between reps. Do ${GOAL_REPS} good reps.</p>`;
  };
  const clearProgress = () => {
    result.hidden = true;
    rejectedList.replaceChildren();
    feedback.textContent = '';
    usableCount.textContent = `0 of ${GOAL_REPS} usable reps`;
    finishButton.hidden = true;
    finishButton.disabled = true;
    finishButton.textContent = `Finish with ${MIN_REPS} reps`;
    skipButton.hidden = true;
    dots.forEach((dot) => dot.setAttribute('data-state', 'pending'));
  };
  showPlacement();
  showRig();
  const routineChanged = () => {
    showPlacement();
    showRig();
    clearProgress();
    showExisting();
  };
  routineSelect.addEventListener('change', routineChanged);
  wireRoutinePicker(routineSelect, legacyToggle, routineChanged);

  /** The routine and person a run was started for, so editing the form mid-run cannot change where it is saved. */
  let runRoutine: Routine = routine();
  let runPerson: Person | undefined;

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
      const saved = { ...fresh, references: { ...fresh.references, [currentRoutine]: reference } };
      await deps.store.savePerson(saved);
      if (mounted) {
        profiles = profiles.map((p) => (p.id === saved.id ? saved : p));
        if (selectedPerson?.id === saved.id) selectedPerson = saved;
        showExisting();
      }
    } catch (error) {
      message = `Could not save: ${error instanceof Error ? error.message : 'unknown error'}. Calibration not stored.`;
    }
    const status = root.querySelector('[data-save-status]');
    if (mounted && status) {
      status.textContent = message;
      if (message === 'Reference saved.') {
        const next = document.createElement('a');
        next.href = '#/test';
        next.textContent = 'Test a surface';
        status.after(next);
      }
    }
  };

  const unlock = () => {
    button.disabled = false;
    finishButton.hidden = true;
    finishButton.disabled = true;
    skipButton.hidden = true;
    routineSelect.disabled = false;
    legacyToggle.disabled = false;
    profileSelect.disabled = false;
  };

  const run = createRepRun(deps, getCoach, {
    onCue(cue) {
      // The rep verdict has its own line, so the rest or done cue that follows it cannot hide the fix.
      if (cue.key === 'rep-accepted' || cue.key === 'rep-rejected') feedback.textContent = cue.text;
      else cueText.textContent = cue.text;
    },
    onState(state) {
      skipButton.hidden = state !== 'resting';
      finishButton.disabled = run.accepted < MIN_REPS || state === 'capturing' || state === 'done';
    },
    onRep(rep, accepted) {
      if (isUsable(rep)) {
        dots[accepted - 1]?.setAttribute('data-state', 'accepted');
        usableCount.textContent = `${accepted} of ${GOAL_REPS} usable reps`;
        finishButton.textContent = `Finish with ${accepted} reps`;
        finishButton.disabled = accepted < MIN_REPS || run.state === 'capturing';
        if (accepted >= MIN_REPS) finishButton.hidden = false;
      } else {
        const item = document.createElement('li');
        item.textContent = rejectMessage((rep.ok ? rep.issues : rep.reasons)[0]!);
        rejectedList.append(item);
      }
    },
    onDone(reps, outcome) {
      unlock();
      const built = buildReference(reps, runRoutine);
      const accepted = reps.filter(isUsable).length;
      const saveStatus = built.ok && runPerson ? 'Saving…' : '';
      if (built.ok && runPerson) {
        void saveReference(runPerson.id, runRoutine, {
          stats: { ...built.ref, createdAt: deps.now().toISOString() },
          reps,
        });
      }
      result.hidden = false;
      result.innerHTML = built.ok
        ? `<p>${accepted} accepted reps${outcome === 'low-confidence' ? ' — low confidence' : ''}</p>${droppedNote(built.dropped.length)}<p data-save-status role="status">${saveStatus}</p><dl>${(Object.keys(built.ref.features) as FeatureName[])
            .map(
              (name) =>
                `<div><dt>${name}</dt><dd>${built.ref.features[name].center.toFixed(3)} ${FEATURE_UNITS[name]}</dd></div>`,
            )
            .join('')}</dl>`
        : `<p>${accepted} accepted reps. ${BUILD_FAILURE[built.reason]}</p>`;
    },
    onBlocked(message) {
      cueText.textContent = message;
      unlock();
    },
  });

  button.addEventListener('click', () => {
    if (!selectedPerson) return;
    runPerson = selectedPerson;
    runRoutine = routine();
    button.disabled = true;
    routineSelect.disabled = true;
    legacyToggle.disabled = true;
    profileSelect.disabled = true;
    clearProgress();
    void run.start(runRoutine, undefined, runRoutine === 'rig-drop' ? personRig(runPerson) : undefined);
  });
  finishButton.addEventListener('click', () => run.finishNow());
  skipButton.addEventListener('click', () => run.skipRest());

  return () => {
    mounted = false;
    run.dispose();
  };
}
