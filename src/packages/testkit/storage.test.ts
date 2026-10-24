import { describe, expect, it } from 'vitest';
import { memoryStorage } from './index';

describe('memoryStorage', () => {
  it('stores, reads and removes values like localStorage', () => {
    const s = memoryStorage();
    expect(s.getItem('k')).toBeNull();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('throws QuotaExceededError when the total size passes the limit', () => {
    const s = memoryStorage({ limitChars: 10 });
    s.setItem('a', '123456');
    expect(() => s.setItem('b', '1234567')).toThrow(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    );
    expect(s.getItem('b')).toBeNull();
  });

  it('counts a replaced value once, not twice', () => {
    const s = memoryStorage({ limitChars: 10 });
    s.setItem('a', '123456789');
    expect(() => s.setItem('a', '987654321')).not.toThrow();
  });
});
