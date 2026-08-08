import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GEMINI_FLASH,
  getSessionCallLog,
  resetSessionCallLog,
  type GeminiClient,
} from '../ai/core/geminiService';
import { NoAttemptEvidenceSelectionSchema } from '../ai/core/schemas';
import { zNoAttemptEvidenceSelection } from '../ai/core/zodSchemas';
import { buildNoAttemptEvidenceSelectionPrompt } from '../ai/prompts/noAttemptResponse';
import { selectNoAttemptEvidence } from '../ai/tools/noAttemptResponse';
import type { NoAttemptEvidence } from '../playerView/noAttemptResponse';
import { makeQueuedTextAi as makeAi } from './factories';

const QUESTION = '  What can I tell from the empty benches?  ';
const evidence: NoAttemptEvidence[] = [
  {
    id: 'evidence-1',
    source: 'network',
    text: 'Lucius left the forum before the vote.',
  },
  {
    id: 'evidence-2',
    source: 'public',
    text: 'The eastern doors remain open.',
  },
  {
    id: 'evidence-3',
    source: 'spy',
    text: 'A courier entered the Curia at dusk.',
  },
];

beforeEach(() => {
  resetSessionCallLog();
});

describe('no-attempt evidence selection schemas', () => {
  it('accepts the three-field decision, evidence-ID, and actors contract', () => {
    expect(zNoAttemptEvidenceSelection.parse({
      decision: 'answer',
      evidenceIds: ['evidence-1'],
      actors: [],
    })).toEqual({ decision: 'answer', evidenceIds: ['evidence-1'], actors: [] });

    expect(() => zNoAttemptEvidenceSelection.parse({
      decision: 'answer',
      evidenceIds: ['evidence-1'],
      actors: [],
      prose: 'Lucius is afraid',
    })).toThrow();
    expect(() => zNoAttemptEvidenceSelection.parse({
      decision: 'maybe',
      evidenceIds: [],
      actors: [],
    })).toThrow();
  });

  it.each([
    {
      label: 'an answer with no IDs',
      value: { decision: 'answer', evidenceIds: [], actors: [] },
    },
    {
      label: 'an answer with more than five IDs',
      value: {
        decision: 'answer',
        evidenceIds: [
          'evidence-1',
          'evidence-2',
          'evidence-3',
          'evidence-4',
          'evidence-5',
          'evidence-6',
        ],
        actors: [],
      },
    },
    {
      label: 'a no_answer with an ID',
      value: { decision: 'no_answer', evidenceIds: ['evidence-1'], actors: [] },
    },
  ])('rejects $label at the Zod boundary', ({ value }) => {
    expect(zNoAttemptEvidenceSelection.safeParse(value).success).toBe(false);
  });

  it('accepts an explicit no-answer with an empty ID list', () => {
    expect(zNoAttemptEvidenceSelection.parse({
      decision: 'no_answer',
      evidenceIds: [],
      actors: [],
    })).toEqual({ decision: 'no_answer', evidenceIds: [], actors: [] });
  });

  it('keeps the Gemini response schema in exact three-field lockstep', () => {
    expect(Object.keys(NoAttemptEvidenceSelectionSchema.properties)).toEqual([
      'decision',
      'evidenceIds',
      'actors',
    ]);
    expect(NoAttemptEvidenceSelectionSchema.required).toEqual(['decision', 'evidenceIds', 'actors']);
    expect(NoAttemptEvidenceSelectionSchema.properties.decision.enum).toEqual([
      'answer',
      'no_answer',
    ]);
    expect(NoAttemptEvidenceSelectionSchema.properties.evidenceIds.maxItems).toBe(5);
    expect(JSON.stringify(NoAttemptEvidenceSelectionSchema)).not.toContain('prose');
  });
});

