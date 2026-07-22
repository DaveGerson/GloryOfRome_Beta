/**
 * ai/prompts/fragments.ts
 *
 * Shared, reusable prompt-text builders extracted from `ai/core/engine.ts`'s
 * former `compileContext`/`getEntityBrief` (and a near-duplicate brief
 * builder that had been re-implemented in `ai/tools/intelligence.ts`'s
 * `getRelationshipUpdates`). This is the one source of truth for each
 * fragment - every prompt builder in ai/prompts/*.ts that needs an entity
 * brief, a world-state summary, the GM-intervention block, or a
 * relationship listing pulls it from here instead of re-serializing state
 * inline.
 *
 * Text is moved verbatim from its original call site; only the glue
 * (function signatures, JSDoc) is new.
 */

import { Entity, WorldState, SimulationState, StoryRelevance, NpcIntent, NpcMindDecision } from '../../types';

/**
 * The opaque stand-in that REPLACES a 'scheme' delta's `reason` before that
 * delta is serialized into any prompt whose OUTPUT the player reads (D28). A
 * 'scheme' delta's real `reason` is the full active_scheme JSON - name,
 * overall goal, and ordered steps - which is GM-private: perception reveals
 * only THAT a character's design shifted, never its nature (that is earned by
 * accreting clues). The player-output-bound prompts (the narration prompt and
 * the sim-state prompt, whose text renders in WorldStateTab) swap the real
 * reason for this marker, so the model learns only that a private design
 * moved, never its name or steps. The swap happens ONLY in the string handed
 * to those prompts: the engine's own 'scheme' case still parses the REAL
 * reason, and the delta object itself is never mutated.
 */
export const REDACTED_SCHEME_REASON = 'A character quietly advanced a private design this turn; its nature is not observable.';

/**
 * Full per-entity brief: goals/scheme/personality/skills/beliefs/relationships.
 * Used for spotlight and "other" NPCs in the adjudication prompt, and for
 * the player entity elsewhere. Moved verbatim from `engine.ts`'s
 * `getEntityBrief` (unexported local helper).
 *
 * `skills` (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4): a compact
 * "Skills: oratory:5, strategy:7" line, added so the adjudicator and the
 * resolution layer's assessment call (ai/prompts/assessment.ts) can see
 * numeric skill values - previously omitted entirely, so no prompt ever let
 * the model reason about a character's actual competence. A handful of
 * short tokens per entity; trivial prompt-size impact even across a full
 * cast of NPCs.
 *
 * `epithet` ONLY, never `voice` (4C.5): the epithet is one token of public
 * flavor riding the name; voice directives deliberately stay OUT of the
 * omniscient briefs to save context - they feed only the character's own
 * mind prompt (ai/prompts/npcMind.ts) and the narration prompt's bounded
 * voice-cast block (ai/prompts/narration.ts). Both fields are OPTIONAL: a
 * legacy entity without them renders exactly as before (never "undefined").
 */
export function getEntityBrief(entity: Entity): string {
  const relationships = Object.values(entity.relationships)
    .filter(r => r) // Filter out null or undefined relationships
    .map(r => `${r.entity_id}(T:${r.trust_level}, R:${r.respect_level ?? 0}, Th:${r.perceived_threat ?? 0}, A:${r.ideological_alignment ?? 0}, D:${r.dependency_level ?? 0})`).join(', ');
  const personality = entity.personality ? `Personality(A:${entity.personality.ambition}, P:${entity.personality.paranoia}, L:${entity.personality.loyalty}, C:${entity.personality.cunning}, H:${entity.personality.honor})` : '';
  const skills = entity.skills ? `Skills: ${Object.entries(entity.skills).map(([name, value]) => `${name}:${value}`).join(', ')}` : '';
  const beliefs = entity.beliefs ? `Beliefs: ${entity.beliefs.join('; ')}` : '';
  const scheme = entity.active_scheme ? `Active Scheme: ${JSON.stringify(entity.active_scheme)}` : '';
  return `${entity.name}${entity.epithet ? ` "${entity.epithet}"` : ''} (${entity.position || entity.entity_type}) [Status: ${entity.status}, Location: ${entity.location}] Goals: ${entity.short_term_goals.join(', ')}. ${scheme}. ${personality}. ${skills}. ${beliefs}. Relationships: ${relationships}`;
}

