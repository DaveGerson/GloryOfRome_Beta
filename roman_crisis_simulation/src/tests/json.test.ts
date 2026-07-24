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

describe('parseModelJson wrapped JSON extraction', () => {
  it('extracts wrapped nonempty and empty top-level arrays', () => {
    expect(parseModelJson('Preamble\n[{"id":"one"},{"id":"two"}]\nPostamble')).toEqual([
      { id: 'one' },
      { id: 'two' },
    ]);
    expect(parseModelJson('Preamble [] Postamble')).toEqual([]);
  });

  it('extracts the first complete top-level object before later JSON', () => {
    expect(parseModelJson('Preamble {"first":{"items":[1,2]}} between ["later"]')).toEqual({
      first: { items: [1, 2] },
    });
  });

  it('balances nested arrays and objects without treating escaped quotes or brackets in strings as structure', () => {
    const raw = 'Before [{"message":"literal ] } and \\"quoted\\" text","nested":{"items":[1,{"text":"["}]}}] After';

    expect(parseModelJson(raw)).toEqual([{
      message: 'literal ] } and "quoted" text',
      nested: { items: [1, { text: '[' }] },
    }]);
  });

  it('rejects malformed or absent top-level JSON instead of salvaging a nested fragment', () => {
    expect(() => parseModelJson('Preamble [{"value":1}')).toThrow('failed to parse model output as JSON');
    expect(() => parseModelJson('Preamble with no structured value')).toThrow('failed to parse model output as JSON');
  });
});