describe('no-attempt evidence selection prompt boundary', () => {
  it('sends the exact question and only allowlisted evidence through the named Flash structured call', async () => {
    const pollutedEvidence = evidence.map((item, index) => ({
      ...item,
      privateIntent: `PRIVATE_INTENT_SENTINEL_${index}`,
      narration: `NARRATION_SENTINEL_${index}`,
      gm_private: `GM_PRIVATE_SENTINEL_${index}`,
      secret_truth: `SECRET_TRUTH_SENTINEL_${index}`,
      resolutionTrace: `RESOLUTION_TRACE_SENTINEL_${index}`,
      mortalityTrace: `MORTALITY_TRACE_SENTINEL_${index}`,
      roll: 20,
      tier: `TIER_SENTINEL_${index}`,
      entity: { hidden: `ENTITY_SENTINEL_${index}` },
      adjudication: { hidden: `ADJUDICATION_SENTINEL_${index}` },
    })) as unknown as NoAttemptEvidence[];
    const { ai, generateContent } = makeAi(JSON.stringify({
      decision: 'answer',
      evidenceIds: ['evidence-1'],
      actors: [],
    }));

    await expect(selectNoAttemptEvidence(ai, QUESTION, pollutedEvidence)).resolves.toEqual({
      kind: 'answer',
      evidence: [evidence[0]],
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(GEMINI_FLASH);
    expect(request.contents).toContain(QUESTION);
    expect(request.contents).toContain(JSON.stringify(evidence));
    expect(request.config.responseSchema).toEqual(NoAttemptEvidenceSelectionSchema);
    expect(getSessionCallLog().map(({ callName }) => callName)).toEqual([
      'noAttemptEvidenceSelection',
    ]);

    const sent = JSON.stringify(request);
    for (const forbiddenField of [
      'privateIntent',
      'narration',
      'gm_private',
      'secret_truth',
      'resolutionTrace',
      'mortalityTrace',
      'roll',
      'tier',
      'entity',
      'adjudication',
    ]) {
      expect(sent).not.toContain(`"${forbiddenField}"`);
    }
    for (const forbiddenSentinel of [
      'PRIVATE_INTENT_SENTINEL',
      'NARRATION_SENTINEL',
      'GM_PRIVATE_SENTINEL',
      'SECRET_TRUTH_SENTINEL',
      'RESOLUTION_TRACE_SENTINEL',
      'MORTALITY_TRACE_SENTINEL',
      'TIER_SENTINEL',
      'ENTITY_SENTINEL',
      'ADJUDICATION_SENTINEL',
    ]) {
      expect(sent).not.toContain(forbiddenSentinel);
    }
  });

  it('asks for direct evidence IDs only and never delegates player-facing prose', () => {
    const { systemInstruction, prompt } = buildNoAttemptEvidenceSelectionPrompt(QUESTION, evidence);
    const boundary = `${systemInstruction}\n${prompt}`;

    expect(systemInstruction).toMatch(/choose only evidence that directly helps answer the question/i);
    expect(systemInstruction).toMatch(/return IDs only/i);
    expect(systemInstruction).toMatch(/never write prose/i);
    expect(systemInstruction).toMatch(/question does not establish facts/i);
    expect(systemInstruction).toMatch(/no_answer.*evidence is insufficient/i);
    expect(boundary).not.toMatch(/\b(?:draft|summarize|narrate)\b/i);
    expect(boundary).not.toMatch(/\binfer facts\b/i);
    expect(boundary).not.toMatch(/(?:write|provide|return|compose).*answer in prose/i);
  });
});

describe('selectNoAttemptEvidence', () => {
  it('resolves a valid selection to canonical offered evidence without model-authored text', async () => {
    const { ai } = makeAi(JSON.stringify({
      decision: 'answer',
      evidenceIds: ['evidence-2'],
      actors: [],
    }));

    await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
      kind: 'answer',
      evidence: [evidence[1]],
    });
  });

  it('restores provider IDs to canonical evidence order', async () => {
    const { ai } = makeAi(JSON.stringify({
      decision: 'answer',
      evidenceIds: ['evidence-3', 'evidence-1'],
      actors: [],
    }));

    await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
      kind: 'answer',
      evidence: [evidence[0], evidence[2]],
    });
  });

  it.each([
    {
      label: 'an unknown ID',
      selection: { decision: 'answer', evidenceIds: ['evidence-unknown'], actors: [] },
    },
    {
      label: 'a duplicate ID',
      selection: { decision: 'answer', evidenceIds: ['evidence-1', 'evidence-1'], actors: [] },
    },
  ])('fails closed for $label after schema validation', async ({ selection }) => {
    const { ai } = makeAi(JSON.stringify(selection));

    await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
      kind: 'no_answer',
      reason: 'invalid_selection',
    });
  });

  it('preserves an explicit valid model no-answer decision', async () => {
    const { ai } = makeAi(JSON.stringify({ decision: 'no_answer', evidenceIds: [], actors: [] }));

    await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
      kind: 'no_answer',
      reason: 'model_no_answer',
    });
  });

  it.each([false, true])('returns no_evidence without a provider call in mock mode %s', async (isMockMode) => {
    const { ai, generateContent } = makeAi();

    await expect(selectNoAttemptEvidence(ai, QUESTION, [], isMockMode)).resolves.toEqual({
      kind: 'no_answer',
      reason: 'no_evidence',
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('selects only the first offered item in mock mode without a provider call', async () => {
    const { ai, generateContent } = makeAi();

    await expect(selectNoAttemptEvidence(ai, QUESTION, evidence, true)).resolves.toEqual({
      kind: 'answer',
      evidence: [evidence[0]],
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('converts provider rejection to a content-free selector failure', async () => {
    const providerError = new Error('PROVIDER_DETAIL_SENTINEL');
    const generateContent = vi.fn().mockRejectedValue(providerError);
    const ai: GeminiClient = { models: { generateContent } };

    const result = await selectNoAttemptEvidence(ai, QUESTION, evidence);

    expect(result).toEqual({ kind: 'no_answer', reason: 'selector_failure' });
    expect(JSON.stringify(result)).not.toContain('PROVIDER_DETAIL_SENTINEL');
  });

  it('converts malformed JSON after repair exhaustion to selector_failure without throwing', async () => {
    const { ai, generateContent } = makeAi('{not json', '{still not json');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
        kind: 'no_answer',
        reason: 'selector_failure',
      });
      expect(generateContent).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('converts schema repair exhaustion to selector_failure without throwing', async () => {
    const malformed = JSON.stringify({
      decision: 'answer',
      evidenceIds: ['evidence-1'],
      prose: 'MODEL_PROSE_SENTINEL',
    });
    const { ai, generateContent } = makeAi(malformed, malformed);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(selectNoAttemptEvidence(ai, QUESTION, evidence)).resolves.toEqual({
        kind: 'no_answer',
        reason: 'selector_failure',
      });
      expect(generateContent).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('no-attempt prompt inventory', () => {
  it('inventories the call family, builder, model, and paired schemas', () => {
    const inventory = readFileSync(new URL('../ai/prompts/README.md', import.meta.url), 'utf8');
    expect(inventory).toContain(
      '| `noAttemptEvidenceSelection` | `noAttemptResponse.ts::buildNoAttemptEvidenceSelectionPrompt` | flash | `zNoAttemptEvidenceSelection` | `NoAttemptEvidenceSelectionSchema` | question-only player response; evidence IDs only |',
    );
  });
});
