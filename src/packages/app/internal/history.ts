import type { Person, RepResult, Surface, TestRecord } from '../../domain';
import { analyzeRep, compare, isUsable, summarize } from '../../signal';
import { PLACEMENT } from './placement';
import { referenceRig, sameRig } from './rig';
import { brandHeader } from './shell';
import type { AppDeps } from './shell';
import { matchText } from './wording';

/**
 * Runs the current analysis over a stored test's raw traces. The session facts that no trace holds (rest
 * length and a skipped rest) are carried over from the stored rep. Throws a message for the user when the
 * test cannot be re-run, and then nothing is changed.
 */
function rerun(test: TestRecord, person: Person | undefined): TestRecord {
  const reference = person?.references[test.routine];
  if (!reference) throw new Error('That profile has no reference for this routine any more, so the verdict cannot be recomputed.');
  const reps: RepResult[] = test.reps.map((old) => {
    const fresh = analyzeRep(old.trace, reference.stats);
    if (!fresh.ok || !old.ok) return fresh;
    return {
      ...fresh,
      ...(old.restS !== undefined && { restS: old.restS }),
      ...(old.restSkipped !== undefined && { restSkipped: old.restSkipped }),
    };
  });
  if (!reps.some(isUsable)) throw new Error('No stored rep is usable under the current analysis, so the verdict is unchanged.');
  return { ...test, reps, verdict: compare(reps, reference.stats), index: summarize(reps).features };
}

/** The saved tests screen: each test with its match, and a button to re-run the analysis on its stored traces. */
export function historyView(root: HTMLElement, deps: AppDeps): () => void {
  root.innerHTML = `
    <div class="app-shell">
      ${brandHeader('Saved tests')}
      <main class="app-main history-view">
        <h1>Saved tests</h1>
        <p data-history-status role="status" aria-live="polite">Loading…</p>
        <ul data-history-list class="history-list"></ul>
        <p data-history-empty hidden>No saved tests yet. <a href="#/test">Test a surface</a></p>
      </main>
    </div>
  `;
  const status = root.querySelector<HTMLElement>('[data-history-status]')!;
  const list = root.querySelector<HTMLElement>('[data-history-list]')!;
  const empty = root.querySelector<HTMLElement>('[data-history-empty]')!;
  let mounted = true;
  let people: Person[] = [];
  let surfaces = new Map<string, Surface>();
  let tests: TestRecord[] = [];
  const running = new Set<string>();

  const rowText = (test: TestRecord): string => {
    const name = surfaces.get(test.surfaceId)?.name ?? 'Unnamed surface';
    const routine = PLACEMENT[test.routine]?.label.split(':')[0] ?? test.routine;
    return `${name} · ${routine} · ${test.createdAt.slice(0, 10)} · ${matchText(test.verdict)}`;
  };

  const render = () => {
    empty.hidden = tests.length > 0;
    list.replaceChildren(
      ...tests.map((test) => {
        const item = document.createElement('li');
        item.dataset.testRow = test.id;
        const label = document.createElement('span');
        try {
          label.textContent = rowText(test);
        } catch {
          label.textContent = `Unreadable test (${test.id})`;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--quiet';
        button.dataset.action = 'rerun';
        button.textContent = 'Re-run analysis';
        button.addEventListener('click', () => void rerunOne(test.id, button));
        item.append(label, button);
        return item;
      }),
    );
  };

  const rerunOne = async (id: string, button: HTMLButtonElement) => {
    if (running.has(id)) return;
    running.add(id);
    button.disabled = true;
    try {
      const old = tests.find((t) => t.id === id);
      if (!old) return;
      // Re-read the people so a reference recalibrated since this screen opened is the one used.
      people = await deps.store.listPeople();
      const person = people.find((p) => p.id === old.personId);
      const updated = rerun(old, person);
      await deps.store.saveTest(updated);
      tests = tests.map((t) => (t.id === id ? updated : t));
      if (mounted) {
        render();
        const testRig = old.reps.find((rep) => rep.trace.rig)?.trace.rig;
        const recorded = person?.references[old.routine] && referenceRig(person.references[old.routine]!);
        const rigNote = testRig && recorded && !sameRig(testRig, recorded) ? ' Your reference was recorded with a different rig setup than this test.' : '';
        status.textContent = `Analysis updated: ${matchText(updated.verdict)}, compared with your current reference.${rigNote}`;
      }
    } catch (error) {
      if (mounted) status.textContent = error instanceof Error ? error.message : 'Could not re-run the analysis.';
    } finally {
      running.delete(id);
      button.disabled = false;
    }
  };

  void Promise.all([deps.store.listTests(), deps.store.listPeople(), deps.store.findSurfaces('')])
    .then(([savedTests, savedPeople, savedSurfaces]) => {
      if (!mounted) return;
      tests = savedTests;
      people = savedPeople;
      surfaces = new Map(savedSurfaces.map((s) => [s.id, s]));
      status.textContent = '';
      render();
    })
    .catch(() => {
      if (mounted) status.textContent = 'Could not load the saved tests.';
    });

  return () => {
    mounted = false;
  };
}
