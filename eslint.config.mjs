import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.local/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
