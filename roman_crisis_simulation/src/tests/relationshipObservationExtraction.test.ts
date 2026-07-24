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
import { evidenceContainsExactEntityName } from '../knowledge/relationships';

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
const knownEntityIds = directory.map(entity => entity.entity_id);
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

  it('preserves a non-empty exact excerpt without trimming it at the schema or tool boundary', async () => {
    const excerpt = `  ${SAFE_TEXT}  `;
    const paddedDraft = { ...validDraft, excerpt };
    const paddedEvidence = [{ ...evidence[0], text: excerpt }];

    expect(zRelationshipObservations.parse([paddedDraft])).toEqual([paddedDraft]);
    const { ai } = makeMockAi([paddedDraft]);
    await expect(getRelationshipObservations(ai, paddedEvidence, directory, knownEntityIds)).resolves.toEqual([paddedDraft]);
  });

  it.each([
    null,
    {},
    [{ participantIds: ['severus_alexander', 'lucius'], excerpt: SAFE_TEXT }],
    [{ evidenceId: 'report_7_1', participantIds: 'lucius', excerpt: SAFE_TEXT }],
    [{ evidenceId: 'report_7_1', participantIds: ['lucius'], excerpt: 7 }],
    [{ ...validDraft, excerpt: '' }],
    [{ ...validDraft, excerpt: '   ' }],
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

  it('rejects duplicate evidence ids before the selector prompt is built, regardless of order', async () => {
    for (const duplicateEvidence of [
      [{ ...evidence[0], source: 'rumor' as const }, { ...evidence[0], source: 'scout' as const }],
      [{ ...evidence[0], source: 'scout' as const }, { ...evidence[0], source: 'rumor' as const }],
    ]) {
      const { ai, generateContent } = makeMockAi([]);
      await expect(getRelationshipObservations(ai, duplicateEvidence, directory, knownEntityIds)).rejects.toThrow('duplicate evidence id');
      expect(generateContent).not.toHaveBeenCalled();
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

describe('evidenceContainsExactEntityName Unicode identity boundary', () => {
  it('normalizes canonically equivalent names without treating combining marks as boundaries', () => {
    expect(evidenceContainsExactEntityName('Jose\u0301 entered the Forum.', 'Jose')).toBe(false);
    expect(evidenceContainsExactEntityName('Jose\u0301 entered the Forum.', 'José')).toBe(true);
    expect(evidenceContainsExactEntityName('가 arrived from the east.', '가')).toBe(true);
    expect(evidenceContainsExactEntityName('Jose\u0301 entered the Forum.', 'Jos')).toBe(false);
  });

  it('keeps word continuations closed while matching ordinary exact punctuation literally', () => {
    expect(evidenceContainsExactEntityName('An Annex was posted.', 'Ann')).toBe(false);
    expect(evidenceContainsExactEntityName('Jose_ally entered.', 'Jose')).toBe(false);
    expect(evidenceContainsExactEntityName('Jose\u200Dally entered.', 'Jose')).toBe(false);
    expect(evidenceContainsExactEntityName('Aurelia (Minor) arrived.', 'Aurelia (Minor)')).toBe(true);
    expect(evidenceContainsExactEntityName('The envoy A+B arrived.', 'A+B')).toBe(true);
    expect(evidenceContainsExactEntityName('José entered.', 'josé')).toBe(false);
    expect(evidenceContainsExactEntityName('Anyone entered.', '')).toBe(false);
  });
});

describe('getRelationshipObservations', () => {
  it('requires deliberate knownness at compile time and fails closed before prompting at runtime', async () => {
    type KnownnessIsRequired = undefined extends Parameters<typeof getRelationshipObservations>[3]
      ? false
      : true;
    const knownnessIsRequired: KnownnessIsRequired = true;
    expect(knownnessIsRequired).toBe(true);

    type LegacyOptionalKnownness = (
      ai: GeminiClient,
      evidence: PlayerSafeEvidence[],
      entities: Array<{ entity_id: string; name: string }>,
      knownEntityIds?: readonly string[],
      isMockMode?: boolean,
    ) => ReturnType<typeof getRelationshipObservations>;
    const legacyTool = getRelationshipObservations as LegacyOptionalKnownness;
    const hiddenDirectory = [
      ...directory,
      { entity_id: 'lycinia_stolo', name: 'Lycinia Stolo' },
    ];

    for (const invoke of [
      (ai: GeminiClient) => legacyTool(ai, evidence, hiddenDirectory),
      (ai: GeminiClient) => legacyTool(ai, evidence, hiddenDirectory, undefined),
    ]) {
      const { ai, generateContent } = makeMockAi([]);
      const [result] = await Promise.allSettled([invoke(ai)]);
      expect({ status: result.status, providerCalls: generateContent.mock.calls.length }).toEqual({
        status: 'rejected',
        providerCalls: 0,
      });
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(Error);
        expect((result.reason as Error).message).toMatch(/knownEntityIds.*required/i);
      }
    }
  });

  it('routes through the structured boundary and returns a valid empty list', async () => {
    const { ai, generateContent } = makeMockAi([]);
    await expect(getRelationshipObservations(ai, evidence, directory, knownEntityIds)).resolves.toEqual([]);

    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe(GEMINI_FLASH);
    expect(call.contents).toContain(SAFE_TEXT);
    expect(call.config.responseSchema).toEqual(RelationshipObservationsSchema);
  });

  it('returns validated exact-selection drafts without adding quote or interpretation fields', async () => {
    const { ai } = makeMockAi([validDraft]);
    await expect(getRelationshipObservations(ai, evidence, directory, knownEntityIds)).resolves.toEqual([validDraft]);
  });

  it('sends only known or exactly cited identities while retaining the full directory for local validation', async () => {
    const citedText = 'Gaius Pontius Magnus publicly rebuked the Roman Senate beneath the Curia steps.';
    const citedEvidence: PlayerSafeEvidence[] = [{ id: 'report_cited', source: 'rumor', text: citedText }];
    const completeDirectory = [
      { entity_id: 'severus_alexander', name: 'Severus Alexander' },
      { entity_id: 'gaius_pontius_magnus', name: 'Gaius Pontius Magnus' },
      { entity_id: 'lycinia_stolo', name: 'Lycinia Stolo' },
    ];
    const citedUnknown = {
      evidenceId: 'report_cited',
      participantIds: ['severus_alexander', 'gaius_pontius_magnus'],
      excerpt: citedText,
    };
    const uncitedHidden = {
      ...citedUnknown,
      participantIds: ['severus_alexander', 'lycinia_stolo'],
    };
    const { ai, generateContent } = makeMockAi(
      [citedUnknown],
      [uncitedHidden],
      [citedUnknown, uncitedHidden],
    );

    await expect(getRelationshipObservations(
      ai, citedEvidence, completeDirectory, ['severus_alexander']
    )).resolves.toEqual([citedUnknown]);
    await expect(getRelationshipObservations(
      ai, citedEvidence, completeDirectory, ['severus_alexander']
    )).rejects.toThrow(/semantic validation rejected/i);
    await expect(getRelationshipObservations(
      ai, citedEvidence, completeDirectory, ['severus_alexander']
    )).rejects.toThrow(/semantic validation rejected/i);

    expect(generateContent).toHaveBeenCalledTimes(3);
    for (const [request] of generateContent.mock.calls) {
      expect(request.contents).toContain('{"entity_id":"severus_alexander","name":"Severus Alexander"}');
      expect(request.contents).toContain('{"entity_id":"gaius_pontius_magnus","name":"Gaius Pontius Magnus"}');
      expect(request.contents).not.toContain('lycinia_stolo');
      expect(request.contents).not.toContain('Lycinia Stolo');
    }
  });

  it('does not treat a display name embedded inside a longer word as cited identity evidence', async () => {
    const fragmentEvidence: PlayerSafeEvidence[] = [{
      id: 'report_fragment',
      source: 'rumor',
      text: 'An Annex was posted beside Severus Alexander in the Forum.',
    }];
    const fragmentDirectory = [
      { entity_id: 'severus_alexander', name: 'Severus Alexander' },
      { entity_id: 'ann', name: 'Ann' },
    ];
    const fragmentSelection = [{
      evidenceId: 'report_fragment',
      participantIds: ['severus_alexander', 'ann'],
      excerpt: fragmentEvidence[0].text,
    }];
    const { ai, generateContent } = makeMockAi(fragmentSelection);

    await expect(getRelationshipObservations(
      ai, fragmentEvidence, fragmentDirectory, ['severus_alexander']
    )).rejects.toThrow(/semantic validation rejected/i);
    expect(generateContent.mock.calls[0][0].contents).not.toContain('{"entity_id":"ann","name":"Ann"}');
  });

  it('rejects a schema-valid non-empty selection that cites nonexistent evidence', async () => {
    const nonexistent = { ...validDraft, evidenceId: 'missing_evidence' };
    const { ai } = makeMockAi([nonexistent]);

    await expect(getRelationshipObservations(ai, evidence, directory, knownEntityIds))
      .rejects.toThrow(/semantic validation rejected/i);
  });

  it('rejects the whole provider result when valid and semantically invalid selections are mixed', async () => {
    const nonexistent = { ...validDraft, evidenceId: 'missing_evidence' };
    const { ai } = makeMockAi([validDraft, nonexistent]);

    await expect(getRelationshipObservations(ai, evidence, directory, knownEntityIds))
      .rejects.toThrow(/semantic validation rejected/i);
  });

  it('fails loudly after the repair attempt when structured output is still invalid', async () => {
    const malformed = [{ ...validDraft, quote: { speakerId: 'lucius', text: 'MODEL QUOTE' } }];
    const { ai } = makeMockAi(malformed, malformed);
    await expect(getRelationshipObservations(ai, evidence, directory, knownEntityIds)).rejects.toBeInstanceOf(AiServiceError);
  });

  it('never sends locally trusted quote attribution to the model', async () => {
    const localEvidence = [{
      ...evidence[0],
      trustedQuote: { speakerId: 'lucius', text: 'Senator Lucius supports Severus.' },
    }];
    const { ai, generateContent } = makeMockAi([]);
    await getRelationshipObservations(ai, localEvidence, directory, knownEntityIds);

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
