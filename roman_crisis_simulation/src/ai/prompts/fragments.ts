/**
 * ai/prompts/fragments.ts
 *
 * Shared, reusable prompt-text builders extracted from `ai/core/engine.ts`'s
 * former `compileContext`/`getEntityBrief`. This is the one source of truth for each
 * fragment - every prompt builder in ai/prompts/*.ts that needs an entity
 * brief, a world-state summary, the GM-intervention block, or a
 * relationship listing pulls it from here instead of re-serializing state
 * inline.
 *
 * Text is moved verbatim from its original call site; only the glue
 * (function signatures, JSDoc) is new.
 */

import { Entity, WorldState, SimulationState, StoryRelevance, NpcIntent, NpcMindDecision, LedgerLine } from '../../types';
import {
  BLACKMAIL_PREFIX,
  HOLDING_PREFIX,
  classifyResourceKey,
  formatArabic,
  formatResourcesCompact,
  numericResource,
  RESOURCE_CATEGORIES,
  ResourceCategory,
} from '../core/resourceRegistry';
import { creditorsPress, investigationCap, projectWeeklyCoinFlow, runwayWeeks, CREDITORS_PRESS_THRESHOLD, DESERTION_ARREARS_WEEKS } from '../core/ledger';

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

// U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR, and U+0085 NEXT LINE
// (NEL), built from their code points so the invisible characters never sit
// raw in this source.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const NEXT_LINE = String.fromCharCode(0x0085);

/**
 * Delimits a player-authored value as JSON DATA for interpolation into a
 * provider prompt (D41). JSON.stringify escapes newlines, quotes, and
 * backslashes but leaves the JS line separators U+2028/U+2029 raw; both
 * providers and JS ^-anchored multiline regexes treat those as line breaks,
 * so a raw one lets player text occupy line-start position and forge an
 * engine steering block (e.g. "PLAYER ACTION OUTCOME"). U+0085 NEL is
 * escaped alongside them defensively: JS's own /^.../m does NOT treat it as
 * a line terminator (so it cannot forge a match in this codebase's own
 * regex checks), but Unicode assigns NEL line-break class BK, so a
 * provider's own tokenizer/renderer may still treat it as one. All three are
 * escaped to their JSON-legal \uXXXX forms here, so the quoted value can
 * never span or start a prompt line and still parses back byte-identical.
 * Every prompt interpolation of player-authored text MUST route through
 * this helper, not bare JSON.stringify. `space` mirrors JSON.stringify's
 * indent parameter for pretty-printed object blocks.
 */
export function asPromptData(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space)
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029')
    .split(NEXT_LINE).join('\\u0085');
}

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
 *
 * `Holdings` (D46): the entity's resource bag as stored, compact - the
 * omniscient adjudicator prices an NPC's bribe or donative against what that
 * NPC actually holds, and echoes the stored keys on its deltas. Before D46
 * no prompt ever showed the adjudicator a single holding, so nothing could
 * cost anything. The player's own holdings get the fuller ledger block
 * (`buildPlayerLedgerBlock`), not this line.
 */
export function getEntityBrief(entity: Entity): string {
  const relationships = Object.values(entity.relationships)
    .filter(r => r) // Filter out null or undefined relationships
    .map(r => `${r.entity_id}(T:${r.trust_level}, R:${r.respect_level ?? 0}, Th:${r.perceived_threat ?? 0}, A:${r.ideological_alignment ?? 0}, D:${r.dependency_level ?? 0})`).join(', ');
  const personality = entity.personality ? `Personality(A:${entity.personality.ambition}, P:${entity.personality.paranoia}, L:${entity.personality.loyalty}, C:${entity.personality.cunning}, H:${entity.personality.honor})` : '';
  const skills = entity.skills ? `Skills: ${Object.entries(entity.skills).map(([name, value]) => `${name}:${value}`).join(', ')}` : '';
  const beliefs = entity.beliefs ? `Beliefs: ${entity.beliefs.join('; ')}` : '';
  const scheme = entity.active_scheme ? `Active Scheme: ${JSON.stringify(entity.active_scheme)}` : '';
  const holdings = Object.keys(entity.resources ?? {}).length > 0 ? `Holdings: ${formatResourcesCompact(entity.resources)}` : 'Holdings: none recorded';
  return `${entity.name}${entity.epithet ? ` "${entity.epithet}"` : ''} (${entity.position || entity.entity_type}) [Status: ${entity.status}, Location: ${entity.location}] Goals: ${entity.short_term_goals.join(', ')}. ${scheme}. ${personality}. ${skills}. ${beliefs}. ${holdings}. Relationships: ${relationships}`;
}

