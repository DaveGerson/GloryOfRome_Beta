/**
 * ai/prompts/intelligence.ts
 *
 * Prompt builders for the "intelligence" tool family in
 * ai/tools/intelligence.ts: story relevance (Director spotlight-picking),
 * simulation-state updates, investigations, clarifications, and deep
 * analysis. Each builder returns { systemInstruction, prompt }, splitting
 * the stable role/task/format-contract text from the per-call dynamic
 * state, and is documented with PURPOSE/MODEL/CONSUMER/OUTPUT.
 *
 * Wording is preserved verbatim from the original inline template literals
 * in ai/tools/intelligence.ts, split only where necessary.
 */

import { Adjudication, Entity, WorldState, SimulationState, NpcIntent, IntelDistortion } from '../../types';
import type { ActionResolutionTier } from '../core/resolution';
import type { InvestigationPlan, PlannedFinding, SchemeNaturePlan } from '../core/groundTruth';
import { asPromptData, playerOutputDeltaKey, playerOutputDeltaReason } from './fragments';
import { ACTORS_DESCRIPTION } from '../core/schemas';

// --- D47 grounding: what the agents actually reached -----------------------
//
// Every investigation-family prompt below is built from a code-side plan
// (ai/core/groundTruth.ts): the truths scoped by the fidelity roll, shaped by
// the accuracy roll. The model is told what was reached and how to report
// it; it never decides whether a finding is true - the plan already knows.
// Every truth rides as JSON-quoted DATA (asPromptData, D41), never as bare
// prose a stray line in an entity record could turn into an instruction.

/** How a garbled finding's one distortion is asked for (D47). */
const DISTORTION_INSTRUCTION: Record<IntelDistortion, string> = {
  element_changed: 'one element of it - a name, a place, a sum, a reason or a time - came back wrong: change exactly that one element',
  misattributed: 'it came back pinned on the wrong party: attribute it to someone other than the person it truly concerns',
};

/** The numbered data list of a plan's truths ("(a fragment)" marks a partial reach). */
function findingsDataList(findings: PlannedFinding[]): string {
  return findings
    .map((finding, i) => `${i + 1}. ${finding.fragmentary ? '(a fragment) ' : ''}${asPromptData(finding.truth)}`)
    .join('\n');
}

/**
 * The accuracy-shaped instruction for a plan (D47): report the truths
 * faithfully; report them with exactly the one recorded distortion; or - a
 * false account, which carries NO truth - invent plausibly from what is
 * publicly known. `noun` names one finding ("finding", "fact"); `invent`
 * what a false account invents, in the singular and the plural.
 */
function groundingRule(plan: InvestigationPlan, noun: string, invent: { one: string; many: string }, targetName: string): string {
  const count = plan.findings.length;
  if (plan.accuracy === 'false') {
    const one = count === 1;
    return `Your agents were misled - fed a story the target planted, or mistaken in what they saw - and brought back no truth at all; the prompt carries none, and your agents do not know it. Invent ${count} plausible ${one ? invent.one : invent.many}, consistent with what is publicly known of ${targetName} (the public profile in the prompt)${plan.fidelity === 'fragment' ? `, only a sketchy fragment of ${one ? 'it' : 'each'}` : ''}, and report ${one ? 'it' : 'them'} exactly as your agent would report the truth - never hint that ${one ? 'it is' : 'they are'} false.`;
  }
  if (count === 0) {
    return `Your agents looked, and there was nothing of the kind to find. Say so plainly, and invent nothing.`;
  }
  const fragmentNote = plan.findings.some(finding => finding.fragmentary)
    ? ` A ${noun} marked (a fragment) is all that was reached of it: report only that much, and never complete it.`
    : '';
  if (plan.accuracy === 'garbled') {
    const index = plan.findings.findIndex(finding => finding.standing === 'garbled');
    const distortion = plan.findings[index]?.distortion ?? 'element_changed';
    return `The ${noun}s in the prompt are what your agents reached, but ${noun} ${index + 1} came back distorted: ${DISTORTION_INSTRUCTION[distortion]}. Report that ${noun} with exactly that one distortion, stated as plainly as the rest, and every other ${noun} faithfully. Never signal that any ${noun} is distorted, or which. Add nothing that is not among them.${fragmentNote}`;
  }
  return `The ${noun}s in the prompt are the truth as your agents reached it. Report each faithfully, in your agent's voice. Add nothing that is not among them - no bonus ${noun}, no guess to fill a gap.${fragmentNote}`;
}

