import type { Person } from '../../domain';
import { StoreFullError } from '../../store';
import type { Store } from '../../store';

export interface ProfileDeps {
  store: Store;
  newId: () => string;
}

const MIN_BODY_KG = 20;
const MAX_BODY_KG = 500;

/** Plain digits with an optional . or , decimal. Returns kg, or null when it is not a usable weight. */
function parseBodyKg(text: string): number | null {
  if (!/^\d+([.,]\d+)?$/.test(text)) return null;
  const kg = Number(text.replace(',', '.'));
  return kg >= MIN_BODY_KG && kg <= MAX_BODY_KG ? kg : null;
}

const describePerson = (p: Person) =>
  p.bodyMassKg === undefined ? p.name : `${p.name} (${p.bodyMassKg} kg)`;

/** Shows the saved profiles and a form to add one. Resolves once the list has rendered; returns unmount. */
export async function mountProfileScreen(
  root: HTMLElement,
  { store, newId }: ProfileDeps,
): Promise<() => void> {
  root.innerHTML = `
    <form aria-label="Create profile">
      <label>Name <input name="name" autocomplete="off"></label>
      <label>Body weight in kg, optional <input name="weight" inputmode="decimal"></label>
      <button type="submit">Create profile</button>
      <p role="alert"></p>
    </form>
    <ul aria-label="Profiles"></ul>`;
  const form = root.querySelector('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('input[name=name]')!;
  const weightInput = form.querySelector<HTMLInputElement>('input[name=weight]')!;
  const button = form.querySelector('button')!;
  const message = form.querySelector('[role=alert]')!;
  const list = root.querySelector('ul')!;

  const renderList = async () => {
    list.replaceChildren(
      ...(await store.listPeople()).map((p) => {
        const li = document.createElement('li');
        li.textContent = describePerson(p);
        return li;
      }),
    );
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const name = nameInput.value.trim();
    if (!name) {
      message.textContent = 'Enter a name.';
      return;
    }
    const weightText = weightInput.value.trim();
    const bodyMassKg = weightText === '' ? undefined : parseBodyKg(weightText);
    if (bodyMassKg === null) {
      message.textContent = `Enter a body weight in kg, from ${MIN_BODY_KG} to ${MAX_BODY_KG}, or leave it blank.`;
      return;
    }
    button.disabled = true;
    try {
      await store.savePerson({
        id: newId(),
        name,
        ...(bodyMassKg !== undefined && { bodyMassKg }),
        references: {},
      });
      form.reset();
      message.textContent = '';
    } catch (e) {
      message.textContent =
        e instanceof StoreFullError
          ? 'Phone storage is full. Free some space and try again.'
          : 'Could not save the profile. Try again.';
      return;
    } finally {
      button.disabled = false;
    }
    // The profile is saved by now, so a failure here must not read as "could not save".
    await renderList().catch(() => {
      message.textContent = 'Profile saved, but the list could not be refreshed.';
    });
  });

  await renderList();
  return () => root.replaceChildren();
}
