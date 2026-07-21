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

import { Entity, WorldState, SimulationState, StoryRelevance, NpcIntent } from '../../types';
import type { ActionResolutionTier } from '../core/resolution';
import {
  buildWorldSummary,
  buildSpotlightBlock,
  buildOtherNpcsBlock,
  buildDirectorIntentsBlock,
  buildGmInterventionBlock,
  buildStoryEvolutionBlock,
  buildMetaNarrativeBlock,
  buildMetaStateBlock,
  buildSecretSurvivorsBlock,
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
- STATUS DELTAS: To change an entity's life/freedom status or their location, create a 'status' delta with 'key' as the entity_id. You MUST set the structured 'new_status' field to the entity's new status ('alive', 'dead', 'exiled', or 'missing') whenever their status changes - do not rely on 'reason' text for this, it is narrative only and is never parsed for game logic. If the entity also relocates (e.g. fleeing into exile, being banished, going missing in a specific place), set 'new_location' to the destination region's name; omit it if their location does not change. 'reason' should still contain the narrative explanation of what happened (e.g. "Struck down by an assassin's blade in the forum"), for the report log.
- Spotlight NPCs MUST take at least one proactive action to advance their scheme.
- All NPCs can react. The player's action can be the catalyst for the turn.
- Introduce 0-2 rumors per turn via 'rumor' deltas. That 0-2 budget applies to ORGANIC rumors only: planted rumors (player or NPC, see PLANTED RUMORS & COUNTERPLAY below) and counterplay follow-ups are ADDITIONAL and are never suppressed to stay within the budget - a mandated plant always resolves into its 'rumor' delta. A rumor's 'delta' field is its credibility (0.0 to 1.0). EVERY 'rumor' delta MUST also carry two GM-private bookkeeping fields:
    - 'is_true' (boolean, ALWAYS set): whether the claim is ACTUALLY TRUE in the simulation's reality. You are the arbiter of that reality, so you can and must rule true or false on every rumor at emission - never omit it, and there is no "unknown". Truth is independent of credibility: a planted lie can sound highly credible, and a true claim can sound implausible.
    - 'origin_id' (string): the entity_id of whoever started or is spreading the rumor. Omit it ONLY when the rumor is genuinely organic, with no single attributable source.
    Both fields are GM-private ledger data: they must NEVER surface in 'headlines', in any delta's 'reason' text, or in anything else that could reach the player - the rumor is presented to the player exactly as before, credibility and all, regardless of its truth.
- PLANTED RUMORS & COUNTERPLAY (lies in play):
    - PLAYER PLANTING: When the player's action this turn is spreading or planting a rumor - a fabricated lie OR a deliberately spread truth - you MUST resolve it into a 'rumor' delta: 'is_true' reflects whether the claim is ACTUALLY TRUE in the simulation's reality (not whether the player believes it or wants it believed), and 'origin_id' is the PLAYER'S entity_id. When a "PLAYER ACTION OUTCOME" block is present, its tier governs HOW WELL the plant lands: the rumor's credibility (its 'delta'), how far it spreads, and whether the origin stays hidden in the fiction - on a failure tier, suspicion may fall on the player through NPC reactions and 'relation' deltas, never by labeling the rumor itself.
    - NPC PLANTING: NPCs may plant rumors in service of their 'active_scheme' under the same contract: a 'rumor' delta whose 'is_true' is ruled STRICTLY by whether the claim is ACTUALLY TRUE in the world - a fabricated lie is typically false because its claim is false, a weaponized truth is still true, and a fabrication that happens to be true is still true; authorship never changes the ruling - and 'origin_id' set to the planting NPC's entity_id.
    - COUNTERPLAY: Planted rumors are game objects other characters act against. In later turns, an NPC who would plausibly investigate a rumor that damages them or their interests may produce a follow-up 'rumor' delta that corroborates, mutates, or refutes the existing claim. Phrase the follow-up as an UPDATE about the SAME subject, reusing the original rumor's 'key', so it reads as the rumor mill re-reporting on the same matter. The mill has no special access to truth: refuting a true rumor and corroborating a false one are both allowed; every follow-up still carries its own honest 'is_true' ruling on what ITS claim asserts.
    - NEVER REVEAL: No player-visible text ('headlines', any delta's 'reason', a report's claim) may state a rumor's truth status or that it was planted - a planted rumor must read exactly like any other rumor. Authorship and truth live ONLY in the GM-private 'is_true'/'origin_id' fields and, if you wish to note them, 'gm_private'.
- DEBT HAS TEETH: If an entity carries a 'debt_denarii' resource (created automatically by the simulation when their denarii overdraws — you never set this directly), treat them as beholden to their creditors, not merely poor. Creditors may be introduced or invoked as named NPCs. As debt persists or grows, the debtor's 'dependency_level' toward a creditor should rise via a 'relation' delta. Refusing or being unable to service the debt has real social consequences — a creditor calling in favors, spreading damaging rumors, or turning openly hostile — reflected in 'relation' deltas, 'rumor' deltas, or headlines, never silently ignored.
- WORLD DELTAS: When the turn's events plausibly shift the empire's macro condition, emit a 'world' delta. The 'key' MUST be 'economic_stability' or 'political_climate'; 'reason' is the new short string value for that field (e.g. 'Failing', 'Openly Hostile'). At most one 'world' delta per field per turn. 'delta' is ignored for this type; set it to 0.
- PLAYER ACTION RESOLUTION (resolution layer, ROADMAP_0_MASTER_PLAN.md Phase 3 item 4): When the prompt below includes a "PLAYER ACTION OUTCOME" block, the player's action's outcome TIER has ALREADY been decided by a hidden dice roll you never see - mirroring the mortality pipeline's own contract (you narrate/adjudicate a pre-decided outcome, you never decide it yourself). You decide HOW that tier manifests - the concrete deltas, NPC reactions, and headline wording - you never decide, second-guess, upgrade, or downgrade WHETHER the action succeeded. The tier name is for your (the adjudicator's) internal use only: NEVER let the tier name, a roll number, or any other mechanical detail reach 'headlines', a delta's player-adjacent 'reason' text, or anything else that could reach the player - mechanics stay exclusively in your own reasoning and, if you wish to note them, 'gm_private'. When no such block is present, the player's action carries no pre-decided outcome - adjudicate it exactly as you always have.

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;

