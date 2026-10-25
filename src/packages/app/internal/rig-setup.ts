import type { Person, RigSetup } from '../../domain';
import { RecordingFormatError, parseRig } from '../../sensors';
import { personRig, rigSummary } from './rig';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';

const MAX_DROP_CM = 10;
const DECIMAL = /^\d+([.,]\d+)?$/;

/** Plain digits with an optional . or , decimal; anything else is not a number. */
const toNumber = (text: string): number | undefined => (DECIMAL.test(text) ? Number(text.replace(',', '.')) : undefined);

/** The rig the form describes, or the message to show. A blank mass means the standard rig mass. */
function readForm(form: { dropHeightCm: string; spot: string; massKg: string }): { rig: RigSetup } | { error: string } {
  const base = personRig();
  const height = toNumber(form.dropHeightCm.trim());
  if (height === undefined || height <= 0 || height > MAX_DROP_CM) {
    return { error: `Enter the spacer height in cm, from 1 to ${MAX_DROP_CM}. Never drop from higher.` };
  }
  const massText = form.massKg.trim();
  const mass = massText === '' ? base.massKg : toNumber(massText);
  if (mass === undefined || mass <= 0) {
    return { error: 'Enter the mass in kg, for example 2.1, or leave it blank for the standard rig.' };
  }
  try {
    return { rig: parseRig({ massKg: mass, baseCm: base.baseCm, dropHeightCm: height, spot: form.spot }, 'rig') };
  } catch (e) {
    return { error: e instanceof RecordingFormatError ? 'That rig setup is not valid.' : 'Could not read the rig setup.' };
  }
}

/** The rig setup screen: strap and spacer instructions, the release height, the test spot and a mass override. */
export function rigSetupView(root: HTMLElement, deps: AppDeps): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Rig setup')}
      <main class="app-main rig-view">
        <h1>Rig setup</h1>
        <ol data-rig-help class="protocol-list">
          <li>Strap the phone face up on the steel slab, its back flat on the silicone sheet.</li>
          <li>Rest the slab flat on a spacer, 5 to 10 cm high, over the spot you test.</li>
          <li>Hold the slab level with both hands, then let go with both hands at once.</li>
        </ol>
        <label data-profile-control hidden>Profile <select name="person"></select></label>
        <form aria-label="Rig setup">
          <div class="field-grid">
            <label><span>Spacer height (cm)</span><input name="dropHeightCm" inputmode="decimal" value="5"></label>
            <label><span>Test spot</span>
              <select name="spot">
                <option value="center">Middle of a mattress</option>
                <option value="seat-middle">Middle of a seat</option>
                <option value="other">Another spot</option>
              </select>
            </label>
          </div>
          <details>
            <summary>Advanced: use another slab or a heavy flat object</summary>
            <label><span>Mass with the phone (kg), blank for the standard rig</span><input name="massKg" inputmode="decimal" value=""></label>
          </details>
          <button class="button button--primary" type="submit" disabled>Save rig setup</button>
          <p data-rig-status role="status" aria-live="polite">Loading profiles…</p>
          <p data-rig-current></p>
        </form>
        <p><a href="#/calibrate">Calibrate</a> · <a href="#/test">Test a surface</a></p>
      </main>
    </div>
  `;
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const profileControl = q('[data-profile-control]');
  const profileSelect = q<HTMLSelectElement>('select[name="person"]');
  const form = q<HTMLFormElement>('form');
  const heightInput = q<HTMLInputElement>('input[name="dropHeightCm"]');
  const massInput = q<HTMLInputElement>('input[name="massKg"]');
  const spotSelect = q<HTMLSelectElement>('select[name="spot"]');
  const saveButton = q<HTMLButtonElement>('button[type="submit"]');
  const status = q('[data-rig-status]');
  const current = q('[data-rig-current]');
  let mounted = true;
  let people: Person[] = [];
  let person: Person | undefined;

  const show = () => {
    const rig = personRig(person);
    heightInput.value = String(rig.dropHeightCm);
    spotSelect.value = rig.spot;
    massInput.value = person?.rig && rig.massKg !== personRig().massKg ? String(rig.massKg) : '';
    current.textContent = person ? `Current rig for ${person.name}: ${rigSummary(rig)}.` : '';
  };

  void deps.store
    .listPeople()
    .then((list) => {
      if (!mounted) return;
      people = list;
      person = list[0];
      profileSelect.replaceChildren(
        ...list.map((p) => {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name;
          return option;
        }),
      );
      profileControl.hidden = list.length === 0;
      saveButton.disabled = person === undefined;
      status.textContent = person ? '' : 'Create a profile first, then set up its rig.';
      show();
    })
    .catch(() => {
      if (mounted) status.textContent = 'Could not load profiles. Reload this page to try again.';
    });
  profileSelect.addEventListener('change', () => {
    person = people.find((p) => p.id === profileSelect.value);
    status.textContent = '';
    show();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!person || saveButton.disabled) return;
    const read = readForm({ dropHeightCm: heightInput.value, spot: spotSelect.value, massKg: massInput.value });
    if ('error' in read) {
      status.textContent = read.error;
      return;
    }
    const personId = person.id;
    saveButton.disabled = true;
    void (async () => {
      let message = 'Rig setup saved.';
      try {
        // Re-read the person so only the rig changes if the profile was edited elsewhere.
        const fresh = (await deps.store.listPeople()).find((p) => p.id === personId);
        if (!fresh) throw new Error('profile missing');
        const saved = { ...fresh, rig: read.rig };
        await deps.store.savePerson(saved);
        if (mounted) {
          people = people.map((p) => (p.id === saved.id ? saved : p));
          if (person?.id === saved.id) person = saved;
          show();
        }
      } catch {
        message = 'Could not save the rig setup. Try again.';
      }
      if (mounted) {
        status.textContent = message;
        saveButton.disabled = person === undefined;
      }
    })();
  });

  return () => {
    mounted = false;
  };
}
