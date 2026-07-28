/**
 * ai/core/zodSchemas.ts
 *
 * Zod schemas mirroring the AI-boundary response shapes that are actually
 * parsed today (see ROADMAP_2_AI_ARCHITECTURE.md P0.1 and
 * ROADMAP_6_MAINTAINABILITY.md P1.1). These are validated by
 * `geminiService.generateStructured` AFTER `JSON.parse` succeeds, closing
 * the "blindly cast `JSON.parse(...) as Adjudication`" gap - a
 * structurally-wrong-but-syntactically-valid response now fails loudly
 * (with one automatic repair-retry) instead of silently corrupting state
 * deep inside `applyDeltas`.
 *
 * This file mirrors `types.ts` - it does NOT replace it. Field names and
 * shapes are kept in lockstep with `types.ts` and `ai/core/schemas.ts` (the
 * Gemini `responseSchema` trees) by hand; if you add/rename a field in one,
 * update the other two. `.passthrough()` is used liberally so validation
 * catches genuine structural breakage (missing/wrong-typed fields the
 * engine dereferences) without rejecting harmless extra keys the model
 * adds.
 *
 * IMPORTANT: schema changes here and prompt changes in ai/prompts/ must
 * land together - see ai/prompts/README.md.
 */

import { z } from 'zod';
import {
  EntityActionIntentEnum,
  EventDeltaTypeEnum,
  NpcIntentContinuityEnum,
  RumorStanceEnum,
} from '../../types';
import {
  PRIVATE_SCENE_MAX_NPC_RESPONSES,
  PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
} from '../../privateScene/model';
import { assertPlayerVisibleValueSafe } from './playerBoundary';

const zPrivateSceneText = z.string().trim().min(1).max(PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
const PRIVATE_SCENE_NUMERIC_RELATIONSHIP_PATTERNS = [
  /\b(?:relationship|trust|respect|threat|alignment|dependency|loyalty)\s+(?:(?:level|score|rating)(?:\s*(?:is|at|equals?|to|=|:))?|(?:is|at|equals?|to|=|:))\s*[+-]?\d+(?:\.\d+)?(?:\s*(?:\/|out\s+of|of)\s*\d+(?:\.\d+)?)?\b/i,
  /\b[+-]?\d+(?:\.\d+)?\s*(?:\/|out\s+of|of)\s*\d+(?:\.\d+)?\s+(?:relationship|trust|respect|threat|alignment|dependency|loyalty)(?:\s+(?:level|score|rating))?\b/i,
] as const;

function privateSceneResponseStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(privateSceneResponseStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(privateSceneResponseStrings);
  return [];
}

/** Strict runtime boundary: this micro-loop cannot return world-state authority. */
export const zPrivateSceneModelResponse = z.object({
  disposition: z.enum(['refused', 'continues', 'ends']),
  npcUtterance: zPrivateSceneText,
  speechActs: z.array(z.object({
    speaker: z.literal('npc'),
    kind: z.enum(['claim', 'disclosure', 'request', 'promise', 'agreement', 'refusal', 'threat']),
    text: zPrivateSceneText,
    exchange: z.number().int().min(1).max(PRIVATE_SCENE_MAX_NPC_RESPONSES),
  }).strict()).max(16),
  npcPrivate: z.object({
    sincerity: zPrivateSceneText,
    hiddenIntent: zPrivateSceneText,
    plannedFollowThrough: z.array(zPrivateSceneText).max(8),
  }).strict(),
}).strict().superRefine((response, context) => {
  try {
    assertPlayerVisibleValueSafe(response);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'private-scene response contains hidden mechanics',
    });
  }
  if (privateSceneResponseStrings(response).some(text => PRIVATE_SCENE_NUMERIC_RELATIONSHIP_PATTERNS.some(pattern => pattern.test(text)))) {
    context.addIssue({
      code: 'custom',
      message: 'private-scene response contains numeric relationship mechanics',
    });
  }
});

// --- Entity sub-schemas (types.ts mirror) --------------------------------

export const zPersonalityTraits = z.object({
  ambition: z.number(),
  paranoia: z.number(),
  loyalty: z.number(),
  cunning: z.number(),
  honor: z.number(),
}).passthrough();

