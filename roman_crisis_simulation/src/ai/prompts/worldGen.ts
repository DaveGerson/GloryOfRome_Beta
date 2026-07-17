/**
 * ai/prompts/worldGen.ts
 *
 * Prompt builders for the two-step world generation pipeline in
 * ai/core/initiator.ts: Step 1 builds the world/cast skeleton, Step 2
 * fleshes out full Entity objects for a batch of stubs.
 */

import { WorldState, EntityStub } from '../../types';

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

  const prompt = `
    **Meta-Narrative:** "${metaNarrative}"
    **Player Concept:** "${playerCharacterDescription}"
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
    4.  **Resources:** Create unique, thematic resources.
    5.  **Location:** Place them in one of the regions defined in the World State.
    6.  **Memories:** Start with empty arrays.

    **CRITICAL OUTPUT RULES:**
    - Output pure JSON only.
    - **DO NOT REPEAT** the Cast Context or the inputs in your response logic.
    - **DO NOT** output entities that were not requested in the "Task" list.
    `;

  const targetIds = targetStubs.map(s => s.entity_id).join(', ');
  const castListContext = allStubs.map(s => `- ${s.name} (${s.entity_id}): ${s.position}. ${s.brief_description}`).join('\n');
  const regionNames = Object.keys(worldState.regions).join(', ');

  const prompt = `
    **Meta-Narrative:** "${metaNarrative}"
    **Regions Available:** ${regionNames}

    **Full Cast Context (Use this for relationships):**
    ${castListContext}

    Generate the FULL 'Entity' objects for ONLY these specific characters: ${targetIds}.
    `;

  return { systemInstruction, prompt };
}