/**
 * Lightweight per-entity relationship summary (name + trust/threat only),
 * used where a full brief would be overkill. Moved verbatim from
 * `intelligence.ts`'s `getRelationshipUpdates` (previously an inline
 * `.map()` building `entityBriefs`).
 */
export function getLightEntityBrief(entity: Entity, allEntities: Entity[]): string {
  const rels = Object.entries(entity.relationships)
    .filter(([, rel]) => rel) // Add a filter to remove null or undefined relationships
    .map(([id, rel]) => {
      const targetName = allEntities.find(t => t.entity_id === id)?.name || id;
      return `${targetName}(T:${rel.trust_level}, Th:${rel.perceived_threat ?? 0})`;
    }).join(', ');
  return `- ${entity.name} (ID: ${entity.entity_id}). Relationships: ${rels || 'None'}`;
}

/** One-line world summary (year/week/political climate/economic stability). */
export function buildWorldSummary(worldState: WorldState): string {
  return `Year: ${worldState.year}, Week: ${worldState.week}. Political Climate: ${worldState.political_climate}. Economic Stability: ${worldState.economic_stability}.`;
}

/** The "SPOTLIGHT NPCS (Proactive Simulation)" block from the adjudication prompt. */
export function buildSpotlightBlock(spotlightNpcs: Entity[]): string {
  return spotlightNpcs.length > 0 ? `
SPOTLIGHT NPCS (Proactive Simulation):
These entities are central to this turn's events. You MUST generate proactive actions for them based on their 'Active Scheme'.
${spotlightNpcs.map(getEntityBrief).join('\n')}
` : 'No spotlight NPCs this turn.';
}

/** The "OTHER NPCS (Reactive Simulation)" block from the adjudication prompt. */
export function buildOtherNpcsBlock(otherNpcs: Entity[]): string {
  return otherNpcs.length > 0 ? `
OTHER NPCS (Reactive Simulation):
These entities should primarily react to the player's action or the actions of spotlight NPCs. They only act independently if strongly motivated.
${otherNpcs.map(getEntityBrief).join('\n')}
` : '';
}

/**
 * The Director's per-spotlight intents block for the adjudication prompt
 * (ROADMAP_PHASE_4.md 4C item 3). The two-phase adjudication prompt already
 * demands proactive spotlight actions; this block gives those actions
 * durable direction: each spotlight NPC's Phase 1 action must serve the
 * one-line intent the Director committed for it - unless that NPC's own
 * mind decision (the block below this one) overrides it, per the system
 * instruction's DIRECTION PRECEDENCE rule (mind decision > Director intent
 * > generic scheme rules). Empty/absent intents produce no block at all -
 * the adjudicator behaves exactly as before the Director existed.
 * GM-private data class (D4/D5) with the same carve-out the resolution
 * layer states for its tiers: what stays private is the direction system's
 * PROVENANCE (that an intent exists, its wording) - the acted-out move
 * itself is a real event whose public manifestation belongs in headlines.
 */
export function buildDirectorIntentsBlock(npcIntents: NpcIntent[] | undefined): string {
  if (!npcIntents || npcIntents.length === 0) return '';
  return `
SPOTLIGHT NPC INTENTS (the Director's durable direction for this turn):
Each spotlight NPC below is durably trying to accomplish its stated intent. Their Phase 1 proactive actions MUST act in service of their stated intent - advance it, or react to whatever blocks it - and do not let a spotlight NPC drift onto unrelated business this turn, UNLESS that NPC has an entry in the mind-decisions block below: per DIRECTION PRECEDENCE (mind decision > Director intent > generic scheme rules), the mind decision then governs instead. These intents are GM-private direction: never restate them in 'headlines' or any other player-visible text. What is private is the provenance - that an intent exists, its wording, that a Director set it. The action taken in service of an intent is a real event: its public manifestation may and should surface in headlines and NPC reactions as usual.
${npcIntents.map(i => `- ${i.entity_id}: "${i.intent}" [${i.continuity}]`).join('\n')}
`;
}

