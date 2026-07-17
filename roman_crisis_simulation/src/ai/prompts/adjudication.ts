/**
 * ai/prompts/adjudication.ts
 *
 * PURPOSE: Build the single-shot, two-phase (proactive NPC simulation +
 * player-action adjudication) turn prompt.
 * MODEL: pro (GEMINI_PRO) - the highest-stakes call in the pipeline.
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 2.
 * OUTPUT: validated against `zAdjudication` (ai/core/zodSchemas.ts) /
 * `AdjudicationSchema` (ai/core/schemas.ts).
 *
 * This is a straight split of the former `ai/core/engine.ts::compileContext`
 * along the system/user boundary: the STABLE role, phase explanation, and
 * simulation rules/output contract (identical every turn) now live in
 * `systemInstruction`; the PER-TURN dynamic state (world summary, entity
 * briefs, player action, history, GM intervention, story-evolution
 * suggestions) lives in `prompt`. Wording is preserved verbatim from the
 * original template literal except for the trivial glue needed to split it
 * into two strings.
 *
 * The directional relationship-delta rule ("A delta changes entity_a's
 * perception of entity_b ONLY... if a change is mutual, emit two deltas")
 * is preserved verbatim below - see also `ai/core/schemas.ts`'s
 * `EventDeltaSchema` description and `ai/prompts/intelligence.ts`'s
 * relationship-updates prompt, which state the same rule for their own
 * call sites.
 */

import { Entity, WorldState, SimulationState, StoryRelevance } from '../../types';
import {
  buildWorldSummary,
  buildSpotlightBlock,
  buildOtherNpcsBlock,
  buildGmInterventionBlock,
  buildStoryEvolutionBlock,
  buildMetaNarrativeBlock,
  buildMetaStateBlock,
} from './fragments';

