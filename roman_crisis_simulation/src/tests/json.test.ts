/**
 * tests/json.test.ts
 *
 * Task 8c (task-8c-brief.md) - Task 5 review Group F1
 * (`preserve-caught-error` in ai/core/json.ts::parseModelJson).
 *
 * Proves the existing contextual error message is unchanged AND that the
 * original SyntaxError thrown by JSON.parse is preserved via Error.cause,
 * so the failure's original stack/identity is no longer silently dropped.
 */
import { describe, it, expect } from 'vitest';
import { parseModelJson } from '../ai/core/json';

describe('parseModelJson', () => {
  it('chains the original SyntaxError as the cause of its contextual error', () => {
    let caught: unknown;
    try {
      parseModelJson('{not valid json');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    expect(err.message).toMatch(
      /^parseModelJson: failed to parse model output as JSON \(.*\)\. Offending text: "\{not valid json"$/
    );
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });
});