/**
 * The minds' decisions block for the adjudication prompt (ROADMAP_PHASE_4.md
 * 4C item 4). Each spotlight character whose mind call succeeded has ALREADY
 * chosen its move; the adjudicator's contract is to have that character act
 * it out and resolve conflicts/consequences - it still owns all deltas.
 * Per the system instruction's DIRECTION PRECEDENCE rule, a decision here
 * OVERRIDES that NPC's Director intent and the generic scheme rules, and
 * the block forbids additional independent scheme-actions for a character
 * listed in it - the decided move IS that character's proactive move.
 * A decision's optional `scheme_adjustment` is LOAD-BEARING (D30): it is the
 * character's own evolving intent, applied code-side as that entity's own
 * `active_scheme` evolution (ai/core/turn.ts::buildMindSchemeDeltas) and
 * deduped against any competing adjudicator 'scheme' delta for the same
 * entity. The adjudicator is therefore told NOT to emit a 'scheme' delta for
 * such an entity - a minded entity's interior plan is owned by its own mind;
 * the adjudicator still owns every OTHER entity's scheme deltas (DYNAMIC
 * SCHEMES) and all action outcomes in the shared world.
 * DELIBERATELY passes only entity_id/chosen_action/method (+ the optional
 * scheme hint): the mind's `private_reasoning` never enters the
 * adjudicator's context (it doesn't need their inner monologue - keeps its
 * context lean, and preserves the seam where a mind can be wrong about
 * itself). Empty/absent decisions produce no block at all; spotlights
 * without a decision fall back to the Director-intents block above, exactly
 * the pre-minds behavior. GM-private data class (D4/D5) with the same
 * carve-out as the intents block: private means the direction system's
 * PROVENANCE, not the acted-out move's public manifestation.
 */
export function buildNpcMindDecisionsBlock(decisions: NpcMindDecision[] | undefined): string {
  if (!decisions || decisions.length === 0) return '';
  return `
SPOTLIGHT NPC DECISIONS (each character's own mind has already chosen its move this turn):
Each entry below is what that character has DECIDED to do this week, in their own head. That spotlight NPC's Phase 1 proactive action MUST be this chosen action, carried out by the stated method - you decide how it plays out, resolve conflicts between characters' decisions, and still own every delta and consequence; do not substitute a different move for them, and do NOT generate additional, independent scheme-advancing actions for a character listed here - the chosen action IS that character's proactive move this turn. Per DIRECTION PRECEDENCE (mind decision > Director intent > generic scheme rules), an entry here governs even where it departs from that NPC's intent or scheme. A character may be wrong about the world or about themselves - let the outcome reflect reality, not their confidence. Where an entry notes "their scheme shifts", that is the character's OWN evolving intent, and its own 'active_scheme' is ALREADY being evolved by that change this turn (a minded entity's interior plan is owned by its mind) - do NOT emit a 'scheme' delta for such an entity; one you emit would be redundant and discarded. Spotlight NPCs with no entry here act on their Director intent above, as before. These decisions are GM-private: never restate them in 'headlines' or any other player-visible text. What is private is the provenance - that a mind chose, its wording. The chosen action, once acted out, is a real event: its public manifestation may and should surface in headlines and NPC reactions as usual.
${decisions.map(d => `- ${d.entity_id} chose to: "${d.chosen_action}" — method: ${d.method}${d.scheme_adjustment ? ` — their scheme shifts: "${d.scheme_adjustment}"` : ''}`).join('\n')}
`;
}

/** The GM-intervention directive block, shared by any prompt that should honor it. */
export function buildGmInterventionBlock(gmInterventionText: string): string {
  return gmInterventionText && gmInterventionText.trim() ? `
GM INTERVENTION:
The following directive MUST be taken into account. This represents an external event or a guiding hand from the Fates.
${gmInterventionText.trim()}
` : '';
}

