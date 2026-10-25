import { mkdirSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture } from './index';

describe('loadFixture', () => {
  it('reads a committed fixture through parseRecording', () => {
    const rec = loadFixture('example');
    expect(rec.version).toBe(1);
    expect(rec.label).toBe('example');
    expect(rec.traces[0]!.samples).toHaveLength(3);
  });

  it('reads the real desk-chair recording as five sit-drops', () => {
    const rec = loadFixture('desk-chair-set1');
    expect(rec.traces).toHaveLength(5);
    expect(rec.traces.every((t) => t.routine === 'sit-drop')).toBe(true);
  });

  it('reads the real couch recording as five sit-drops', () => {
    const rec = loadFixture('couch-set1');
    expect(rec.traces).toHaveLength(5);
    expect(rec.traces.every((t) => t.routine === 'sit-drop')).toBe(true);
  });

  it('reads the real mesh chair recording as five sit-drops without the user agent', () => {
    const rec = loadFixture('mesh-chair-set1');
    expect(rec.traces).toHaveLength(5);
    expect(rec.traces.every((t) => t.routine === 'sit-drop')).toBe(true);
    expect(rec.traces.every((t) => !t.device.includes('Mozilla'))).toBe(true);
    expect(rec.traces.every((t) => t.samples[0]!.t === 0)).toBe(true);
  });

  it.each(['hard-chair-set2', 'hard-chair-held-out-set1'])('reads %s as five sit-drops without the user agent', (name) => {
    const rec = loadFixture(name);
    expect(rec.traces).toHaveLength(5);
    expect(rec.traces.every((t) => t.routine === 'sit-drop')).toBe(true);
    expect(rec.traces.every((t) => !t.device.includes('Mozilla'))).toBe(true);
    expect(rec.traces.every((t) => t.samples[0]!.t === 0)).toBe(true);
  });

  it('names the fixture when it does not exist', () => {
    expect(() => loadFixture('no-such-fixture')).toThrow(/no-such-fixture/);
  });
});

describe('loadFixture read errors', () => {
  const dir = new URL('./fixtures/__is-a-dir.json', import.meta.url);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a read error other than a missing file as itself', () => {
    mkdirSync(dir);
    expect(() => loadFixture('__is-a-dir')).toThrow(/EISDIR/);
  });
});
