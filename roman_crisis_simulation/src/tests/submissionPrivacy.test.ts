import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { buildPerceivedDigest } from '../perception/visibility';
import { computeTurnKnowledge } from '../knowledge/commit';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { Entity, SimulationState, TurnSubmission, WorldState } from '../types';

const OBSERVABLE_SENTINEL = 'OBSERVABLE_ATTEMPT_SENTINEL_6T2';
const PRIVATE_SENTINEL = 'PRIVATE_INTENT_SENTINEL_6T2';
const QUESTION_SENTINEL = 'QUESTION_CONTEXT_SENTINEL_6T2';
const POISONED_NARRATION_SENTINEL = 'POISONED_NARRATION_SENTINEL_6T2';
const SAFE_HEADLINE_SENTINEL = 'SAFE_PUBLIC_HEADLINE_SENTINEL_6T2';
const SAFE_FACT_SENTINEL = 'SAFE_ADJUDICATED_FACT_SENTINEL_6T2';

const WORLD_STATE: WorldState = {
  year: 235,
  week: 7,
  economic_stability: 'Strained',
  political_climate: 'Volatile',
  regions: {
    Rome: { stability: 'Tense', controlling_faction: null, current_events: [] },
    Camp: { stability: 'Wavering', controlling_faction: null, current_events: [] },
  },
};

const SIMULATION_STATE: SimulationState = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Uneasy',
  major_ongoing_crisis: null,
};

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    entity_type: 'individual',
    status: 'alive',
    position: 'Emperor',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: { denarii: 1000 },
    visibility_network: [],
    current_state_narrative: 'The throne is contested.',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

function makeCast(): { player: Entity; npcA: Entity; npcB: Entity } {
  const player = makeEntity();
  const npcA = makeEntity({
    entity_id: 'npc_a',
    name: 'Aulus',
    position: 'General',
    location: 'Camp',
    active_scheme: { name: 'Aulus Scheme', overall_goal: 'Gain command.', steps: [] },
  });
  const npcB = makeEntity({
    entity_id: 'npc_b',
    name: 'Brutus',
    position: 'Senator',
    active_scheme: { name: 'Brutus Scheme', overall_goal: 'Control the Senate.', steps: [] },
  });
  return { player, npcA, npcB };
}

const FULL_SUBMISSION: TurnSubmission = {
  version: 1,
  kind: 'structured',
  actions: [OBSERVABLE_SENTINEL],
  messagesOrOrders: [{
    recipient: { kind: 'known_entity', entityId: 'npc_a', displayName: 'Aulus' },
    command: 'Hold the northern gate.',
  }],
  privateIntent: PRIVATE_SENTINEL,
  questionOrContext: QUESTION_SENTINEL,
};

type CallKind =
  | 'storyRelevance'
  | 'assessment'
  | 'npcMind'
  | 'adjudication'
  | 'privateConversation'
  | 'simulationState'
  | 'monologue'
  | 'narration'
  | 'relationshipUpdates';

interface CapturedCall {
  kind: CallKind;
  prompt: string;
  systemInstruction: string;
}

type ResponseOverride = string | ((prompt: string) => string);
type ResponseOverrides = Partial<Record<CallKind, ResponseOverride>>;