/** The registers the ledger block lists the player's bag under, in reading order. */
const LEDGER_BLOCK_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  coin: 'Coin',
  debt: 'Owed',
  intel: 'Intel',
  forces: 'Forces',
  holdings: 'Holdings',
  standing: 'Standing',
  leverage: 'Leverage',
};

/**
 * The adjudicator's window onto the player's own economy (D46) - the
 * ENGINE's figures, authoritative, rendered every turn so that "every act
 * has a price" (ai/prompts/adjudication.ts's RESOURCE ECONOMY principle)
 * is priced against real holdings rather than guessed at. Carries the
 * treasury, debt and back pay; the week's projected income/upkeep/interest
 * and the runway they imply (ai/core/ledger.ts::projectWeeklyCoinFlow, the
 * same arithmetic the Assets tab shows the player); the bag by register;
 * the intel ceiling; the creditor-pressure and arrears flags DEBT HAS TEETH
 * bites with; and last week's ledger lines, so the adjudicator narrates
 * the wages that came due rather than contradicting them.
 *
 * Every string here is engine- or model-authored (keys, numbers, catalogue
 * labels); the one exception - a string-valued or list-valued resource the
 * model once wrote - is JSON-quoted through `asPromptData` (D41) so it can
 * never occupy line-start position. GM-side prompt only: this block never
 * reaches a player-bound call (the narration prompt carries the player
 * entity's own resources map, which is the player's to see).
 */
