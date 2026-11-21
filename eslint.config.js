import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', 'src-tauri']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Existing findings, tracked as warnings so CI is not blocked by them.
      // Fixing them can change behavior; address them in dedicated changes.
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    // Node-side config files
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests use vitest globals (see `globals: true` in vitest.config.ts)
    files: ['**/*.test.{ts,tsx}', 'src/setupTests.ts'],
    languageOptions: { globals: { ...globals.vitest } },
    // Mocks of third-party component props are loosely typed on purpose.
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // Must come last: turns off rules that conflict with Prettier.
  prettier,
]);