// Directional relationship semantics (see engine.ts's `applyDeltas` 'relation'
// case and ai/prompts/fragments.ts / adjudication.ts): a relationship record
// keyed under entity A describes A's perception of the other entity ONLY.
export const zRelationship = z.object({
  entity_id: z.string(),
  relationship_type: z.string(),
  trust_level: z.number(),
  respect_level: z.number().nullable().optional(),
  perceived_threat: z.number().nullable().optional(),
  ideological_alignment: z.number().nullable().optional(),
  dependency_level: z.number().nullable().optional(),
  recent_interactions: z.array(z.string()),
}).passthrough();

export const zMemory = z.object({
  turn: z.number(),
  event_description: z.string(),
  emotional_impact: z.string(),
  involved_entities: z.array(z.string()),
}).passthrough();

export const zSchemeStep = z.object({
  objective: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
}).passthrough();

export const zScheme = z.object({
  name: z.string(),
  overall_goal: z.string(),
  steps: z.array(zSchemeStep),
}).passthrough();

/**
 * Entity: strict on the fields the engine actually dereferences
 * (entity_id/name/entity_type/status/location/relationships/memories/
 * resources/visibility_network/current_state_narrative/short_term_goals/
 * long_term_ambitions - the `required` list in schemas.ts's EntitySchema),
 * loose (.passthrough() / permissive value types) on everything else, and
 * `.passthrough()` at the top level so unrecognized extra keys the model
 * invents don't fail validation.
 */
export const zEntity = z.object({
  entity_id: z.string(),
  name: z.string(),
  entity_type: z.enum(['individual', 'group', 'faction']),
  status: z.enum(['alive', 'dead', 'exiled', 'missing']),
  position: z.string().nullable().optional(),
  // 4C.5 narrative flavor (types.ts's Entity.voice/epithet). Nullable AND
  // optional so legacy entities/saves without them - and model responses
  // that omit or null them - all validate; keep in lockstep with
  // EntitySchema in ai/core/schemas.ts.
  voice: z.string().nullable().optional(),
  epithet: z.string().nullable().optional(),
  location: z.string(),
  personality: zPersonalityTraits.nullable().optional(),
  faction_id: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  culture: z.record(z.string(), z.array(z.string())).optional(),
  faction_members: z.array(z.string()).nullable().optional(),
  relationships: z.record(z.string(), zRelationship.nullable()),
  memories: z.array(zMemory),
  resources: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])),
  visibility_network: z.array(z.string()),
  current_state_narrative: z.string(),
  short_term_goals: z.array(z.string()),
  long_term_ambitions: z.array(z.string()),
  beliefs: z.array(z.string()).nullable().optional(),
  secrets: z.array(z.string()).nullable().optional(),
  skills: z.record(z.string(), z.number()).nullable().optional(),
  active_scheme: zScheme.nullable().optional(),
}).passthrough();

export const zEntityStub = z.object({
  entity_id: z.string(),
  name: z.string(),
  entity_type: z.enum(['individual', 'group', 'faction']),
  position: z.string(),
  brief_description: z.string(),
}).passthrough();

export const zRegionState = z.object({
  stability: z.string(),
  controlling_faction: z.string().nullable(),
  current_events: z.array(z.string()),
}).passthrough();

export const zWorldState = z.object({
  year: z.number(),
  week: z.number(),
  economic_stability: z.string(),
  political_climate: z.string(),
  regions: z.record(z.string(), zRegionState),
}).passthrough();

// --- Turn pipeline shapes --------------------------------------------------

export const zEventDelta = z.object({
  type: z.enum(EventDeltaTypeEnum),
  key: z.string(),
  delta: z.number(),
  reason: z.string(),
  // 'status' deltas only: structured status/location fields. Nullable and
  // optional so non-status deltas (resource, relation, scheme, ...) don't
  // need to carry them. See ai/core/engine.ts's 'status' case and
  // ai/prompts/adjudication.ts for how these are produced/consumed.
  new_status: z.enum(['alive', 'dead', 'exiled', 'missing']).nullable().optional(),
  new_location: z.string().nullable().optional(),
  // 'rumor' deltas only, GM-PRIVATE (DESIGN_DECISIONS.md D11 - same
  // handling class as secret_truth): the claim's actual truth disposition
  // and originating entity. The adjudication prompt demands is_true on
  // every rumor; nullable/optional here so non-rumor deltas need not carry
  // them and so an omission fails soft into the engine's assumed-true
  // fallback (ai/core/engine.ts) instead of failing the whole turn. See
  // types.ts's EventDelta for the leak-prevention contract.
  is_true: z.boolean().nullable().optional(),
  origin_id: z.string().nullable().optional(),
  // 'rumor' deltas only (D29), NOT private: `topic` is the categorization
  // slug that keeps distinct matters about one subject on distinct claims;
  // `stance` marks a counterplay follow-up as corroborating or contradicting
  // the claim it continues. The adjudication prompt demands `topic` on every
  // rumor; nullable/optional here so non-rumor deltas need not carry them and
  // an omission fails soft (the knowledge store defaults an absent topic)
  // rather than failing the turn. See types.ts's EventDelta.
  topic: z.string().nullable().optional(),
  stance: z.enum(RumorStanceEnum).nullable().optional(),
}).passthrough();