/** The "STORY EVOLUTION SUGGESTIONS" block, derived from a turn's StoryRelevance result. */
export function buildStoryEvolutionBlock(storyRelevance: StoryRelevance): string {
  const storyEvolutionParts: string[] = [];
  if (storyRelevance.add_entity_suggestion) {
    storyEvolutionParts.push(`Add Entity: ${storyRelevance.add_entity_suggestion.description} Reason: ${storyRelevance.add_entity_suggestion.reason}`);
  }
  if (storyRelevance.remove_entity_suggestion) {
    storyEvolutionParts.push(`Remove Entity: ${storyRelevance.remove_entity_suggestion.entity_id}. Reason: ${storyRelevance.remove_entity_suggestion.reason}`);
  }
  if (storyRelevance.add_location_suggestion) {
    storyEvolutionParts.push(`Add Location: ${storyRelevance.add_location_suggestion.name} (${storyRelevance.add_location_suggestion.description}). Reason: ${storyRelevance.add_location_suggestion.reason}`);
  }
  if (storyRelevance.remove_location_suggestion) {
    storyEvolutionParts.push(`Remove Location: ${storyRelevance.remove_location_suggestion.name}. Reason: ${storyRelevance.remove_location_suggestion.reason}`);
  }
  return storyEvolutionParts.length > 0 ? `
STORY EVOLUTION SUGGESTIONS:
The storyteller suggests the following changes to the world this turn. You MUST strongly consider implementing them.
${storyEvolutionParts.join('\n')}
` : '';
}

/** The meta-narrative theme block, shared by prompts that should honor the campaign's genre/tone. */
export function buildMetaNarrativeBlock(metaNarrative: string): string {
  return metaNarrative ? `
META-NARRATIVE THEME:
The story should adhere to the following theme: "${metaNarrative}"
This should guide the tone, character actions, and outcomes to be consistent with this genre or style.
` : '';
}

/** The high-level "META-NARRATIVE STATE" (SimulationState) block. */
export function buildMetaStateBlock(simulationState: SimulationState): string {
  return `
**META-NARRATIVE STATE:**
This is the undeniable high-level truth of the world right now. All of your decisions MUST be consistent with this state.
${JSON.stringify(simulationState, null, 2)}
`;
}

/**
 * GM-SECRET block: NPCs whose PUBLIC status is 'dead' but who are secretly
 * alive in hiding per the mortality pipeline's "presumed dead" NPC fate
 * outcome (DESIGN_DECISIONS.md D3, see `Entity.secret_truth` in types.ts
 * and ai/core/mortality.ts). Listed for the adjudicator ONLY, so a hidden
 * survivor can be dramatically reintroduced later (a 'status' delta with
 * new_status:'alive') when narratively opportune.
 *
 * CRITICAL: this text - and the underlying `secret_truth` field - must
 * NEVER reach any player-facing prompt. See
 * ai/prompts/narration.ts::sanitizeAdjudicationForNarration, which strips
 * every trace of it before the narration call.
 */
export function buildSecretSurvivorsBlock(allNpcEntities: Entity[]): string {
  const survivors = allNpcEntities.filter(e => e.secret_truth?.actually_alive);
  if (survivors.length === 0) return '';
  return `
GM-SECRET: SECRETLY SURVIVING ENTITIES (never reveal this to the player - for your plotting only):
The world (and the player) believe these entities are dead. They are NOT - they are alive and hiding. You MAY dramatically reintroduce any of them (e.g. as a returning nemesis) when narratively opportune, by emitting a 'status' delta with new_status:'alive' for them. Until you choose to do so, they remain publicly dead and MUST NOT appear, act, or be referenced as alive in any headline, delta reason, or entity action.
${survivors.map(e => `- ${e.name} (${e.entity_id}), hidden since turn ${e.secret_truth!.hidden_since_turn}. Motive: ${e.secret_truth!.motive}`).join('\n')}
`;
}
