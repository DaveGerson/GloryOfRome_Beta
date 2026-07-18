/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { inferAmbition, zAmbitionInference } from '../ai/tools/ambition';
import { AiServiceError, GeminiClient } from '../ai/core/geminiService';
import type { Entity } from '../types';

// --- fixtures --------------------------------------------------------------

function makePlayer(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    entity_type: 'individual',
    status: 'alive',
    position: 'Emperor',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: { denarii: 5000 },
    visibility_network: [],
    current_state_narrative: 'Beset on all sides by rivals.',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

/** Minimal mock GeminiClient - a queue of raw-text responses, matching tests/mortality.test.ts's convention. */
function makeMockAi(...responses: string[]): { ai: GeminiClient; generateContent: ReturnType<typeof vi.fn> } {
  const generateContent = vi.fn();
  responses.forEach(text => generateContent.mockResolvedValueOnce({ text }));
  return { ai: { models: { generateContent } }, generateContent };
}

describe('ai/tools/ambition.ts', () => {
  describe('zAmbitionInference (local schema)', () => {
    it('accepts a well-formed inference', () => {
      const result = zAmbitionInference.safeParse({
        apparent_ambition: 'Appears to be currying favor with the legions.',
        confidence: 'medium',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an out-of-enum confidence value', () => {
      const result = zAmbitionInference.safeParse({
        apparent_ambition: 'Appears to be currying favor with the legions.',
        confidence: 'certain', // not in ['low', 'medium', 'high']
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing apparent_ambition field', () => {
      const result = zAmbitionInference.safeParse({ confidence: 'high' });
      expect(result.success).toBe(false);
    });
  });

  describe('inferAmbition', () => {
    it('returns the parsed structured output from a mocked GeminiClient', async () => {
      const { ai, generateContent } = makeMockAi(
        JSON.stringify({
          apparent_ambition: 'Appears to be consolidating personal loyalty within the legions at the Senate\'s expense.',
          confidence: 'high',
        })
      );

      const player = makePlayer();
      const result = await inferAmbition(
        ai,
        player,
        ['appease the frontier legions', 'bribe the praetorian prefect', 'ignore the Senate\'s summons'],
        ['The legions cheer their emperor.', 'The Senate grumbles in private.'],
        /* isMockMode */ false
      );

      expect(result).toEqual({
        apparent_ambition: 'Appears to be consolidating personal loyalty within the legions at the Senate\'s expense.',
        confidence: 'high',
      });
      expect(generateContent).toHaveBeenCalledTimes(1);

      // Sanity-check the call was routed through the flash tier with the
      // player's brief and the recent intents/headlines embedded - not
      // just that a call happened at all.
      const call = generateContent.mock.calls[0][0];
      expect(call.model).toBe('gemini-2.5-flash');
      expect(call.contents).toContain('bribe the praetorian prefect');
      expect(call.contents).toContain('The legions cheer their emperor.');
    });

    it('mock mode short-circuits to a canned value without calling the model', async () => {
      const { ai, generateContent } = makeMockAi('should never be read');

      const player = makePlayer();
      const result = await inferAmbition(ai, player, ['some action'], ['some headline'], /* isMockMode */ true);

      expect(result.apparent_ambition).toEqual(expect.any(String));
      expect(['low', 'medium', 'high']).toContain(result.confidence);
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('rejects when the model response is malformed even after the repair-retry (service layer handles the retry; this only asserts the wrapper propagates the failure)', async () => {
      // Two consecutive schema-invalid responses: the first triggers
      // generateStructured's one automatic repair-retry, and the second
      // (still invalid) exhausts it, producing a fatal AiServiceError.
      const { ai } = makeMockAi(
        JSON.stringify({ confidence: 'medium' }), // missing apparent_ambition
        JSON.stringify({ confidence: 'medium' })  // still missing it after "repair"
      );

      const player = makePlayer();
      await expect(
        inferAmbition(ai, player, ['some action'], ['some headline'], /* isMockMode */ false)
      ).rejects.toBeInstanceOf(AiServiceError);
    });

    it('rejects when the model response is not parseable JSON at all', async () => {
      const { ai } = makeMockAi('not json at all', 'still not json');

      const player = makePlayer();
      await expect(
        inferAmbition(ai, player, [], [], /* isMockMode */ false)
      ).rejects.toBeInstanceOf(AiServiceError);
    });
  });
});
