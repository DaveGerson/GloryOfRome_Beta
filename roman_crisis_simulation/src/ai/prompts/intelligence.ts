/**
 * ai/prompts/intelligence.ts
 *
 * Prompt builders for the "intelligence" tool family in
 * ai/tools/intelligence.ts: story relevance (Director spotlight-picking),
 * simulation-state updates, relationship updates, private NPC
 * conversations, investigations, clarifications, raw thoughts, and deep
 * analysis. Each builder returns { systemInstruction, prompt }, splitting
 * the stable role/task/format-contract text from the per-call dynamic
 * state, and is documented with PURPOSE/MODEL/CONSUMER/OUTPUT.
 *
 * Wording is preserved verbatim from the original inline template literals
 * in ai/tools/intelligence.ts, split only where necessary.
 */

import { Adjudication, Entity, WorldState, SimulationState } from '../../types';
import { getLightEntityBrief } from './fragments';

/**
 * PURPOSE: Answer a player's question about a past event via their
 * spymaster's aide, confident if the event's actors are visible to the
 * player, vague/rumor-based otherwise.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getClarificationOnEvent`.
 * OUTPUT: plain prose (no schema).
 */
export function buildClarificationPrompt(
  event: string,
  question: string,
  player: Entity,
  isVisible: boolean
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `You are a spymaster's aide in ancient Rome. Your master, ${player.name}, has asked for clarification on a recent event.

    **Your Master's Knowledge:** Your master has direct knowledge of these entities: ${player.visibility_network.join(', ')}.

    **Task:** Based on your master's knowledge, provide an answer.
    - If the key players in the event are visible to your master (${isVisible}), provide a confident, detailed answer.
    - If they are not visible, provide a vague, rumor-based answer reflecting your limited intelligence.
    `;

  const prompt = `**Event:** "${event}"
    **Question:** "${question}"`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: The player character's unfiltered/reputation-based inner
 * monologue about another character.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getRawThoughts`.
 * OUTPUT: plain prose (no schema).
 */
export function buildRawThoughtsPrompt(
  target: Entity,
  player: Entity,
  isVisible: boolean
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `You are the inner monologue of ${player.name}, a ${player.position} in ancient Rome. Your network: [${player.visibility_network.join(', ')}].
    Task: If you **know** the target (${isVisible}), provide your personal, unfiltered thoughts. If you **do not know** them (${!isVisible}), provide thoughts based on their public reputation. Keep it concise and first-person.`;

  const prompt = `You are contemplating another character: ${target.name}.`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: A trusted advisor's detailed intelligence report/threat
 * assessment on another character.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getDeepAnalysis`.
 * OUTPUT: plain prose (no schema).
 */
export function buildDeepAnalysisPrompt(
  target: Entity,
  player: Entity,
  isVisible: boolean
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `You are a trusted advisor to ${player.name}. Task: Provide a detailed intelligence report on ${target.name}.
    - If the target is in your network (${isVisible}), provide concrete intelligence and assess their threat level.
    - If they are outside your network (${!isVisible}), report on limited information and emphasize them as an "unknown variable".`;

  const prompt = `Target: ${target.name}.`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Generate the results of an investigation into a target's
 * secrets/beliefs/scheme, including a narrative report and possible
 * negative consequences.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/tools/intelligence.ts `getInvestigationResult`.
 * OUTPUT: validated against `zInvestigationResult` (ai/core/zodSchemas.ts) /
 * `buildInvestigationResultSchema` (ai/core/schemas.ts).
 */
export function buildInvestigationPrompt(
  target: Entity,
  player: Entity,
  subject: 'secrets' | 'beliefs' | 'scheme'
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `You are the head of intelligence for ${player.name}. You completed an investigation into ${target.name} to uncover their **${subject}**.

    **Task:** Generate a JSON object with the results.
    1.  **reportData:** Based on the target's profile, generate a plausible list of ${subject} (or a full Scheme object if the subject is 'scheme'). This is the raw data.
    2.  **report:** Write a brief, narrative report for your master summarizing what you found.
    3.  **consequences:** If the investigation has a chance of failure (paranoia > 6 or cunning > 6), there's a 40% chance of a negative consequence. Otherwise, return null. The consequence should be a short string describing the negative outcome (e.g., 'Your agent was spotted').

    **CRITICAL JSON FORMATTING RULES:**
    Your response MUST be a perfectly valid JSON object that adheres to the schema.
    - **Escape All Quotes:** Inside any string value, every double quote (") MUST be escaped (\\").
    - **No Trailing Commas.**`;

  const prompt = `**Target Profile:**
    - Name: ${target.name}
    - Position: ${target.position}
    - Personality: Ambition(${target.personality?.ambition}), Paranoia(${target.personality?.paranoia}), Loyalty(${target.personality?.loyalty}), Cunning(${target.personality?.cunning}), Honor(${target.personality?.honor})
    - Known Goals: ${target.short_term_goals.join(', ')}`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: The player character's first-person internal monologue is built
 * in ai/prompts/narration.ts (`buildPlayerMonologuePrompt`) - grouped there
 * per the narration/monologue/suggested-actions family rather than here.
 */

/**
 * PURPOSE: The "Director" call - pick 2-4 spotlight NPCs for this turn and
 * optionally suggest cast/location additions or removals to keep the story
 * fresh.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 0 (`getStoryRelevance` in
 * ai/tools/intelligence.ts).
 * OUTPUT: validated against `zStoryRelevance` (ai/core/zodSchemas.ts) /
 * `StoryRelevanceSchema` (ai/core/schemas.ts).
 */
export function buildStoryRelevancePrompt(
  turnNumber: number,
  prevTurnHeadlines: string[],
  worldState: WorldState
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a master storyteller and game master for a Roman political simulation.

    Task: Analyze the situation and determine the narrative focus for the upcoming turn.
    1.  **Spotlight Entities:** Identify 2-4 existing entities who are now critically important. Provide a brief reason for each.
    2.  **Evolve The World (Optional):** To keep the story fresh, consider if the cast or setting should change.
        - **Add Entity?** Is there a new character archetype missing that would create compelling conflict? (e.g., a populist tribune, a foreign envoy, a ruthless crime boss). If so, suggest adding ONE.
        - **Remove Entity?** Has an existing character become irrelevant or served their purpose? If so, suggest removing ONE to streamline the story.
        - **Add Location?** Would a new location open up strategic or narrative possibilities? (e.g., 'The Temple of Vesta', 'A Hidden Catacomb'). If so, suggest adding ONE.
        - **Remove Location?** Has a location become unimportant? If so, suggest removing ONE.

    Only suggest additions or removals if they would significantly improve the narrative. Otherwise, leave these fields null. Limit suggestions to a maximum of one of each type.

    Return a valid JSON object matching the schema.
    `;

  const prompt = `
    It is currently Turn ${turnNumber}. The political climate is ${worldState.political_climate}.

    Last turn's major events were:
    - ${prevTurnHeadlines.length > 0 ? prevTurnHeadlines.join('\n- ') : "The city was quiet."}
    `;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Update the high-level meta-narrative state (imperial/senate/
 * military status, plebeian mood, ongoing crisis) given a turn's events.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 2.5 (`getUpdatedSimulationState`
 * in ai/tools/intelligence.ts).
 * OUTPUT: validated against `zSimulationState` (ai/core/zodSchemas.ts) /
 * `SimulationStateSchema` (ai/core/schemas.ts).
 */
export function buildSimulationStateUpdatePrompt(
  adjudication: Adjudication,
  oldState: SimulationState
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
You are a Roman historian analyzing the state of the Empire. Based on the previous state and the summary of events that just occurred, update the meta-narrative state of the simulation.

**Your Task:**
Return a new, updated JSON object reflecting the current reality.
- If an emperor was killed, imperial_status MUST become 'Vacant' and a 'Succession Crisis' should begin.
- If legions are openly fighting, military_status MUST become 'Rebellious' and a 'Civil War' crisis should begin.
- If the senate was purged or its power broken, senate_status could become 'Deposed' or 'Irrelevant'.
- If events caused mass unrest (e.g., grain shortage), plebeian_mood could become 'Rioting'.

Return only the valid JSON object.
`;

  const prompt = `
**Previous State:**
${JSON.stringify(oldState, null, 2)}

**Events of This Week (Adjudication):**
- Headlines: ${adjudication.headlines.join('. ')}
- Key Deltas: ${adjudication.deltas.slice(0, 5).map(d => `${d.type} on ${d.key} because ${d.reason}`).join('; ')}
`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Derive 'relation' EventDeltas for relationships directly or
 * strongly implicitly affected by this turn's narration/headlines.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 5.5 (`getRelationshipUpdates`
 * in ai/tools/intelligence.ts).
 * OUTPUT: validated against `zRelationshipDeltas` (ai/core/zodSchemas.ts) /
 * `RelationshipDeltasSchema` (ai/core/schemas.ts).
 *
 * The directional relation-delta rule below is preserved verbatim - it
 * must stay in lockstep with the identical rule in
 * ai/prompts/adjudication.ts and the `EventDeltaSchema` description in
 * ai/core/schemas.ts.
 */
export function buildRelationshipUpdatesPrompt(
  narration: string,
  headlines: string[],
  entities: Entity[]
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a narrative analyst AI. Your task is to read a summary of events and identify subtle shifts in relationships between characters. Based on the events, suggest specific, numerical changes to their relationship stats.

    **Task:**
    Based *only* on the events described above, generate a list of 'relation' deltas to reflect how the characters' feelings towards each other might have changed.
    - Only generate deltas for relationships that were directly or strongly implicitly affected by the events.
    - The 'key' for a relation delta MUST be in the format 'entity_a_id:entity_b_id:attribute'. Valid attributes are 'trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'.
    - A delta changes entity_a's perception of entity_b ONLY (relationships are asymmetric). If both characters' feelings changed, emit two deltas — one per direction. The two directions need not be equal.
    - 'delta' should be a small integer, typically between -3 and 3, representing the change.
    - 'reason' should be a brief justification citing the event from the narration.
    - If no relationships were significantly affected, return an empty list for 'deltas'.

    Return a valid JSON object matching the schema.
    `;

  const entityBriefs = entities
    .filter(e => e.status === 'alive')
    .map(e => getLightEntityBrief(e, entities))
    .join('\n');

  const prompt = `
    **Current Character Relationships:**
    ${entityBriefs}

    **Events of the Turn:**
    Headlines:
    - ${headlines.join('\n- ')}

    Narration:
    "${narration}"
    `;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Simulate the outcome of a secret off-screen meeting between two
 * spotlight NPCs (alliance/betrayal/secret exchange) and the mechanical
 * EventDeltas that result.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 3.5 (`simulatePrivateConversation`
 * in ai/tools/intelligence.ts).
 * OUTPUT: validated against `zConversationSimulation` (ai/core/zodSchemas.ts) /
 * `ConversationSimulationSchema` (ai/core/schemas.ts).
 */
export function buildPrivateConversationPrompt(
  npc1: Entity,
  npc2: Entity,
  adjudication: Adjudication
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a secret observer in a Roman political simulation, reporting on clandestine meetings.

    **Task:**
    Simulate the outcome of their private conversation. What did they discuss? Did they form an alliance, betray one another, or exchange secrets?
    1.  **dialogueSnippet:** Write a short, third-person summary of their conversation for the Game Master's log.
    2.  **deltas:** Generate 1-3 'EventDelta' objects that mechanically represent the outcome. This could be changing their 'trust_level' or 'perceived_threat' towards each other, or creating a new 'resource' like 'blackmail_on_${npc1.entity_id}'.

    Return a valid JSON object matching the schema.
    `;

  const prompt = `
    Two characters, ${npc1.name} and ${npc2.name}, have met in secret this week.

    **Character Profiles:**
    - ${npc1.name} (${npc1.position}): Goals: ${npc1.short_term_goals.join(', ')}. Personality: Ambition(${npc1.personality?.ambition}), Cunning(${npc1.personality?.cunning}), Loyalty(${npc1.personality?.loyalty}).
    - ${npc2.name} (${npc2.position}): Goals: ${npc2.short_term_goals.join(', ')}. Personality: Ambition(${npc2.personality?.ambition}), Cunning(${npc2.personality?.cunning}), Loyalty(${npc2.personality?.loyalty}).

    **Context: Events of the Week**
    - Headlines: ${adjudication.headlines.join('. ')}
    - Player Action Summary: A player character took an action that resulted in these events.
    `;

  return { systemInstruction, prompt };
}
