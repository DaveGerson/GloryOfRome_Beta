/**
 * ai/prompts/narration.ts
 *
 * Narration + player monologue + suggested actions - the "flavor" prose
 * calls of the turn pipeline (as opposed to the structured adjudication
 * calls in ai/prompts/adjudication.ts / intelligence.ts).
 */

import { Adjudication, Entity } from '../../types';

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
 */
export function sanitizeAdjudicationForNarration(adjudication: Adjudication): Omit<Adjudication, 'gm_private'> {
  const { gm_private, add_entities, deltas, ...rest } = adjudication;
  return {
    ...rest,
    deltas: deltas.map(({ secret_truth, ...delta }) => delta),
    add_entities: add_entities?.map(sanitizeEntityForNarration) as Entity[] | undefined,
  };
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
  playerIntent: string,
  adjudication: Adjudication,
  mortalityDirectives: string[] = []
): { systemInstruction: string; prompt: string } {
  const systemInstruction = `
ROLE: Chronicler of the Empire & Intelligence Briefer
META-NARRATIVE: The story's theme is "${metaNarrative}". Your tone and focus should align with this.

Task:
1.  **Narrate the Turn (2-3 paragraphs):** Write a narrative summary for the player. This MUST follow a specific structure:
    a.  **Direct Consequences:** Begin by describing the immediate, observable results of the player's action ("${playerIntent}"). What happened right after they did it?
    b.  **Observed & Reported Events:** Describe other major events from the adjudication (headlines, key NPC actions) BUT strictly from the player's vantage point. Consider their location, allies, and spies.
    c.  **Source Information:** For any information the player didn't witness directly, you MUST state how they learned of it. Be specific and creative. Examples: "A panicked messenger arrives...", "Whispers in the Senate, relayed by your ally Gaius Pontius, suggest...", "A coded message from your spymaster reveals...". This makes information potentially unreliable.
    d.  **Tone:** Maintain a tone of Tacitus meets field report. Focus on concrete outcomes. Do not invent new facts not present in the Adjudication JSON.

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

PLAYER'S ACTION THIS TURN:
"${playerIntent}"

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

    Here is a summary of your strategic actions over the last few weeks:
    ${recentActionsString}
    `;

  return { systemInstruction, prompt };
}
