import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../types';
import type { PlayerSafeEvidence } from '../knowledge/store';
import {
  RelationshipObservationsSchema,
} from '../ai/core/schemas';
import { zRelationshipObservations } from '../ai/core/zodSchemas';
import { AiServiceError, GEMINI_FLASH, type GeminiClient } from '../ai/core/geminiService';
import { buildRelationshipObservationsPrompt } from '../ai/prompts/relationshipObservations';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { parseModelJson } from '../ai/core/json';

function makeMockAi(...responses: unknown[]): {
  ai: GeminiClient;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn();
  for (const response of responses) {
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(response) });
  }
  return { ai: { models: { generateContent } }, generateContent };
}

const SAFE_TEXT = 'Senator Lucius defended Severus Alexander before the Curia.';
const evidence: PlayerSafeEvidence[] = [{
  id: 'report_7_1',
  source: 'rumor',
  text: SAFE_TEXT,
}];
const directory = [
  { entity_id: 'severus_alexander', name: 'Severus Alexander' },
  { entity_id: 'lucius', name: 'Senator Lucius' },
];
const validDraft = {
  evidenceId: 'report_7_1',
  participantIds: ['severus_alexander', 'lucius'],
  excerpt: SAFE_TEXT,
};

describe('relationship observation schema boundary', () => {
  it('preserves top-level arrays while retaining object parsing for existing structured calls', () => {
    expect(parseModelJson('[{"evidenceId":"report_7_1"}]')).toEqual([{ evidenceId: 'report_7_1' }]);
    expect(parseModelJson('Preamble {"valid":true} postamble')).toEqual({ valid: true });
  });

  it('accepts a valid empty list as no meaningful observation', () => {
    expect(zRelationshipObservations.parse([])).toEqual([]);
  });

  it('accepts only evidenceId, participantIds, and excerpt on each draft', () => {
    expect(zRelationshipObservations.parse([validDraft])).toEqual([validDraft]);

    for (const forbiddenField of ['quote', 'source', 'sentiment', 'direction', 'confidence', 'tier', 'score', 'analysis']) {
      expect(zRelationshipObservations.safeParse([{ ...validDraft, [forbiddenField]: 'forbidden' }]).success)
        .toBe(false);
    }
  });

  it.each([
    null,
    {},
    [{ participantIds: ['severus_alexander', 'lucius'], excerpt: SAFE_TEXT }],
    [{ evidenceId: 'report_7_1', participantIds: 'lucius', excerpt: SAFE_TEXT }],
    [{ evidenceId: 'report_7_1', participantIds: ['lucius'], excerpt: 7 }],
  ])('rejects malformed structured output: %j', malformed => {
    expect(zRelationshipObservations.safeParse(malformed).success).toBe(false);
  });

  it('keeps the Gemini response schema inventory in exact lockstep with the strict Zod shape', () => {
    const serialized = JSON.stringify(RelationshipObservationsSchema);
    expect(serialized).toContain('evidenceId');
    expect(serialized).toContain('participantIds');
    expect(serialized).toContain('excerpt');
    for (const forbiddenField of ['quote', 'source', 'sentiment', 'direction', 'confidence', 'tier', 'score', 'analysis']) {
      expect(serialized).not.toContain(`"${forbiddenField}"`);
    }
  });
});

