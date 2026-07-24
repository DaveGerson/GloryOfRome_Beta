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

import { Adjudication, Entity, WorldState, SimulationState, NpcIntent } from '../../types';
import type { ActionResolutionTier } from '../core/resolution';
import { getLightEntityBrief, REDACTED_SCHEME_REASON } from './fragments';

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
 * Per-tier authoring guidance for the investigation report call, keyed by
 * the exact tier strings from ai/core/resolution.ts. Replaces the old prose
 * "40% chance of a negative consequence" line, which was never actually
 * wired to a real roll (ai/tools/intelligence.ts::getInvestigationResult
 * ignored its own `isRisky` param entirely in the real, non-mock path). The
 * tier is now decided by a real hidden `resolveAction` roll BEFORE this
 * prompt is built - the model narrates the pre-decided tier, it does not
 * decide it (mirrors the mortality pipeline's contract, see
 * ai/prompts/README.md). `consequences` MUST/MUST NOT be null per tier is
 * additionally enforced post-hoc in code
 * (ai/tools/intelligence.ts::getInvestigationResult) - this text steers the
 * model, it is not the only guarantee.
 */
const INVESTIGATION_TIER_GUIDANCE: Record<ActionResolutionTier, string> = {
  critical_failure: "The investigation goes badly wrong - the agent is caught red-handed. 'consequences' is MANDATORY: describe a severe, concrete negative outcome (the agent captured/exposed, the target now openly hunting the player, a damaging rumor loosed, etc).",
  failure: "The investigation fails to turn up reliable intelligence and the attempt draws notice. 'consequences' is MANDATORY: describe a real (if less severe) negative outcome - the agent is spotted and now watched, a resource or contact is burned.",
  partial_success: "The investigation succeeds but leaves a trace - the target is left with a faint, unconfirmed whiff of suspicion. 'consequences' MAY describe a mild complication, or be null if you judge the trace goes unnoticed.",
  success: "The investigation goes cleanly - the target notices nothing. 'consequences' MUST be null.",
  critical_success: "The investigation goes exceptionally well - clean, AND the agent turns up one additional bonus detail beyond what was asked for. 'consequences' MUST be null.",
};

/**
 * How firmly the player's OWN agent stands behind what the investigation
 * turned up, keyed off the already-rolled resolution tier. This is the
 * verification-framing half of DESIGN_DECISIONS.md D26: an investigation
 * result is never a system-authoritative "confirmed" - it is the agent's
 * SOURCED confidence, which the player may choose to distrust. A low tier
 * yields intel the agent could barely stand up; a high tier, intel the agent
 * vouches for. Ordered by confidence (a low tier is never framed as more
 * certain than a high one) and carries no number. Exported for lockstep
 * testing against the builder below.
 */
export function agentConfidenceFraming(tier: ActionResolutionTier): string {
  const framing: Record<ActionResolutionTier, string> = {
    critical_failure: 'your agent came away with next to nothing and cannot vouch for a word of it',
    failure: 'your agent is doubtful and could stand up little of what they gleaned',
    partial_success: 'your agent is fairly sure of the gist but will not swear to every particular',
    success: 'your agent is confident in what they gathered',
    critical_success: 'your agent is certain of this, and turned up more than you asked',
  };
  return framing[tier];
}

/**
 * PURPOSE: Generate the results of an investigation into a target's
 * secrets/beliefs/scheme, including a narrative report and possible
 * negative consequences, CONSISTENT with an already-rolled resolution tier.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/tools/intelligence.ts `getInvestigationResult`.
 * OUTPUT: validated against `zInvestigationResult` (ai/core/zodSchemas.ts) /
 * `buildInvestigationResultSchema` (ai/core/schemas.ts).
 */
