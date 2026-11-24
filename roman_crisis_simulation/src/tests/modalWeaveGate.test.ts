import { describe, expect, it, vi } from 'vitest';
import {
  recordWovenEvents,
  isEventEligible,
  checkForTriggeredEvent,
} from '../events/engine';
import { ALL_EVENTS } from '../constants/events';
import { stripActorsFromAdjudication, type AdjudicationInterchange } from '../ai/core/actorsBoundary';
import { buildHistoricalMaterialBlock } from '../ai/prompts/adjudication';
import { sanitizeAdjudicationForNarration } from '../ai/prompts/narration';
import { gameReducer, createInitialGameState } from '../state/gameReducer';
import { runNewTurn } from '../ai/core/turn';
import type { GeminiClient } from '../ai/core/geminiService';
import {
  makeEntity,
  makeWorldState,
  makeSimulationState,
} from './factories';

describe('1B: D12 Modal-Weave Cooldown Gate', () => {
  it('recordWovenEvents records both triggeredEventIds and eventFirings at turnNumber without mutating inputs', () => {
    const initialIds: string[] = [];
    const initialFirings: ReturnType<typeof recordWovenEvents>['eventFirings'] = [];

    const after = recordWovenEvents(
      initialIds,
      initialFirings,
      ['grain_shortage', 'grain_shortage', 'gordian_stirrings'],
      5,
    );

    expect(initialIds).toEqual([]);
    expect(initialFirings).toEqual([]);
    expect(after.triggeredEventIds).toEqual(['grain_shortage', 'gordian_stirrings']);
    expect(after.eventFirings).toEqual([
      { eventId: 'grain_shortage', lastFiredTurn: 5, timesFired: 1 },
      { eventId: 'gordian_stirrings', lastFiredTurn: 5, timesFired: 1 },
    ]);

    const repeatable = ALL_EVENTS.find(e => e.id === 'grain_shortage')!;
    const oneShot = ALL_EVENTS.find(e => e.id === 'gordian_stirrings')!;

    // Repeatable is suppressed during its cooldown window (turns 5..14), re-eligible at 5 + cooldownTurns.
    expect(isEventEligible(repeatable, after.eventFirings, 5)).toBe(false);
    expect(isEventEligible(repeatable, after.eventFirings, 5 + (repeatable.cooldownTurns ?? 0) - 1)).toBe(false);
    expect(isEventEligible(repeatable, after.eventFirings, 5 + (repeatable.cooldownTurns ?? 0))).toBe(true);

    // One-shot stays suppressed permanently once woven.
    expect(isEventEligible(oneShot, after.eventFirings, 100)).toBe(false);

    // checkForTriggeredEvent fires grain_shortage cleanly on an unfired roster containing its cast,
    // and skips it once recordWovenEvents stamps after.eventFirings.
    const player = makeEntity({ entity_id: 'player_1', name: 'Severus' });
    const senatorialParty = makeEntity({ entity_id: 'senatorial_party', name: 'Senatorial Party', entity_type: 'faction' });
    const romanSenate = makeEntity({ entity_id: 'roman_senate', name: 'Roman Senate', entity_type: 'group' });
    const failingWorld = makeWorldState({ economic_stability: 'Failing', week: 5 });
    const roster = [player, senatorialParty, romanSenate];
    const unfired = checkForTriggeredEvent(failingWorld, roster, [], player, makeSimulationState(), 5);
    expect(unfired?.id).toBe('grain_shortage');

    const triggered = checkForTriggeredEvent(failingWorld, roster, after.eventFirings, player, makeSimulationState(), 5);
    expect(triggered).toBeNull();
  });

  it('recordWovenEvents trims and drops blank/whitespace ids, and sanitizeAdjudicationForNarration strips woven_event_ids', () => {
    const cleaned = recordWovenEvents([], [], ['  ', '', '  grain_shortage  '], 3);
    expect(cleaned.triggeredEventIds).toEqual(['grain_shortage']);
    expect(cleaned.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 1 }]);

    const sanitized = sanitizeAdjudicationForNarration({
      turn: 3,
      entityActions: [],
      deltas: [],
      headlines: ['Bread prices rise.'],
      gm_private: ['secret note'],
      woven_event_ids: ['grain_shortage'],
    });
    expect('woven_event_ids' in sanitized).toBe(false);
    expect('gm_private' in sanitized).toBe(false);
  });

  it('stripActorsFromAdjudication deduplicates and trims woven_event_ids, and drops empty/null values', () => {
    const interchange: AdjudicationInterchange = {
      turn: 4,
      entityActions: [],
      deltas: [],
      headlines: [],
      gm_private: [],
      woven_event_ids: [' grain_shortage ', 'grain_shortage', '', '  '],
    };
    const stripped = stripActorsFromAdjudication(interchange);
    expect(stripped.woven_event_ids).toEqual(['grain_shortage']);

    const nullWoven: AdjudicationInterchange = {
      ...interchange,
      woven_event_ids: null,
    };
    expect('woven_event_ids' in stripActorsFromAdjudication(nullWoven)).toBe(false);
  });

  it('buildHistoricalMaterialBlock documents woven_event_ids for RIPE entries and warns against NEAR ids', () => {
    const block = buildHistoricalMaterialBlock([
      { id: 'grain_shortage', title: 'Grain Shortage', premise: 'Famine looms.', status: 'ripe' },
    ]);
    expect(block).toContain('woven_event_ids');
    expect(block).toContain('never list NEAR ids');
  });

  it('gameReducer TURN_COMMITTED applies optional woven event bookkeeping when provided and preserves prior when omitted', () => {
    const state = {
      ...createInitialGameState(),
      triggeredEventIds: ['existing_ev'],
      eventFirings: [{ eventId: 'existing_ev', lastFiredTurn: 2, timesFired: 1 }],
    };

    const withWoven = gameReducer(state, {
      type: 'TURN_COMMITTED',
      entities: state.entities,
      worldState: state.worldState,
      simulationState: state.simulationState,
      reports: state.reports,
      truthLedger: state.truthLedger,
      knowledge: state.knowledge,
      npcIntents: state.npcIntents,
      privateScenes: state.privateScenes,
      turnNumber: 4,
      turnHistory: [],
      playerMessage: { sender: 'player', text: 'Act' },
      gmMessage: { sender: 'gm', text: 'Done' },
      monologueMessage: null,
      ribbonMessage: { sender: 'ribbon', text: 'Week IV' },
      suggestedActions: [],
      currentEvents: [],
      triggeredEventIds: ['existing_ev', 'grain_shortage'],
      eventFirings: [
        { eventId: 'existing_ev', lastFiredTurn: 2, timesFired: 1 },
        { eventId: 'grain_shortage', lastFiredTurn: 4, timesFired: 1 },
      ],
    });
    expect(withWoven.triggeredEventIds).toEqual(['existing_ev', 'grain_shortage']);
    expect(withWoven.eventFirings).toHaveLength(2);

    const withoutWoven = gameReducer(withWoven, {
      type: 'TURN_COMMITTED',
      entities: withWoven.entities,
      worldState: withWoven.worldState,
      simulationState: withWoven.simulationState,
      reports: withWoven.reports,
      truthLedger: withWoven.truthLedger,
      knowledge: withWoven.knowledge,
      npcIntents: withWoven.npcIntents,
      privateScenes: withWoven.privateScenes,
      turnNumber: 5,
      turnHistory: [],
      playerMessage: { sender: 'player', text: 'Next' },
      gmMessage: { sender: 'gm', text: 'Calm' },
      monologueMessage: null,
      ribbonMessage: { sender: 'ribbon', text: 'Week V' },
      suggestedActions: [],
      currentEvents: [],
    });
    expect(withoutWoven.triggeredEventIds).toEqual(['existing_ev', 'grain_shortage']);
    expect(withoutWoven.eventFirings).toHaveLength(2);
  });

  it('runNewTurn accepts only RIPE woven_event_ids and strips NEAR or invented ids', async () => {
    const player = makeEntity({ entity_id: 'player_1', name: 'Severus Alexander', entity_type: 'individual' });
    const guard = makeEntity({
      entity_id: 'praetorian_guard',
      name: 'Praetorian Guard',
      entity_type: 'group',
      relationships: {
        player_1: { entity_id: 'player_1', relationship_type: 'patron', trust_level: -4, recent_interactions: [] },
        rival_1: { entity_id: 'rival_1', relationship_type: 'ally', trust_level: 8, recent_interactions: [] },
      },
    });
    const rival = makeEntity({ entity_id: 'rival_1', name: 'Thrax', entity_type: 'individual', status: 'alive' });
    const senatorialParty = makeEntity({ entity_id: 'senatorial_party', name: 'Senatorial Party', entity_type: 'faction' });
    const romanSenate = makeEntity({ entity_id: 'roman_senate', name: 'Roman Senate', entity_type: 'faction' });
    // Failing economy => grain_shortage is RIPE when unfired; whispers_of_mutiny last fired at turn 2 with cooldown 12 is NEAR at turn 12 (turnsUntilEligible = 2 <= NEAR_COOLDOWN_WINDOW 3).
    const world = makeWorldState({ economic_stability: 'Failing', week: 5 });
    const sim = makeSimulationState();
    const firings = [{ eventId: 'whispers_of_mutiny', lastFiredTurn: 2, timesFired: 1 }];

    const schemaJson = (config?: Record<string, unknown>) => JSON.stringify(config?.responseSchema ?? '');
    const ai: GeminiClient = {
      models: {
        generateContent: vi.fn(async (params: { config?: Record<string, unknown> }) => {
          const schema = schemaJson(params.config);
          if (schema.includes('spotlight_entities')) {
            return { text: JSON.stringify({ spotlight_entities: [], spotlight_intents: [] }) };
          }
          if (schema.includes('is_consequential')) {
            return {
              text: JSON.stringify({
                is_consequential: false,
                action_category: 'observation',
                relevant_skill: 'oratory',
                difficulty: 10,
                opposing_entity_id: 'none',
                rationale: 'Passive observation.',
              }),
            };
          }
          if (schema.includes('entityActions')) {
            return {
              text: JSON.stringify({
                turn: 12,
                entityActions: [],
                deltas: [],
                headlines: [{ text: 'Bread lines lengthen along the Tiber.', actors: [] }],
                gm_private: [],
                woven_event_ids: ['grain_shortage', 'whispers_of_mutiny', 'invented_event'],
              }),
            };
          }
          if (schema.includes('imperial_status')) {
            return {
              text: JSON.stringify({
                imperial_status: sim.imperial_status,
                senate_status: sim.senate_status,
                military_status: sim.military_status,
                plebeian_mood: sim.plebeian_mood,
                major_ongoing_crisis: null,
                actors: [],
              }),
            };
          }
          return { text: JSON.stringify({ text: 'The people grow thin.', actors: [] }) };
        }),
        generateContentStream: vi.fn(async () => (async function* () {
          yield {
            text: JSON.stringify({
              text: 'Long queues gather before the public granaries.\nSUGGESTION: Open the reserve stores.',
              actors: [],
            }),
          };
        })()),
      },
    };

    const result = await runNewTurn(
      ai as never,
      { version: 1, kind: 'freeform', text: 'Look out over the grain docks.' },
      player,
      12,
      [player, guard, rival, senatorialParty, romanSenate],
      world,
      sim,
      [],
      [],
      [],
      [],
      '',
      false,
      'Crisis of 235',
      { eventFirings: firings },
    );

    expect(result.wovenEventIds).toEqual(['grain_shortage']);
  });
});
