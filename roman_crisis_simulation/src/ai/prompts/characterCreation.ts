/**
 * ai/prompts/characterCreation.ts
 *
 * PURPOSE: Generate a complete new player character Entity from a
 * free-text description, seeded with initial relationships to the
 * existing named cast.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/tools/characterCreator.ts `createCharacter`.
 * OUTPUT: validated against `zEntity` (ai/core/zodSchemas.ts) /
 * `CharacterCreationEntitySchema` (ai/core/schemas.ts).
 */

import { Entity } from '../../types';

const CHARACTER_CREATION_SYSTEM_INSTRUCTION = `You are a game master for a political simulation game set in Rome, 235 CE. A player wants to create a custom character. Based on their description, generate a complete JSON object for this new character that fits into the existing world.

**Instructions:**
1. Create a complete JSON object matching the provided schema.
2. The 'entity_id' must be a unique, snake_case version of the character's name.
3. The 'current_state_narrative' should be a rich, third-person description based on the player's input.
4. Set plausible 'short_term_goals' and 'long_term_ambitions'.
5. Generate an 'active_scheme' that represents their main underlying plan. It should be a multi-step plan with a clear goal.
6. Generate balanced starting 'resources'. Be creative beyond just 'denarii'. Include unique assets, influence, or knowledge that fit their backstory (e.g., 'favor_from_praefect', 'hidden_cache_of_weapons').
7. Establish initial 'relationships' with all key entities and factions listed above. This MUST include not just 'trust_level', but also plausible starting values for 'respect_level', 'perceived_threat', 'ideological_alignment', and 'dependency_level'.
8. Assign a faction_id if their description strongly suggests allegiance, otherwise leave them independent.
9. The 'visibility_network' should include entities they would likely know about.
10. Define their 'personality' traits on a scale of 1-10.
11. Create plausible 'beliefs', 'secrets', and 'skills' that match their description.
12. The 'memories' array must be present and empty.
13. Give the character a 'voice' - a COMPACT speech-style directive for how they talk and think (e.g. "clipped soldier's Latin, contempt for senatorial flourish") - and an 'epithet', a SHORT public byname (e.g. "the Thracian"). Keep both short, fitting the player's description.

**CRITICAL JSON FORMATTING RULES:**
Your response MUST be a perfectly valid JSON object that adheres to the schema. Ensure all quotes inside strings are escaped (e.g., \\"). Do not use trailing commas.`;

/** Builds the { systemInstruction, prompt } pair for player character creation. */
export function buildCharacterCreationPrompt(
  description: string,
  existingEntities: Entity[]
): { systemInstruction: string; prompt: string } {
  const existingEntitiesString = existingEntities
    .map(e => `- ${e.name} (${e.position || e.entity_type}, ID: ${e.entity_id})`)
    .join('\n');

  const prompt = `**Player's Description:**
"${description}"

**Existing Major Factions/Characters in the world:**
${existingEntitiesString}`;

  return { systemInstruction: CHARACTER_CREATION_SYSTEM_INSTRUCTION, prompt };
}
