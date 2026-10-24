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
      name: 'index-only',
      comment: 'Reach other packages only through their index.ts.',
      severity: 'error',
      from: { path: '^src/packages/([^/]+)/' },
      to: {
        path: '^src/packages/',
        pathNot: ['^src/packages/$1/', '^src/packages/[^/]+/index\.ts$'],
      },
    },
    {
      name: 'main-index-only',
      comment: 'The composition root reaches packages only through their index.ts.',
      severity: 'error',
      from: { path: '^src/main\.ts$' },
      to: { path: '^src/packages/', pathNot: '^src/packages/[^/]+/index\.ts$' },
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
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
  },
};
