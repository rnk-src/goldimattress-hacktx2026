/** Package boundaries from the spec (#1). Each package lists what it may import. */
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

const isTest = '\\.test\\.ts$';

// Test files may also use testkit; production files may not.
const importRules = Object.entries(allowed).flatMap(([pkg, may]) => [
  {
    name: `${pkg}-imports`,
    severity: 'error',
    from: { path: `^src/packages/${pkg}/`, pathNot: isTest },
    to: { path: '^src/packages/', pathNot: [pkg, ...may].map((p) => `^src/packages/${p}/`) },
  },
  {
    name: `${pkg}-test-imports`,
    severity: 'error',
    from: { path: `^src/packages/${pkg}/.*${isTest}` },
    to: {
      path: '^src/packages/',
      pathNot: [pkg, ...may, 'testkit'].map((p) => `^src/packages/${p}/`),
    },
  },
]);

const indexOnly = '^src/packages/[^/]+/index\\.ts$';

module.exports = {
  forbidden: [
    ...importRules,
    {
      name: 'index-only',
      severity: 'error',
      from: { path: '^src/packages/([^/]+)/' },
      to: { path: '^src/packages/', pathNot: ['^src/packages/$1/', indexOnly] },
    },
    {
      // Same rule for files outside every package, such as src/main.ts.
      name: 'index-only',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/packages/' },
      to: { path: '^src/packages/', pathNot: indexOnly },
    },
    {
      name: 'testkit-tests-only',
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
