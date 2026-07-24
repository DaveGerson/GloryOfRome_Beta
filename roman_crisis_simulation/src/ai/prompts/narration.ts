/**
 * ai/prompts/narration.ts
 *
 * Narration + player monologue + suggested actions - the "flavor" prose
 * calls of the turn pipeline (as opposed to the structured adjudication
 * calls in ai/prompts/adjudication.ts / intelligence.ts).
 */

import { Adjudication, Entity } from '../../types';
import type { NarrationSubmissionProjection } from '../../playerInput/turnSubmission';
import { REDACTED_SCHEME_REASON } from './fragments';

/**
 * Strips GM-only / secret-survival state from an Entity before it's
 * embedded in a player-facing prompt. Currently only `secret_truth`
 * (DESIGN_DECISIONS.md D3) needs stripping - defensive, since the player
 * entity itself should never carry it (only NPCs get the "presumed dead"
 * fate outcome per D3), but this guards against any future mortality
 * outcome touching the player entity directly.
 */
export function sanitizeEntityForNarration(entity: Entity): Omit<Entity, 'secret_truth'> {
  const { secret_truth, ...sanitized } = entity;
  return sanitized;
}

/**
 * CRITICAL LEAK-PREVENTION POINT (DESIGN_DECISIONS.md D3/D4): strips
 * `gm_private` and every `secret_truth` trace from an adjudication before
 * it is embedded in the player-facing narration prompt.
 *
 * `gm_private` now routinely carries mortality validation/roll notes (e.g.
 * "[Mortality] ... roll 14 -> gravely_wounded") that must never reach the
 * player. More subtly, `ai/core/mortality.ts` attaches a `secret_truth`
 * field directly onto a 'status' delta for "presumed dead" NPCs (see
 * types.ts's `EventDelta.secret_truth`) - if that delta were serialized
 * as-is into this prompt's `JSON.stringify(adjudication)`, the "secretly
 * alive" fact would leak straight into the model's context for a
 * player-facing call. Stripping it per-delta here is the actual
 * enforcement point; `getEntityBrief`/`getLightEntityBrief` (fragments.ts)
 * never serialize `secret_truth` either, and a dead-but-secretly-alive NPC
 * always shows `status: 'dead'` there, exactly as the public record says.
 *
 * The same per-delta stripping covers a rumor delta's `is_true`/`origin_id`
 * (DESIGN_DECISIONS.md D11 - the truth-ledger fields, same GM-private
 * handling class as `secret_truth`): the narrator must present a rumor at
 * its stated credibility with no knowledge of whether it is actually a
 * lie, or the disposition could color player-facing prose.
 *
 * A 'scheme' delta's `reason` is the entity's full active_scheme JSON (name,
 * goal, steps) - GM-private under D28 (perception reveals only THAT a design
 * shifted, never its nature). Its reason is REPLACED here with the opaque
 * REDACTED_SCHEME_REASON marker so the narrator learns only that a private
 * design moved and narrates the turn's VISIBLE actions from the other deltas,
 * never the interior plan. Only the string embedded in this player-facing
 * prompt is redacted - the committed delta the engine parses is untouched.
 */
export function sanitizeAdjudicationForNarration(adjudication: Adjudication): Omit<Adjudication, 'gm_private'> {
  const { gm_private, add_entities, deltas, ...rest } = adjudication;
  return {
    ...rest,
    deltas: deltas.map(({ secret_truth, is_true, origin_id, ...delta }) =>
      delta.type === 'scheme' ? { ...delta, reason: REDACTED_SCHEME_REASON } : delta
    ),
    add_entities: add_entities?.map(sanitizeEntityForNarration) as Entity[] | undefined,
  };
}

/**
 * Cap on the narration prompt's voice-cast lines (4C.5): the block is
 * BOUNDED by construction - spotlight cast plus this turn's acting entities
 * only, never the whole roster - and this cap is the code-side guarantee
 * against a runaway entityActions list bloating the prompt.
 */
export const MAX_VOICE_CAST = 8;

/**
 * Picks the entities whose voice/epithet lines the narration prompt may
 * carry (4C.5): spotlight ids FIRST (the Director's importance ranking),
 * then this turn's entityAction actor ids, deduped, resolved against the
 * roster, capped at MAX_VOICE_CAST. Deliberately NOT the whole roster -
 * the voice block is texture for the characters actually on stage this
 * turn. Entities without voice AND epithet still count against nothing:
 * they are dropped before the cap so a largely-legacy roster never crowds
 * out the few entities that do carry flavor. Pure; exported for direct
 * unit testing.
 */
