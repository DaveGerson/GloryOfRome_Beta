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
      // Task 5 (task-5-brief.md): seed rules so the current tree exits
      // zero without any source rewrite. Each downgrade below is a
      // deliberate, temporary allowance documented in task-5-report.md,
      // not a permanent stance on the rule.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Task 8a (task-8a-brief.md): `ignoreRestSiblings` recognizes the
      // deliberate `const { drop, ...rest } = obj` omit idiom (used by the
      // narration redaction that strips gm_private/secret_truth fields)
      // instead of flagging the omitted name as an unused variable.
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
      // typescript-eslint's eslint-recommended override; current tree has
      // existing `let` bindings that are never reassigned.
      'prefer-const': 'warn',
      // @eslint/js recommended; current tree has existing dead
      // reassignments that would need a source edit to remove.
      'no-useless-assignment': 'warn',
      // @eslint/js recommended; current tree has existing rethrows that
      // don't attach the original error as `cause`.
      'preserve-caught-error': 'warn',
      // eslint-plugin-react-hooks recommended; current tree has existing
      // effects that call setState synchronously (React Compiler-era
      // rule), which is a behavior-adjacent change out of scope here.
      'react-hooks/set-state-in-effect': 'warn',
    },
  }
);
