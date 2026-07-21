/**
 * ai/tools/npcMind.ts
 *
 * The per-spotlight NPC mind call (ROADMAP_PHASE_4.md 4C item 4, D10/D22):
 * one character, addressed in character with its BOUNDED knowledge only
 * (see ai/prompts/npcMind.ts's asymmetry contract), deciding its own move
 * for the turn. Consumed by ai/core/turn.ts's npc_minds stage, which runs
 * up to MAX_MINDS_PER_TURN of these in a single Promise.all between the
 * Director and adjudication (D16 sanctions the one added latency leg).
 *
 * MODEL: flash (GEMINI_FLASH) - the cheap tier, like assessment/monologue;
 * cost scales with the spotlight cast, so it must not ride the pro tier.
 * OUTPUT: validated against `zNpcMindDecision` (ai/core/zodSchemas.ts) /
 * `NpcMindDecisionSchema` (ai/core/schemas.ts). The whole decision is
 * GM-PRIVATE (D4/D5): GameMasterScreen and ai/ only, and even the
 * adjudicator receives it minus `private_reasoning`.
 *
 * D22 GROUPING SEAM: today this is strictly ONE mind per spotlight
 * CHARACTER. Grouping minds per set/faction later (the sanctioned cost
 * lever) would swap `input.self` for a collective brief and change only
 * ai/core/turn.ts::selectMindEntities plus buildNpcMindPrompt's self-brief -
 * this wrapper's call shape stays one call per mind either way.
 *
 * MOCK MODE: never actually reached from `runNewTurn` - `runNewTurn`
 * returns via `mockRunNewTurn` (which builds mock decisions itself) before
 * this module would run. The `isMockMode` branch below is kept for parity
 * with every sibling tool wrapper (see ai/tools/assessment.ts's identical
 * note).
 */
import { NpcMindDecision } from '../../types';
import { GeminiClient, generateStructured, GEMINI_FLASH } from '../core/geminiService';
import { NpcMindDecisionSchema } from '../core/schemas';
import { zNpcMindDecision } from '../core/zodSchemas';
import { buildNpcMindPrompt, NpcMindPromptInput } from '../prompts/npcMind';
import { mockGetNpcMindDecision } from '../mocks';

// A mind's choice should be characterful and varied, not deterministic
// optimal play - between adjudication's 0.8 and narration's 1.0.
const MIND_TEMPERATURE = 0.9;

export const getNpcMindDecision = async (
  ai: GeminiClient,
  input: NpcMindPromptInput,
  isMockMode: boolean
): Promise<NpcMindDecision> => {
  if (isMockMode) {
    return mockGetNpcMindDecision(input.self, input.directorIntent);
  }

  const { systemInstruction, prompt } = buildNpcMindPrompt(input);
  const decision = await generateStructured<NpcMindDecision>(ai, {
    // Suffixed per character (the entityBatch convention - see
    // ai/prompts/README.md) so the GM console's raw-call log tells the
    // turn's parallel mind calls apart.
    callName: `npcMind:${input.self.entity_id}`,
    model: GEMINI_FLASH,
    systemInstruction,
    prompt,
    responseSchema: NpcMindDecisionSchema,
    zodSchema: zNpcMindDecision,
    thinkingConfig: { thinkingBudget: 256 },
    temperature: MIND_TEMPERATURE,
  });

  // The entity_id is a JOIN KEY the pipeline already knows - the caller
  // asked THIS character. Normalizing it code-side means a confused model
  // echoing another id can never mislabel whose decision this is.
  return { ...decision, entity_id: input.self.entity_id };
};