export const zEntityAction = z.object({
  id: z.string(),
  intent: z.enum(EntityActionIntentEnum),
  target: z.string().nullable().optional(),
  notes: z.string(),
}).passthrough();

/** Validates the main per-turn adjudication call's output (turn.ts). */
export const zAdjudication = z.object({
  turn: z.number(),
  entityActions: z.array(zEntityAction),
  deltas: z.array(zEventDelta),
  headlines: z.array(z.string()),
  gm_private: z.array(z.string()),
  add_entities: z.array(zEntity).nullable().optional(),
  remove_entities: z.array(z.string()).nullable().optional(),
}).passthrough();

/**
 * One spotlight NPC's persistent intent from the Director (4C.3) - mirrors
 * types.ts's NpcIntent. GM-private data class (D4/D5): consumed only by
 * ai/** prompts and the GM console.
 */
export const zNpcIntent = z.object({
  entity_id: z.string(),
  intent: z.string(),
  continuity: z.enum(NpcIntentContinuityEnum),
}).passthrough();

/** Validates getStoryRelevance's (the Director's) output (intelligence.ts). */
export const zStoryRelevance = z.object({
  spotlight_entities: z.array(z.object({
    entity_id: z.string(),
    reason: z.string(),
  }).passthrough()),
  // Required, like spotlight_entities: the intents are the durable state the
  // continuity loop (ai/core/turn.ts) commits every turn - an omission is a
  // structural failure the repair-retry should catch, not a silent no-op.
  spotlight_intents: z.array(zNpcIntent),
  add_entity_suggestion: z.object({
    description: z.string(),
    reason: z.string(),
  }).passthrough().nullable().optional(),
  remove_entity_suggestion: z.object({
    entity_id: z.string(),
    reason: z.string(),
  }).passthrough().nullable().optional(),
  add_location_suggestion: z.object({
    name: z.string(),
    description: z.string(),
    reason: z.string(),
  }).passthrough().nullable().optional(),
  remove_location_suggestion: z.object({
    name: z.string(),
    reason: z.string(),
  }).passthrough().nullable().optional(),
}).passthrough();

/** Validates getUpdatedSimulationState's output (intelligence.ts). */
export const zSimulationState = z.object({
  imperial_status: z.enum(['Stable', 'Contested', 'Vacant']),
  senate_status: z.enum(['Ascendant', 'Functional', 'Deposed', 'Irrelevant']),
  military_status: z.enum(['Loyal', 'Divided', 'Rebellious']),
  plebeian_mood: z.enum(['Content', 'Uneasy', 'Rioting']),
  major_ongoing_crisis: z.string().nullable(),
}).passthrough();

/** Validates getInvestigationResult's output (intelligence.ts). `reportData`
 * is a string list for every subject: findings for secrets/beliefs, and for
 * 'scheme' a list of partial clues (D28 - a scheme investigation returns
 * fragments, never the whole Scheme object). */
export const zInvestigationResult = z.object({
  reportData: z.array(z.string()),
  report: z.string(),
  consequences: z.string().nullable(),
}).passthrough();

// --- Mortality pipeline (ai/core/mortality.ts, DESIGN_DECISIONS.md D2/D3) --

/** Validates the mortality VALIDATION call's output (ai/core/mortality.ts). */
export const zMortalityDisposition = z.object({
  entity_id: z.string(),
  valid: z.boolean(),
  reasoning: z.string(),
}).passthrough();

export const zMortalityValidation = z.object({
  dispositions: z.array(zMortalityDisposition),
}).passthrough();

