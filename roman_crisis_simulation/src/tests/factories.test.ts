/**
 * TDD RED — pins the tests/factories.ts shared fixture vocabulary spec
 * BEFORE the implementation exists.
 *
 * Contract under test (per the factories spec):
 * - 21 canonical data factories + 1 AI harness (makeQueuedTextAi) + a
 *   re-export of getMockInitialState from ./mockData.
 * - Every data factory takes a single `overrides: Partial<T> = {}` and
 *   returns the concrete type. Caller overrides win; untouched fields keep
 *   their canonical defaults.
 * - Nullable-vs-optional boundary: `T | null` fields default to explicit
 *   null; optional (`?`) fields are OMITTED entirely — never set to
 *   undefined, never set to null. Optional-field PRESENCE is load-bearing
 *   (legacy-save shape discrimination), so `toStrictEqual` is used
 *   throughout: it pins the exact key set, including absence.
 */
import { describe, it, expect, vi } from 'vitest';
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
import { getMockInitialState as getMockInitialStateFromMockData } from './mockData';

import {
  makePersonality,
  makeRelationship,
  makeEntity,
  makeWorldState,
  makeSimulationState,
  makeAdjudication,
  makeTurnHistoryEntry,
  makeRawCall,
  makeResolutionTrace,
  makeMortalityEvent,
  makeNpcIntent,
  makeStoryRelevance,
  makeInvestigationResult,
  makeReport,
  makePerceivedChange,
  makeKnowledgeClaim,
  makePrivateScene,
  makeLegacySaveState,
  makeAppSave,
  buildAdjudicationPromptInput,
  makeQueuedTextAi,
  getMockInitialState,
} from './factories';

