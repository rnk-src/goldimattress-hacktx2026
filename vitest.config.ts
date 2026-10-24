import { defineConfig } from 'vitest/config';

const domPackages = ['sensors', 'store', 'coach', 'app'];

export default defineConfig({
  test: {
    passWithNoTests: true,
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