export function buildPlayerLedgerBlock(player: Entity, lastLedger: LedgerLine[] | undefined): string {
  const bag = player.resources ?? {};
  const treasury = numericResource(bag, 'denarii');
  const debt = numericResource(bag, 'debt_denarii');
  const arrears = numericResource(bag, 'pay_arrears');
  const flow = projectWeeklyCoinFlow(bag);
  const runway = runwayWeeks(treasury, flow.net);

  const byCategory = new Map<ResourceCategory, string[]>();
  for (const [key, value] of Object.entries(bag)) {
    if (key === 'denarii' || key === 'debt_denarii' || key === 'pay_arrears') continue;
    const kind = classifyResourceKey(key);
    const rendered = Array.isArray(value)
      ? `${key} (${value.length} item${value.length === 1 ? '' : 's'})`
      : typeof value === 'number'
        ? key === 'investigations'
          ? `${key} ${value} of ${investigationCap(bag)}`
          : `${key} ${value}`
        : `${key} ${asPromptData(value)}`;
    const list = byCategory.get(kind.category) ?? [];
    list.push(rendered);
    byCategory.set(kind.category, list);
  }
  const registers = RESOURCE_CATEGORIES
    .filter(category => (byCategory.get(category) ?? []).length > 0)
    .map(category => `${LEDGER_BLOCK_CATEGORY_LABELS[category]}: ${(byCategory.get(category) ?? []).join(', ')}.`)
    .join(' ');

  const incomeLine = flow.income.length > 0
    ? `income +${formatArabic(flow.incomeTotal)} (${flow.income.map(i => `${i.key} ${i.count} x ${i.perUnit}`).join(', ')})`
    : 'income none';
  const upkeepLine = flow.upkeep.length > 0
    ? `wages -${formatArabic(flow.upkeepTotal)} (${flow.upkeep.map(i => `${i.key} ${i.count} x ${i.perUnit}`).join(', ')})`
    : 'wages none';
  const interestLine = flow.interest > 0 ? `; interest -${formatArabic(flow.interest)}` : '';
  const runwayLine = flow.net >= 0
    ? 'the treasury holds level or grows'
    : runway === 0
      ? 'the treasury is already empty against this drain - next week overdraws into debt'
      : `at this rate the treasury lasts about ${runway} week${runway === 1 ? '' : 's'}`;

  const pressures: string[] = [];
  if (creditorsPress(bag)) {
    pressures.push(`CREDITORS PRESS: the debt of ${formatArabic(debt)} denarii is at or past ${formatArabic(CREDITORS_PRESS_THRESHOLD)} - a creditor must be FELT this week (DEBT HAS TEETH): named, calling, raising 'dependency_level', or turning hostile.`);
  } else if (debt > 0) {
    pressures.push(`Debt stands at ${formatArabic(debt)} denarii; interest is taken from the treasury each week or added to the debt when the treasury cannot pay.`);
  }
  if (arrears > 0) {
    const weeksOwed = flow.upkeepTotal > 0 ? arrears / flow.upkeepTotal : 0;
    pressures.push(`BACK PAY OWED: the player's own men are owed ${formatArabic(arrears)} denarii${flow.upkeepTotal > 0 ? ` (${weeksOwed.toFixed(1)} weeks' wages)` : ''}; their loyalty erodes weekly and desertions begin at ${DESERTION_ARREARS_WEEKS} weeks' pay - let the grumbling be heard.`);
  }
  const heldItems = Object.keys(bag).filter(key => key.startsWith(HOLDING_PREFIX) || key.startsWith(BLACKMAIL_PREFIX));
  if (heldItems.length > 0) {
    pressures.push(`Discrete holdings and leverage the player may draw on: ${heldItems.join(', ')}.`);
  }

  const lastWeek = lastLedger && lastLedger.length > 0
    ? `Last week's ledger: ${lastLedger.map(line => line.text).join(' ')}`
    : "Last week's ledger: nothing was booked.";

  return `
PLAYER HOLDINGS & LEDGER (engine-kept and authoritative - price every act against this, echo these keys on deltas):
Treasury: ${formatArabic(treasury)} denarii. Debt: ${debt > 0 ? formatArabic(debt) : 'none'}. Back pay owed: ${arrears > 0 ? formatArabic(arrears) : 'none'}.
Weekly flow: ${incomeLine}; ${upkeepLine}${interestLine}; net ${flow.net >= 0 ? '+' : ''}${formatArabic(flow.net)} - ${runwayLine}.
${registers || 'No other holdings recorded.'}
${pressures.length > 0 ? `${pressures.join('\n')}\n` : ''}${lastWeek}
`;
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

/**
 * The GM-intervention directive block, shared by any prompt that should
 * honor it. `gmInterventionText` is user-settable through the GM directive
 * UI (App.tsx) - delimited via `asPromptData` (D41) so it can never forge a
 * neighboring engine block (e.g. "STORY EVOLUTION SUGGESTIONS").
 */
export function buildGmInterventionBlock(gmInterventionText: string): string {
  return gmInterventionText && gmInterventionText.trim() ? `
GM INTERVENTION:
The following directive MUST be taken into account. This represents an external event or a guiding hand from the Fates.
${asPromptData(gmInterventionText.trim())}
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

/**
 * The meta-narrative theme block, shared by prompts that should honor the
 * campaign's genre/tone. Delimited via `asPromptData` (D41) - its own quotes
 * replace the previous literal quoting, so an embedded quote or line
 * separator can never forge a neighboring engine block (e.g.
 * "GM INTERVENTION").
 */
export function buildMetaNarrativeBlock(metaNarrative: string): string {
  return metaNarrative ? `
META-NARRATIVE THEME:
The story should adhere to the following theme: ${asPromptData(metaNarrative)}
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
