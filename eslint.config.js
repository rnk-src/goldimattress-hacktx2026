import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const domGlobals = Object.keys({ ...globals.browser });

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.dependency-cruiser.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/packages/{signal,session,listings}/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...domGlobals
          .filter((g) => !(g in globals.es2021) && !(g in globals.node))
          .map((name) => ({ name, message: 'No DOM use in pure packages.' })),
      ],
    },
  },
);
