import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    // API source files
    files: ['api/src/**/*.ts'],
    ignores: ['api/src/**/*.test.ts', 'api/src/**/*.spec.ts', 'api/src/test/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './api/tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Web source files
    files: ['web/src/**/*.ts', 'web/src/**/*.tsx'],
    ignores: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx', 'web/src/**/*.spec.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './web/tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
