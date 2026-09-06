/**
 * ai/prompts/worldGen.ts
 *
 * Prompt builders for the two-step world generation pipeline in
 * ai/core/initiator.ts: Step 1 builds the world/cast skeleton, Step 2
 * fleshes out full Entity objects for a batch of stubs.
 */

import { WorldState, EntityStub } from '../../types';
import { asPromptData } from './fragments';

/**
 * PURPOSE: Step 1 of world generation - create the WorldState skeleton and
 * a cast list of lightweight entity "stubs" (player + 4-6 NPCs).
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/initiator.ts `generateScenarioStructure`.
 * OUTPUT: validated against `zScenarioStructure` (ai/core/zodSchemas.ts) /
 * `ScenarioStructureSchema` (ai/core/schemas.ts).
 */
export function buildScenarioStructurePrompt(
  metaNarrative: string,
  playerCharacterDescription: string
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a world-building Game Master. Step 1: Create the skeleton of a new political simulation.

    **Task:**
    1.  **World State:** Generate a 'WorldState' with 3-4 distinct, thematic regions appropriate for the narrative.
    2.  **Cast List (Stubs):** Identify the key actors.
        - **Player:** One entity must be the player character.
        - **NPCs:** Create 4-6 other key entities (individuals or factions) that will drive the conflict.
        - For each, provide a 'stub': ID, name, position (role/title), and a one-sentence description.

    The 'entity_id's must be unique snake_case strings.

    **IMPORTANT:** Output ONLY the JSON object. Do not include any conversational text.
    `;

  // metaNarrative/playerCharacterDescription are player-typed free text -
  // the earliest reachable point in the app, straight from the two text
  // inputs on the character-creation screen (components/CharacterSelection.tsx's
  // `metaNarrative`/`customDescription` useState fields). Delimited via
  // `asPromptData` (D41) so an embedded quote or line separator can never
  // break the surrounding quoting or forge a neighboring labeled line (e.g.
  // a fake "**Player Concept:**").
  const prompt = `
    **Meta-Narrative:** ${asPromptData(metaNarrative)}
    **Player Concept:** ${asPromptData(playerCharacterDescription)}
    `;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Step 2 of world generation - flesh out full Entity objects
 * (relationships, schemes, resources, location) for one batch of stubs.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/initiator.ts `generateEntityBatch` (called once for the
 * player, then once per NPC batch of 2, in parallel).
 * OUTPUT: validated against `zEntityBatch` (ai/core/zodSchemas.ts) /
 * `EntityListSchema` (ai/core/schemas.ts).
 */
export function buildEntityBatchPrompt(
  targetStubs: EntityStub[],
  allStubs: EntityStub[],
  metaNarrative: string,
  worldState: WorldState
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a world-building Game Master. Step 2: Flesh out the characters.

    **Task:**
    Generate the FULL 'Entity' objects for ONLY the specific characters requested below.

    **Requirements:**
    1.  **Match IDs:** You MUST use the exact 'entity_id's provided.
    2.  **Deep Relationships:** Every entity must have a 'relationships' object keyed by the IDs of the OTHER entities in the Full Cast Context.
        - Set 'trust_level' (-10 to 10).
        - Set 'perceived_threat', 'ideological_alignment', 'dependency_level'.
    3.  **Schemes:** Give every entity (except maybe the player) a multi-step 'active_scheme'.
    4.  **Resources:** Give every entity holdings under the CANONICAL ledger keys, then colour them: 'denarii' for spendable coin (the player gets a treasury sized to the setting; NPC treasuries are theirs to spend in play), 'investigations' (1-5) and 'deep_analyses' (1-4) for the player, counted 'troops'/'guards'/'agents' where a character commands men (the engine pays them 8/12/15 a week from their denarii), productive 'estates'/'ships'/'workshops' where they own property (600/250/150 a week each) - balanced so weekly wages do not exceed weekly yield plus a tenth of the denarii - one or two 0-100 standings ('legion_support', 'senatorial_support', 'popular_support', 'political_influence', 'legitimacy', 'military_might'), 'favors' where favours are owed, and one or two unique thematic assets as 'holding_<slug>' with value 1 (a relic, a hostage, a ship with a name). A resource under a new name is welcome only when none of these fits.
    5.  **Location:** Place them in one of the regions defined in the World State.
    6.  **Memories:** Start with empty arrays.
    7.  **Voice & Epithet:** Give EVERY entity (the player included) a 'voice' - a COMPACT speech-style directive for how they talk and think (e.g. "clipped soldier's Latin, contempt for senatorial flourish") - and an 'epithet', a SHORT public byname (e.g. "the Thracian"). Keep both short and make each voice DISTINCT from the others'; for a collective entity (a faction, a guard, a mob) a group voice and collective epithet are fine.

    **CRITICAL OUTPUT RULES:**
    - Output pure JSON only.
    - **DO NOT REPEAT** the Cast Context or the inputs in your response logic.
    - **DO NOT** output entities that were not requested in the "Task" list.
    `;

  const targetIds = targetStubs.map(s => s.entity_id).join(', ');
  const castListContext = allStubs.map(s => `- ${s.name} (${s.entity_id}): ${s.position}. ${s.brief_description}`).join('\n');
  const regionNames = Object.keys(worldState.regions).join(', ');

  // metaNarrative is player-typed free text (see the doc comment on
  // buildScenarioStructurePrompt above) - delimited via `asPromptData` (D41)
  // so it can never forge a neighboring labeled line (e.g. a fake
  // "**Regions Available:**").
  const prompt = `
    **Meta-Narrative:** ${asPromptData(metaNarrative)}
    **Regions Available:** ${regionNames}

    **Full Cast Context (Use this for relationships):**
    ${castListContext}

    Generate the FULL 'Entity' objects for ONLY these specific characters: ${targetIds}.
    `;

  return { systemInstruction, prompt };
}
