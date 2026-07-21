/**
 * ai/prompts/mortality.ts
 *
 * The mortality pipeline's two model calls (DESIGN_DECISIONS.md D2/D3/D4):
 * validating a declared death, then generating the concrete content for a
 * fate the hidden code-side roll has ALREADY decided
 * (ai/core/resolution.ts). Neither call ever decides whether or how
 * someone dies - the validation call only sanity-checks the claim against
 * the world, and the outcome call only dresses a pre-decided band in
 * prose-ready deltas and a narration directive.
 * MODEL: pro (GEMINI_PRO) for both - death dispositioning is high-stakes,
 * same tier as the main adjudication.
 * CONSUMER: ai/core/mortality.ts `processMortality`.
 * OUTPUT: (a) validated against `zMortalityValidation` /
 * `MortalityValidationSchema`; (b) against `zMortalityOutcome` /
 * `MortalityOutcomeSchema` (both in ai/core/zodSchemas.ts / schemas.ts).
 */

import { EventDeltaTypeEnum } from '../../types';

// --- Validation prompt ---------------------------------------------------

export interface MortalityValidationCandidate {
  entity_id: string;
  name: string;
  isPlayer: boolean;
  /** The death delta's `reason` text - the claimed cause of death. */
  cause: string;
  /** ai/prompts/fragments.ts::getEntityBrief output for this entity. */
  entityBrief: string;
}

export interface MortalityValidationPromptInput {
  candidates: MortalityValidationCandidate[];
  /** This turn's public headlines, for context on what actually happened. */
  headlines: string[];
  /** This turn's gm_private notes so far (including any private-conversation log lines), for context. */
  gmPrivate: string[];
}

const VALIDATION_SYSTEM_INSTRUCTION = `
ROLE: Mortality Validator - the second, independent gate in a two-gate death pipeline.
A prior adjudication call declared that one or more entities have died. Your ONLY job is to disposition each claim: given everything you know about the world and the entity, is this death REAL and EARNED, or is it a hallucination/overreach - a death that doesn't follow from the actual events described, contradicts the entity's established situation, or is unsupported melodrama?

You do NOT decide the mechanical outcome. A separate, hidden dice roll decides that once (and only if) you validate a claim as real - you have no influence over it and will never see it. You only decide: did this entity plausibly, earnestly die from the events of this turn - yes or no.

RULES:
- Validate (valid: true) only when the claimed cause of death is a direct, earned consequence of what actually happened this turn - a real ambush, a real battle, a real poisoning, a real execution order actually carried out, etc.
- Invalidate (valid: false) melodrama, hallucinated causes not supported by the turn's actual events, deaths that contradict the entity's established situation (e.g. they were never in danger this turn), or vague/unsupported claims.
- Every candidate MUST receive exactly one disposition, matched by its exact entity_id.
- 'reasoning' is a short (1-2 sentence) justification. It is logged for the GM only and is never shown to the player.

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;

/** Builds the { systemInstruction, prompt } pair for the mortality VALIDATION call. */
export function buildMortalityValidationPrompt(
  input: MortalityValidationPromptInput
): { systemInstruction: string; prompt: string } {
  const { candidates, headlines, gmPrivate } = input;

  const prompt = `
THIS TURN'S PUBLIC HEADLINES:
${headlines.length > 0 ? headlines.join('\n') : 'None.'}

THIS TURN'S GM-PRIVATE NOTES (context on what actually happened, including any off-screen events):
${gmPrivate.length > 0 ? gmPrivate.join('\n') : 'None.'}

DEATH CLAIMS TO DISPOSITION:
${candidates
  .map(
    c => `- entity_id: "${c.entity_id}" (${c.isPlayer ? 'PLAYER CHARACTER' : 'NPC'})
  Claimed cause of death: "${c.cause}"
  Entity brief: ${c.entityBrief}`
  )
  .join('\n')}
