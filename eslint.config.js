import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Pre-existing debt. These stay warn because the volume is still high
      // (no-explicit-any, no-unused-vars, exhaustive-deps) or the fix is a
      // type-signature change (no-unsafe-function-type). The lint script caps
      // the warning count so this debt cannot grow. Restored to error (recommended
      // default): react-hooks/rules-of-hooks, prefer-const, no-extra-boolean-cast,
      // no-useless-catch, no-empty, no-case-declarations, no-prototype-builtins,
      // @typescript-eslint/no-empty-object-type.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  }
);
