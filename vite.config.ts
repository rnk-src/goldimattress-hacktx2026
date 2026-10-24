import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the build under the repo path; dev and tunnels use the root.
  base: command === 'build' ? '/goldimattress-hacktx2026/' : '/',
}));
