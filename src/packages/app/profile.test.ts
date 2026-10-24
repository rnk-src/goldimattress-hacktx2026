import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreFullError, createLocalStore } from '../store';
import type { Store } from '../store';
import { memoryStorage } from '../testkit';
import { mountProfileScreen } from './index';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

const ids = () => {
  let n = 0;
  return () => `p${++n}`;
};
const submit = (name: string, weight = '') => {
  root.querySelector<HTMLInputElement>('input[name=name]')!.value = name;
  root.querySelector<HTMLInputElement>('input[name=weight]')!.value = weight;
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};
const listed = () => [...root.querySelectorAll('ul li')].map((li) => li.textContent);
const alertText = () => root.querySelector('[role=alert]')!.textContent;

describe('profile screen', () => {
  it('lists the people already in the store', async () => {
    const store = createLocalStore(memoryStorage());
    await store.savePerson({ id: 'p0', name: 'Ana', bodyMassKg: 62, references: {} });
    await mountProfileScreen(root, { store, newId: ids() });
    expect(listed()).toEqual(['Ana (62 kg)']);
  });

  it('creates a person from a name, saves it, and clears the form', async () => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('  Ben  ');
    await vi.waitFor(() => expect(listed()).toEqual(['Ben']));
    expect(await store.listPeople()).toEqual([{ id: 'p1', name: 'Ben', references: {} }]);
    expect(root.querySelector<HTMLInputElement>('input[name=name]')!.value).toBe('');
  });

  it('saves an optional body weight', async () => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('Ana', '62.5');
    await vi.waitFor(() => expect(listed()).toEqual(['Ana (62.5 kg)']));
    expect((await store.listPeople())[0]).toMatchObject({ bodyMassKg: 62.5 });
  });

  it('keeps the profile after a reload', async () => {
    const storage = memoryStorage();
    const first = await mountProfileScreen(root, { store: createLocalStore(storage), newId: ids() });
    submit('Ana');
    await vi.waitFor(() => expect(listed()).toEqual(['Ana']));
    first();

    const reloaded = document.createElement('div');
    root = reloaded;
    await mountProfileScreen(reloaded, { store: createLocalStore(storage), newId: ids() });
    expect(listed()).toEqual(['Ana']);
  });

  it('refuses an empty name and saves nothing', async () => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('   ');
    await vi.waitFor(() => expect(alertText()).toMatch(/name/i));
    expect(await store.listPeople()).toEqual([]);
  });

  it.each(['abc', '-5', '0', '0x50', '1e2', '12abc', '501', 'Infinity'])('refuses the body weight %j and saves nothing', async (weight) => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('Ana', weight);
    await vi.waitFor(() => expect(alertText()).toMatch(/weight/i));
    expect(await store.listPeople()).toEqual([]);
  });

  it('saves one profile when the form is submitted twice quickly', async () => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('Ana');
    submit('Ana');
    await vi.waitFor(() => expect(listed()).toEqual(['Ana']));
    expect(await store.listPeople()).toHaveLength(1);
  });

  it('disables the button while saving and enables it again after', async () => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    const button = root.querySelector('button')!;
    submit('Ana');
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it('says it could not save when the store fails for another reason', async () => {
    const broken: Store = {
      ...createLocalStore(memoryStorage()),
      savePerson: () => Promise.reject(new Error('blocked')),
    };
    await mountProfileScreen(root, { store: broken, newId: ids() });
    submit('Ana');
    await vi.waitFor(() => expect(alertText()).toMatch(/could not save/i));
    expect(root.querySelector('button')!.disabled).toBe(false);
  });

  it.each([['62,5', 62.5], ['70', 70], ['500', 500]])('reads the body weight %j as %s kg', async (text, kg) => {
    const store = createLocalStore(memoryStorage());
    await mountProfileScreen(root, { store, newId: ids() });
    submit('Ana', text);
    await vi.waitFor(async () => expect((await store.listPeople())[0]).toMatchObject({ bodyMassKg: kg }));
  });

  it('tells the user when the phone storage is full', async () => {
    const full: Store = {
      ...createLocalStore(memoryStorage()),
      savePerson: () => Promise.reject(new StoreFullError()),
    };
    await mountProfileScreen(root, { store: full, newId: ids() });
    submit('Ana');
    await vi.waitFor(() => expect(alertText()).toMatch(/full/i));
  });

  it('removes itself from the page on unmount', async () => {
    const store = createLocalStore(memoryStorage());
    const unmount = await mountProfileScreen(root, { store, newId: ids() });
    unmount();
    expect(root.children).toHaveLength(0);
  });
});