export function selectVoiceCast(spotlightIds: string[], actorIds: string[], entities: Entity[]): Entity[] {
  const byId = new Map(entities.map(e => [e.entity_id, e]));
  const picked: Entity[] = [];
  const seen = new Set<string>();
  for (const id of [...spotlightIds, ...actorIds]) {
    if (picked.length >= MAX_VOICE_CAST) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const entity = byId.get(id);
    if (!entity || (!entity.voice && !entity.epithet)) continue;
    picked.push(entity);
  }
  return picked;
}

/**
 * The narration prompt's CAST VOICES block (4C.5): one line per on-stage
 * character carrying a voice and/or epithet, plus the guidance to let named
 * characters SOUND distinct when quoted. Reads ONLY name/epithet/voice -
 * never secrets, schemes, or any GM-private field - so it is safe for this
 * player-facing prompt by construction. Absent fields emit NOTHING (never
 * the string "undefined"); an all-legacy cast emits no block at all.
 * Exported for direct unit testing.
 */
export function buildVoiceCastBlock(cast: Entity[]): string {
  const lines = cast
    .filter(e => e.voice || e.epithet)
    .map(e => `- ${e.name}${e.epithet ? ` "${e.epithet}"` : ''}${e.voice ? `: ${e.voice}` : ''}`);
  if (lines.length === 0) return '';
  return `
CAST VOICES (speech-style notes for this turn's named characters - flavor only):
When you quote or closely paraphrase a character listed here, let them SOUND like themselves per their voice note - distinct registers, never interchangeable prose. Epithets are public bynames you may use as texture. These notes style HOW people speak; they never add events, facts, or knowledge beyond the Adjudication JSON.
${lines.join('\n')}
`;
}

/**
 * PURPOSE: Narrate the turn's events from the player's vantage point and
 * suggest 3 next actions.
 * MODEL: pro (GEMINI_PRO).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 5.
 * OUTPUT: plain prose (no schema) - parsed by splitting on the
 * "SUGGESTION:" marker back in turn.ts.
 *
 * Split along the system/user boundary: the ROLE and the fixed
 * narration/suggestion task instructions are stable across every turn and
 * now live in `systemInstruction`; the per-turn player profile, action,
 * and adjudication JSON are the dynamic `prompt`. Wording preserved
 * verbatim from the former inline template literal in turn.ts.
 *
 * `adjudication` and `updatedPlayerEntity` are sanitized (see
 * `sanitizeAdjudicationForNarration`/`sanitizeEntityForNarration` above)
 * before being embedded - this is the one call in the pipeline that talks
 * directly to the player, so it must never see `gm_private` or a
 * `secret_truth` trace. `mortalityDirectives` (from
 * `ai/core/mortality.ts::processMortality`'s trace, forwarded by
 * `turn.ts`) are pre-decided narration instructions for any death claims
 * resolved this turn - the model narrates them, it does not re-decide them.
 */
