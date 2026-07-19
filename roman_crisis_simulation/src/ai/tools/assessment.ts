/**
 * ai/tools/assessment.ts
 *
 * The resolution layer's assessment call (ROADMAP_0_MASTER_PLAN.md Phase 3
 * item 4): a cheap, flash-tier gatekeeper that decides WHETHER the player's
 * action is consequential enough to warrant a hidden dice roll at all, and
 * if so, what to roll against. This call NEVER decides success or failure
 * itself - `ai/core/resolution.ts::resolveAction` does that, deterministically,
 * from this call's output plus the player's skills/personality and the
 * opposing entity's directional stats (see `ai/core/turn.ts`'s wiring).
 *
 * MODEL: flash (GEMINI_FLASH) - cheap and fast, since this runs on EVERY
 * turn, concurrently with `getStoryRelevance` (ai/tools/intelligence.ts).
 * CONSUMER: `ai/core/turn.ts` `runNewTurn`, step 0 (alongside
 * `getStoryRelevance` - both launched via the same `Promise.all`).
 * OUTPUT: validated against `zActionAssessment` (ai/core/zodSchemas.ts) /
 * `ActionAssessmentSchema` (ai/core/schemas.ts).
 *
 * MOCK MODE: never actually reached from `runNewTurn` - `runNewTurn` returns
 * via `mockRunNewTurn` before any code in this module would run. The
 * `isMockMode` branch below is kept anyway for parity with every sibling
 * `get*` function in ai/tools/intelligence.ts (defensive symmetry, and safe
 * if this function is ever invoked directly, e.g. from a future direct test
 * or pipeline entry point) - it always reports the action as
 * non-consequential and never rolls, per this feature's "mock mode:
 * assessment skipped, no roll" contract (see ai/prompts/README.md).
 */
import { Entity, WorldState } from '../../types';
import { GeminiClient, generateStructured, GEMINI_FLASH } from '../core/geminiService';
import { ActionAssessmentSchema } from '../core/schemas';
import { zActionAssessment } from '../core/zodSchemas';
import { buildActionAssessmentPrompt } from '../prompts/assessment';
import { getEntityBrief, buildWorldSummary } from '../prompts/fragments';

/** The action-assessment call's parsed/validated output shape. Mirrors `zActionAssessment`/`ActionAssessmentSchema` and (as an inline duplicate, see that type's doc comment) `types.ts`'s `ActionResolutionEvent.assessment`. */
export interface ActionAssessment {
  is_consequential: boolean;
  action_category: string;
  relevant_skill: 'oratory' | 'strategy' | 'intrigue' | null;
  difficulty: number;
  opposing_entity_id: string | null;
  rationale: string;
}

export const getActionAssessment = async (
  ai: GeminiClient,
  playerEntity: Entity,
  playerIntent: string,
  worldState: WorldState,
  npcEntities: Entity[],
  isMockMode: boolean
): Promise<ActionAssessment> => {
  if (isMockMode) {
    return {
      is_consequential: false,
      action_category: 'unclassified',
      relevant_skill: null,
      difficulty: 10,
      opposing_entity_id: null,
      rationale: 'Mock mode: the assessment call is skipped entirely - no roll is made.',
    };
  }

  const { systemInstruction, prompt } = buildActionAssessmentPrompt({
    playerIntent,
    playerBrief: getEntityBrief(playerEntity),
    worldSummary: buildWorldSummary(worldState),
    npcEntities,
  });

  return generateStructured<ActionAssessment>(ai, {
    callName: 'assessment',
    model: GEMINI_FLASH,
    systemInstruction,
    prompt,
    responseSchema: ActionAssessmentSchema,
    zodSchema: zActionAssessment,
    thinkingConfig: { thinkingBudget: 256 },
  });
};
