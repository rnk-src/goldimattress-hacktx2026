const MIN_SAMPLES_FOR_RATE = 20;

/** Measures the sample rate from sample times (seconds); null until 20 samples arrived. */
export interface RateMeter {
  add(t: number): void;
  reset(): void;
  readonly hz: number | null;
}

export function createRateMeter(): RateMeter {
  let count = 0;
  let firstT = 0;
  let lastT = 0;
  return {
    add(t) {
      if (count === 0) firstT = t;
      lastT = t;
      count += 1;
    },
    reset() {
      count = 0;
      firstT = 0;
      lastT = 0;
    },
    get hz() {
      if (count < MIN_SAMPLES_FOR_RATE || lastT <= firstT) return null;
      return (count - 1) / (lastT - firstT);
    },
  };
}
