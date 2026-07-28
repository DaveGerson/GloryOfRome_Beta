import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { GEMINI_PRO, type GeminiClient } from '../ai/core/geminiService';
import { PrivateSceneModelResponseSchema } from '../ai/core/schemas';
import { zPrivateSceneModelResponse } from '../ai/core/zodSchemas';
import {
  buildPrivateScenePrompt,
  PRIVATE_SCENE_MAX_CONTEXT_ITEMS,
  PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS,
  PRIVATE_SCENE_MAX_TRANSCRIPT_LINES,
  type PrivateScenePromptInput,
} from '../ai/prompts/privateScene';
import { continuePrivateScene } from '../ai/tools/privateScene';
import {
  PRIVATE_SCENE_MAX_NPC_RESPONSES,
  PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  type PrivateSceneModelResponse,
} from '../privateScene/model';

const VALID_RESPONSE: PrivateSceneModelResponse = {
  disposition: 'continues',
  npcUtterance: 'I will consider it.',
  speechActs: [
    { speaker: 'npc', kind: 'promise', text: 'I will consider it.', exchange: 1 },
  ],
  npcPrivate: {
    sincerity: 'Guarded but genuine.',
    hiddenIntent: 'Learn how much support the player commands.',
    plannedFollowThrough: ['Consult the household before dawn.'],
  },
};

const INPUT: PrivateScenePromptInput = {
  phase: 'invitation',
  exchange: 1,
  npc: {
    entityId: 'livia',
    displayName: 'Livia',
    position: 'Senator',
    location: 'The Curia',
    voice: 'Measured, formal, and wary.',
    selfDescription: 'A careful senator protecting her household.',
    goals: ['Keep the household beyond factional retaliation.'],
    beliefs: ['Rome survives through restraint.'],
    ownSecrets: ['She has quietly corresponded with the eastern governors.'],
    memories: ['Gaius defended her client before the Curia.'],
    relationshipToPlayer: 'She is grateful, but uncertain whether Gaius can protect her.',
  },
  player: {
    entityId: 'gaius',
    displayName: 'Gaius',
    position: 'Tribune',
  },
  transcript: [{ speaker: 'player', text: 'Stand with me.' }],
};

function pollutedInput(): PrivateScenePromptInput {
  return {
    ...INPUT,
    privateIntent: 'PRIVATE_INTENT_POISON',
    rawDeltas: 'RAW_DELTA_POISON',
    truthLedger: 'TRUTH_FLAG_POISON',
    resolutionTrace: 'ROLL_TIER_TRACE_POISON',
    simulationState: 'SIMULATION_STATE_POISON',
    gm_private: 'GM_PRIVATE_POISON',
    unrelatedScenes: 'UNRELATED_SCENE_POISON',
    npc: {
      ...INPUT.npc,
      otherNpcSecrets: 'OTHER_NPC_SECRET_POISON',
      rawEntity: 'RAW_ENTITY_POISON',
    },
    player: {
      ...INPUT.player,
      privateIntent: 'NESTED_PRIVATE_INTENT_POISON',
      secrets: 'PLAYER_SECRET_POISON',
    },
    transcript: INPUT.transcript.map(line => ({
      ...line,
      gm_private: 'TRANSCRIPT_GM_PRIVATE_POISON',
      roll: 'TRANSCRIPT_ROLL_POISON',
    })),
  } as unknown as PrivateScenePromptInput;
}

const PROMPT_POISON_VALUES = [
  'PRIVATE_INTENT_POISON', 'RAW_DELTA_POISON', 'TRUTH_FLAG_POISON',
  'ROLL_TIER_TRACE_POISON', 'SIMULATION_STATE_POISON', 'GM_PRIVATE_POISON',
  'UNRELATED_SCENE_POISON', 'OTHER_NPC_SECRET_POISON', 'RAW_ENTITY_POISON',
  'NESTED_PRIVATE_INTENT_POISON', 'PLAYER_SECRET_POISON',
  'TRANSCRIPT_GM_PRIVATE_POISON', 'TRANSCRIPT_ROLL_POISON',
];

