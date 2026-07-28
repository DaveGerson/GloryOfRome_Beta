/**
 * tests/journeys/fixtures.ts
 *
 * Scenario seeds and canned AI-response builders for the journey smoke
 * harness (see tests/journeys/harness.ts and
 * testing/SMOKE_HARNESS_DESIGN.md).
 *
 * Every builder returns a PLAIN OBJECT shaped exactly like the zod schema
 * the CURRENT pipeline validates that call against (ai/core/zodSchemas.ts) -
 * the harness stringifies it before handing it to the fake client, and the
 * REAL `generateStructured` then parses + zod-validates it, so a fixture
 * that drifts out of schema fails the journey loudly (INV-SCHEMA - our
 * "plausible model output" must be plausible against the real schemas).
 *
 * The scenario seed is the REAL base scenario (constants/baseScenario.ts) -
 * Rome, 235 CE, Severus Alexander as the player - deep-cloned per journey so
 * journeys can never contaminate each other or the shared constants.
 */

import type {
  Adjudication,
  Entity,
  EventDelta,
  EntityAction,
  Report,
  Scheme,
  SimulationState,
  StoryRelevance,
  NpcIntent,
  NpcMindDecision,
  TruthLedgerEntry,
  TurnHistoryEntry,
  WorldState,
  Message,
} from '../../types';
import type { KnowledgeClaim } from '../../knowledge/store';
import {
  ALL_INITIAL_ENTITIES,
  INITIAL_WORLD_STATE,
  INITIAL_SIMULATION_STATE,
} from '../../constants/baseScenario';

// --- Scenario seed --------------------------------------------------------

export const PLAYER_ID = 'severus_alexander';

export const META_NARRATIVE =
  'An imperial succession crisis in a crumbling empire teetering on the brink of civil war.';

export interface ScenarioSeed {
  entities: Entity[];
  worldState: WorldState;
  simulationState: SimulationState;
  reports: Report[];
  truthLedger: TruthLedgerEntry[];
  knowledge: KnowledgeClaim[];
  npcIntents: NpcIntent[];
  turnHistory: TurnHistoryEntry[];
  messages: Message[];
  turnNumber: number;
  playerId: string;
  metaNarrative: string;
}

/** A fresh, isolated copy of the real starting scenario (Rome, 235 CE). */
export function baseScenario(): ScenarioSeed {
  return {
    entities: structuredClone(ALL_INITIAL_ENTITIES),
    worldState: structuredClone(INITIAL_WORLD_STATE),
    simulationState: structuredClone(INITIAL_SIMULATION_STATE),
    reports: [],
    truthLedger: [],
    knowledge: [],
    npcIntents: [],
    turnHistory: [],
    messages: [],
    turnNumber: 1,
    playerId: PLAYER_ID,
    metaNarrative: META_NARRATIVE,
  };
}

// --- EventDelta helpers ---------------------------------------------------

export function resourceDelta(entityId: string, resource: string, amount: number, reason: string): EventDelta {
  return { type: 'resource', key: `${entityId}:${resource}`, delta: amount, reason };
}

/** Directional: changes A's perception of B only (engine.ts 'relation' case). */
export function relationDelta(
  aId: string,
  bId: string,
  attribute: 'trust_level' | 'respect_level' | 'perceived_threat' | 'ideological_alignment' | 'dependency_level',
  amount: number,
  reason: string
): EventDelta {
  return { type: 'relation', key: `${aId}:${bId}:${attribute}`, delta: amount, reason };
}

export function statusDelta(
  entityId: string,
  newStatus: 'alive' | 'dead' | 'exiled' | 'missing',
  reason: string,
  newLocation?: string
): EventDelta {
  return { type: 'status', key: entityId, delta: 0, reason, new_status: newStatus, ...(newLocation ? { new_location: newLocation } : {}) };
}

/**
 * A rumor delta carrying its GM-PRIVATE truth disposition (D11): `is_true`
 * and `origin_id` are the ledger fields the narration sanitizer strips and
 * that must never reach a player-facing surface. `topic` is player-safe D29
 * categorization the engine copies onto the Report.
 */
export function rumorDelta(
  aboutId: string,
  claim: string,
  credibility: number,
  opts: { isTrue: boolean; originId?: string; topic?: string } = { isTrue: true }
): EventDelta {
  return {
    type: 'rumor',
    key: aboutId,
    delta: credibility,
    reason: claim,
    is_true: opts.isTrue,
    ...(opts.originId ? { origin_id: opts.originId } : {}),
    ...(opts.topic ? { topic: opts.topic } : {}),
  };
}

export function schemeDelta(entityId: string, scheme: Scheme): EventDelta {
  return { type: 'scheme', key: entityId, delta: 0, reason: JSON.stringify(scheme) };
}

export function worldDelta(key: 'economic_stability' | 'political_climate', newValue: string): EventDelta {
  return { type: 'world', key, delta: 0, reason: newValue };
}

// --- Canned structured responses (schema-valid, see zodSchemas.ts) --------

/**
 * getStoryRelevance (the Director) response. Current schema (zStoryRelevance)
 * REQUIRES `spotlight_intents` alongside `spotlight_entities` - so both are
 * always emitted. Default: no spotlights and no intents, so no mind calls.
 */