export function buildInvestigationPrompt(
  target: Entity,
  player: Entity,
  subject: 'secrets' | 'beliefs' | 'scheme',
  tier: ActionResolutionTier
): { systemInstruction: string; prompt: string } {
  // A 'scheme' investigation returns CLUES, never the whole plot (D28): the
  // scheme's nature is earned across several separate investigations, so a
  // single buy must hand back only partial fragments - never a scheme title
  // or its list of steps.
  const reportDataInstruction = subject === 'scheme'
    ? `Generate 1-3 discrete CLUES as an array of short strings - partial, concrete observations your agents turned up that hint at what ${target.name} is quietly working toward. Each clue is a FRAGMENT, not the whole plot: never state a scheme's title and never lay out its steps. Piecing together the full nature of a scheme takes several separate investigations; this is only one of them.`
    : `Based on the target's profile, generate a plausible list of ${subject} as an array of strings. This is the raw data.`;

  const systemInstruction = `You are the head of intelligence for ${player.name}. You completed an investigation into ${target.name} to uncover their **${subject}**.

    **Task:** Generate a JSON object with the results.
    1.  **reportData:** ${reportDataInstruction}
    2.  **report:** Write a brief, narrative report for your master summarizing what you found, consistent with the outcome below. Frame every finding as YOUR AGENT'S OWN read that the master may choose to distrust - ${agentConfidenceFraming(tier)}. Never present a finding as a confirmed, settled fact: it is your agent's sourced judgment, its reliability set by how well they fared, not a certainty the report itself guarantees.
    3.  **consequences:** The investigation's outcome has ALREADY been mechanically decided by a hidden roll (you do not decide it, only write consistent report content) as: ${tier.toUpperCase()}. ${INVESTIGATION_TIER_GUIDANCE[tier]}

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
 * Bounded slice of an NPC's memory lines fed into the Director's prompt:
 * the LAST N entries of the perception-grounded memories stamped by
 * ai/core/engine.ts's applyAdjudication (D10 - each line is something this
 * character actually witnessed or heard from its own vantage). Bounded
 * because Entity.memories holds up to MAX_ENTITY_MEMORIES entries per
 * entity and the Director only needs recent context for its continuity
 * ruling, not the whole remembered past.
 */
export const DIRECTOR_MEMORY_LINES = 5;

/** One-line active-scheme summary for the Director's cast roster. */
function schemeLine(entity: Entity): string {
  return entity.active_scheme
    ? `${entity.active_scheme.name}: ${entity.active_scheme.overall_goal}`
    : 'none';
}

/**
 * The Director's continuity input: the PREVIOUS turn's committed intents
 * (the reducer's `npcIntents` slice, threaded through ai/core/turn.ts),
 * each with its holder's active scheme and a DIRECTOR_MEMORY_LINES-bounded
 * slice of that NPC's own perception-grounded memories - the Director
 * judges 'continue'/'pivot' from what the CHARACTER experienced, not from
 * the global record. Exported for direct prompt-lockstep testing.
 */
export function buildPreviousIntentsBlock(previousIntents: NpcIntent[], npcEntities: Entity[]): string {
  if (previousIntents.length === 0) {
    return `PREVIOUS TURN'S INTENTS: None on record - rule every spotlight intent this turn as 'new'.`;
  }
  const lines = previousIntents.map(prev => {
    const entity = npcEntities.find(e => e.entity_id === prev.entity_id);
    const scheme = entity ? `\n  Active scheme: ${schemeLine(entity)}` : '';
    const memories = entity && entity.memories.length > 0
      ? `\n  Recent memories (their own vantage, oldest first):\n${entity.memories
          .slice(-DIRECTOR_MEMORY_LINES)
          .map(m => `    - T${m.turn}: ${m.event_description}`)
          .join('\n')}`
      : '';
    return `- ${prev.entity_id} was trying to: "${prev.intent}" (continuity last turn: ${prev.continuity})${scheme}${memories}`;
  });
  return `PREVIOUS TURN'S INTENTS (your own prior direction - judge each spotlight's continuity against these, informed by what each character has since witnessed):
${lines.join('\n')}`;
}

/**
 * PURPOSE: The "Director" call - pick 2-4 spotlight NPCs for this turn,
 * emit a persistent one-line INTENT (+ continuity ruling against the
 * previous turn's intents) for each spotlight, and optionally suggest
 * cast/location additions or removals to keep the story fresh. The intents
 * are the durable state of the 4C.3 continuity loop: committed at turn end,
 * fed back in here next turn.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 0 (`getStoryRelevance` in
 * ai/tools/intelligence.ts).
 * OUTPUT: validated against `zStoryRelevance` (ai/core/zodSchemas.ts) /
 * `StoryRelevanceSchema` (ai/core/schemas.ts).
 */
