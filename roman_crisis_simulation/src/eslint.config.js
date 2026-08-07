import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tooling/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These six rules were seeded at 'warn' to tolerate a 17-item legacy
      // inventory (roadmaps/BACKLOG.md B11) while it was burned down. That
      // inventory reached zero (tooling/eslint-warning-baseline.json is
      // empty), so the ratchet is locked: each is now 'error'. A future
      // deliberate exception goes through an inline disable with a
      // justification comment, or back through the baseline machinery
      // (tooling/lint-baseline.mjs) with a matching B11 entry.
      // The one accepted `any` (ai/core/geminiService.ts's Zod escape
      // hatch) carries its own inline disable.
      '@typescript-eslint/no-explicit-any': 'error',
      // `ignoreRestSiblings` recognizes the deliberate
      // `const { drop, ...rest } = obj` omit idiom (used by the narration
      // redaction that strips gm_private/secret_truth fields) instead of
      // flagging the omitted name as an unused variable.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'prefer-const': 'error',
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
      'react-hooks/set-state-in-effect': 'error',
    },
  }
);
