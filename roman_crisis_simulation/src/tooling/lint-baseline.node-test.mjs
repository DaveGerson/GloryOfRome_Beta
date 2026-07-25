import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateWarningBaseline } from './lint-baseline.mjs';

const acceptedWarnings = [
  {
    file: 'ai/core/engine.ts',
    line: 343,
    column: 34,
    ruleId: '@typescript-eslint/no-unused-vars',
    message: "'e' is defined but never used.",
  },
  {
    file: 'components/ui/Core.tsx',
    line: 12,
    column: 20,
    ruleId: '@typescript-eslint/no-explicit-any',
    message: 'Unexpected any. Specify a different type.',
  },
];

test('accepts the exact warning baseline when ESLint reports no errors', () => {
  const result = evaluateWarningBaseline({
    acceptedWarnings,
    actualWarnings: [
      {
        file: 'ai/core/engine.ts',
        line: 343,
        column: 34,
        ruleId: '@typescript-eslint/no-unused-vars',
        message: "'e' is defined but never used.",
      },
      {
        file: 'components/ui/Core.tsx',
        line: 12,
        column: 20,
        ruleId: '@typescript-eslint/no-explicit-any',
        message: 'Unexpected any. Specify a different type.',
      },
    ],
    errorCount: 0,
  });

  assert.deepEqual(result, {
    ok: true,
    errorCount: 0,
    added: [],
    removed: [],
  });
});

test('rejects an added warning fingerprint', () => {
  const addedWarning = {
    file: 'new-warning.ts',
    line: 9,
    column: 3,
    ruleId: 'no-debugger',
    message: "Unexpected 'debugger' statement.",
  };

  const result = evaluateWarningBaseline({
    acceptedWarnings,
    actualWarnings: [...acceptedWarnings, addedWarning],
    errorCount: 0,
  });

  assert.deepEqual(result, {
    ok: false,
    errorCount: 0,
    added: [addedWarning],
    removed: [],
  });
});

test('rejects a removed warning fingerprint so the baseline must ratchet down', () => {
  const result = evaluateWarningBaseline({
    acceptedWarnings,
    actualWarnings: [acceptedWarnings[0]],
    errorCount: 0,
  });

  assert.deepEqual(result, {
    ok: false,
    errorCount: 0,
    added: [],
    removed: [acceptedWarnings[1]],
  });
});

test('rejects a same-count warning substitution', () => {
  const substitutedWarning = {
    file: 'new-warning.ts',
    line: 9,
    column: 3,
    ruleId: 'no-debugger',
    message: "Unexpected 'debugger' statement.",
  };

  const result = evaluateWarningBaseline({
    acceptedWarnings,
    actualWarnings: [acceptedWarnings[0], substitutedWarning],
    errorCount: 0,
  });

  assert.deepEqual(result, {
    ok: false,
    errorCount: 0,
    added: [substitutedWarning],
    removed: [acceptedWarnings[1]],
  });
});

test('rejects ESLint errors even when every warning fingerprint is exact', () => {
  const result = evaluateWarningBaseline({
    acceptedWarnings,
    actualWarnings: acceptedWarnings,
    errorCount: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    errorCount: 1,
    added: [],
    removed: [],
  });
});