/**
 * The pre-decided outcome of the player's action, from the resolution layer
 * (`ai/core/resolution.ts::resolveAction`, wired in `ai/core/turn.ts`).
 * Present ONLY when the assessment call (`ai/prompts/assessment.ts`)
 * flagged the action as consequential - see `buildPlayerActionOutcomeBlock`
 * below. `tier` is GM-side only; it must never reach player-facing text.
 */
export interface PlayerActionOutcomeContext {
  tier: ActionResolutionTier;
  actionCategory: string;
}

/** Per-tier authoring guidance for the adjudicator, keyed by the exact tier strings from ai/core/resolution.ts. Mirrors ai/prompts/mortality.ts's BAND_GUIDANCE pattern. */
const PLAYER_ACTION_TIER_GUIDANCE: Record<ActionResolutionTier, string> = {
  critical_failure: 'The action fails badly. Narrate/adjudicate a real, concrete negative consequence beyond simple failure - a complication, an exposure, or a backfire that leaves the player worse off than if they had done nothing.',
  failure: "The action does not achieve its goal. The consequence should be plausible and may sting, but it is not catastrophic.",
  partial_success: 'The action partly succeeds - the player gains something real, but at a cost or with a complication attached.',
  success: "The action succeeds cleanly and achieves its intended goal.",
  critical_success: "The action succeeds exceptionally well - it achieves its goal AND yields an extra, unlooked-for benefit.",
};

/**
 * Builds the "PLAYER ACTION OUTCOME" block injected into the adjudication
 * prompt when the resolution layer has already decided the player's
 * action's outcome tier this turn. Returns '' (no block at all) when
 * `outcome` is undefined - the non-consequential path, where the
 * adjudicator behaves exactly as it did before this feature existed.
 * Exported for direct unit testing.
 */
export function buildPlayerActionOutcomeBlock(outcome: PlayerActionOutcomeContext | undefined, playerIntent: string): string {
  if (!outcome) return '';
  return `
PLAYER ACTION OUTCOME (pre-decided by a hidden roll - GM-only; never reveal the tier, roll, or any mechanics to the player):
The player's action ("${playerIntent}", category: ${outcome.actionCategory}) has ALREADY been mechanically resolved as: ${outcome.tier.toUpperCase()}.
${PLAYER_ACTION_TIER_GUIDANCE[outcome.tier]}
This outcome is FINAL. You decide HOW it manifests in the story - you do NOT decide, second-guess, upgrade, or downgrade WHETHER it succeeded.
`;
}

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
  /** Present only when the resolution layer's assessment call flagged this turn's player action as consequential - see `buildPlayerActionOutcomeBlock`. */
  playerActionOutcome?: PlayerActionOutcomeContext;
  /**
   * The Director's committed per-spotlight intents for THIS turn (4C.3) -
   * the bounded list ai/core/turn.ts derives via `selectDurableIntents`.
   * Optional so pre-Director constructions keep working; absent/empty means
   * no SPOTLIGHT NPC INTENTS block (see `buildDirectorIntentsBlock`).
   */
  npcIntents?: NpcIntent[];
}

/** Builds the { systemInstruction, prompt } pair for the main turn adjudication call. */
export function buildAdjudicationPrompt(input: AdjudicationPromptInput): { systemInstruction: string; prompt: string } {
  const {
    worldState, simulationState, playerEntity, npcEntities, history,
    playerIntent, gmInterventionText, storyRelevance, metaNarrative,
    playerActionOutcome, npcIntents,
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
${buildDirectorIntentsBlock(npcIntents)}
${buildOtherNpcsBlock(otherNpcs)}

${buildSecretSurvivorsBlock(npcEntities)}

PLAYER CHARACTER:
Name: ${playerEntity.name} (ID: ${playerEntity.entity_id})
Action this turn: "${playerIntent}"
This action is an INPUT. Do NOT generate an action for the player in your output. Your task is to determine the consequences and NPC reactions to this action.
${buildPlayerActionOutcomeBlock(playerActionOutcome, playerIntent)}
${buildGmInterventionBlock(gmInterventionText)}

${buildStoryEvolutionBlock(storyRelevance)}
`;

  return { systemInstruction: ADJUDICATION_SYSTEM_INSTRUCTION, prompt };
}
