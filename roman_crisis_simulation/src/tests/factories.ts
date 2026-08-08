/**
 * Shared fixture vocabulary for tests (tests/factories.ts spec).
 *
 * One vocabulary of canonical, parameterized factories so test files stop
 * re-deriving the same fixture shapes. Every data factory takes a single
 * `overrides: Partial<T> = {}` and returns the concrete type. Nullable
 * (`T | null`) fields default to an explicit `null`; optional (`?`) fields
 * are OMITTED entirely from the canonical defaults - callers opt in by
 * passing them, and that presence/absence is preserved exactly (it is the
 * subject of legacy-save-shape tests elsewhere in the suite).
 *
 * `getMockInitialState` is NOT absorbed here - it is the fixed canonical
 * 3-entity scenario `tests/mockData.ts` owns and `mockParity.test.ts` pins.
 * It is simply re-exported so this file becomes the one-stop import
 * surface going forward.
 */
import { vi } from 'vitest';
import type {
  Entity,
  PersonalityTraits,
  Relationship,
  WorldState,
  SimulationState,
  Adjudication,
  TurnHistoryEntry,
  RawCallRecord,
  ActionResolutionEvent,
  MortalityEvent,
  NpcIntent,
  StoryRelevance,
  InvestigationResult,
  Report,
} from '../types';
import type { SaveGameState } from '../persistence/saveGame';
import type { KnowledgeClaim } from '../knowledge/store';
import type { PerceivedChange } from '../perception/visibility';
import type { PrivateSceneRecord } from '../privateScene/model';
import type { GeminiClient } from '../ai/core/geminiService';
import type { AdjudicationPromptInput } from '../ai/prompts/adjudication';
import { createInitialGameState } from '../state/gameReducer';
import { getMockInitialState } from './mockData';

export { getMockInitialState } from './mockData';