export function buildStoryRelevancePrompt(
  turnNumber: number,
  prevTurnHeadlines: string[],
  worldState: WorldState,
  npcEntities: Entity[],
  previousIntents: NpcIntent[]
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are a master storyteller and game master for a Roman political simulation. You are the Director: you choose where the story's attention goes AND you carry each spotlight character's direction forward from week to week.

    Task: Analyze the situation and determine the narrative focus for the upcoming turn.
    1.  **Spotlight Entities:** Identify 2-4 existing entities who are now critically important. Provide a brief reason for each. Use the exact entity_ids from the CAST list.
    2.  **Persistent Intents:** For EACH spotlight entity, emit exactly one intent entry: ONE LINE stating what this character is trying to accomplish next, plus a 'continuity' ruling against the PREVIOUS TURN'S INTENTS block:
        - 'continue': the character keeps pursuing its previous intent (restate it, refined by what has happened since).
        - 'pivot': the character abandons or redirects its previous intent because events made it obsolete or opened something better.
        - 'new': the character has no previous intent on record.
        Ground each intent in the character's active scheme and its recent memories - what the character itself witnessed or heard, not what you as narrator know. Intents are GM-private direction and never reach the player.
        INTENT KNOWLEDGE BOUND (hard rule): each intent's text is later handed VERBATIM to that character's own simulated mind as the character's own carried thought. Phrase every intent strictly from that character's own knowledge - their scheme, their memories and perceptions as provided below - and NEVER reference another NPC's scheme, secret, or any act this character did not witness or hear of. You see the whole cast; the character does not, and your wording must not smuggle your omniscience into their head.
    3.  **Evolve The World (Optional):** To keep the story fresh, consider if the cast or setting should change.
        - **Add Entity?** Is there a new character archetype missing that would create compelling conflict? (e.g., a populist tribune, a foreign envoy, a ruthless crime boss). If so, suggest adding ONE.
        - **Remove Entity?** Has an existing character become irrelevant or served their purpose? If so, suggest removing ONE to streamline the story.
        - **Add Location?** Would a new location open up strategic or narrative possibilities? (e.g., 'The Temple of Vesta', 'A Hidden Catacomb'). If so, suggest adding ONE.
        - **Remove Location?** Has a location become unimportant? If so, suggest removing ONE.

    Only suggest additions or removals if they would significantly improve the narrative. Otherwise, leave these fields null. Limit suggestions to a maximum of one of each type.

    Return a valid JSON object matching the schema.
    `;

  const castLines = npcEntities
    .filter(e => e.status === 'alive')
    .map(e => `- ${e.entity_id} — ${e.name} (${e.position || e.entity_type}). Active scheme: ${schemeLine(e)}`);

  const prompt = `
    It is currently Turn ${turnNumber}. The political climate is ${worldState.political_climate}.

    Last turn's major events were:
    - ${prevTurnHeadlines.length > 0 ? prevTurnHeadlines.join('\n- ') : "The city was quiet."}

    CAST (use these exact entity_ids for spotlight picks and intents):
    ${castLines.length > 0 ? castLines.join('\n    ') : 'No living NPCs.'}

    ${buildPreviousIntentsBlock(previousIntents, npcEntities)}
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

  // This call's OUTPUT renders in WorldStateTab, so its input is a
  // player-output-bound prompt (D5/D28): a 'scheme' delta's `reason` is the
  // full active_scheme JSON (name/goal/steps), GM-private under D28, and is
  // swapped for the opaque REDACTED_SCHEME_REASON marker here. Every other
  // delta type keeps its prose reason - only the private design is withheld.
  const prompt = `
**Previous State:**
${JSON.stringify(oldState, null, 2)}

**Events of This Week (Adjudication):**
- Headlines: ${adjudication.headlines.join('. ')}
- Key Deltas: ${adjudication.deltas.slice(0, 5).map(d => `${d.type} on ${d.key} because ${d.type === 'scheme' ? REDACTED_SCHEME_REASON : d.reason}`).join('; ')}
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
  entities: Entity[],
  hasObservableAttempt = true
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
    ${hasObservableAttempt
      ? ''
      : '- No observable player attempt was submitted this turn. Do not infer relationship changes from an invented player action; use only factual adjudicated events.'}

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

    RUMOR DELTAS: if any delta is a 'rumor' (e.g. the pair agree to seed a story after the meeting), it MUST also carry two GM-private bookkeeping fields:
    - 'is_true' (boolean, ALWAYS set): whether the claim is ACTUALLY TRUE in the simulation's reality, ruled STRICTLY by world-truth - never omit it, and there is no "unknown". Authorship never changes the ruling: a fabricated lie is false because its claim is false; a deliberately spread truth is still true.
    - 'origin_id' (string): the entity_id of whichever participant starts or spreads the rumor.
    Both fields are GM-private ledger data: neither may surface in the delta's 'reason' text, the 'dialogueSnippet', or anything else that could reach the player.
    Every 'rumor' delta MUST also carry one NON-private categorization field:
    - 'topic' (string, ALWAYS set): a short lowercase hyphenated slug naming WHAT about the subject the rumor concerns (e.g. 'health', 'tribute', 'succession-plot', 'legion-loyalty'). Two rumors about DIFFERENT matters of the same subject MUST get DIFFERENT topics so they stay distinct; a follow-up about the SAME matter reuses the SAME topic. Unlike is_true/origin_id this is a neutral label, not truth - it may reach the player and must never hint at whether the claim is true or planted.
    - 'stance' ('corroborates' | 'contradicts'): set ONLY when this rumor is a counterplay follow-up that reuses an existing rumor's 'key' AND 'topic' - 'corroborates' if it backs the running claim, 'contradicts' if it refutes it. Omit on a first emission or an ordinary restatement.

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
