import { describe, expect, it } from 'vitest';
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
