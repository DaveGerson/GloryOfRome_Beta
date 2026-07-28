import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { Entity, SimulationState, TurnHistoryEntry, TurnSubmission, WorldState } from '../types';

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

function makeCast(): { player: Entity; npcA: Entity } {
  const player = makeEntity();
  const npcA = makeEntity({
    entity_id: 'npc_a',
    name: 'Aulus',
    position: 'General',
    location: 'Camp',
  });
  return { player, npcA };
}

type CallKind =
  | 'storyRelevance'
  | 'assessment'
  | 'npcMind'
  | 'adjudication'
  | 'simulationState'
  | 'monologue'
  | 'narration';

interface CapturedCall {
  kind: CallKind;
  prompt: string;
  systemInstruction: string;
}

function classify(systemInstruction: string): CallKind {
  if (systemInstruction.includes('master storyteller and game master')) return 'storyRelevance';
  if (systemInstruction.includes('Action Assessor')) return 'assessment';
  if (systemInstruction.includes("character's own private mind")) return 'npcMind';
  if (systemInstruction.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
  if (systemInstruction.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (systemInstruction.includes('the inner voice of')) return 'monologue';
  if (systemInstruction.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
  throw new Error(`monologueContext fake could not classify: ${systemInstruction.slice(0, 160)}`);
}

function responseFor(kind: CallKind): string {
  switch (kind) {
    case 'storyRelevance':
      return JSON.stringify({
        spotlight_entities: [],
        spotlight_intents: [],
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
    case 'npcMind':
      return JSON.stringify({
        entity_id: 'npc_a',
        chosen_action: 'Inspect the cohorts.',
        method: 'Quietly.',
        private_reasoning: 'I must act before my rival does.',
      });
    case 'adjudication':
      return JSON.stringify({
        turn: 7,
        entityActions: [],
        deltas: [],
        headlines: [{ text: 'Rome waits.', actors: [] }],
        gm_private: [],
      });
    case 'simulationState':
      // Raw provider interchange (zSimulationState): the committed
      // SIMULATION_STATE fixture plus the actors-attribution sibling a real
      // captured response carries.
      return JSON.stringify({ ...SIMULATION_STATE, actors: [] });
    case 'monologue':
      return 'I weigh what must remain unspoken.';
    case 'narration':
      return 'The week closes under a tense silence.\nSUGGESTION: Wait';
  }
}

function makeHarness(): { ai: GoogleGenAI; calls: CapturedCall[] } {
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
    return { text: responseFor(kind) };
  });
  return {
    ai: { models: { generateContent } } as unknown as GoogleGenAI,
    calls,
  };
}

function fullCallText(call: CapturedCall): string {
  return `${call.systemInstruction}\n${call.prompt}`;
}

afterEach(() => {
  endTurnCapture();
});

describe('monologue context re-projection', () => {
  it('re-projects serialized history submissions for the monologue: no namespace, no entity ids, private intent retained', async () => {
    const harness = makeHarness();
    const { player, npcA } = makeCast();

    const historySubmission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['HISTORY_ACTION_SENTINEL'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'npc_a', displayName: 'Aulus' },
        command: 'Watch the gate.',
      }],
      privateIntent: 'HISTORY_PRIVATE_SENTINEL',
    };

    const turnHistory: TurnHistoryEntry[] = [
      {
        turnNumber: 4,
        playerIntent: serializeTurnSubmission(historySubmission),
        adjudication: { turn: 4, entityActions: [], deltas: [], headlines: [], gm_private: [] },
        narration: '',
      },
      {
        turnNumber: 5,
        playerIntent: 'March on the camp at dawn',
        adjudication: { turn: 5, entityActions: [], deltas: [], headlines: [], gm_private: [] },
        narration: '',
      },
      {
        turnNumber: 6,
        playerIntent: 'GOR_TURN_SUBMISSION/1\n{"garbage":true}',
        adjudication: { turn: 6, entityActions: [], deltas: [], headlines: [], gm_private: [] },
        narration: '',
      },
    ];

    const currentSubmission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['CURRENT_ACTION_SENTINEL'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'npc_a', displayName: 'Aulus' },
        command: 'Hold the line.',
      }],
    };

    await runNewTurn(
      harness.ai,
      currentSubmission,
      player,
      7,
      [player, npcA],
      WORLD_STATE,
      SIMULATION_STATE,
      turnHistory,
      [],
      [],
      [],
      '',
      false,
      'A political thriller',
    );

    const monologueCall = harness.calls.find(call => call.kind === 'monologue');
    expect(monologueCall).toBeDefined();
    const text = fullCallText(monologueCall!);

    expect(text).not.toContain('GOR_TURN_SUBMISSION');
    expect(text).not.toContain('[npc_a]');
    expect(text).toContain('HISTORY_PRIVATE_SENTINEL');
    expect(text).toContain('HISTORY_ACTION_SENTINEL');
    expect(text).toContain('Aulus');
    expect(text).toContain('March on the camp at dawn');
    expect(text).not.toContain('"garbage"');
    expect(text).toContain('CURRENT_ACTION_SENTINEL');
  });

  it('mock mode passes the same reflection projection to the mock monologue', async () => {
    const { player, npcA } = makeCast();
    const stubAi = { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI;

    const currentSubmission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['CURRENT_ACTION_SENTINEL'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'npc_a', displayName: 'Aulus' },
        command: 'Hold the line.',
      }],
    };

    const result = await runNewTurn(
      stubAi,
      currentSubmission,
      player,
      7,
      [player, npcA],
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

    expect(result.playerMonologue).not.toContain('[npc_a]');
    expect(result.playerMonologue).not.toContain('GOR_TURN_SUBMISSION');
    expect(result.playerMonologue).toContain('Aulus');
  });
});
