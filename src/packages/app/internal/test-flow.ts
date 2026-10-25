import type { Coach } from '../../coach';
import type { FeatureName, FeatureStats, Person, ReferenceStats, RepResult, RigSetup, Routine, Surface, SurfaceType, TestRecord } from '../../domain';
import { GOAL_REPS, MIN_REPS, rejectMessage } from '../../session';
import type { SessionOutcome } from '../../session';
import { compare, isUsable, summarize } from '../../signal';
import { shortDeviceModel } from './metadata';
import { PLACEMENT } from './placement';
import { personRig, referenceRig, rigSummary, sameRig } from './rig';
import { routinePickerHtml, wireRoutinePicker } from './routines';
import { createRepRun } from './rep-run';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';
import { caveatTexts, confidenceText, hardnessText, indexText, matchText, springinessText } from './wording';

const MAX_SUGGESTIONS = 8;
const SURFACE_TYPES: SurfaceType[] = ['mattress', 'couch', 'chair', 'cushion', 'pad'];

/** Collapses runs of spaces so "Blue  couch" and "Blue couch" are one surface. */
const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** The saved surface with this name, ignoring case and repeated spaces. */
async function knownSurface(deps: AppDeps, name: string): Promise<Surface | undefined> {
  const key = name.toLowerCase();
  return (await deps.store.findSurfaces(name)).find((s) => normalizeName(s.name).toLowerCase() === key);
}

/** The surface already saved under this name, or a new one. */
async function surfaceNamed(deps: AppDeps, name: string, type: SurfaceType): Promise<Surface> {
  const existing = await knownSurface(deps, name);
  if (existing) {
    if (existing.type === type) return existing;
    const retyped = { ...existing, type };
    await deps.store.saveSurface(retyped);
    return retyped;
  }
  const surface: Surface = { id: deps.newId(), name, type };
  await deps.store.saveSurface(surface);
  return surface;
}

/** What a run was started with, fixed at the click so editing the form mid-run cannot change the record. */
interface RunInputs {
  measureOnly: boolean;
  person?: Person;
  routine: Routine;
  /** Absent for Measure only. */
  ref?: ReferenceStats;
  /** The rig the run uses, for a rig-drop. */
  rig?: RigSetup;
  /** The rig the reference was recorded with, when it is known. */
  referenceRig?: RigSetup;
  surfaceName: string;
  surfaceType: SurfaceType;
}

