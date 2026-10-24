import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nonDomGlobals = { ...globals.es2021, ...globals.node };
// Browser globals Node also defines. Pure packages must not use them either.
const sharedWithNode = ['navigator', 'performance', 'fetch', 'localStorage', 'sessionStorage', 'location'];
const domOnly = [
  ...new Set([
    ...Object.keys(globals.browser).filter((name) => !(name in nonDomGlobals)),
    ...sharedWithNode,
  ]),
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.dependency-cruiser.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/packages/{domain,signal,session,listings}/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...domOnly.map((name) => ({ name, message: 'No DOM use in pure packages.' })),
      ],
    },
  },
);
