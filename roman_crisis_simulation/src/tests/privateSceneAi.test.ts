import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { GEMINI_PRO, type GeminiClient } from '../ai/core/geminiService';
import { PrivateSceneModelResponseSchema } from '../ai/core/schemas';
import { zPrivateSceneModelResponse } from '../ai/core/zodSchemas';
import { buildPrivateScenePrompt, type PrivateScenePromptInput } from '../ai/prompts/privateScene';
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
    { speaker: 'player', kind: 'request', text: 'Stand with me.', exchange: 1 },
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
});

describe('buildPrivateScenePrompt', () => {
  it('serializes only the participating NPC self brief, player-visible identity, and current transcript', () => {
    const { systemInstruction, prompt } = buildPrivateScenePrompt(pollutedInput());
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

    await expect(continuePrivateScene(ai as GoogleGenAI, pollutedInput(), false)).resolves.toEqual(VALID_RESPONSE);
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
    ['NPC-ended exchange', { ...INPUT, phase: 'exchange' as const, exchange: 2, transcript: [...INPUT.transcript, { speaker: 'npc' as const, text: 'I heard you.' }, { speaker: 'player' as const, text: 'Farewell.' }] }, 'ends'],
  ])('returns a deterministic %s in mock mode with zero provider calls', async (_label, input, disposition) => {
    const generateContent = vi.fn();
    const ai: GeminiClient = { models: { generateContent } };
    const result = await continuePrivateScene(ai as GoogleGenAI, input, true);

    expect(result.disposition).toBe(disposition);
    expect(zPrivateSceneModelResponse.safeParse(result).success).toBe(true);
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