/** Validates the mortality OUTCOME call's output (ai/core/mortality.ts). */
export const zMortalityOutcomeEntry = z.object({
  entity_id: z.string(),
  deltas: z.array(zEventDelta),
  narrative_directive: z.string(),
  // 'presumed_dead' candidates only - see ai/prompts/mortality.ts's BAND_GUIDANCE.
  secret_motive: z.string().nullable().optional(),
}).passthrough();

export const zMortalityOutcome = z.object({
  outcomes: z.array(zMortalityOutcomeEntry),
}).passthrough();

// --- NPC minds (ai/tools/npcMind.ts, ROADMAP_PHASE_4.md 4C item 4, D10/D22) --

/**
 * Validates one per-spotlight mind call's output (ai/tools/npcMind.ts).
 * Mirrors `NpcMindDecisionSchema` in ai/core/schemas.ts and
 * `NpcMindDecision` in types.ts - keep all three in lockstep. GM-private
 * data class (D4/D5): `private_reasoning` renders only in GameMasterScreen
 * and is never fed to the adjudicator.
 */
export const zNpcMindDecision = z.object({
  entity_id: z.string(),
  chosen_action: z.string(),
  method: z.string(),
  private_reasoning: z.string(),
  scheme_adjustment: z.string().nullable().optional(),
}).passthrough();

// --- Resolution layer: action assessment (ai/tools/assessment.ts, ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) --

/** Validates the action-assessment call's output (ai/tools/assessment.ts). */
export const zActionAssessment = z.object({
  is_consequential: z.boolean(),
  action_category: z.string(),
  relevant_skill: z.enum(['oratory', 'strategy', 'intrigue']).nullable(),
  difficulty: z.number(),
  opposing_entity_id: z.string().nullable(),
  rationale: z.string(),
}).passthrough();

// --- World generation (initiator.ts) --------------------------------------

/** Validates generateScenarioStructure's output (initiator.ts, Step 1). */
export const zScenarioStructure = z.object({
  worldState: zWorldState,
  playerStub: zEntityStub,
  npcStubs: z.array(zEntityStub),
}).passthrough();

/** Validates generateEntityBatch's output (initiator.ts, Step 2). */
export const zEntityBatch = z.object({
  entities: z.array(zEntity),
}).passthrough();

// --- Character creation (characterCreator.ts) -----------------------------
// createCharacter's output is a single full Entity - `zEntity` above.

// --- Offline eval judge (eval/judge.ts, DESIGN_DECISIONS.md D18) ----------

/** One judged axis: an integer score 1 (worst) to 5 (best) plus a short rationale. */
export const zEvalJudgeAxisScore = z.object({
  score: z.number().int().min(1).max(5),
  rationale: z.string(),
}).passthrough();

/**
 * Validates the offline eval judge call's output (eval/judge.ts,
 * ai/prompts/evalJudge.ts). Exactly five fixed axes - mirrors
 * `EvalJudgeVerdictSchema` in ai/core/schemas.ts; keep the two in lockstep.
 * `character_richness` is the 4C richness axis (D10/D16): continuity of
 * self over plot convenience. Eval tooling only: this call is never made
 * from app code.
 */
export const zEvalJudgeVerdict = z.object({
  consequence_density: zEvalJudgeAxisScore,
  sim_state_consistency: zEvalJudgeAxisScore,
  schema_validity: zEvalJudgeAxisScore,
  information_asymmetry: zEvalJudgeAxisScore,
  character_richness: zEvalJudgeAxisScore,
}).passthrough();
/** Strict model boundary: selections only, no relationship interpretation or attribution. */
export const zRelationshipObservations = z.array(z.object({
  evidenceId: z.string(),
  participantIds: z.array(z.string()),
  excerpt: z.string().refine(value => value.trim().length > 0, 'excerpt must contain non-whitespace text'),
}).strict());

/** Strict model boundary: a semantic decision plus offered evidence IDs only. */
export const zNoAttemptEvidenceSelection = z.object({
  decision: z.enum(['answer', 'no_answer']),
  evidenceIds: z.array(z.string()).max(5),
}).strict().superRefine((selection, context) => {
  if (selection.decision === 'answer' && selection.evidenceIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['evidenceIds'],
      message: 'answer requires one to five evidence IDs',
    });
  }
  if (selection.decision === 'no_answer' && selection.evidenceIds.length !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['evidenceIds'],
      message: 'no_answer requires an empty evidence ID list',
    });
  }
});