export function buildNarrationPrompt(
  metaNarrative: string,
  updatedPlayerEntity: Entity,
  playerOwned: NarrationSubmissionProjection | string,
  adjudication: Adjudication,
  mortalityDirectives: string[] = [],
  // 4C.5: the bounded on-stage cast whose voice/epithet lines the prompt
  // may carry - callers pass `selectVoiceCast`'s output (spotlight +
  // involved entities only, never the whole roster). Defaults to [] so
  // legacy call sites/tests behave exactly as before the block existed.
  voiceCast: Entity[] = []
): { systemInstruction: string; prompt: string } {
  // String callers are legacy direct prompt tests. The real pipeline passes
  // the typed projection so private-only text can never be mistaken for an
  // observable attempt.
  const playerSubmission: NarrationSubmissionProjection = typeof playerOwned === 'string'
    ? { context: playerOwned, hasObservableAttempt: true }
    : playerOwned;
  const playerTurnInstruction = playerSubmission.hasObservableAttempt
    ? 'Begin with the direct, observable consequences of the player\'s submitted attempt. Private intent remains player-owned goal context only: do not turn it into facts, concealment, NPC knowledge, or an additional action.'
    : 'Begin with a player-view response or reflection on the submitted private intent and question/context. No observable attempt was submitted: do not invent an action or immediate consequence, and do not make the avatar investigate or act.';
  const playerContextLabel = playerSubmission.hasObservableAttempt
    ? "PLAYER'S OBSERVABLE ATTEMPT THIS TURN:"
    : 'PLAYER-OWNED CONTEXT THIS TURN (NO OBSERVABLE ACTION SUBMITTED):';
  const systemInstruction = `
ROLE: Chronicler of the Empire & Intelligence Briefer
META-NARRATIVE: The story's theme is "${metaNarrative}". Your tone and focus should align with this.

Task:
1.  **Narrate the Turn (2-3 paragraphs):** Write a narrative summary for the player. This MUST follow a specific structure:
    a.  **Player Turn Context:** ${playerTurnInstruction}
    b.  **Observed & Reported Events:** Describe other major events from the adjudication (headlines, key NPC actions) BUT strictly from the player's vantage point. Consider their location, allies, and spies.
    c.  **Source Information:** For any information the player didn't witness directly, you MUST state how they learned of it. Be specific and creative. Examples: "A panicked messenger arrives...", "Whispers in the Senate, relayed by your ally Gaius Pontius, suggest...", "A coded message from your spymaster reveals...". This makes information potentially unreliable.
    d.  **Tone:** Maintain a tone of Tacitus meets field report. Focus on concrete outcomes. Do not invent new facts not present in the Adjudication JSON.
    e.  **Moment Line (ROADMAP_PHASE_4.md 4D item 3):** When a named character's scheme visibly culminates or detonates this turn - look at the Adjudication JSON's 'scheme' deltas and headline events for a plan coming to fruition or to ruin - give that character ONE short signature spoken line, quoted in their own voice (per CAST VOICES when present): the line a chronicler would set down. At most one line per character, and only at a true culmination - never for routine scheming - and the line must reveal nothing beyond what the Adjudication JSON already states.

2.  **Suggest Next Actions:** After the narration, on new lines, suggest exactly 3 brief, interesting, actionable next steps for the player, each prefixed with "SUGGESTION:". The suggestions should be tailored to the player's character, goals, and the new situation.

IMPORTANT: If the prompt includes "MORTALITY NARRATION DIRECTIVES", these are non-negotiable staging notes about outcomes that have already been mechanically decided (by a roll you never see). Follow each directive exactly for its named entity - do not contradict it, soften it, or hint at any information it says to withhold.
    `;

  const mortalityBlock =
    mortalityDirectives.length > 0
      ? `
MORTALITY NARRATION DIRECTIVES:
${mortalityDirectives.join('\n')}
`
      : '';

  const prompt = `
PLAYER CHARACTER PROFILE (for context):
${JSON.stringify(sanitizeEntityForNarration(updatedPlayerEntity), null, 2)}

${playerContextLabel}
"${playerSubmission.context}"
${buildVoiceCastBlock(voiceCast)}
ADJUDICATION JSON (all events of the turn):
${JSON.stringify(sanitizeAdjudicationForNarration(adjudication), null, 2)}
${mortalityBlock}`;

  return { systemInstruction, prompt };
}

/**
 * PURPOSE: Generate the player's first-person internal monologue reflecting
 * on recent strategy and this week's events.
 * MODEL: flash (GEMINI_FLASH).
 * CONSUMER: ai/core/turn.ts `runNewTurn`, step 4 (`getPlayerMonologue` in
 * ai/tools/intelligence.ts).
 * OUTPUT: plain prose (no schema).
 */
export function buildPlayerMonologuePrompt(
  player: Entity,
  turnHeadlines: string[],
  recentPlayerIntents: string[]
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
    You are the inner voice of ${player.name}, a ${player.position} in ancient Rome.
    Your personality is defined by: Ambition(${player.personality?.ambition}), Paranoia(${player.personality?.paranoia}), Loyalty(${player.personality?.loyalty}), Cunning(${player.personality?.cunning}), Honor(${player.personality?.honor}).
    Your current state is: "${player.current_state_narrative}"

    Task: Write a brief, first-person internal monologue (2-3 sentences). Do NOT simply state your goals. Instead, reflect on your recent strategy.
    - The recent entries are player-owned context, not necessarily strategic actions. Never reinterpret Private Intent or Question/Context as an avatar action, investigation, or accomplished fact.
    - Consider the risks of your current path. Are you making powerful enemies? Are you over-extending yourself?
    - Contemplate the long-term consequences of your actions. Is your strategy working? Do you need to change course?
    - Your thoughts should be personal and strategic, revealing fears, hopes, or schemes based on the new events and your past choices.
    `;

  const recentActionsString = recentPlayerIntents.length > 0
    ? recentPlayerIntents.map((intent, i) => `${i + 1}. "${intent}"`).join('\n')
    : "No significant actions have been taken yet.";

  const prompt = `
    The following events just occurred this week:
    - ${turnHeadlines.join('\n- ')}

    Here is a summary of your recent player-owned context over the last few weeks:
    ${recentActionsString}
    `;

  return { systemInstruction, prompt };
}