export function testView(root: HTMLElement, deps: AppDeps, getCoach: () => Coach): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Test a surface')}
      <main class="app-main capture-view">
        <header class="capture-heading"><div><h1>Test a surface</h1><p>Compare it with your reference.</p></div></header>
        <label data-profile-control hidden>Profile <select name="person"></select></label>
        ${routinePickerHtml()}
        <fieldset class="mode-row">
          <legend>What to do</legend>
          <label class="check-row"><input type="radio" name="mode" value="compare" checked> Compare with my reference</label>
          <label class="check-row"><input type="radio" name="mode" value="measure"> Measure only (no reference needed)</label>
        </fieldset>
        <p data-rig-line></p>
        <div class="field-grid">
          <label><span data-surface-label>Surface name</span><input name="surface" maxlength="80" autocomplete="off" list="surface-options"><datalist id="surface-options"></datalist></label>
          <label><span>Type</span><select name="type">${SURFACE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></label>
        </div>
        <section data-placement aria-label="Phone placement"></section>
        <p data-block role="status"></p>
        <p data-cue-text class="cue-panel__text" role="status" aria-live="polite"></p>
        <p data-rep-feedback role="status" aria-live="polite"></p>
        <p data-usable-count>0 of ${GOAL_REPS} usable reps</p>
        <ol class="repetition-rail" data-rep-dots aria-label="Accepted reps">${Array.from({ length: GOAL_REPS }, (_, i) => `<li data-state="pending">${i + 1}</li>`).join('')}</ol>
        <button class="button button--primary" type="button" data-action="start-test" disabled>Start test</button>
        <button class="button button--quiet" type="button" data-action="skip-rest" hidden>Skip rest</button>
        <button class="button button--quiet" type="button" data-action="finish-test" hidden disabled>Finish with ${MIN_REPS} reps</button>
        <p data-form-error role="alert"></p>
        <section data-result aria-label="Test result" aria-live="polite" hidden></section>
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
  const skipButton = q<HTMLButtonElement>('[data-action="skip-rest"]');
  const finishButton = q<HTMLButtonElement>('[data-action="finish-test"]');
  const formError = q('[data-form-error]');
  const result = q('[data-result]');
  const legacyToggle = q<HTMLInputElement>('input[name="legacy"]');
  const modeRadios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const rigLine = q('[data-rig-line]');
  const surfaceLabel = q('[data-surface-label]');
  const surfaceOptions = q<HTMLDataListElement>('#surface-options');
  const lockedFields = [profileSelect, routineSelect, legacyToggle, surfaceInput, typeSelect, ...modeRadios];

  let mounted = true;
  let running = false;
  let profiles: Person[] = [];
  let person: Person | undefined;
  let inputs: RunInputs | undefined;

  const routine = () => routineSelect.value as Routine;
  /** The routine picked before Measure only forced the rig, so Compare can give it back. */
  let routineBeforeMeasure: string | undefined;
  const measureOnly = () => modeRadios.some((r) => r.checked && r.value === 'measure');
  const reference = () => person?.references[routine()];

  const link = (href: string, label: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  };
  const refresh = () => {
    const measure = measureOnly();
    // Measure only reads the rig index, which only the rig has.
    if (measure) {
      routineBeforeMeasure ??= routineSelect.value;
      routineSelect.value = 'rig-drop';
    } else if (routineBeforeMeasure !== undefined) {
      routineSelect.value = routineBeforeMeasure;
      routineBeforeMeasure = undefined;
    }
    routineSelect.disabled = running || measure;
    legacyToggle.disabled = running || measure;
    surfaceLabel.textContent = measure ? 'Surface name (optional)' : 'Surface name';
    placement.innerHTML = `<p>${PLACEMENT[routine()].text}</p>`;
    rigLine.replaceChildren();
    if (routine() === 'rig-drop') {
      rigLine.append(`Rig: ${rigSummary(personRig(person))}. `, link('#/rig', 'Change rig setup'));
    }
    if (measure) {
      block.textContent = '';
      startButton.disabled = running;
      return;
    }
    if (!person) {
      block.replaceChildren('Create a profile first. ', link('#/profile', 'Create a profile'));
    } else if (!reference()) {
      block.replaceChildren(`${person.name} has no reference for this routine. `, link('#/calibrate', 'Calibrate'), ' it first.');
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
    result.hidden = true;
    refresh();
  });
  routineSelect.addEventListener('change', () => {
    result.hidden = true;
    refresh();
  });
  wireRoutinePicker(routineSelect, legacyToggle, () => {
    result.hidden = true;
    refresh();
  });
  modeRadios.forEach((radio) =>
    radio.addEventListener('change', () => {
      result.hidden = true;
      formError.textContent = '';
      refresh();
    }),
  );
  surfaceInput.addEventListener('input', () => {
    formError.textContent = '';
    const name = normalizeName(surfaceInput.value);
    // One lookup serves both the suggestions and the type of a surface the name already matches.
    void deps.store
      .findSurfaces(name)
      .then((found) => {
        if (!mounted || normalizeName(surfaceInput.value) !== name) return;
        surfaceOptions.replaceChildren(
          ...found.slice(0, MAX_SUGGESTIONS).map((surface) => {
            const option = document.createElement('option');
            option.value = surface.name;
            return option;
          }),
        );
        // Show the type a known surface already has, so retesting it does not retype it by accident.
        const known = found.find((s) => normalizeName(s.name).toLowerCase() === name.toLowerCase());
        if (!running && known) typeSelect.value = known.type;
      })
      .catch(() => undefined);
  });
  refresh();

  const unlock = () => {
    running = false;
    lockedFields.forEach((field) => (field.disabled = false));
    finishButton.hidden = true;
    finishButton.disabled = true;
    skipButton.hidden = true;
    refresh();
  };

  const indexOf = (reps: readonly RepResult[]): Record<FeatureName, FeatureStats> => summarize(reps).features;

  const showResult = (record: TestRecord, used: RunInputs, outcome: SessionOutcome) => {
    const { verdict } = record;
    const caveats = caveatTexts(verdict);
    if (used.routine === 'rig-drop' && used.referenceRig && used.rig && !sameRig(used.rig, used.referenceRig)) {
      caveats.push(`Rig setup differs from calibration: it was ${rigSummary(used.referenceRig)}, now ${rigSummary(used.rig)}.`);
    }
    result.hidden = false;
    result.innerHTML = `
      <p data-match>${matchText(verdict)}</p>
      <p data-direction>${springinessText(verdict)}</p>
      <p data-hardness>${hardnessText(verdict)}</p>
      <p data-confidence>Confidence: ${confidenceText(verdict)}</p>
      ${record.index && used.routine === 'rig-drop' ? `<p data-rig-index>${indexText(record.index)}</p>` : ''}
      ${outcome === 'low-confidence' ? `<p data-low-confidence>You finished with fewer than ${GOAL_REPS} good reps.</p>` : ''}
      <ul data-caveats>${caveats.map((c) => `<li>${c}</li>`).join('')}</ul>
      <p data-save-status role="status">Saving…</p>`;
    void (async () => {
      let message = 'Test saved.';
      try {
        const surface = await surfaceNamed(deps, used.surfaceName, used.surfaceType);
        await deps.store.saveTest({ ...record, surfaceId: surface.id });
      } catch (error) {
        message = `Could not save: ${error instanceof Error ? error.message : 'unknown error'}. Test not stored.`;
      }
      const status = root.querySelector('[data-save-status]');
      if (mounted && status) status.textContent = message;
    })();
  };

  const showMeasurement = (index: Record<FeatureName, FeatureStats>, outcome: SessionOutcome) => {
    result.hidden = false;
    result.innerHTML = `
      <p data-measure-title>Measure only</p>
      <p data-rig-index>${indexText(index)}</p>
      <p>No reference, so no verdict. Compare it with another surface at the same rig and drop height.</p>
      ${outcome === 'low-confidence' ? `<p data-low-confidence>You finished with fewer than ${GOAL_REPS} good reps.</p>` : ''}
      <p data-save-status>This measurement is not saved.</p>`;
  };

  const run = createRepRun(deps, getCoach, {
    onCue(cue) {
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
        finishButton.hidden = accepted < MIN_REPS;
        finishButton.disabled = accepted < MIN_REPS || run.state === 'capturing';
      } else {
        feedback.textContent = rejectMessage((rep.ok ? rep.issues : rep.reasons)[0]!);
      }
    },
    onDone(reps, outcome) {
      unlock();
      const used = inputs!;
      if (outcome === 'retry' || !reps.some(isUsable)) {
        result.hidden = false;
        result.innerHTML =
          '<p data-retry>This technique or surface is not working. Nothing was saved. Try again when you are ready.</p>';
        return;
      }
      try {
        if (used.measureOnly) {
          showMeasurement(indexOf(reps), outcome);
          return;
        }
        showResult(
          {
            id: deps.newId(),
            personId: used.person!.id,
            surfaceId: '',
            routine: used.routine,
            createdAt: deps.now().toISOString(),
            device: shortDeviceModel(deps.device),
            sampleRateHz: deps.source.sampleRateHz ?? reps[0]!.trace.sampleRateHz,
            reps,
            verdict: compare(reps, used.ref!),
            index: indexOf(reps),
          },
          used,
          outcome,
        );
      } catch {
        result.hidden = false;
        result.innerHTML = '<p data-retry>The result could not be worked out. Nothing was saved. Try the test again.</p>';
      }
    },
    onBlocked(message) {
      cueText.textContent = message;
      unlock();
    },
  });

  startButton.addEventListener('click', () => {
    const measure = measureOnly();
    const ref = reference();
    const surfaceName = normalizeName(surfaceInput.value);
    if (!measure && (!ref || !person)) return;
    if (!measure && !surfaceName) {
      formError.textContent = 'Enter the name of the surface first.';
      return;
    }
    formError.textContent = '';
    const chosen = routine();
    const started: RunInputs = {
      measureOnly: measure,
      routine: chosen,
      surfaceName,
      surfaceType: typeSelect.value as SurfaceType,
    };
    if (person) started.person = person;
    if (!measure && ref) {
      started.ref = ref.stats;
      const recorded = referenceRig(ref);
      if (recorded) started.referenceRig = recorded;
    }
    if (chosen === 'rig-drop') started.rig = personRig(person);
    inputs = started;
    running = true;
    startButton.disabled = true;
    lockedFields.forEach((field) => (field.disabled = true));
    result.hidden = true;
    feedback.textContent = '';
    usableCount.textContent = `0 of ${GOAL_REPS} usable reps`;
    dots.forEach((dot) => dot.setAttribute('data-state', 'pending'));
    void run.start(started.routine, started.ref, started.rig);
  });
  finishButton.addEventListener('click', () => run.finishNow());
  skipButton.addEventListener('click', () => run.skipRest());

  return () => {
    mounted = false;
    run.dispose();
  };
}