/** Assert each named optional field is genuinely ABSENT (not present-with-undefined). */
function expectAbsent(obj: object, keys: string[]): void {
  for (const key of keys) {
    expect(key in obj, `optional field "${key}" must be absent, not merely undefined`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// 1. makePersonality
// ---------------------------------------------------------------------------
describe('makePersonality', () => {
  it('emits the canonical defaults exactly', () => {
    const personality: PersonalityTraits = makePersonality();
    expect(personality).toStrictEqual({
      ambition: 5,
      paranoia: 5,
      loyalty: 5,
      cunning: 5,
      honor: 5,
    });
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const personality = makePersonality({ ambition: 9 });
    expect(personality.ambition).toBe(9);
    expect(personality.paranoia).toBe(5);
    expect(personality.loyalty).toBe(5);
    expect(personality.cunning).toBe(5);
    expect(personality.honor).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. makeRelationship
// ---------------------------------------------------------------------------
describe('makeRelationship', () => {
  it('emits the canonical defaults exactly (optional relation attrs absent)', () => {
    const relationship: Relationship = makeRelationship();
    expect(relationship).toStrictEqual({
      entity_id: 'target',
      relationship_type: 'rival',
      trust_level: 0,
      recent_interactions: [],
    });
    expectAbsent(relationship, [
      'respect_level',
      'perceived_threat',
      'ideological_alignment',
      'dependency_level',
    ]);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const relationship = makeRelationship({ trust_level: -5, entity_id: 'severus_alexander' });
    expect(relationship.trust_level).toBe(-5);
    expect(relationship.entity_id).toBe('severus_alexander');
    expect(relationship.relationship_type).toBe('rival');
    expect(relationship.recent_interactions).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. makeEntity
// ---------------------------------------------------------------------------
describe('makeEntity', () => {
  it('emits the canonical defaults exactly (all optional Entity fields absent)', () => {
    const entity: Entity = makeEntity();
    expect(entity).toStrictEqual({
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
    });
    expectAbsent(entity, [
      'position',
      'voice',
      'epithet',
      'personality',
      'skills',
      'secrets',
      'beliefs',
      'active_scheme',
      'secret_truth',
    ]);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const entity = makeEntity({ entity_id: 'e1', name: 'Test Entity' });
    expect(entity.entity_id).toBe('e1');
    expect(entity.name).toBe('Test Entity');
    expect(entity.location).toBe('Rome');
    expect(entity.resources).toStrictEqual({});
  });

  it('an optional field passed by the caller becomes present', () => {
    const entity = makeEntity({ position: 'Senator' });
    expect(entity.position).toBe('Senator');
    const plain = makeEntity();
    expect('position' in plain).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. makeWorldState
// ---------------------------------------------------------------------------
describe('makeWorldState', () => {
  it('emits the canonical defaults exactly', () => {
    const worldState: WorldState = makeWorldState();
    expect(worldState).toStrictEqual({
      year: 235,
      week: 3,
      economic_stability: 'stable',
      political_climate: 'tense',
      regions: {},
    });
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const worldState = makeWorldState({ week: 5, political_climate: 'Volatile' });
    expect(worldState.week).toBe(5);
    expect(worldState.political_climate).toBe('Volatile');
    expect(worldState.year).toBe(235);
    expect(worldState.economic_stability).toBe('stable');
  });
});

// ---------------------------------------------------------------------------
// 5. makeSimulationState
// ---------------------------------------------------------------------------
describe('makeSimulationState', () => {
  it('emits the canonical defaults exactly (crisis null, crisis_severity absent)', () => {
    const simulationState: SimulationState = makeSimulationState();
    expect(simulationState).toStrictEqual({
      imperial_status: 'Stable',
      senate_status: 'Functional',
      military_status: 'Loyal',
      plebeian_mood: 'Uneasy',
      major_ongoing_crisis: null,
    });
    expect(simulationState.major_ongoing_crisis).toBeNull();
    expectAbsent(simulationState, ['crisis_severity']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const simulationState = makeSimulationState({ major_ongoing_crisis: 'Civil War' });
    expect(simulationState.major_ongoing_crisis).toBe('Civil War');
    expect(simulationState.imperial_status).toBe('Stable');
    expect(simulationState.military_status).toBe('Loyal');
  });
});

// ---------------------------------------------------------------------------
// 6. makeAdjudication
// ---------------------------------------------------------------------------
describe('makeAdjudication', () => {
  it('emits the canonical required-only skeleton exactly', () => {
    const adjudication: Adjudication = makeAdjudication();
    expect(adjudication).toStrictEqual({
      turn: 1,
      entityActions: [],
      deltas: [],
      headlines: [],
      gm_private: [],
    });
    expectAbsent(adjudication, ['add_entities', 'remove_entities']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const adjudication = makeAdjudication({ turn: 5, headlines: ['Something dramatic happened.'] });
    expect(adjudication.turn).toBe(5);
    expect(adjudication.headlines).toStrictEqual(['Something dramatic happened.']);
    expect(adjudication.deltas).toStrictEqual([]);
    expect(adjudication.gm_private).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. makeTurnHistoryEntry
// ---------------------------------------------------------------------------
describe('makeTurnHistoryEntry', () => {
  it('emits the canonical defaults exactly with ALL optional fields absent', () => {
    const entry: TurnHistoryEntry = makeTurnHistoryEntry();
    expect(entry).toStrictEqual({
      turnNumber: 1,
      playerIntent: 'intent 1',
      adjudication: {
        turn: 1,
        entityActions: [],
        deltas: [],
        headlines: [],
        gm_private: [],
      },
    });
    expectAbsent(entry, [
      'narration',
      'playerMonologue',
      'postTurnEntities',
      'rawCalls',
      'mortalityTrace',
      'perceivingNpcIds',
      'npcIntents',
      'npcMindResults',
      'resolutionTrace',
      'turnSeed',
      'proseRedactions',
    ]);
  });

  it('documented footgun: overriding turnNumber does NOT sync adjudication.turn or playerIntent', () => {
    const entry = makeTurnHistoryEntry({ turnNumber: 9 });
    expect(entry.turnNumber).toBe(9);
    expect(entry.adjudication.turn).toBe(1);
    expect(entry.playerIntent).toBe('intent 1');
  });
});

// ---------------------------------------------------------------------------
// 8. makeRawCall
// ---------------------------------------------------------------------------
describe('makeRawCall', () => {
  it('emits the canonical defaults exactly (capture fields absent)', () => {
    const rawCall: RawCallRecord = makeRawCall();
    expect(rawCall).toStrictEqual({
      callName: 'adjudication',
      model: 'gemini-3-pro-preview',
      latencyMs: 100,
      attempts: 1,
      promptChars: 1000,
      rawResponse: 'x'.repeat(1000),
      validated: true,
    });
    expectAbsent(rawCall, ['promptText', 'systemInstruction', 'streamChunks']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const rawCall = makeRawCall({ callName: 'narration', validated: false });
    expect(rawCall.callName).toBe('narration');
    expect(rawCall.validated).toBe(false);
    expect(rawCall.model).toBe('gemini-3-pro-preview');
    expect(rawCall.latencyMs).toBe(100);
    expect(rawCall.promptChars).toBe(1000);
    expect(rawCall.rawResponse).toBe('x'.repeat(1000));
  });
});

// ---------------------------------------------------------------------------
// 9. makeResolutionTrace
// ---------------------------------------------------------------------------
describe('makeResolutionTrace', () => {
  it('emits the canonical defaults exactly (seed absent)', () => {
    const trace: ActionResolutionEvent = makeResolutionTrace();
    expect(trace).toStrictEqual({
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
    });
    expectAbsent(trace, ['seed']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const trace = makeResolutionTrace({ roll: 20, tier: 'critical_success' });
    expect(trace.roll).toBe(20);
    expect(trace.tier).toBe('critical_success');
    expect(trace.total).toBe(17);
    expect(trace.margin).toBe(3);
    expect(trace.assessment.difficulty).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 10. makeMortalityEvent
// ---------------------------------------------------------------------------
describe('makeMortalityEvent', () => {
  it('emits the canonical defaults exactly', () => {
    const event: MortalityEvent = makeMortalityEvent();
    expect(event).toStrictEqual({
      entity_id: 'gaius_pontius_magnus',
      entity_name: 'Gaius Pontius Magnus',
      claim: 'Poisoned at a banquet.',
      valid: true,
      roll: 4,
      band: 'dies',
      outcomeSummary: 'The poison takes him before dawn.',
    });
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const event = makeMortalityEvent({ valid: false, band: 'survive_with_loss' });
    expect(event.valid).toBe(false);
    expect(event.band).toBe('survive_with_loss');
    expect(event.entity_id).toBe('gaius_pontius_magnus');
    expect(event.roll).toBe(4);
    expect(event.outcomeSummary).toBe('The poison takes him before dawn.');
  });
});

// ---------------------------------------------------------------------------
// 11. makeNpcIntent
// ---------------------------------------------------------------------------
describe('makeNpcIntent', () => {
  it('emits the canonical defaults exactly', () => {
    const intent: NpcIntent = makeNpcIntent();
    expect(intent).toStrictEqual({
      entity_id: 'maximinus_thrax',
      intent: 'Court the Rhine legions',
      continuity: 'new',
    });
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const intent = makeNpcIntent({ continuity: 'continue' });
    expect(intent.continuity).toBe('continue');
    expect(intent.entity_id).toBe('maximinus_thrax');
    expect(intent.intent).toBe('Court the Rhine legions');
  });
});

// ---------------------------------------------------------------------------
// 12. makeStoryRelevance
// ---------------------------------------------------------------------------
describe('makeStoryRelevance', () => {
  it('emits the canonical defaults exactly (suggestion fields absent)', () => {
    const relevance: StoryRelevance = makeStoryRelevance();
    expect(relevance).toStrictEqual({
      spotlight_entities: [{ entity_id: 'maximinus_thrax', reason: 'Momentum.' }],
      spotlight_intents: [
        { entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions', continuity: 'new' },
      ],
    });
    expectAbsent(relevance, [
      'add_entity_suggestion',
      'remove_entity_suggestion',
      'add_location_suggestion',
      'remove_location_suggestion',
    ]);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const relevance = makeStoryRelevance({ spotlight_entities: [] });
    expect(relevance.spotlight_entities).toStrictEqual([]);
    expect(relevance.spotlight_intents).toStrictEqual([
      { entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions', continuity: 'new' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 13. makeInvestigationResult
// ---------------------------------------------------------------------------
describe('makeInvestigationResult', () => {
  it('emits the canonical defaults exactly (consequences explicit null)', () => {
    const result: InvestigationResult = makeInvestigationResult();
    expect(result).toStrictEqual({
      target_id: 'maximinus_thrax',
      report: 'Some uncovered fact.',
      consequences: null,
    });
    expect(result.consequences).toBeNull();
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const result = makeInvestigationResult({ consequences: 'Guards were alerted.' });
    expect(result.consequences).toBe('Guards were alerted.');
    expect(result.target_id).toBe('maximinus_thrax');
    expect(result.report).toBe('Some uncovered fact.');
  });
});

// ---------------------------------------------------------------------------
// 14. makeReport
// ---------------------------------------------------------------------------
describe('makeReport', () => {
  it('emits the canonical defaults exactly (topic/stance absent)', () => {
    const report: Report = makeReport();
    expect(report).toStrictEqual({
      id: 'report_2_1',
      turn: 2,
      source: 'rumor',
      about: 'maximinus_thrax',
      claim: 'Thrax courts the Rhine legions',
      credibility: 0.6,
    });
    expectAbsent(report, ['topic', 'stance']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const report = makeReport({ credibility: 0.9, turn: 5 });
    expect(report.credibility).toBe(0.9);
    expect(report.turn).toBe(5);
    expect(report.id).toBe('report_2_1');
    expect(report.source).toBe('rumor');
    expect(report.claim).toBe('Thrax courts the Rhine legions');
  });
});

// ---------------------------------------------------------------------------
// 15. makePerceivedChange
// ---------------------------------------------------------------------------
describe('makePerceivedChange', () => {
  it('emits the canonical defaults exactly', () => {
    const change: PerceivedChange = makePerceivedChange();
    expect(change).toStrictEqual({
      text: 'Your denarii dwindles.',
      source: 'self',
      tabs: ['resources'],
      subject: 'severus_alexander',
      deltaType: 'resource',
      deltaKey: 'severus_alexander:denarii',
    });
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const change = makePerceivedChange({ source: 'network', subject: 'maximinus_thrax' });
    expect(change.source).toBe('network');
    expect(change.subject).toBe('maximinus_thrax');
    expect(change.text).toBe('Your denarii dwindles.');
    expect(change.tabs).toStrictEqual(['resources']);
    expect(change.deltaType).toBe('resource');
    expect(change.deltaKey).toBe('severus_alexander:denarii');
  });
});

// ---------------------------------------------------------------------------
// 16. makeKnowledgeClaim
// ---------------------------------------------------------------------------
describe('makeKnowledgeClaim', () => {
  it('emits the canonical defaults exactly (topic/edges/schemeDiscovery/relationshipObservation absent)', () => {
    const claim: KnowledgeClaim = makeKnowledgeClaim();
    expect(claim).toStrictEqual({
      id: 'claim_1',
      subject: 'maximinus_thrax',
      claim: 'Thrax courts the Rhine legions',
      claimKey: 'report:maximinus_thrax:rumor:claim_1',
      firstLearnedTurn: 1,
      updates: [
        { turn: 1, source: 'rumor', text: 'Thrax courts the Rhine legions', credibility: 0.6 },
      ],
    });
    expectAbsent(claim, ['topic', 'edges', 'schemeDiscovery', 'relationshipObservation']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const claim = makeKnowledgeClaim({ subject: 'gaius_pontius_magnus', firstLearnedTurn: 3 });
    expect(claim.subject).toBe('gaius_pontius_magnus');
    expect(claim.firstLearnedTurn).toBe(3);
    expect(claim.id).toBe('claim_1');
    expect(claim.claimKey).toBe('report:maximinus_thrax:rumor:claim_1');
    expect(claim.updates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 17. makePrivateScene
// ---------------------------------------------------------------------------
describe('makePrivateScene', () => {
  it('emits the canonical defaults exactly (persistence.test.ts values; lastWord/consumedByTurn absent)', () => {
    const scene: PrivateSceneRecord = makePrivateScene();
    expect(scene).toStrictEqual({
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
    });
    expectAbsent(scene, ['lastWord', 'consumedByTurn']);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const scene = makePrivateScene({ sceneId: 'scene_3_1', macroTurn: 3 });
    expect(scene.sceneId).toBe('scene_3_1');
    expect(scene.macroTurn).toBe(3);
    expect(scene.status).toBe('closed');
    expect(scene.npcResponseCount).toBe(1);
    expect(scene.closureReason).toBe('player_ended');
  });
});

// ---------------------------------------------------------------------------
// 18. makeLegacySaveState
// ---------------------------------------------------------------------------
describe('makeLegacySaveState', () => {
  it('emits the legacy save shape exactly — NO modern optional fields present', () => {
    const save: SaveGameState = makeLegacySaveState();
    expect(save).toStrictEqual({
      entities: [],
      worldState: {
        year: 235,
        week: 3,
        economic_stability: 'stable',
        political_climate: 'tense',
        regions: {},
      },
      simulationState: {
        imperial_status: 'Stable',
        senate_status: 'Functional',
        military_status: 'Loyal',
        plebeian_mood: 'Uneasy',
        major_ongoing_crisis: null,
      },
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
    });
    expectAbsent(save, [
      'truthLedger',
      'knowledge',
      'npcIntents',
      'eventFirings',
      'inferredAmbition',
      'pendingIntelligenceFallout',
    ]);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const save = makeLegacySaveState({ turnNumber: 9, entities: [makeEntity()] });
    expect(save.turnNumber).toBe(9);
    expect(save.entities).toHaveLength(1);
    expect(save.metaNarrative).toBe('A crisis of succession.');
    expect(save.playerCharacterId).toBe('severus_alexander');
    expect(save.messages).toStrictEqual([{ sender: 'gm', text: 'Welcome.' }]);
  });
});

// ---------------------------------------------------------------------------
// 19. makeAppSave
// ---------------------------------------------------------------------------
describe('makeAppSave', () => {
  it('emits the modern full save shape exactly (relationshipObservationCommit values)', () => {
    const save: SaveGameState = makeAppSave();
    const initial = getMockInitialStateFromMockData();
    expect(save).toStrictEqual({
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
    });
    expect(save.inferredAmbition).toBeNull();
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const save = makeAppSave({ turnNumber: 9, entities: [] });
    expect(save.turnNumber).toBe(9);
    expect(save.entities).toStrictEqual([]);
    expect(save.metaNarrative).toBe('Task 7 observation integration.');
    expect(save.playerCharacterId).toBe('severus_alexander');
    expect(save.pendingIntelligenceFallout).toStrictEqual([]);
    expect(save.worldState).toStrictEqual(getMockInitialStateFromMockData().worldState);
  });
});

// ---------------------------------------------------------------------------
// 20. buildAdjudicationPromptInput
// ---------------------------------------------------------------------------
describe('buildAdjudicationPromptInput', () => {
  it('emits the canonical prompt input exactly (pacingPosture/playerActionOutcome absent)', () => {
    const input: AdjudicationPromptInput = buildAdjudicationPromptInput();
    const { entities, worldState } = getMockInitialStateFromMockData();
    expect(input).toStrictEqual({
      worldState,
      simulationState: {
        imperial_status: 'Stable',
        senate_status: 'Functional',
        military_status: 'Loyal',
        plebeian_mood: 'Uneasy',
        major_ongoing_crisis: null,
      },
      playerEntity: entities[0],
      npcEntities: entities.slice(1),
      history: [],
      submission: { observableAttempt: 'Hold court', questionOrContext: null },
      gmInterventionText: '',
      storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
      metaNarrative: 'A succession crisis.',
    });
    expectAbsent(input, [
      'pacingPosture',
      'playerActionOutcome',
      'npcIntents',
      'npcMindDecisions',
    ]);
  });

  it('an override replaces the default; untouched fields keep theirs', () => {
    const input = buildAdjudicationPromptInput({
      submission: { observableAttempt: 'Spread word that Thrax steals from his own men', questionOrContext: null },
      pacingPosture: 'dramatic',
    });
    expect(input.submission).toStrictEqual({
      observableAttempt: 'Spread word that Thrax steals from his own men',
      questionOrContext: null,
    });
    expect(input.pacingPosture).toBe('dramatic');
    expect(input.metaNarrative).toBe('A succession crisis.');
    expect(input.history).toStrictEqual([]);
    expect(input.gmInterventionText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 21. makeQueuedTextAi (documented exemption from the Partial convention)
// ---------------------------------------------------------------------------
describe('makeQueuedTextAi', () => {
  it('queues each response text in order and exposes the same mock via ai.models.generateContent', async () => {
    const harness = makeQueuedTextAi('first response', 'second response');
    const ai: GeminiClient = harness.ai;
    const generateContent = harness.generateContent;

    expect(vi.isMockFunction(generateContent)).toBe(true);
    expect(generateContent).toBe(ai.models.generateContent);
    expect(generateContent).not.toHaveBeenCalled();

    const first = await ai.models.generateContent({ model: 'm', contents: 'c' });
    expect(first.text).toBe('first response');
    const second = await ai.models.generateContent({ model: 'm', contents: 'c' });
    expect(second.text).toBe('second response');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Re-export: getMockInitialState
// ---------------------------------------------------------------------------
describe('getMockInitialState re-export', () => {
  it('re-exports the exact same function object as ./mockData', () => {
    expect(getMockInitialState).toBe(getMockInitialStateFromMockData);
  });
});