describe('private-scene structured response schema', () => {
  it('accepts the exact bounded response and rejects unknown state/mechanics/truth keys', () => {
    expect(zPrivateSceneModelResponse.parse(VALID_RESPONSE)).toEqual(VALID_RESPONSE);

    for (const polluted of [
      { ...VALID_RESPONSE, deltas: [{ type: 'relation', key: 'livia:gaius:trust_level', delta: 5 }] },
      { ...VALID_RESPONSE, relationshipNumbers: { trust: 8 } },
      { ...VALID_RESPONSE, roll: 20 },
      { ...VALID_RESPONSE, tier: 'critical_success' },
      { ...VALID_RESPONSE, dice: 'd20' },
      { ...VALID_RESPONSE, is_true: true },
      { ...VALID_RESPONSE, secret_truth: { actually_alive: true } },
      { ...VALID_RESPONSE, gm_private: ['hidden'] },
      { ...VALID_RESPONSE, simulationState: { imperial_status: 'Stable' } },
      {
        ...VALID_RESPONSE,
        speechActs: [{ speaker: 'npc', kind: 'claim', text: 'No.', exchange: 1, entityId: 'arbitrary' }],
      },
      {
        ...VALID_RESPONSE,
        npcPrivate: { ...VALID_RESPONSE.npcPrivate, trust_level: 9 },
      },
    ]) {
      expect(zPrivateSceneModelResponse.safeParse(polluted).success).toBe(false);
    }
  });

  it('rejects provider-authored player speech acts', () => {
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      speechActs: [{ speaker: 'player', kind: 'request', text: 'Stand with me.', exchange: 1 }],
    }).success).toBe(false);

    const speakerSchema = PrivateSceneModelResponseSchema.properties.speechActs.items.properties.speaker;
    expect(speakerSchema.enum).toEqual(['npc']);
  });

  it('rejects unclassified provider acts and all response bounds', () => {
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      speechActs: [{ speaker: 'player', kind: 'unclassified', text: 'Later.', exchange: 1 }],
    }).success).toBe(false);
    expect(zPrivateSceneModelResponse.safeParse({ ...VALID_RESPONSE, npcUtterance: 'x'.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS + 1) }).success).toBe(false);
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      speechActs: [{ speaker: 'npc', kind: 'claim', text: 'No.', exchange: PRIVATE_SCENE_MAX_NPC_RESPONSES + 1 }],
    }).success).toBe(false);
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      npcPrivate: { ...VALID_RESPONSE.npcPrivate, plannedFollowThrough: Array.from({ length: 9 }, (_, index) => `Step ${index}`) },
    }).success).toBe(false);
    expect(zPrivateSceneModelResponse.safeParse({ ...VALID_RESPONSE, npcUtterance: 'I rolled a natural 20.' }).success).toBe(false);
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      npcPrivate: { ...VALID_RESPONSE.npcPrivate, hiddenIntent: 'critical_success' },
    }).success).toBe(false);
  });

  it('keeps the provider schema paired with the same strict field vocabulary', () => {
    const serialized = JSON.stringify(PrivateSceneModelResponseSchema);
    for (const required of ['disposition', 'npcUtterance', 'speechActs', 'npcPrivate', 'sincerity', 'hiddenIntent', 'plannedFollowThrough']) {
      expect(serialized).toContain(required);
    }
    for (const forbidden of ['EventDelta', 'trust_level', 'roll', 'tier', 'dice', 'is_true', 'secret_truth', 'gm_private', 'SimulationState']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ['NPC utterance', { ...VALID_RESPONSE, npcUtterance: 'My trust level is 8 of 10.' }],
    ['speech act', { ...VALID_RESPONSE, speechActs: [{ speaker: 'npc', kind: 'claim', text: 'Relationship rating: 7/10.', exchange: 1 }] }],
    ['unpunctuated rating', { ...VALID_RESPONSE, npcUtterance: 'Our relationship score 7/10.' }],
    ['sincerity', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, sincerity: 'Trust score = 5.' } }],
    ['hidden intent', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, hiddenIntent: 'Respect rating is -2.' } }],
    ['follow-through', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, plannedFollowThrough: ['Set dependency level to 3.'] } }],
  ])('rejects numeric relationship mechanics in %s', (_field, response) => {
    expect(zPrivateSceneModelResponse.safeParse(response).success).toBe(false);
  });

  it('allows ordinary in-fiction numbers outside relationship mechanics', () => {
    expect(zPrivateSceneModelResponse.safeParse({
      ...VALID_RESPONSE,
      npcUtterance: 'In the year 238, three legions crossed the frontier.',
    }).success).toBe(true);
  });

  it.each([
    ['compact colon in NPC utterance', { ...VALID_RESPONSE, npcUtterance: 'Trust: 8' }],
    ['compact equals in speech act', { ...VALID_RESPONSE, speechActs: [{ speaker: 'npc', kind: 'claim', text: 'trust=8', exchange: 1 }] }],
    ['bare ratio in private sincerity', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, sincerity: 'trust 8/10' } }],
    ['signed value in private intent', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, hiddenIntent: 'loyalty +3' } }],
    ['of-connector rating', { ...VALID_RESPONSE, npcUtterance: 'My trust level of 8 should reassure you.' }],
    ['is-at rating', { ...VALID_RESPONSE, npcUtterance: 'My trust is at 8.' }],
    ['past-tense rating', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, sincerity: 'Her loyalty was 9.' } }],
  ])('rejects %s as numeric relationship mechanics', (_field, response) => {
    expect(zPrivateSceneModelResponse.safeParse(response).success).toBe(false);
  });

  it.each([
    ['count noun', { ...VALID_RESPONSE, npcUtterance: 'The threat is 3 cohorts approaching Rome.' }],
    ['time unit', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, plannedFollowThrough: ['Their loyalty is 3 years old.'] } }],
    ['assassin count', { ...VALID_RESPONSE, npcUtterance: 'The threat is 3 assassins sent by the prefect.' }],
    ['spy count', { ...VALID_RESPONSE, npcUtterance: 'The threat is 3 spies in your household.' }],
    ['generations depth', { ...VALID_RESPONSE, npcPrivate: { ...VALID_RESPONSE.npcPrivate, hiddenIntent: 'Their loyalty is 3 generations deep.' } }],
  ])('allows ordinary relationship-term prose followed by a %s', (_field, response) => {
    expect(zPrivateSceneModelResponse.safeParse(response).success).toBe(true);
  });
});

