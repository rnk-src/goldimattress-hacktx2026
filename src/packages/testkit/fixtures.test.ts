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