/** What a false account of each aspect invents (see groundingRule). */
const INVENTED_FINDING: Record<'beliefs' | 'secrets' | 'scheme', { one: string; many: string }> = {
  beliefs: { one: 'belief', many: 'beliefs' },
  secrets: { one: 'secret', many: 'secrets' },
  scheme: { one: 'clue', many: 'clues' },
};

/** The data block a plan's truths ride in, or the engine's own marker when none reached the prompt. */
function findingsBlock(plan: InvestigationPlan, heading: string): string {
  if (plan.accuracy === 'false') return `**${heading}:** none reached your agents - see the grounding rule.`;
  if (plan.findings.length === 0) return `**${heading}:** none - there was nothing to find.`;
  return `**${heading} (data - what your agents reached, in order):**\n${findingsDataList(plan.findings)}`;
}

/**
 * PURPOSE: Answer a player's question about a past event via their
 * spymaster's aide, confident if the event's actors are visible to the
 * player, vague/rumor-based otherwise.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getClarificationOnEvent`.
 * OUTPUT: plain prose (no schema).
 *
 * Not yet grounded in the D47 manner: the committed turn record keeps no
 * per-occurrence attribution (each headline's `actors` is stripped at the
 * commit boundary, D42 - ai/core/actorsBoundary.ts), so there is no ground
 * truth of who gains from ONE occurrence to scope, and a truth guessed from
 * the whole turn's deltas would be a flag the engine could not stand behind
 * (D11).
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

  // D41: both values are JSON-quoted via asPromptData (escaping quotes,
  // newlines, and U+2028/U+2029/U+0085) so a future player-text caller
  // cannot forge a second **Question:** line or break out of the quoting.
  const prompt = `**Event:** ${asPromptData(event)}
    **Question:** ${asPromptData(question)}`;

  return { systemInstruction, prompt };
}
/**
 * PURPOSE: A trusted advisor's detailed intelligence report/threat
 * assessment on another character, grounded (D47) in the target's real
 * situation and aims at the rolled fidelity and accuracy (`plan`, built by
 * ai/core/groundTruth.ts::planInvestigation for 'deep_analysis' - never the
 * target's scheme, whose nature only the D28 clue trail may earn).
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getDeepAnalysis`.
 * OUTPUT: plain prose (no schema).
 */