describe('buildPrivateScenePrompt', () => {
  it('serializes only the participating NPC self brief, player-visible identity, and current transcript', () => {
    const { systemInstruction, prompt } = buildPrivateScenePrompt(INPUT);
    const request = `${systemInstruction}\n${prompt}`;

    for (const allowed of [
      'Livia', 'Senator', 'The Curia', 'Measured, formal, and wary.',
      'She has quietly corresponded with the eastern governors.',
      'Gaius', 'Tribune', 'Stand with me.',
    ]) {
      expect(request).toContain(allowed);
    }
    for (const poison of PROMPT_POISON_VALUES) {
      expect(request).not.toContain(poison);
    }

    expect(systemInstruction).toContain('may be false');
    expect(systemInstruction).toContain('current internal intent');
    expect(systemInstruction).toContain('does not establish world truth');
    expect(systemInstruction).toContain('no action resolution');
    expect(systemInstruction).toContain('no deltas');
    expect(systemInstruction).toContain('no numeric relationship');
    expect(systemInstruction).toContain('speech acts only for the NPC');
  });
});

describe('continuePrivateScene', () => {
  it('uses the central pro model and generateStructured contract', async () => {
    type GenerateContentRequest = Parameters<GeminiClient['models']['generateContent']>[0];
    const generateContent = vi.fn(async (request: GenerateContentRequest) => {
      void request;
      return { text: JSON.stringify(VALID_RESPONSE) };
    });
    const ai: GeminiClient = { models: { generateContent } };

    await expect(continuePrivateScene(ai as GoogleGenAI, INPUT, false)).resolves.toEqual(VALID_RESPONSE);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(GEMINI_PRO);
    expect(request.contents).toContain('Stand with me.');
    expect(request.config?.responseSchema).toEqual(PrivateSceneModelResponseSchema);
    expect(String(request.config?.systemInstruction)).toContain('current internal intent');
    for (const poison of PROMPT_POISON_VALUES) expect(request.contents).not.toContain(poison);
  });

  it.each([
    ['accepted invitation', INPUT, 'continues'],
    ['refused invitation', { ...INPUT, transcript: [{ speaker: 'player' as const, text: 'Refuse this invitation.' }] }, 'refused'],
    ['NPC-ended invitation', { ...INPUT, transcript: [{ speaker: 'player' as const, text: 'Farewell.' }] }, 'ends'],
    ['NPC-ended exchange', { ...INPUT, phase: 'exchange' as const, exchange: 2, transcript: [...INPUT.transcript, { speaker: 'npc' as const, text: 'I heard you.' }, { speaker: 'player' as const, text: 'Farewell.' }] }, 'ends'],
  ])('returns a deterministic %s in mock mode with zero provider calls', async (_label, input, disposition) => {
    const generateContent = vi.fn();
    const ai: GeminiClient = { models: { generateContent } };
    const result = await continuePrivateScene(ai as GoogleGenAI, input, true);

    expect(result.disposition).toBe(disposition);
    expect(zPrivateSceneModelResponse.safeParse(result).success).toBe(true);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects a provider response that violates the requested phase or exchange', async () => {
    type GenerateContentRequest = Parameters<GeminiClient['models']['generateContent']>[0];
    const wrongExchange = {
      ...VALID_RESPONSE,
      speechActs: [{ speaker: 'npc' as const, kind: 'promise' as const, text: 'Later.', exchange: 2 }],
    };
    const generateContent = vi.fn(async (request: GenerateContentRequest) => {
      void request;
      return { text: JSON.stringify(wrongExchange) };
    });
    const ai: GeminiClient = { models: { generateContent } };

    await expect(continuePrivateScene(ai as GoogleGenAI, INPUT, false)).rejects.toThrow(/exchange/i);
  });

  it('rejects a refused disposition after the invitation phase', async () => {
    type GenerateContentRequest = Parameters<GeminiClient['models']['generateContent']>[0];
    const refused = {
      ...VALID_RESPONSE,
      disposition: 'refused' as const,
      speechActs: [{ speaker: 'npc' as const, kind: 'refusal' as const, text: 'No.', exchange: 2 }],
    };
    const generateContent = vi.fn(async (request: GenerateContentRequest) => {
      void request;
      return { text: JSON.stringify(refused) };
    });
    const ai: GeminiClient = { models: { generateContent } };
    const exchangeInput = { ...INPUT, phase: 'exchange' as const, exchange: 2 };

    await expect(continuePrivateScene(ai as GoogleGenAI, exchangeInput, false)).rejects.toThrow(/cannot refuse/i);
  });

  it('rejects invalid and unbounded input before either execution branch', async () => {
    const generateContent = vi.fn();
    const ai: GeminiClient = { models: { generateContent } };
    const invalid = {
      ...INPUT,
      exchange: 2,
      unexpected: 'must be rejected',
      npc: { ...INPUT.npc, goals: Array.from({ length: 9 }, (_, index) => `Goal ${index}`) },
    } as unknown as PrivateScenePromptInput;

    await expect(continuePrivateScene(ai as GoogleGenAI, pollutedInput(), false)).rejects.toThrow(/private.scene input/i);
    await expect(continuePrivateScene(ai as GoogleGenAI, invalid, true)).rejects.toThrow(/private.scene input/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('enforces phase, string, list, transcript, and aggregate input bounds before execution', async () => {
    const generateContent = vi.fn();
    const ai: GeminiClient = { models: { generateContent } };
    const longText = 'x'.repeat(PRIVATE_SCENE_MAX_UTTERANCE_CHARS + 1);
    const aggregateChunk = 'a'.repeat(Math.floor(PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS / 16));
    const invalidInputs: PrivateScenePromptInput[] = [
      { ...INPUT, phase: 'invalid' as 'invitation' },
      { ...INPUT, exchange: 1.5 },
      { ...INPUT, exchange: PRIVATE_SCENE_MAX_NPC_RESPONSES + 1 },
      { ...INPUT, phase: 'exchange', exchange: 1 },
      { ...INPUT, npc: { ...INPUT.npc, selfDescription: longText } },
      { ...INPUT, npc: { ...INPUT.npc, goals: Array.from({ length: PRIVATE_SCENE_MAX_CONTEXT_ITEMS + 1 }, (_, index) => `Goal ${index}`) } },
      { ...INPUT, transcript: Array.from({ length: PRIVATE_SCENE_MAX_TRANSCRIPT_LINES + 1 }, () => ({ speaker: 'player' as const, text: 'Continue.' })) },
      {
        ...INPUT,
        npc: {
          ...INPUT.npc,
          goals: Array.from({ length: PRIVATE_SCENE_MAX_CONTEXT_ITEMS }, () => aggregateChunk),
          beliefs: Array.from({ length: PRIVATE_SCENE_MAX_CONTEXT_ITEMS }, () => aggregateChunk),
        },
      },
    ];

    for (const invalidInput of invalidInputs) {
      await expect(continuePrivateScene(ai as GoogleGenAI, invalidInput, true)).rejects.toThrow(/private.scene input/i);
    }
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('exposes the approved adapter signature', () => {
    expectTypeOf(continuePrivateScene).parameters.toEqualTypeOf<[
      ai: GoogleGenAI,
      input: PrivateScenePromptInput,
      isMockMode: boolean,
    ]>();
  });
});
