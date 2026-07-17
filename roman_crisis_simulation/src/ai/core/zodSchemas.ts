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
} from '../../types';

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

/** Validates getStoryRelevance's output (intelligence.ts). */
export const zStoryRelevance = z.object({
  spotlight_entities: z.array(z.object({
    entity_id: z.string(),
    reason: z.string(),
  }).passthrough()),
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

/** Validates getRelationshipUpdates's output (intelligence.ts). */
export const zRelationshipDeltas = z.object({
  deltas: z.array(zEventDelta),
}).passthrough();

/** Validates simulatePrivateConversation's output (intelligence.ts). */
export const zConversationSimulation = z.object({
  dialogueSnippet: z.string(),
  deltas: z.array(zEventDelta),
}).passthrough();

/** Validates getInvestigationResult's output (intelligence.ts). `reportData`
 * is either a string list (secrets/beliefs) or a full Scheme object,
 * depending on the requested `subject`. */
export const zInvestigationResult = z.object({
  reportData: z.union([z.array(z.string()), zScheme]),
  report: z.string(),
  consequences: z.string().nullable(),
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
