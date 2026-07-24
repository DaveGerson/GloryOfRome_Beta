import { describe, expect, it } from 'vitest';
import { parseModelJson } from '../ai/core/json';

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
