/** Enforces the package boundaries in the spec (#1). */
const allowed = {
  app: ['domain', 'signal', 'session', 'sensors', 'store', 'coach', 'testkit', 'listings'],
  session: ['signal', 'domain'],
  signal: ['domain'],
  sensors: ['domain'],
  store: ['domain'],
  coach: ['domain'],
  listings: ['domain'],
  testkit: ['sensors', 'domain'],
  domain: [],
};
const pkgs = Object.keys(allowed);

module.exports = {
  forbidden: [
    ...pkgs.map((pkg) => ({
      name: `${pkg}-imports`,
      comment: `${pkg} may import only: ${allowed[pkg].join(', ') || 'nothing'}.`,
      severity: 'error',
      from: { path: `^src/packages/${pkg}/` },
      to: {
        path: '^src/packages/',
        pathNot: [`^src/packages/${pkg}/`, ...allowed[pkg].map((p) => `^src/packages/${p}/`)],
      },
    })),
    {
      name: 'no-cross-package-internal',
      comment: 'Reach other packages only through their index.ts.',
      severity: 'error',
      from: { path: '^src/packages/([^/]+)/' },
      to: { path: '^src/packages/([^/]+)/internal/', pathNot: '^src/packages/$1/' },
    },
    {
      name: 'testkit-tests-only',
      comment: 'Only test files may import testkit.',
      severity: 'error',
      from: { pathNot: ['\\.test\\.ts$', '^src/packages/testkit/'] },
      to: { path: '^src/packages/testkit/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
  },
};
