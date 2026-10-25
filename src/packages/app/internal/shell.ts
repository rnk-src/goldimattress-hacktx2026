import type { Coach } from '../../coach';
import type { SensorSource } from '../../sensors';
import type { Store } from '../../store';

export interface AppDeps {
  source: SensorSource;
  store: Store;
  makeCoach: () => Coach;
  now: () => Date;
  device: string;
  newId: () => string;
}

export const brandHeader = (mode: string) => `
  <header class="product-bar">
    <a class="brand" href="#/permission" aria-label="GoldiMattress home">
      <svg class="brand__mark" viewBox="0 0 36 24" aria-hidden="true">
        <path d="M2 8c4-5 8 5 12 0s8 5 12 0 6 0 8 2" />
        <path d="M2 15c4-5 8 5 12 0s8 5 12 0 6 0 8 2" />
      </svg>
      <span>GoldiMattress</span>
    </a>
    <span class="product-bar__mode">${mode}</span>
  </header>
`;
