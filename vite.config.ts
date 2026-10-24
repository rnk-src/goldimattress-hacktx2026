import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the build under the repo path; dev and tunnels use the root.
  base: command === 'build' ? '/goldimattress-hacktx2026/' : '/',
  server: {
    // A leading dot allows the hostname and its subdomains without accepting arbitrary hosts.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app'],
  },
}));