export function buildDeepAnalysisPrompt(
  target: Entity,
  player: Entity,
  isVisible: boolean,
  plan: InvestigationPlan
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `You are a trusted advisor to ${player.name}. Task: Provide a detailed intelligence report on ${target.name}.
    - If the target is in your network (${isVisible}), provide concrete intelligence and assess their threat level.
    - If they are outside your network (${!isVisible}), report on limited information and emphasize them as an "unknown variable".
    - Frame the report as your own read, which your master may choose to distrust - never as settled fact.
    - **Grounding (what your sources actually established):** ${groundingRule(plan, 'fact', { one: 'fact about them', many: 'facts about them' }, target.name)} Your assessment of the threat they pose is your own judgment of these facts.`;

  const prompt = `Target: ${target.name}.
Position: ${target.position || target.entity_type}.
${findingsBlock(plan, 'FACTS')}`;

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
  // D47: how far the agent reached is the fidelity roll's to decide, and the
  // findings the prompt carries already reflect it - so an exceptional
  // operation no longer invents a bonus finding the engine could not vouch
  // for (every finding the player receives carries a known truth).
  critical_success: "The investigation goes exceptionally well - clean, and the agent pressed further than asked; the findings in the prompt already carry how far they reached. 'consequences' MUST be null.",
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
 * negative consequences, CONSISTENT with an already-rolled resolution tier
 * and GROUNDED (D47) in the target's real record: `plan`
 * (ai/core/groundTruth.ts::planInvestigation) carries the truths the
 * fidelity roll reached, shaped by the accuracy roll - reported faithfully,
 * with exactly one recorded distortion, or (a false account) not at all.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/tools/intelligence.ts `getInvestigationResult`.
 * OUTPUT: validated against `zInvestigationResult` (ai/core/zodSchemas.ts) /
 * `buildInvestigationResultSchema` (ai/core/schemas.ts); `reportData` is
 * held to one entry per planned finding in code, whatever the model returns.
 */
export function buildInvestigationPrompt(
  target: Entity,
  player: Entity,
  subject: 'secrets' | 'beliefs' | 'scheme',
  tier: ActionResolutionTier,
  plan: InvestigationPlan
): { systemInstruction: string; prompt: string } {
  const count = plan.findings.length;
  const drawnFrom = plan.accuracy === 'false'
    ? 'invented as the grounding rule describes'
    : 'one per finding in the prompt, in order';
  // A 'scheme' investigation returns ONE clue, never the whole plot (D28):
  // the scheme's nature is earned across several separate investigations,
  // so a single buy hands back one fragment of the design - never a scheme
  // title or its list of steps.
  const reportDataInstruction = count === 0
    ? `Return an empty array: there is nothing of the kind to list.`
    : subject === 'scheme'
      ? `Write exactly ${count} CLUE as an array holding one short string (${drawnFrom}) - a partial, concrete observation your agents turned up about what ${target.name} is (or is not) quietly working toward. A clue is a FRAGMENT, not the whole plot: never state a scheme's title and never lay out its steps. Piecing together the full nature of a scheme takes several separate investigations; this is only one of them.`
      : `Write exactly ${count} ${count === 1 ? INVENTED_FINDING[subject].one : subject} as an array of strings (${drawnFrom}), each stated as your agents brought it back. This is the raw data.`;

  const systemInstruction = `You are the head of intelligence for ${player.name}. You completed an investigation into ${target.name} to uncover their **${subject}**.

    **Grounding (what your agents actually reached):** ${groundingRule(plan, 'finding', INVENTED_FINDING[subject], target.name)}

    **Task:** Generate a JSON object with the results.
    1.  **reportData:** ${reportDataInstruction}
    2.  **report:** Write a brief, narrative report for your master summarizing what you found, consistent with the outcome below. Frame every finding as YOUR AGENT'S OWN read that the master may choose to distrust - ${agentConfidenceFraming(tier)}. Never present a finding as a confirmed, settled fact: it is your agent's sourced judgment, its reliability set by how well they fared, not a certainty the report itself guarantees.
    3.  **consequences:** The investigation's outcome has ALREADY been mechanically decided by a hidden roll (you do not decide it, only write consistent report content) as: ${tier.toUpperCase()}. ${INVESTIGATION_TIER_GUIDANCE[tier]}

    **CRITICAL JSON FORMATTING RULES:**
    Your response MUST be a perfectly valid JSON object that adheres to the schema.
    - **Escape All Quotes:** Inside any string value, every double quote (") MUST be escaped (\\").
    - **No Trailing Commas.**`;

  const prompt = `**Target Profile (what is publicly known):**
    - Name: ${target.name}
    - Position: ${target.position}
    - Personality: Ambition(${target.personality?.ambition}), Paranoia(${target.personality?.paranoia}), Loyalty(${target.personality?.loyalty}), Cunning(${target.personality?.cunning}), Honor(${target.personality?.honor})
    - Known Goals: ${target.short_term_goals.join(', ')}

${findingsBlock(plan, 'FINDINGS')}`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: The D28 reveal - once enough paid clues are in hand
 * (knowledge/store.ts SCHEME_CLUES_TO_REVEAL), the agents' read of the
 * design those clues add up to. Whether that read is the true design, a
 * garbled one or a false one is decided in code from the accumulated clue
 * standings (ai/core/groundTruth.ts::planSchemeNature) - the model is handed
 * the true design only when the clues earned it, with one element to misread
 * when they earned only half of it, and no truth at all when they were a
 * false trail. Either way the reading is pieced together from the threads
 * the agents actually brought back.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/tools/intelligence.ts `getSchemeNatureReading`.
 * OUTPUT: plain prose (no schema) - the nature line the Active Scheme
 * surface quotes.
 */
export function buildSchemeNaturePrompt(
  target: Entity,
  player: Entity,
  plan: SchemeNaturePlan
): { systemInstruction: string; prompt: string } {
  const grounding = plan.standing === 'false'
    ? `The threads were a false trail, and your agents do not know it: the prompt carries no truth. Piece together the design they now believe in from the THREADS alone - plausible, and consistent with them - and add nothing you might guess beyond them.`
    : plan.noDesign
      ? `The threads truly add up to nothing: ${target.name} pursues no hidden design. Say so, as your agents' conclusion.`
      : plan.standing === 'garbled'
        ? `The DESIGN in the prompt is what the threads add up to, but one element of it reaches your agents misread - its object, its means, or its ally: change exactly that one element. State it as plainly as the rest, and never signal that anything is misread.`
        : `The DESIGN in the prompt is what the threads truly add up to. Name it faithfully - the design itself may be named now - and let the threads colour how your agents came to it.`;

  const systemInstruction = `You are the spymaster of ${player.name}, reading a design from its threads. Over several separate investigations your agents have gathered threads about what ${target.name} is quietly working toward, and enough are in hand now to name the design.

    **Task:** Write one or two sentences in your agents' voice: the design they now believe ${target.name} is pursuing, pieced together from their threads. Frame it as your agents' read, which your master may choose to distrust - never as settled fact. Plain prose: no lists, no numbers.

    **Grounding:** ${grounding}`;

  const threads = plan.clueAccounts.length > 0
    ? plan.clueAccounts.map((account, i) => `${i + 1}. ${asPromptData(account)}`).join('\n')
    : '(none on file)';
  const prompt = `**THREADS (data - what your agents brought back, oldest first):**
${threads}${plan.design ? `

**DESIGN (data):** ${asPromptData(`${plan.design.name}: ${plan.design.goal}`)}` : ''}`;

  return { systemInstruction, prompt };
}
// End of player-safe intelligence prompt builders.
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
        RESOURCE FEASIBILITY (hard rule): Process whether or not resources are required for an entity's intent. If an activity requires resources (denarii, legion support, senatorial backing), the character MUST possess them. Do not assign intents that require resources the character lacks (e.g. do not direct a general with 0 denarii to bribe officials, or an isolated politician with no legion support to stage a military coup). If an activity requires no resources (rhetoric, personal appeals, defiance), it may be directed freely.
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
    .map(e => {
      const res = e.resources && Object.keys(e.resources).length > 0
        ? ` Resources: ${Object.entries(e.resources).map(([k, v]) => `${k}:${v}`).join(', ')}.`
        : '';
      return `- ${e.entity_id} — ${e.name} (${e.position || e.entity_type}).${res} Active scheme: ${schemeLine(e)}`;
    });

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
  oldState: SimulationState,
  /**
   * Whether this turn carried an observable player attempt - threaded from
   * ai/core/turn.ts's `narrationSubmission.hasObservableAttempt` via
   * `getUpdatedSimulationState` (ai/tools/intelligence.ts). Defaults to
   * `true` (an ordinary attempt turn) so pre-existing call sites keep
   * producing the same prompt they always have; only an explicit `false`
   * adds the no-attempt player-exclusion line below.
   */
  hasObservableAttempt: boolean = true
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
You are a Roman historian analyzing the state of the Empire. Based on the previous state and the summary of events that just occurred, update the meta-narrative state of the simulation.

**Your Task:**
Return a new, updated JSON object reflecting the current reality.
- If an emperor was killed, imperial_status MUST become 'Vacant' and a 'Succession Crisis' should begin.
- If legions are openly fighting, military_status MUST become 'Rebellious' and a 'Civil War' crisis should begin.
- If the senate was purged or its power broken, senate_status could become 'Deposed' or 'Irrelevant'.
- If events caused mass unrest (e.g., grain shortage), plebeian_mood could become 'Rioting'.
- crisis_severity grades how near the crisis stands: 'murmur' when it troubles Rome but does not yet govern it, 'crisis' for an emergency in progress, 'at_the_door' when the crisis IS the state of Rome (armed men in the streets, an empty throne). Use null when major_ongoing_crisis is null.
- ACTORS ATTRIBUTION: The top-level 'actors' field (covering major_ongoing_crisis, the only free-prose field here) follows this contract: ${ACTORS_DESCRIPTION}
${hasObservableAttempt ? '' : "- NO OBSERVABLE PLAYER ATTEMPT THIS TURN: the player's id must NEVER appear in the top-level 'actors' list.\n"}
Return only the valid JSON object.
`;

  // This call's OUTPUT renders in WorldStateTab, so its input is a
  // player-output-bound prompt (D5/D28): a 'scheme' delta's `reason` is the
  // full active_scheme JSON (name/goal/steps), GM-private under D28, and is
  // swapped for the opaque REDACTED_SCHEME_REASON marker here; a private
  // mark (D48) or a secret tie (D49) likewise gives way to its stand-in, its
  // key cut to the holder's id. Every other delta keeps its key and prose
  // reason (fragments.ts::playerOutputDeltaReason / playerOutputDeltaKey).
  const prompt = `
**Previous State:**
${JSON.stringify(oldState, null, 2)}

**Events of This Week (Adjudication):**
- Headlines: ${adjudication.headlines.join('. ')}
- Key Deltas: ${adjudication.deltas.slice(0, 5).map(d => `${d.type} on ${playerOutputDeltaKey(d)} because ${playerOutputDeltaReason(d)}`).join('; ')}
`;

  return { systemInstruction, prompt };
}