// ---------------------------------------------------------------------------
// 1. makePersonality
// ---------------------------------------------------------------------------
export function makePersonality(overrides: Partial<PersonalityTraits> = {}): PersonalityTraits {
  return {
    ambition: 5,
    paranoia: 5,
    loyalty: 5,
    cunning: 5,
    honor: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 2. makeRelationship
// ---------------------------------------------------------------------------
export function makeRelationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    entity_id: 'target',
    relationship_type: 'rival',
    trust_level: 0,
    recent_interactions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 3. makeEntity
// ---------------------------------------------------------------------------
export function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 4. makeWorldState
// ---------------------------------------------------------------------------
export function makeWorldState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    year: 235,
    week: 3,
    economic_stability: 'stable',
    political_climate: 'tense',
    regions: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 5. makeSimulationState
// ---------------------------------------------------------------------------
export function makeSimulationState(overrides: Partial<SimulationState> = {}): SimulationState {
  return {
    imperial_status: 'Stable',
    senate_status: 'Functional',
    military_status: 'Loyal',
    plebeian_mood: 'Uneasy',
    major_ongoing_crisis: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 6. makeAdjudication
// ---------------------------------------------------------------------------
export function makeAdjudication(overrides: Partial<Adjudication> = {}): Adjudication {
  return {
    turn: 1,
    entityActions: [],
    deltas: [],
    headlines: [],
    gm_private: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 7. makeTurnHistoryEntry
// ---------------------------------------------------------------------------
export function makeTurnHistoryEntry(overrides: Partial<TurnHistoryEntry> = {}): TurnHistoryEntry {
  return {
    turnNumber: 1,
    playerIntent: 'intent 1',
    adjudication: makeAdjudication({ turn: 1 }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 8. makeRawCall
// ---------------------------------------------------------------------------
export function makeRawCall(overrides: Partial<RawCallRecord> = {}): RawCallRecord {
  return {
    callName: 'adjudication',
    model: 'gemini-3-pro-preview',
    latencyMs: 100,
    attempts: 1,
    promptChars: 1000,
    rawResponse: 'x'.repeat(1000),
    validated: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 9. makeResolutionTrace
// ---------------------------------------------------------------------------
export function makeResolutionTrace(overrides: Partial<ActionResolutionEvent> = {}): ActionResolutionEvent {
  return {
    assessment: {
      is_consequential: true,
      action_category: 'political maneuvering',
      relevant_skill: 'intrigue',
      difficulty: 14,
      opposing_entity_id: 'maximinus_thrax',
      rationale: 'A direct move against a rival.',
    },
    roll: 11,
    total: 17,
    margin: 3,
    tier: 'success',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 10. makeMortalityEvent
// ---------------------------------------------------------------------------
export function makeMortalityEvent(overrides: Partial<MortalityEvent> = {}): MortalityEvent {
  return {
    entity_id: 'gaius_pontius_magnus',
    entity_name: 'Gaius Pontius Magnus',
    claim: 'Poisoned at a banquet.',
    valid: true,
    roll: 4,
    band: 'dies',
    outcomeSummary: 'The poison takes him before dawn.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 11. makeNpcIntent
// ---------------------------------------------------------------------------
export function makeNpcIntent(overrides: Partial<NpcIntent> = {}): NpcIntent {
  return {
    entity_id: 'maximinus_thrax',
    intent: 'Court the Rhine legions',
    continuity: 'new',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 12. makeStoryRelevance
// ---------------------------------------------------------------------------
export function makeStoryRelevance(overrides: Partial<StoryRelevance> = {}): StoryRelevance {
  return {
    spotlight_entities: [{ entity_id: 'maximinus_thrax', reason: 'Momentum.' }],
    spotlight_intents: [makeNpcIntent()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 13. makeInvestigationResult
// ---------------------------------------------------------------------------
export function makeInvestigationResult(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    target_id: 'maximinus_thrax',
    report: 'Some uncovered fact.',
    consequences: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 14. makeReport
// ---------------------------------------------------------------------------
export function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report_2_1',
    turn: 2,
    source: 'rumor',
    about: 'maximinus_thrax',
    claim: 'Thrax courts the Rhine legions',
    credibility: 0.6,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 15. makePerceivedChange
// ---------------------------------------------------------------------------
export function makePerceivedChange(overrides: Partial<PerceivedChange> = {}): PerceivedChange {
  return {
    text: 'Your denarii dwindles.',
    source: 'self',
    tabs: ['resources'],
    subject: 'severus_alexander',
    deltaType: 'resource',
    deltaKey: 'severus_alexander:denarii',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 16. makeKnowledgeClaim
// ---------------------------------------------------------------------------
export function makeKnowledgeClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  return {
    id: 'claim_1',
    subject: 'maximinus_thrax',
    claim: 'Thrax courts the Rhine legions',
    claimKey: 'report:maximinus_thrax:rumor:claim_1',
    firstLearnedTurn: 1,
    updates: [
      { turn: 1, source: 'rumor', text: 'Thrax courts the Rhine legions', credibility: 0.6 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 17. makePrivateScene
// ---------------------------------------------------------------------------
export function makePrivateScene(overrides: Partial<PrivateSceneRecord> = {}): PrivateSceneRecord {
  return {
    sceneId: 'scene_4_1',
    macroTurn: 4,
    playerId: 'severus_alexander',
    npcId: 'maximinus_thrax',
    playerName: 'Severus Alexander',
    npcName: 'Maximinus Thrax',
    status: 'closed',
    transcript: [
      { sequence: 1, speaker: 'player', text: 'Speak plainly.' },
      { sequence: 2, speaker: 'npc', text: 'I have heard you.' },
    ],
    npcResponseCount: 1,
    speechActs: [{ speaker: 'npc', kind: 'claim', text: 'I have heard you.', exchange: 1 }],
    npcPrivate: {
      sincerity: 'Guarded.',
      hiddenIntent: 'Measure the emperor before choosing a side.',
      plannedFollowThrough: ['Question the camp prefect.'],
    },
    closureReason: 'player_ended',
    consequenceStatus: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 18. makeLegacySaveState
// ---------------------------------------------------------------------------
export function makeLegacySaveState(overrides: Partial<SaveGameState> = {}): SaveGameState {
  return {
    entities: [],
    worldState: makeWorldState(),
    simulationState: makeSimulationState(),
    reports: [],
    turnNumber: 4,
    playerCharacterId: 'severus_alexander',
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'A crisis of succession.',
    messages: [{ sender: 'gm', text: 'Welcome.' }],
    triggeredEventIds: [],
    suggestedActions: [],
    currentEvents: [],
    gmInterventionText: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 19. makeAppSave
// ---------------------------------------------------------------------------
export function makeAppSave(overrides: Partial<SaveGameState> = {}): SaveGameState {
  const initial = getMockInitialState();
  return {
    entities: initial.entities,
    worldState: initial.worldState,
    simulationState: createInitialGameState().simulationState,
    reports: [],
    truthLedger: [],
    knowledge: [],
    npcIntents: [],
    turnNumber: 2,
    playerCharacterId: 'severus_alexander',
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'Task 7 observation integration.',
    messages: [],
    triggeredEventIds: [],
    eventFirings: [],
    suggestedActions: [],
    currentEvents: [],
    gmInterventionText: '',
    inferredAmbition: null,
    pendingIntelligenceFallout: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 20. buildAdjudicationPromptInput
// ---------------------------------------------------------------------------
export function buildAdjudicationPromptInput(
  overrides: Partial<AdjudicationPromptInput> = {}
): AdjudicationPromptInput {
  const { entities, worldState } = getMockInitialState();
  return {
    worldState,
    simulationState: makeSimulationState(),
    playerEntity: entities[0],
    npcEntities: entities.slice(1),
    history: [],
    submission: { observableAttempt: 'Hold court', questionOrContext: null },
    gmInterventionText: '',
    storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
    metaNarrative: 'A succession crisis.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 21. makeQueuedTextAi (documented exemption from the Partial convention)
// ---------------------------------------------------------------------------
export function makeQueuedTextAi(...responses: string[]): {
  ai: GeminiClient;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn();
  responses.forEach(text => generateContent.mockResolvedValueOnce({ text }));
  return { ai: { models: { generateContent } }, generateContent };
}
