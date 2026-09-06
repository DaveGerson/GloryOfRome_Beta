/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { inferAmbition, zAmbitionInference } from '../ai/tools/ambition';
import { AiServiceError } from '../ai/core/geminiService';
import { projectForExternalInference, serializeTurnSubmission } from '../playerInput/turnSubmission';
import { makeEntity, makeQueuedTextAi as makeMockAi } from './factories';
import type { Entity, TurnSubmission } from '../types';

// --- fixtures --------------------------------------------------------------

function makePlayer(overrides: Partial<Entity> = {}): Entity {
  return makeEntity({
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    position: 'Emperor',
    resources: { denarii: 5000 },
    current_state_narrative: 'Beset on all sides by rivals.',
    ...overrides,
  });
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
    it('passes only the exact player whitelist, observable submissions, and public headlines to apparent-ambition inference', async () => {
      const { ai, generateContent } = makeMockAi(
        JSON.stringify({
          apparent_ambition: 'Appears to be consolidating personal loyalty within the legions at the Senate\'s expense.',
          confidence: 'high',
        })
      );

      const player = makePlayer({
        voice: 'FORBIDDEN_VOICE_6T2',
        epithet: 'FORBIDDEN_EPITHET_6T2',
        status: 'exiled',
        location: 'FORBIDDEN_LOCATION_6T2',
        personality: { ambition: 91, paranoia: 92, loyalty: 93, cunning: 94, honor: 95 },
        faction_id: 'FORBIDDEN_FACTION_6T2',
        size: 9876,
        culture: { FORBIDDEN_CULTURE_6T2: ['FORBIDDEN_CULTURE_VALUE_6T2'] },
        faction_members: ['FORBIDDEN_MEMBER_6T2'],
        relationships: {
          forbidden_rival: {
            entity_id: 'FORBIDDEN_RELATION_ENTITY_6T2',
            relationship_type: 'FORBIDDEN_RELATION_TYPE_6T2',
            trust_level: -77,
            respect_level: 76,
            perceived_threat: 75,
            ideological_alignment: -74,
            dependency_level: 73,
            recent_interactions: ['FORBIDDEN_INTERACTION_6T2'],
          },
        },
        memories: [{
          turn: 2,
          event_description: 'FORBIDDEN_MEMORY_6T2',
          emotional_impact: 'FORBIDDEN_MEMORY_IMPACT_6T2',
          involved_entities: [],
        }],
        resources: { forbidden_resource: 'FORBIDDEN_RESOURCE_VALUE_6T2' },
        visibility_network: ['FORBIDDEN_VISIBILITY_6T2'],
        current_state_narrative: 'FORBIDDEN_STATE_NARRATIVE_6T2',
        short_term_goals: ['FORBIDDEN_SHORT_GOAL_6T2'],
        long_term_ambitions: ['FORBIDDEN_LONG_GOAL_6T2'],
        beliefs: ['FORBIDDEN_BELIEF_6T2'],
        secrets: ['FORBIDDEN_SECRET_6T2'],
        skills: { intrigue: 72 },
        active_scheme: {
          name: 'FORBIDDEN_ACTIVE_SCHEME_6T2',
          overall_goal: 'FORBIDDEN_SCHEME_GOAL_6T2',
          steps: [{ objective: 'FORBIDDEN_SCHEME_STEP_6T2', status: 'in_progress' }],
        },
        secret_truth: {
          actually_alive: true,
          hidden_since_turn: 1,
          motive: 'FORBIDDEN_SECRET_TRUTH_6T2',
        },
      });
      const submission: TurnSubmission = {
        version: 1,
        kind: 'structured',
        actions: ['OBSERVABLE_AMBITION_ACTION_6T2'],
        privateIntent: 'PRIVATE_AMBITION_FORBIDDEN_6T2',
        questionOrContext: 'QUESTION_AMBITION_FORBIDDEN_6T2',
      };
      const externalProjection = projectForExternalInference(submission);
      expect(externalProjection).not.toBeNull();
      const result = await inferAmbition(
        ai,
        player,
        [externalProjection!],
        ['PUBLIC_HEADLINE_6T2'],
        /* isMockMode */ false
      );

      expect(result).toEqual({
        apparent_ambition: 'Appears to be consolidating personal loyalty within the legions at the Senate\'s expense.',
        confidence: 'high',
      });
      expect(generateContent).toHaveBeenCalledTimes(1);

      const call = generateContent.mock.calls[0][0];
      expect(call.model).toBe('gemini-3.8-flash');
      expect(call.contents).toContain(JSON.stringify({
        entityId: 'severus_alexander',
        name: 'Severus Alexander',
        entityType: 'individual',
        position: 'Emperor',
      }, null, 2));
      expect(call.contents).toContain('OBSERVABLE_AMBITION_ACTION_6T2');
      expect(call.contents).toContain('PUBLIC_HEADLINE_6T2');
      expect(call.contents).not.toContain(serializeTurnSubmission(submission));

      for (const forbidden of [
        'PRIVATE_AMBITION_FORBIDDEN_6T2',
        'QUESTION_AMBITION_FORBIDDEN_6T2',
        'FORBIDDEN_VOICE_6T2',
        'FORBIDDEN_EPITHET_6T2',
        'exiled',
        'FORBIDDEN_LOCATION_6T2',
        'FORBIDDEN_FACTION_6T2',
        'FORBIDDEN_CULTURE_6T2',
        'FORBIDDEN_CULTURE_VALUE_6T2',
        'FORBIDDEN_MEMBER_6T2',
        'FORBIDDEN_RELATION_ENTITY_6T2',
        'FORBIDDEN_RELATION_TYPE_6T2',
        'FORBIDDEN_INTERACTION_6T2',
        'FORBIDDEN_MEMORY_6T2',
        'FORBIDDEN_MEMORY_IMPACT_6T2',
        'FORBIDDEN_RESOURCE_VALUE_6T2',
        'FORBIDDEN_VISIBILITY_6T2',
        'FORBIDDEN_STATE_NARRATIVE_6T2',
        'FORBIDDEN_SHORT_GOAL_6T2',
        'FORBIDDEN_LONG_GOAL_6T2',
        'FORBIDDEN_BELIEF_6T2',
        'FORBIDDEN_SECRET_6T2',
        'FORBIDDEN_ACTIVE_SCHEME_6T2',
        'FORBIDDEN_SCHEME_GOAL_6T2',
        'FORBIDDEN_SCHEME_STEP_6T2',
        'FORBIDDEN_SECRET_TRUTH_6T2',
      ]) {
        expect(call.contents, forbidden).not.toContain(forbidden);
      }
    });

    it('mock mode short-circuits to a canned value without calling the model', async () => {
      const { ai, generateContent } = makeMockAi('should never be read');

      const player = makePlayer();
      const result = await inferAmbition(ai, player, ['some action'], ['some headline'], /* isMockMode */ true);

      expect(result.apparent_ambition).toEqual(expect.any(String));
      expect(['low', 'medium', 'high']).toContain(result.confidence);
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('omits malformed reserved turn-submission artifacts instead of treating them as legacy observable text', async () => {
      const { ai, generateContent } = makeMockAi(JSON.stringify({
        apparent_ambition: 'Appears to be keeping counsel.',
        confidence: 'low',
      }));
      const malformedReservedArtifact = 'GOR_TURN_SUBMISSION/999\n{"kind":"structured","actions":["MALFORMED_RESERVED_SENTINEL_6T2"]}';

      await inferAmbition(
        ai,
        makePlayer(),
        ['ordinary legacy action', malformedReservedArtifact],
        ['PUBLIC_HEADLINE_6T2'],
        false,
      );

      const call = generateContent.mock.calls[0][0];
      expect(call.contents).toContain('ordinary legacy action');
      expect(call.contents).not.toContain('MALFORMED_RESERVED_SENTINEL_6T2');
      expect(call.contents).not.toContain('GOR_TURN_SUBMISSION/999');
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
