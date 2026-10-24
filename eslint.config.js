import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nonDomGlobals = { ...globals.es2021, ...globals.node };
const domOnly = Object.keys(globals.browser).filter((name) => !(name in nonDomGlobals));

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