export function scriptStoryRelevance(
  spotlights: Array<{ entity_id: string; reason: string }> = [],
  intents: NpcIntent[] = []
): StoryRelevance {
  return { spotlight_entities: spotlights, spotlight_intents: intents };
}

/** Action-assessment response: non-consequential (no roll, no PLAYER ACTION OUTCOME block). */
export function scriptAssessmentIdle(category = 'routine governance') {
  return {
    is_consequential: false,
    action_category: category,
    relevant_skill: null as 'oratory' | 'strategy' | 'intrigue' | null,
    difficulty: 10,
    opposing_entity_id: null as string | null,
    rationale: 'Administrative business with no real opposition or risk of failure.',
  };
}

/** Action-assessment response: consequential (the resolution layer rolls a hidden d20). */
export function scriptAssessmentConsequential(opts: {
  category: string;
  skill: 'oratory' | 'strategy' | 'intrigue' | null;
  difficulty: number;
  opposingEntityId?: string | null;
  rationale?: string;
}) {
  return {
    is_consequential: true,
    action_category: opts.category,
    relevant_skill: opts.skill,
    difficulty: opts.difficulty,
    opposing_entity_id: opts.opposingEntityId ?? null,
    rationale: opts.rationale ?? 'A real gamble with real opposition; this must be resolved.',
  };
}

/** The main adjudication response. `turn` MUST match the turn number runNewTurn was called with. */
export function scriptAdjudication(
  turn: number,
  opts: {
    deltas?: EventDelta[];
    headlines?: string[];
    gm_private?: string[];
    entityActions?: EntityAction[];
    add_entities?: Entity[];
    remove_entities?: string[];
  } = {}
): Adjudication {
  return {
    turn,
    entityActions: opts.entityActions ?? [],
    deltas: opts.deltas ?? [],
    headlines: opts.headlines ?? ['The week passes without great incident in the city of Rome.'],
    gm_private: opts.gm_private ?? [],
    ...(opts.add_entities ? { add_entities: opts.add_entities } : {}),
    ...(opts.remove_entities ? { remove_entities: opts.remove_entities } : {}),
  };
}

/** getUpdatedSimulationState response. Default: echo the current state unchanged. */
export function scriptSimulationState(
  base: SimulationState,
  overrides: Partial<SimulationState> = {}
): SimulationState {
  return { ...structuredClone(base), ...overrides };
}

/** Narration response: prose + exactly three SUGGESTION lines (the turn.ts split contract). */
export function scriptNarration(prose: string, suggestions: [string, string, string]): string {
  return `${prose}\nSUGGESTION: ${suggestions[0]}\nSUGGESTION: ${suggestions[1]}\nSUGGESTION: ${suggestions[2]}`;
}

/**
 * One per-spotlight NPC MIND decision (ai/tools/npcMind.ts). The pipeline
 * normalizes `entity_id` to the character it actually asked, so for two
 * minds you queue an array of two decisions (consumed in spotlight order).
 * `scheme_adjustment`, when present, becomes the CHARACTER'S own scheme
 * evolution (D30) - a committed 'scheme' delta on that entity.
 */
export function scriptNpcMind(opts: {
  entity_id: string;
  chosen_action: string;
  method: string;
  private_reasoning: string;
  scheme_adjustment?: string | null;
}): NpcMindDecision {
  return {
    entity_id: opts.entity_id,
    chosen_action: opts.chosen_action,
    method: opts.method,
    private_reasoning: opts.private_reasoning,
    ...(opts.scheme_adjustment !== undefined ? { scheme_adjustment: opts.scheme_adjustment } : {}),
  };
}

/** Mortality VALIDATION response - dispositions each death claim (D2/D3 gate 1). */
export function scriptMortalityValidation(
  dispositions: Array<{ entity_id: string; valid: boolean; reasoning: string }>
) {
  return { dispositions };
}

/** Mortality OUTCOME response - concrete content for bands that need it (D2/D3 gate 3). */
export function scriptMortalityOutcome(
  outcomes: Array<{
    entity_id: string;
    deltas: EventDelta[];
    narrative_directive: string;
    secret_motive?: string | null;
  }>
) {
  return { outcomes };
}

/**
 * getInvestigationResult response (the player-triggered intelligence side
 * call). Current schema (zInvestigationResult) requires `reportData` to be a
 * string[] for EVERY subject - a 'scheme' investigation returns partial clue
 * fragments, never the whole Scheme object (D28).
 */
export function scriptInvestigation(opts: {
  reportData: string[];
  report: string;
  consequences: string | null;
}) {
  return { reportData: opts.reportData, report: opts.report, consequences: opts.consequences };
}

// --- Shared default flavor text ------------------------------------------

export const DEFAULT_MONOLOGUE =
  'The city holds its breath, and so must I. Every ally I buy today is a debt some rival will try to collect tomorrow.';

export const DEFAULT_NARRATION_PROSE =
  'The week unfolds in the ordinary rhythm of the capital: petitions in the morning, audiences at midday, and by dusk the murmur of the forum settling like dust. Your household reports nothing amiss, though in Rome quiet is merely intrigue conducted at a lower volume.';

export const DEFAULT_SUGGESTIONS: [string, string, string] = [
  'Court the goodwill of the Senate with a public honor',
  'Send a trusted freedman to sound out the Praetorian prefects',
  'Review the treasury accounts with your own eyes',
];
