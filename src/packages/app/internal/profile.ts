import type { Person } from '../../domain';
import { StoreFullError } from '../../store';
import type { Store } from '../../store';

export interface ProfileDeps {
  store: Store;
  newId: () => string;
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
  const alert = form.querySelector('[role=alert]')!;
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
    const name = nameInput.value.trim();
    if (!name) {
      alert.textContent = 'Enter a name.';
      return;
    }
    const weightText = weightInput.value.trim();
    const bodyMassKg = weightText === '' ? undefined : Number(weightText);
    if (bodyMassKg !== undefined && !(Number.isFinite(bodyMassKg) && bodyMassKg > 0)) {
      alert.textContent = 'Enter a body weight in kg above 0, or leave it blank.';
      return;
    }
    try {
      await store.savePerson({
        id: newId(),
        name,
        ...(bodyMassKg !== undefined && { bodyMassKg }),
        references: {},
      });
    } catch (e) {
      if (!(e instanceof StoreFullError)) throw e;
      alert.textContent = 'Phone storage is full. Free some space and try again.';
      return;
    }
    alert.textContent = '';
    form.reset();
    await renderList();
  });

  await renderList();
  return () => root.replaceChildren();
}
