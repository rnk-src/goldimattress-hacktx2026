import { defineConfig } from 'vitest/config';

// Packages whose tests need a DOM. Keep in step with the pure-package list in eslint.config.js.
const domPackages = ['sensors', 'store', 'coach', 'app'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Boundary tests spawn depcruise and load the ESLint config; allow for cold CI runners.
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: domPackages.map((p) => `src/packages/${p}/**`),
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: domPackages.map((p) => `src/packages/${p}/**/*.test.ts`),
        },
      },
    ],
  },
});