const ADJUDICATION_SYSTEM_INSTRUCTION = `
ROLE: Roman Crisis Adjudicator & Simulation Engine
You are a meticulous simulation engine. Your task is to perform a two-phase adjudication for the turn.

---
**PHASE 1: PROACTIVE NPC SIMULATION**
First, review the 'SPOTLIGHT NPCS'. These characters are actively pursuing their own agendas this turn. Based on their 'Active Scheme', personality, and goals, determine what actions they take *independently* of the player. These are their secret moves and plans for the week.

**PHASE 2: PLAYER ACTION ADJUDICATION & REACTION**
Next, consider the player's action. Adjudicate the outcome of this action and determine how all NPCs (both Spotlight and Other) react to it and to the events of Phase 1.

The final JSON output should be a single, unified adjudication combining both phases into a coherent narrative of the turn.
---

--- SIMULATION RULES & OUTPUT ---

PRINCIPLES:
- NARRATIVE DRIVE: Your primary goal is to create a dynamic, consequential story. Actions should have significant reactions, pushing the scenario towards climactic moments. Avoid static or "no change" outcomes. The world is on a knife's edge; reflect this in the adjudication.
- PERSONALITY & RELATIONSHIP DRIVEN AI: All NPC actions MUST be driven by their personality, relationships, and goals.
    - An honorable character (high honor) should avoid treachery. A paranoid character (high paranoia) might misinterpret neutral actions as hostile. Ambitious characters will take risks.
    - A character with high 'perceived_threat' from another should act defensively or preemptively against them.
    - A character with high 'respect_level' for another may hesitate to act against them or may treat them with deference, even if trust is low. Conversely, low respect can lead to dismissive or contemptuous actions.
    - Use 'ideological_alignment' to determine natural allies and enemies.
    - Use 'dependency_level' to see who might be easily coerced or who an entity might protect.
- DYNAMIC SCHEMES: An entity's actions must advance their 'active_scheme'. If a scheme is completed, failed, or becomes irrelevant, you MUST generate a completely new, plausible, multi-step 'active_scheme'. Update it using a 'scheme' delta. The 'key' is the entity's ID, delta is 0, and 'reason' is a JSON STRING of the complete, new scheme object.
- FLUID ALLIANCES: Factions are not permanent. Entities can be persuaded, coerced, or inspired to change their allegiance. If an event would logically cause an entity to switch sides, create a 'faction' delta. Major political shifts can also depose a faction leader or dissolve a faction entirely via 'status' or 'remove_entities' deltas.
- DYNAMIC RESOURCES: You can create new, specific resources for entities (e.g., 'blackmail_on_senator_x'). New resources are created via 'resource' deltas. The 'key' must be 'entity_id:resource_name' where resource_name is snake_case (4-20 characters). The 'reason' should explain what this resource represents.
- DYNAMIC CAST & LOCATIONS: The world is not static. Implement storyteller suggestions for adding/removing entities and locations.
    - To add an entity, use the 'add_entities' field.
    - To remove an entity, use the 'remove_entities' field.
    - To add/remove a location, create an 'add_region'/'remove_region' delta. Before removing a location, you MUST relocate any entities there using 'status' deltas.
- RELATIONSHIP DELTAS: To modify a relationship, create a 'relation' delta. The 'key' MUST specify the attribute: 'entity_a_id:entity_b_id:attribute'. Valid attributes are 'trust_level', 'respect_level', 'perceived_threat', 'ideological_alignment', 'dependency_level'. The 'delta' is the amount to change. A delta changes entity_a's perception of entity_b ONLY (relationships are asymmetric); if a change is mutual, emit two deltas, one per direction.
- Spotlight NPCs MUST take at least one proactive action to advance their scheme.
- All NPCs can react. The player's action can be the catalyst for the turn.
- Introduce 0-2 rumors per turn via 'rumor' deltas. A rumor's 'delta' field is its credibility (0.0 to 1.0).

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;

export interface AdjudicationPromptInput {
  worldState: WorldState;
  simulationState: SimulationState;
  playerEntity: Entity;
  npcEntities: Entity[];
  history: string[];
  playerIntent: string;
  gmInterventionText: string;
  storyRelevance: StoryRelevance;
  metaNarrative: string;
}

/** Builds the { systemInstruction, prompt } pair for the main turn adjudication call. */
export function buildAdjudicationPrompt(input: AdjudicationPromptInput): { systemInstruction: string; prompt: string } {
  const {
    worldState, simulationState, playerEntity, npcEntities, history,
    playerIntent, gmInterventionText, storyRelevance, metaNarrative,
  } = input;

  const spotlightIds = new Set(storyRelevance.spotlight_entities.map(s => s.entity_id));
  const spotlightNpcs = npcEntities.filter(e => spotlightIds.has(e.entity_id) && e.status === 'alive');
  const otherNpcs = npcEntities.filter(e => !spotlightIds.has(e.entity_id) && e.status === 'alive');

  const prompt = `
${buildMetaNarrativeBlock(metaNarrative)}

${buildMetaStateBlock(simulationState)}

WORLD SUMMARY:
${buildWorldSummary(worldState)}
Regions: ${JSON.stringify(worldState.regions, null, 2)}

RECENT HISTORY (max 6 items):
${history.length > 0 ? history.join('\n') : "No recent events of note."}

--- TURN SIMULATION INPUTS ---

${buildSpotlightBlock(spotlightNpcs)}

${buildOtherNpcsBlock(otherNpcs)}

PLAYER CHARACTER:
Name: ${playerEntity.name} (ID: ${playerEntity.entity_id})
Action this turn: "${playerIntent}"
This action is an INPUT. Do NOT generate an action for the player in your output. Your task is to determine the consequences and NPC reactions to this action.

${buildGmInterventionBlock(gmInterventionText)}

${buildStoryEvolutionBlock(storyRelevance)}
`;

  return { systemInstruction: ADJUDICATION_SYSTEM_INSTRUCTION, prompt };
}
