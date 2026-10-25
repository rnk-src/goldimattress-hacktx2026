import { describe, expect, it } from 'vitest';
import type { Verdict } from '../domain';
import { loadFixture } from '../testkit';
import { analyzeRep, buildReference, compare } from './index';

/** Three real sets from one person on an iPhone: desk chair, couch and a thin-cushion chair (firm, springy). */
const traces = (name: string) => loadFixture(name).traces;

/** Calibrate on one real set and test another, as the app would. */
function verdict(reference: string, tested: string): Verdict {
  const built = buildReference(traces(reference).map((t) => analyzeRep(t)), 'sit-drop');
  if (!built.ok) throw new Error('no reference');
  return compare(traces(tested).map((t) => analyzeRep(t, built.ref)), built.ref);
}

describe('real surfaces, springiness', () => {
  it('reads the thin-cushion chair as bouncier than the desk chair, with enough usable reps', () => {
    const v = verdict('desk-chair-set1', 'thin-cushion-chair-set1');
    expect(v.bouncier).toBe(true);
    expect(v.springinessLabel).not.toBe('just-right');
    expect(v.confidence).not.toBe('not-enough-data');
  });

  it('reads the desk chair as less bouncy than the thin-cushion chair', () => {
    const v = verdict('thin-cushion-chair-set1', 'desk-chair-set1');
    expect(v.bouncier).toBe(false);
  });

  it('reads the couch as less bouncy than the thin-cushion chair', () => {
    const v = verdict('thin-cushion-chair-set1', 'couch-set1');
    expect(v.bouncier).toBe(false);
    expect(v.springinessLabel).not.toBe('just-right');
  });

  it('reads the thin-cushion chair as firmer than the desk chair', () => {
    expect(verdict('desk-chair-set1', 'thin-cushion-chair-set1').firmer).toBe(true);
  });

  it('reads each set against itself as just right', () => {
    for (const name of ['desk-chair-set1', 'couch-set1', 'thin-cushion-chair-set1']) {
      const v = verdict(name, name);
      expect(v.springinessLabel).toBe('just-right');
    }
  });
});
