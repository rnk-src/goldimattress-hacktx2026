import { defineConfig } from 'vitest/config';
import groups from './package-groups.cjs';

const { domPackages } = groups;
const boundaries = 'src/boundaries.test.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [boundaries, ...domPackages.map((p) => `src/packages/${p}/**`)],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: domPackages.map((p) => `src/packages/${p}/**/*.test.ts`),
        },
      },
      {
        test: {
          name: 'boundaries',
          environment: 'node',
          include: [boundaries],
          // Spawns depcruise and loads the ESLint config; allow for cold CI runners.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
