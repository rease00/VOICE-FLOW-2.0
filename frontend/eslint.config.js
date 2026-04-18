import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      '.next/**',
      '.next-*/**',
      '.next-buildcheck/**',
      '.next-ci/**',
      '.next-playwright/**',
      '.next_probe/**',
      '.open-next/**',
      '.wrangler/**',
      'artifacts/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'tmp_dir/**',
      'test-results/**',
      'coverage/**',
      'storybook-static/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The compiler advisory pass is currently unstable on a few large workspace files
      // in this repo and can crash ESLint before normal hook diagnostics are reported.
      'react-hooks/static-components': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
];