`;

  return { systemInstruction: VALIDATION_SYSTEM_INSTRUCTION, prompt };
}

// --- Outcome prompt --------------------------------------------------------

export interface MortalityOutcomeCandidate {
  entity_id: string;
  name: string;
  isPlayer: boolean;
  /** The fate-table band ALREADY decided by the hidden roll (ai/core/resolution.ts) - e.g. 'survive_with_loss', 'presumed_dead'. */
  band: string;
  cause: string;
  entityBrief: string;
}

export interface MortalityOutcomePromptInput {
  candidates: MortalityOutcomeCandidate[];
}

/** Per-band authoring guidance, keyed by the exact band strings from ai/core/resolution.ts. */
const BAND_GUIDANCE: Record<string, string> = {
  survive_with_loss:
    "The PLAYER survives but suffers a REAL, concrete loss - a resource, a relationship, an exposed scheme. Not just prose: emit at least one delta (resource/relation/scheme/rumor - never a 'status' delta, that part is already decided).",
  survive_with_boon:
    "The PLAYER survives and gains a REAL, concrete boon - a resource, a relationship, new leverage. Emit at least one delta (never a 'status' delta).",
  gravely_wounded:
    "The NPC survives PUBLICLY but is gravely wounded - weakened. Emit at least one delta reflecting the toll (e.g. a resource or skill drop, lost standing, a damaged relationship). Never emit a 'status' delta - their public status is already decided as alive.",
  presumed_dead:
    "The world and the player believe this NPC is dead. They are secretly alive, in hiding, and may return later as a nemesis. Do NOT emit any delta that reveals this to the public - deltas here (if any) must be consistent with a confirmed death. Provide a short 'secret_motive': why they are hiding and what they might want if they return.",
  escapes_openly:
    "The NPC visibly escapes death - everyone present now knows an attempt was made on their life. Consider a delta reflecting the fallout now that the attempt is public knowledge (e.g. a relation delta raising perceived_threat, or a rumor). Never emit a 'status' delta - their public status is already decided as alive.",
};

const OUTCOME_SYSTEM_INSTRUCTION = `
ROLE: Mortality Outcome Author.
A hidden dice roll has ALREADY decided each candidate's fate band - you do not choose, influence, or second-guess the outcome, only give it concrete content. For each candidate, produce:
1. 'deltas': EventDeltas (type/key/delta/reason, per the existing delta contract) that apply the band's concrete SIDE-EFFECT consequence (resource, relation, scheme, rumor). Do NOT include a 'status' delta - the life/death/public-status change has already been decided and will be applied elsewhere; these deltas are only the loss/boon/wounding side effects.
2. 'narrative_directive': one line telling the narrator exactly how to narrate this outcome, consistent with the band. This is a STEERING instruction for a later prose pass, not the prose itself.
3. 'secret_motive' (presumed_dead candidates ONLY, omit/null otherwise): a short reason they are hiding and what they might want if they return.

BAND GUIDANCE:
${Object.entries(BAND_GUIDANCE)
  .map(([band, text]) => `- ${band}: ${text}`)
  .join('\n')}

Valid delta types: ${EventDeltaTypeEnum.join(', ')}. Every candidate MUST receive exactly one outcome entry, matched by its exact entity_id.

OUTPUT: A single JSON object per the schema. Do not include any explanatory text or markdown.
`;

/** Builds the { systemInstruction, prompt } pair for the mortality OUTCOME call. */
export function buildMortalityOutcomePrompt(
  input: MortalityOutcomePromptInput
): { systemInstruction: string; prompt: string } {
  const { candidates } = input;

  const prompt = `
CANDIDATES (fate band already decided by a hidden roll - narrate/apply content only, do not change the band):
${candidates
  .map(
    c => `- entity_id: "${c.entity_id}" (${c.isPlayer ? 'PLAYER CHARACTER' : 'NPC'}), band: "${c.band}"
  Original claimed cause: "${c.cause}"
  Entity brief: ${c.entityBrief}`
  )
  .join('\n')}
`;

  return { systemInstruction: OUTCOME_SYSTEM_INSTRUCTION, prompt };
}
