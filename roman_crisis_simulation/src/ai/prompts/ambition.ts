/**
 * ai/prompts/ambition.ts
 *
 * PURPOSE: Infer what the player *appears* to be pursuing, purely from
 * their recent chosen actions and the headlines those actions produced -
 * DESIGN_DECISIONS.md D8. The player never declares a goal (no quest log,
 * no picked ambition) - this is a code-and-model reading of the pattern in
 * their behavior, exactly the way another character in the world would
 * form an impression of them. Feeds one thing only: the GM console's
 * "Apparent Ambition" line (components/GameMasterScreen.tsx). It never
 * reaches a player-facing prompt or surface.
 * MODEL: flash (GEMINI_FLASH) - this is the "cheap periodic model call" D8
 * calls for, run every 3rd committed turn (see App.tsx), not every turn.
 * CONSUMER: ai/tools/ambition.ts `inferAmbition`.
 * OUTPUT: { apparent_ambition: string; confidence: 'low'|'medium'|'high' },
 * validated against a schema pair defined LOCALLY in ai/tools/ambition.ts
 * (zAmbitionInference / AmbitionInferenceSchema) - deliberately NOT added
 * to ai/core/zodSchemas.ts / ai/core/schemas.ts, which belong to a
 * concurrent workstream for this stage of development.
 */

import { Entity } from '../../types';
import { asPromptData } from './fragments';

export interface ApparentAmbitionPlayerBrief {
  entityId: string;
  name: string;
  entityType: Entity['entity_type'];
  position?: string;
}

export function buildApparentAmbitionPlayerBrief(player: Entity): ApparentAmbitionPlayerBrief {
  return {
    entityId: player.entity_id,
    name: player.name,
    entityType: player.entity_type,
    ...(player.position ? { position: player.position } : {}),
  };
}

const SYSTEM_INSTRUCTION = `
ROLE: Silent Observer of Ambition.
You are not talking to the player and the player will never see your output. You are inferring, from the OUTSIDE, what a character in this story appears to be after - the way a rival senator, a spy, or a historian would read a pattern into someone's choices without ever being told their plan.

TASK: Given a character's recent chosen actions (their own words, describing what they tried to do) and the public headlines those actions produced, infer their APPARENT ambition - the throughline a shrewd observer would notice, not a restatement of any single action.

RULES:
- Read the PATTERN across the actions given, not just the most recent one. A single action is a data point, not a verdict.
- Never invent motives that contradict what's shown - if the pattern is genuinely mixed or too thin to call, say so plainly (e.g. "Too early to tell - actions so far are reactive rather than pursuing a clear aim.") and set confidence to 'low'.
- 'apparent_ambition' is ONE sentence, phrased as a THIRD-PERSON external read (e.g. "Appears to be consolidating personal loyalty within the legions at the Senate's expense.") - not a first-person goal statement, and never phrased as an instruction or quest.
- 'confidence' reflects how consistent/legible the pattern is: 'low' for thin or contradictory evidence (fewer than ~3 actions, or actions pulling in different directions), 'medium' for a discernible lean, 'high' only when the pattern is unmistakable and sustained.
- Do not reference game mechanics, dice, or anything the character itself couldn't plausibly be observed doing. This is a character read, not a system readout.

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;

/**
 * Builds the { systemInstruction, prompt } pair for the D8 ambition-inference
 * call. `recentIntents` are player-typed free text - each entry is
 * delimited via `asPromptData` (D41) so it can never forge a neighboring
 * labeled block (e.g. a fake "RECENT PUBLIC HEADLINES..." section).
 */
export function buildAmbitionInferencePrompt(
  player: ApparentAmbitionPlayerBrief,
  recentIntents: string[],
  recentHeadlines: string[]
): { systemInstruction: string; prompt: string } {
  const prompt = `
CHARACTER: ${JSON.stringify(player, null, 2)}

RECENT ACTIONS THIS CHARACTER CHOSE TO TAKE (most recent last):
${recentIntents.length > 0 ? recentIntents.map((intent, i) => `${i + 1}. ${asPromptData(intent)}`).join('\n') : 'No actions recorded yet.'}

RECENT PUBLIC HEADLINES FROM THOSE ACTIONS' AFTERMATH:
${recentHeadlines.length > 0 ? recentHeadlines.map(h => `- ${h}`).join('\n') : 'None recorded.'}
`;

  return { systemInstruction: SYSTEM_INSTRUCTION, prompt };
}