describe('relationship observation prompt privacy boundary', () => {
  it('projects only evidence id/source/text and entity id/name from polluted objects', () => {
    const pollutedEvidence = [{
      ...evidence[0],
      trustedQuote: { speakerId: 'lucius', text: 'LOCAL_TRUSTED_QUOTE_SENTINEL' },
      secret_truth: 'SECRET_TRUTH_SENTINEL',
      gm_private: 'GM_PRIVATE_SENTINEL',
      raw_delta: 'RAW_DELTA_SENTINEL',
      roll: 19,
      total: 28,
      margin: 12,
      tier: 'critical_success',
      trace: 'TRACE_SENTINEL',
      privateIntent: 'PRIVATE_INTENT_SENTINEL',
      narration: 'NARRATION_SENTINEL',
    }] as unknown as PlayerSafeEvidence[];
    const pollutedDirectory = directory.map((entry, index) => ({
      ...entry,
      entity_type: 'individual',
      status: 'alive',
      location: 'HIDDEN_LOCATION_SENTINEL',
      relationships: { private: 'HIDDEN_RELATIONSHIP_SENTINEL' },
      recent_interactions: ['RECENT_INTERACTION_SENTINEL'],
      current_state_narrative: 'STATE_NARRATIVE_SENTINEL',
      short_term_goals: ['SHORT_GOAL_SENTINEL'],
      long_term_ambitions: ['LONG_GOAL_SENTINEL'],
      active_scheme: { name: 'SCHEME_SENTINEL' },
      secret_truth: index === 0 ? 'ENTITY_SECRET_TRUTH_SENTINEL' : undefined,
      simulationState: 'SIMULATION_STATE_SENTINEL',
      adjudication: 'ADJUDICATION_SENTINEL',
    })) as unknown as Entity[];

    const { systemInstruction, prompt } = buildRelationshipObservationsPrompt(
      pollutedEvidence,
      pollutedDirectory
    );
    const serializedBoundary = `${systemInstruction}\n${prompt}`;

    expect(prompt).toContain('report_7_1');
    expect(prompt).toContain(SAFE_TEXT);
    expect(prompt).toContain('severus_alexander');
    expect(prompt).toContain('Senator Lucius');
    for (const forbidden of [
      'trustedQuote', 'LOCAL_TRUSTED_QUOTE_SENTINEL', 'SECRET_TRUTH_SENTINEL',
      'GM_PRIVATE_SENTINEL', 'RAW_DELTA_SENTINEL', '"roll"', '"total"', '"margin"',
      'critical_success', 'TRACE_SENTINEL', 'PRIVATE_INTENT_SENTINEL', 'NARRATION_SENTINEL',
      'HIDDEN_LOCATION_SENTINEL', 'HIDDEN_RELATIONSHIP_SENTINEL', 'RECENT_INTERACTION_SENTINEL',
      'STATE_NARRATIVE_SENTINEL', 'SHORT_GOAL_SENTINEL', 'LONG_GOAL_SENTINEL',
      'SCHEME_SENTINEL', 'SIMULATION_STATE_SENTINEL', 'ADJUDICATION_SENTINEL',
    ]) {
      expect(serializedBoundary).not.toContain(forbidden);
    }
  });

  it('allows an object to remain evidence prose without turning it into an entity participant', () => {
    const physicalObjectEvidence = [{
      id: 'direct_7_2',
      source: 'self' as const,
      text: 'You received an incredibly expensive gift from Senator Lucius.',
    }];
    const { prompt } = buildRelationshipObservationsPrompt(physicalObjectEvidence, directory);
    expect(prompt).toContain('expensive gift');
    expect(prompt).not.toContain('gift_entity_id');
  });
});

describe('getRelationshipObservations', () => {
  it('routes through the structured boundary and returns a valid empty list', async () => {
    const { ai, generateContent } = makeMockAi([]);
    await expect(getRelationshipObservations(ai, evidence, directory)).resolves.toEqual([]);

    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe(GEMINI_FLASH);
    expect(call.contents).toContain(SAFE_TEXT);
    expect(call.config.responseSchema).toEqual(RelationshipObservationsSchema);
  });

  it('returns validated exact-selection drafts without adding quote or interpretation fields', async () => {
    const { ai } = makeMockAi([validDraft]);
    await expect(getRelationshipObservations(ai, evidence, directory)).resolves.toEqual([validDraft]);
  });

  it('fails loudly after the repair attempt when structured output is still invalid', async () => {
    const malformed = [{ ...validDraft, quote: { speakerId: 'lucius', text: 'MODEL QUOTE' } }];
    const { ai } = makeMockAi(malformed, malformed);
    await expect(getRelationshipObservations(ai, evidence, directory)).rejects.toBeInstanceOf(AiServiceError);
  });

  it('never sends locally trusted quote attribution to the model', async () => {
    const localEvidence = [{
      ...evidence[0],
      trustedQuote: { speakerId: 'lucius', text: 'Senator Lucius supports Severus.' },
    }];
    const { ai, generateContent } = makeMockAi([]);
    await getRelationshipObservations(ai, localEvidence, directory);

    const sent = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(sent).not.toContain('trustedQuote');
    expect(sent).not.toContain('speakerId');
  });
});

describe('prompt inventory coupling', () => {
  it('inventories the call family, builder, and paired schemas in the prompt README', () => {
    const inventory = readFileSync(new URL('../ai/prompts/README.md', import.meta.url), 'utf8');
    expect(inventory).toContain('`relationshipObservations`');
    expect(inventory).toContain('relationshipObservations.ts::buildRelationshipObservationsPrompt');
    expect(inventory).toContain('zRelationshipObservations');
    expect(inventory).toContain('RelationshipObservationsSchema');
  });
});
