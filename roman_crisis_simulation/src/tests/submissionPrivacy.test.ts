import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { buildPerceivedDigest } from '../perception/visibility';
import { computeTurnKnowledge } from '../knowledge/commit';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { Entity, EventDelta, SimulationState, TurnSubmission, WorldState } from '../types';

const OBSERVABLE_SENTINEL = 'OBSERVABLE_ATTEMPT_SENTINEL_6T2';
const PRIVATE_SENTINEL = 'PRIVATE_INTENT_SENTINEL_6T2';
const QUESTION_SENTINEL = 'QUESTION_CONTEXT_SENTINEL_6T2';
const SAFE_HEADLINE_SENTINEL = 'SAFE_PUBLIC_HEADLINE_SENTINEL_6T2';
const SAFE_FACT_SENTINEL = 'SAFE_ADJUDICATED_FACT_SENTINEL_6T2';
const PRIVATE_PARAPHRASE = 'The emperor quietly tests which senators can be trusted.';
const QUESTION_PARAPHRASE = 'The sparse benches betray weakness in tomorrow\'s vote.';

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

async function runMockTurn(submission: TurnSubmission) {
  const { player, npcA, npcB } = makeCast();
  const result = await runNewTurn(
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
  return { result, player };
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
    expect(result.narration).toBe('The week closes under a tense silence.');
    expect(result.playerMonologue).toBe('I weigh what must remain unspoken.');
  });

  it('uses observable submission as the only turn-event prose for legitimate relationship updates', async () => {
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
      narration: 'The public audience ends without incident.\nSUGGESTION: Wait',
      relationshipUpdates: JSON.stringify({ deltas: [relationshipDelta] }),
    });

    const relationshipPrompt = calls.find(call => call.kind === 'relationshipUpdates')?.prompt ?? '';
    expect(relationshipPrompt).toContain(OBSERVABLE_SENTINEL);
    expect(relationshipPrompt).not.toContain(SAFE_HEADLINE_SENTINEL);
    expect(relationshipPrompt).not.toContain(SAFE_FACT_SENTINEL);
    expect(relationshipPrompt).not.toContain(PRIVATE_SENTINEL);
    expect(relationshipPrompt).not.toContain(QUESTION_SENTINEL);
    expect(
      result.updatedEntities
        .find(entity => entity.entity_id === 'npc_a')
        ?.relationships.player_1?.trust_level,
    ).toBe(2);
  });

  it.each([
    ['Private Intent paraphrase in a headline', {
      turn: 7,
      entityActions: [],
      deltas: [],
      headlines: [PRIVATE_PARAPHRASE],
      gm_private: [],
    }, PRIVATE_PARAPHRASE],
    ['Question/Context paraphrase in an action note and delta reason', {
      turn: 7,
      entityActions: [{ id: 'npc_a', intent: 'intrigue', target: 'npc_b', notes: QUESTION_PARAPHRASE }],
      deltas: [{ type: 'resource', key: 'npc_a:vote_count', delta: 1, reason: QUESTION_PARAPHRASE }],
      headlines: ['The Senate gathers.'],
      gm_private: [],
    }, QUESTION_PARAPHRASE],
  ])('never launders provider-authored %s into relationship evidence', async (_label, adjudication, poison) => {
    const relationshipDelta = {
      type: 'relation',
      key: 'npc_a:player_1:trust_level',
      delta: 1,
      reason: 'Aulus responds to the observable public order.',
    };
    const { calls, result } = await runRealTurn(FULL_SUBMISSION, {
      adjudication: JSON.stringify(adjudication),
      narration: 'The public audience ends without incident.\nSUGGESTION: Wait',
      relationshipUpdates: JSON.stringify({ deltas: [relationshipDelta] }),
    });

    const relationshipPrompt = calls.find(call => call.kind === 'relationshipUpdates')?.prompt ?? '';
    expect(relationshipPrompt).toContain(OBSERVABLE_SENTINEL);
    expect(relationshipPrompt).not.toContain(poison);
    expect(
      result.updatedEntities.find(entity => entity.entity_id === 'npc_a')?.relationships.player_1?.trust_level,
    ).toBe(1);
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
    ['question-plus-private', {
      version: 1,
      kind: 'structured',
      questionOrContext: QUESTION_SENTINEL,
      privateIntent: PRIVATE_SENTINEL,
    } as const],
  ])('%s submissions advance NPC/world state without freeform player prose', async (_label, submission) => {
    const independentNpcResource = 'independent_preparations';
    const { calls, result } = await runRealTurn(submission, {
      adjudication: JSON.stringify({
        turn: 7,
        entityActions: [{
          id: 'npc_a',
          intent: 'recruit',
          target: 'cohorts',
          notes: 'Aulus independently courts the cohorts.',
        }],
        deltas: [
          {
            type: 'resource',
            key: `npc_a:${independentNpcResource}`,
            delta: 2,
            reason: 'Aulus acts on his own agenda.',
          },
          {
            type: 'world',
            key: 'political_climate',
            delta: 0,
            reason: 'Legions Maneuver Independently',
          },
        ],
        headlines: ['Aulus moves among the cohorts.'],
        gm_private: [],
      }),
      monologue: 'I order an attack after rolling 20. PRIVATE_OUTPUT_POISON',
      narration: 'You order an attack after rolling 20.\nSUGGESTION: Exploit PRIVATE_OUTPUT_POISON',
    });

    expect(calls.filter(call => call.kind === 'assessment')).toHaveLength(0);
    expect(calls.filter(call => call.kind === 'storyRelevance')).toHaveLength(1);
    expect(calls.filter(call => call.kind === 'npcMind')).toHaveLength(2);
    expect(calls.filter(call => call.kind === 'privateConversation')).toHaveLength(1);
    expect(calls.filter(call => call.kind === 'adjudication')).toHaveLength(1);
    expect(calls.filter(call => call.kind === 'simulationState')).toHaveLength(1);
    expect(calls.filter(call => call.kind === 'monologue')).toHaveLength(0);
    expect(calls.filter(call => call.kind === 'narration')).toHaveLength(0);
    expect(calls.filter(call => call.kind === 'relationshipUpdates')).toHaveLength(0);
    expect(result.newHistoryEntry.resolutionTrace).toBeUndefined();
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
    expect(result.suggestedActions).toEqual([
      'Consider your next move carefully.',
      'Consolidate your power.',
      'Seek new allies.',
    ]);
    expect(result.newHistoryEntry.narration).toBe('');
    expect(typeof result.newHistoryEntry.turnSeed).toBe('number');
    expect(result.updatedNpcIntents).toHaveLength(2);
    expect(
      result.updatedEntities.find(entity => entity.entity_id === 'npc_a')?.resources[independentNpcResource],
    ).toBe(2);
    expect(result.updatedWorldState.political_climate).toBe('Legions Maneuver Independently');
    expect(result.newHistoryEntry.adjudication.entityActions).toEqual([
      expect.objectContaining({ id: 'npc_a', intent: 'recruit' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT_POISON');
    const adjudicationPrompt = calls.find(call => call.kind === 'adjudication')?.prompt ?? '';
    expect(adjudicationPrompt).not.toContain('PLAYER ACTION OUTCOME');
    expect(adjudicationPrompt).not.toContain(QUESTION_SENTINEL);
    expect(adjudicationPrompt).not.toContain(PRIVATE_SENTINEL);
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
    ['resource', { type: 'resource', key: 'player_1:question_artifact', delta: 1, reason: 'An unexplained artifact appears.' }],
    ['relation', { type: 'relation', key: 'PLAYER-1:npc_a:trust_level', delta: 1, reason: 'A new opinion forms.' }],
    ['status', { type: 'status', key: 'GaIuS TeStUs', delta: 0, reason: 'The emperor departs.', new_status: 'exiled' }],
    ['rumor origin', { type: 'rumor', key: 'npc_a', delta: 0.7, reason: 'A claim spreads.', is_true: false, origin_id: 'PLAYER-1', topic: 'loyalty' }],
    ['scheme', { type: 'scheme', key: 'PLAYER_1', delta: 0, reason: JSON.stringify({ name: 'A hidden design', overall_goal: 'Gain leverage', steps: [] }) }],
    ['faction', { type: 'faction', key: 'player_1', delta: 0, reason: 'npc_a' }],
    ['region', { type: 'region', key: 'Rome:stability', delta: 0, reason: 'Gaius Testus orders the city sealed.' }],
    ['world', { type: 'world', key: 'political_climate', delta: 0, reason: 'Gaius Testus decrees emergency rule.' }],
    ['add_region', { type: 'add_region', key: 'Imperial Enclave', delta: 0, reason: JSON.stringify({ stability: 'Gaius Testus orders a new enclave.', controlling_faction: null, current_events: [] }) }],
    ['remove_region', { type: 'remove_region', key: 'Camp', delta: 0, reason: 'Gaius Testus orders the camp dissolved.' }],
  ] satisfies Array<[string, EventDelta]>)('rejects a no-attempt %s consequence as a whole response', async (_label, delta) => {
    const submission = { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const;
    const started = startRealTurn(submission, {
      adjudication: JSON.stringify({
        turn: 7,
        entityActions: [],
        deltas: [delta],
        headlines: ['The week advances.'],
        gm_private: [],
      }),
    });

    let thrown: unknown;
    try {
      await started.resultPromise;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AI output violated the player action boundary.');
    expect((thrown as Error).message).not.toContain('Gaius Testus');
  });

  it.each([
    ['miscased player id', { id: 'PLAYER_1', intent: 'intrigue', target: 'npc_a', notes: 'An unattributed inquiry begins.' }],
    ['missing actor id with player-attributed prose', { id: '', intent: 'intrigue', target: 'npc_a', notes: 'Gaius Testus dispatches spies into the Curia.' }],
  ])('rejects a no-attempt entity action with %s', async (_label, action) => {
    const submission = { version: 1, kind: 'structured', privateIntent: PRIVATE_SENTINEL } as const;
    const started = startRealTurn(submission, {
      adjudication: JSON.stringify({
        turn: 7,
        entityActions: [action],
        deltas: [],
        headlines: ['The week advances.'],
        gm_private: [],
      }),
    });

    await expect(started.resultPromise).rejects.toThrow('player action boundary');
  });

  it('rejects a headline-only invented avatar action on a no-attempt turn', async () => {
    const inventedHeadline = 'Gaius Testus dispatches agents to count tomorrow\'s votes.';
    const started = startRealTurn(
      { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL },
      {
        adjudication: JSON.stringify({
          turn: 7,
          entityActions: [],
          deltas: [],
          headlines: [inventedHeadline],
          gm_private: [],
        }),
      },
    );

    let thrown: unknown;
    try {
      await started.resultPromise;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AI output violated the player action boundary.');
    expect((thrown as Error).message).not.toContain(inventedHeadline);
  });

  it('never requests a poisoned narration for a no-attempt turn', async () => {
    const inventedNarration = 'You dispatch spies into the Curia and order them to count tomorrow\'s votes.';
    const { calls, result } = await runRealTurn(
      { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL },
      { narration: `${inventedNarration}\nSUGGESTION: Wait` },
    );

    expect(calls.some(call => call.kind === 'narration')).toBe(false);
    expect(result.narration).toBe('');
    expect(JSON.stringify(result)).not.toContain(inventedNarration);
  });

  it('rejects hidden mechanics in the updated simulation crisis before relationship updates or commit', async () => {
    const poison = 'Civil war decided by 1d20';
    const started = startRealTurn(FULL_SUBMISSION, {
      simulationState: JSON.stringify({ ...SIMULATION_STATE, major_ongoing_crisis: poison }),
    });

    let thrown: unknown;
    try {
      await started.resultPromise;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AI output violated the player-visible mechanics boundary.');
    expect((thrown as Error).message).not.toContain(poison);
    expect(started.calls.some(call => call.kind === 'relationshipUpdates')).toBe(false);
  });

  it.each(['player_1', 'GAIUS TESTUS', 'the emperor'])(
    'rejects updatedSimulationState.remove_entities targeting player alias %s, then retries without partial commit',
    async removedAlias => {
      const submission = { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const;
      const started = startRealTurn(submission, {
        simulationState: JSON.stringify({ ...SIMULATION_STATE, remove_entities: [removedAlias] }),
      });

      let thrown: unknown;
      try {
        await started.resultPromise;
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('AI output violated the player action boundary.');
      expect((thrown as Error).message).not.toContain(removedAlias);
      expect(started.calls.some(call => call.kind === 'relationshipUpdates')).toBe(false);

      const retry = await runRealTurn(submission);
      expect(retry.result.updatedEntities).toContainEqual(expect.objectContaining({ entity_id: 'player_1' }));
      expect(retry.result.newHistoryEntry.playerIntent).toBe(serializeTurnSubmission(submission));
    },
  );

  it('commits an NPC-authored rumor about the player on a no-attempt turn because the subject key is not authorship', async () => {
    const submission = { version: 1, kind: 'structured', questionOrContext: QUESTION_SENTINEL } as const;
    const { result, calls } = await runRealTurn(submission, {
      adjudication: JSON.stringify({
        turn: 7,
        entityActions: [],
        deltas: [{
          type: 'rumor',
          key: 'PLAYER-1',
          delta: 0.7,
          reason: 'Aulus claims the emperor is losing the Senate.',
          is_true: false,
          origin_id: 'NPC_A',
          topic: 'senate-support',
        }],
        headlines: ['A hostile rumor spreads through the Curia.'],
        gm_private: [],
      }),
    });

    expect(result.newHistoryEntry.adjudication.deltas).toContainEqual(
      expect.objectContaining({ type: 'rumor', key: 'PLAYER-1', origin_id: 'NPC_A' }),
    );
    expect(result.updatedReports).toContainEqual(expect.objectContaining({ about: 'PLAYER-1' }));
    expect(calls.some(call => call.kind === 'relationshipUpdates')).toBe(false);
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
    ['question-plus-private', {
      version: 1,
      kind: 'structured',
      privateIntent: PRIVATE_SENTINEL,
      questionOrContext: QUESTION_SENTINEL,
    } as const],
  ])('mock mode suppresses no-attempt presentation for %s while preserving the simulated turn', async (_label, submission) => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { result: mock } = await runMockTurn(submission);

      expect(mock.narration).toBe('');
      expect(mock.playerMonologue).toBe('');
      expect(mock.suggestedActions).toEqual([
        'Consider your next move carefully.',
        'Consolidate your power.',
        'Seek new allies.',
      ]);
      expect(mock.newHistoryEntry.narration).toBe('');
      expect(mock.newHistoryEntry.playerIntent).toBe(serializeTurnSubmission(submission));
      expect(mock.newHistoryEntry.adjudication.entityActions).toHaveLength(2);
      expect(mock.newHistoryEntry.adjudication.deltas.length).toBeGreaterThan(0);
      expect(mock.updatedWorldState.regions['Temple of Jupiter']).toBeDefined();
      expect(mock.updatedEntities).toContainEqual(expect.objectContaining({ entity_id: 'flavius_fulco' }));
      expect(mock.updatedSimulationState).toEqual(SIMULATION_STATE);
      expect(mock.headlines).toEqual(mock.newHistoryEntry.adjudication.headlines);
      expect(consoleLog).not.toHaveBeenCalledWith('--- MOCK PLAYER MONOLOGUE ---');
    } finally {
      consoleLog.mockRestore();
    }
  });

  it('mock mode preserves observable Action + Question + Private Intent presentation and mechanics', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { result: mock, player } = await runMockTurn(FULL_SUBMISSION);

      expect(consoleLog).toHaveBeenCalledWith('--- MOCK PLAYER MONOLOGUE ---');
      expect(mock.narration).toContain(OBSERVABLE_SENTINEL);
      expect(mock.playerMonologue).toContain(OBSERVABLE_SENTINEL);
      expect(mock.playerMonologue).toContain(PRIVATE_SENTINEL);
      expect(mock.playerMonologue).toContain(QUESTION_SENTINEL);
      expect(mock.suggestedActions).toEqual([
        "Mock: Investigate Thrax's rumors",
        'Mock: Send a message to the Senate',
        'Mock: Try to bribe the Praetorians',
      ]);
      expect(mock.newHistoryEntry.narration).toBe(mock.narration);
      expect(mock.newHistoryEntry.adjudication.deltas).toContainEqual(
        expect.objectContaining({ type: 'rumor', origin_id: player.entity_id }),
      );
      expect(mock.updatedTruthLedger).toContainEqual(expect.objectContaining({ originId: player.entity_id }));
      expect(mock.updatedWorldState.regions['Temple of Jupiter']).toBeDefined();
      expect(mock.updatedEntities).toContainEqual(expect.objectContaining({ entity_id: 'flavius_fulco' }));
    } finally {
      consoleLog.mockRestore();
    }
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
