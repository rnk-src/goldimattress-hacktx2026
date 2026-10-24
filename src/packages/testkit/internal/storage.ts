/**
 * In-memory stand-in for `localStorage`. Past `limitChars` (keys plus values) `setItem`
 * throws a `QuotaExceededError`, as browsers do. Matches the store package's `StorageLike`.
 */
export function memoryStorage(opts: { limitChars?: number } = {}) {
  const data = new Map<string, string>();
  const size = () => [...data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    getItem: (k: string): string | null => data.get(k) ?? null,
    setItem(k: string, v: string): void {
      const previous = data.get(k);
      data.set(k, v);
      if (opts.limitChars !== undefined && size() > opts.limitChars) {
        if (previous === undefined) data.delete(k);
        else data.set(k, previous);
        throw new DOMException('Storage is full', 'QuotaExceededError');
      }
    },
    removeItem: (k: string): void => void data.delete(k),
  };
}