function classify(systemInstruction: string): CallKind {
  if (systemInstruction.includes('master storyteller and game master')) return 'storyRelevance';
  if (systemInstruction.includes('Action Assessor')) return 'assessment';
  if (systemInstruction.includes("character's own private mind")) return 'npcMind';
  if (systemInstruction.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
  if (systemInstruction.includes('secret observer')) return 'privateConversation';
  if (systemInstruction.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (systemInstruction.includes('the inner voice of')) return 'monologue';
  if (systemInstruction.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
  if (systemInstruction.includes('narrative analyst AI')) return 'relationshipUpdates';
  throw new Error(`submissionPrivacy fake could not classify: ${systemInstruction.slice(0, 160)}`);
}

function responseFor(kind: CallKind, prompt: string): string {
  switch (kind) {
    case 'storyRelevance':
      return JSON.stringify({
        spotlight_entities: [
          { entity_id: 'npc_a', reason: 'The army is restless.' },
          { entity_id: 'npc_b', reason: 'The Senate is divided.' },
        ],
        spotlight_intents: [
          { entity_id: 'npc_a', intent: 'Sound out the cohorts', continuity: 'new' },
          { entity_id: 'npc_b', intent: 'Count votes in private', continuity: 'new' },
        ],
      });
    case 'assessment':
      return JSON.stringify({
        is_consequential: false,
        action_category: 'administration',
        relevant_skill: null,
        difficulty: 10,
        opposing_entity_id: null,
        rationale: 'No hidden roll is needed for this fixture.',
      });
    case 'npcMind': {
      const entityId = prompt.includes('entity_id: npc_a') ? 'npc_a' : 'npc_b';
      return JSON.stringify({
        entity_id: entityId,
        chosen_action: entityId === 'npc_a' ? 'Inspect the cohorts.' : 'Meet wavering senators.',
        method: 'Quietly.',
        private_reasoning: 'I must act before my rival does.',
      });
    }
    case 'adjudication':
      return JSON.stringify({ turn: 7, entityActions: [], deltas: [], headlines: ['Rome waits.'], gm_private: [] });
    case 'privateConversation':
      return JSON.stringify({ dialogueSnippet: 'They exchange guarded words.', deltas: [] });
    case 'simulationState':
      return JSON.stringify(SIMULATION_STATE);
    case 'monologue':
      return 'I weigh what must remain unspoken.';
    case 'narration':
      return 'The week closes under a tense silence.\nSUGGESTION: Wait';
    case 'relationshipUpdates':
      return JSON.stringify({ deltas: [] });
  }
}

function makeHarness(overrides: ResponseOverrides = {}): { ai: GoogleGenAI; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const generateContent = vi.fn(async (params: {
    contents: string;
    config?: { systemInstruction?: unknown };
  }) => {
    const systemInstruction = typeof params.config?.systemInstruction === 'string'
      ? params.config.systemInstruction
      : '';
    const kind = classify(systemInstruction);
    calls.push({ kind, prompt: params.contents, systemInstruction });
    const override = overrides[kind];
    const text = typeof override === 'function'
      ? override(params.contents)
      : override ?? responseFor(kind, params.contents);
    return { text };
  });
  return {
    ai: { models: { generateContent } } as unknown as GoogleGenAI,
    calls,
  };
}

function startRealTurn(submission: TurnSubmission, overrides: ResponseOverrides = {}) {
  const harness = makeHarness(overrides);
  const { player, npcA, npcB } = makeCast();
  const resultPromise = runNewTurn(
    harness.ai,
    submission,
    player,
    7,
    [player, npcA, npcB],
    WORLD_STATE,
    SIMULATION_STATE,
    [],
    [],
    [],
    [],
    '',
    false,
    'A political thriller',
  );
  return { ...harness, resultPromise, player };
}

async function runRealTurn(submission: TurnSubmission, overrides: ResponseOverrides = {}) {
  const started = startRealTurn(submission, overrides);
  const result = await started.resultPromise;
  return { ...started, result };
}

function fullCallText(call: CapturedCall): string {
  return `${call.systemInstruction}\n${call.prompt}`;
}

afterEach(() => {
  endTurnCapture();
});

describe('runNewTurn submission visibility routing', () => {
  it('sends Private Intent only to adjudication and player-owned narration/monologue boundaries', async () => {
    const { calls, result, player } = await runRealTurn(FULL_SUBMISSION);
    const callsByKind = (kind: CallKind) => calls.filter(call => call.kind === kind);

    expect(callsByKind('adjudication')).toHaveLength(1);
    expect(callsByKind('narration')).toHaveLength(1);
    expect(callsByKind('monologue')).toHaveLength(1);
    for (const kind of ['adjudication', 'narration', 'monologue'] as const) {
      expect(fullCallText(callsByKind(kind)[0]), kind).toContain(PRIVATE_SENTINEL);
    }
    for (const kind of ['narration', 'monologue'] as const) {
      const text = fullCallText(callsByKind(kind)[0]);
      expect(text, kind).toContain(OBSERVABLE_SENTINEL);
      expect(text, kind).toContain(QUESTION_SENTINEL);
    }

    for (const kind of [
      'assessment',
      'storyRelevance',
      'npcMind',
      'privateConversation',
      'simulationState',
      'relationshipUpdates',
    ] as const) {
      expect(callsByKind(kind).length, `${kind} must be exercised`).toBeGreaterThan(0);
      for (const call of callsByKind(kind)) {
        expect(fullCallText(call), kind).not.toContain(PRIVATE_SENTINEL);
      }
    }

    const playerAfter = result.updatedEntities.find(entity => entity.entity_id === player.entity_id) ?? player;
    const perceivedChanges = buildPerceivedDigest(
      result.newHistoryEntry.adjudication.deltas,
      playerAfter,
      result.updatedEntities,
      result.updatedWorldState,
    );
    const knowledge = computeTurnKnowledge({
      prev: [],
      perceivedChanges,
      reportsBefore: [],
      reportsAfter: result.updatedReports,
      turnNumber: 7,
    });
    expect(JSON.stringify(perceivedChanges)).not.toContain(PRIVATE_SENTINEL);
    expect(JSON.stringify(knowledge)).not.toContain(PRIVATE_SENTINEL);
  });

  it('builds relationship updates from observable submission and adjudicated facts, never provider narration that echoes Private Intent', async () => {
    const adjudication = {
      turn: 7,
      entityActions: [],
      deltas: [{
        type: 'resource',
        key: 'npc_a:cohort_support',
        delta: 1,
        reason: SAFE_FACT_SENTINEL,
      }],
      headlines: [SAFE_HEADLINE_SENTINEL],
      gm_private: [],
    };
    const relationshipDelta = {
      type: 'relation',
      key: 'npc_a:player_1:trust_level',
      delta: 2,
      reason: 'Aulus responds to the observable public conduct.',
    };
    const { calls, result } = await runRealTurn(FULL_SUBMISSION, {
      adjudication: JSON.stringify(adjudication),
      narration: `${POISONED_NARRATION_SENTINEL}: ${PRIVATE_SENTINEL}\nSUGGESTION: Wait`,
      relationshipUpdates: JSON.stringify({ deltas: [relationshipDelta] }),
    });

    const relationshipPrompt = calls.find(call => call.kind === 'relationshipUpdates')?.prompt ?? '';
    expect(relationshipPrompt).toContain(OBSERVABLE_SENTINEL);
    expect(relationshipPrompt).toContain(SAFE_HEADLINE_SENTINEL);
    expect(relationshipPrompt).toContain(SAFE_FACT_SENTINEL);
    expect(relationshipPrompt).not.toContain(POISONED_NARRATION_SENTINEL);
    expect(relationshipPrompt).not.toContain(PRIVATE_SENTINEL);
    expect(
      result.updatedEntities
        .find(entity => entity.entity_id === 'npc_a')
        ?.relationships.player_1?.trust_level,
    ).toBe(2);
  });

  it('gives adjudication three separately labeled projections', async () => {
    const { calls } = await runRealTurn(FULL_SUBMISSION);
    const prompt = calls.find(call => call.kind === 'adjudication')?.prompt ?? '';

    expect(prompt).toContain(`observableAttempt:\n${OBSERVABLE_SENTINEL}`);
    expect(prompt).toContain(`privateIntent:\n${PRIVATE_SENTINEL}`);
    expect(prompt).toContain(`questionOrContext:\n${QUESTION_SENTINEL}`);
  });

  it('puts private-intent and question/context non-action guards in the adjudication and monologue system instructions', async () => {
    const { calls } = await runRealTurn(FULL_SUBMISSION);
    const adjudicationSystem = calls.find(call => call.kind === 'adjudication')?.systemInstruction ?? '';
    const monologueSystem = calls.find(call => call.kind === 'monologue')?.systemInstruction ?? '';

    expect(adjudicationSystem).toContain('Private Intent is player-owned goal context only');
    expect(adjudicationSystem).toContain('does not grant an action, modifier, fact, concealment, or NPC knowledge');
    expect(adjudicationSystem).toContain('Question/Context asks for a player-view answer only');
    expect(adjudicationSystem).toContain('must not investigate, act, or create a roll');
    expect(monologueSystem).toContain('player-owned context, not necessarily strategic actions');
    expect(monologueSystem).toContain('Never reinterpret Private Intent or Question/Context as an avatar action');
  });

  it.each([
    ['question-only', { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const],
    ['private-only', { version: 1, kind: 'structured', privateIntent: PRIVATE_SENTINEL } as const],
  ])('%s submissions skip assessment and resolution but still produce a GM response', async (_label, submission) => {
    const { calls, result } = await runRealTurn(submission);

    expect(calls.filter(call => call.kind === 'assessment')).toHaveLength(0);
    expect(result.newHistoryEntry.resolutionTrace).toBeUndefined();
    expect(result.narration).not.toBe('');
    expect(calls.find(call => call.kind === 'adjudication')?.prompt).not.toContain('PLAYER ACTION OUTCOME');
  });

  it('rejects a question-only adjudication with player-authored consequences, while a conforming NPC/world-only adjudication still commits', async () => {
    const playerArtifact = 'forbidden_question_artifact';
    const independentNpcResource = 'independent_preparations';
    const forbiddenPlayerAction = `${PRIVATE_SENTINEL}: the avatar investigates without permission.`;
    const poisoned = {
      turn: 7,
      entityActions: [
        { id: 'player_1', intent: 'intrigue', target: 'npc_a', notes: forbiddenPlayerAction },
        { id: 'npc_a', intent: 'recruit', target: 'cohorts', notes: 'Aulus independently courts the cohorts.' },
      ],
      deltas: [
        { type: 'resource', key: `player_1:${playerArtifact}`, delta: 1, reason: 'The fabricated inquiry creates an artifact.' },
        {
          type: 'rumor',
          key: 'npc_a',
          delta: 0.8,
          reason: 'A player-authored rumor artifact.',
          is_true: false,
          origin_id: 'player_1',
          topic: 'forbidden-question-artifact',
        },
        { type: 'relation', key: 'player_1:npc_a:trust_level', delta: 2, reason: 'The avatar autonomously changes their view.' },
        { type: 'resource', key: `npc_a:${independentNpcResource}`, delta: 2, reason: 'Aulus acts on his own agenda.' },
        { type: 'world', key: 'political_climate', delta: 0, reason: 'Legions Maneuver Independently' },
      ],
      headlines: ['Aulus moves among the cohorts.'],
      gm_private: [],
    };
    const submission = { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const;
    const started = startRealTurn(submission, { adjudication: JSON.stringify(poisoned) });
    let thrown: unknown;
    try {
      await started.resultPromise;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('player action boundary');
    expect((thrown as Error).message).not.toContain(PRIVATE_SENTINEL);

    const conforming = {
      ...poisoned,
      entityActions: [poisoned.entityActions[1]],
      deltas: poisoned.deltas.filter(delta =>
        delta.key === `npc_a:${independentNpcResource}` || delta.type === 'world'),
    };
    const { result } = await runRealTurn(submission, {
      adjudication: JSON.stringify(conforming),
    });

    expect(result.newHistoryEntry.adjudication.entityActions).toEqual([
      expect.objectContaining({ id: 'npc_a', intent: 'recruit' }),
    ]);
    expect(result.newHistoryEntry.adjudication.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resource', key: `npc_a:${independentNpcResource}` }),
      expect.objectContaining({ type: 'world', key: 'political_climate' }),
    ]));
    expect(
      result.updatedEntities.find(entity => entity.entity_id === 'npc_a')?.resources[independentNpcResource],
    ).toBe(2);
    expect(result.updatedWorldState.political_climate).toBe('Legions Maneuver Independently');
  });

  it.each([
    [
      'adjudication headline',
      {
        adjudication: JSON.stringify({
          turn: 7,
          entityActions: [],
          deltas: [],
          headlines: ['The hidden action result was critical_success after a roll of 20.'],
          gm_private: ['critical_success and roll 20 remain valid in this GM-only trace.'],
        }),
      },
      'critical_success',
    ],
    [
      'narration',
      {
        narration: 'The hidden action result was partial_success after the die rolled 14.\nSUGGESTION: Wait',
      },
      'partial_success',
    ],
  ])('rejects mechanical leakage from provider-authored %s without echoing the token in the error', async (_label, overrides, forbiddenToken) => {
    const started = startRealTurn(FULL_SUBMISSION, overrides);
    let thrown: unknown;
    try {
      await started.resultPromise;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('player-visible mechanics boundary');
    expect((thrown as Error).message).not.toContain(forbiddenToken);
    expect(started.calls.some(call => call.kind === 'adjudication')).toBe(true);
  });

  it.each([
    ['legacy freeform', { version: 1, kind: 'freeform', text: 'Hold court' } as const],
    ['structured', FULL_SUBMISSION],
  ])('real and mock modes persist the same canonical playerIntent for %s submissions', async (_label, submission) => {
    const real = await runRealTurn(submission);
    const { player, npcA, npcB } = makeCast();
    const mock = await runNewTurn(
      { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI,
      submission,
      player,
      7,
      [player, npcA, npcB],
      WORLD_STATE,
      SIMULATION_STATE,
      [],
      [],
      [],
      [],
      '',
      true,
      'A political thriller',
    );
    const canonical = serializeTurnSubmission(submission);

    expect(real.result.newHistoryEntry.playerIntent).toBe(canonical);
    expect(mock.newHistoryEntry.playerIntent).toBe(canonical);
    expect(mock.newHistoryEntry.playerIntent).toBe(real.result.newHistoryEntry.playerIntent);
    if (submission.kind === 'freeform') {
      expect(canonical).toBe(submission.text);
    }
  });

  it.each([
    ['private-only', { version: 1, kind: 'structured', privateIntent: PRIVATE_SENTINEL } as const],
    ['question-only', { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const],
  ])('mock mode does not call a %s submission an action', async (_label, submission) => {
    const { player, npcA, npcB } = makeCast();
    const mock = await runNewTurn(
      { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI,
      submission,
      player,
      7,
      [player, npcA, npcB],
      WORLD_STATE,
      SIMULATION_STATE,
      [],
      [],
      [],
      [],
      '',
      true,
      'A political thriller',
    );

    expect(mock.narration).not.toContain('Your action');
    expect(mock.narration).toContain(_label === 'private-only' ? 'private intent' : 'question');
    expect(mock.narration).toContain('No action is taken');
  });

  it.each([
    ['private-only', { version: 1, kind: 'structured', privateIntent: PRIVATE_SENTINEL } as const],
    ['question-only', { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const],
  ])('mock mode commits no player-origin rumor artifact or derivative state for a %s submission', async (_label, submission) => {
    const { player, npcA, npcB } = makeCast();
    const mock = await runNewTurn(
      { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI,
      submission,
      player,
      7,
      [player, npcA, npcB],
      WORLD_STATE,
      SIMULATION_STATE,
      [],
      [],
      [],
      [],
      '',
      true,
      'A political thriller',
    );

    const playerRumor = mock.newHistoryEntry.adjudication.deltas.find(delta => delta.type === 'rumor' && delta.origin_id === player.entity_id);
    expect(playerRumor).toBeUndefined();
    expect(mock.newHistoryEntry.adjudication.entityActions.some(action => action.id === player.entity_id)).toBe(false);
    expect(mock.updatedTruthLedger.some(entry => entry.originId === player.entity_id)).toBe(false);
    expect(mock.updatedReports.some(report => mock.updatedTruthLedger.some(entry => entry.originId === player.entity_id && entry.reportId === report.id))).toBe(false);
    expect(mock.updatedEntities.find(entity => entity.entity_id === player.entity_id)).toEqual(player);
  });

  it('mock mode retains the player-origin rumor artifact for an observable action', async () => {
    const { player, npcA, npcB } = makeCast();
    const mock = await runNewTurn(
      { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI,
      { version: 1, kind: 'structured', actions: [OBSERVABLE_SENTINEL] },
      player,
      7,
      [player, npcA, npcB],
      WORLD_STATE,
      SIMULATION_STATE,
      [],
      [],
      [],
      [],
      '',
      true,
      'A political thriller',
    );

    expect(mock.newHistoryEntry.adjudication.deltas).toContainEqual(expect.objectContaining({ type: 'rumor', origin_id: player.entity_id }));
    expect(mock.updatedTruthLedger).toContainEqual(expect.objectContaining({ originId: player.entity_id }));
  });
});
