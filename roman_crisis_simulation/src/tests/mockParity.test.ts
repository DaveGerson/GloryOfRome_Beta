/**
 * tests/mockParity.test.ts
 *
 * E2: mockRunNewTurn (ai/mocks.ts) never ran the player-boundary gates its
 * real twin (ai/core/turn.ts::runNewTurn) enforces, and committed Director
 * intents unfiltered by selectDurableIntents (phantom intents for entities
 * absent from the roster). This file pins both real-path behaviors onto the
 * mock so the two never diverge again.
 */
import { describe, it, expect } from 'vitest';
import { mockRunNewTurn } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { INITIAL_SIMULATION_STATE, ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import { Entity, TurnSubmission } from '../types';

const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });
const questionOnly = (q: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: q });

const run = (submission: TurnSubmission | string, player: Entity, entities: Entity[], sim = INITIAL_SIMULATION_STATE) =>
  mockRunNewTurn(submission, player, 1, entities, getMockInitialState().worldState, [], '', 'A crisis.', structuredClone(sim), [], []);

function findEntity(entities: Entity[], entityId: string): Entity {
  const found = entities.find(e => e.entity_id === entityId);
  if (!found) throw new Error(`fixture missing entity_id ${entityId}`);
  return found;
}

describe('mockRunNewTurn / real-pipeline boundary parity (E2)', () => {
  it('a no-attempt mock turn emits a boundary-compliant adjudication (no player-authored content)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(questionOnly('What do the wardens report?'), player, entities);

    expect(result.newHistoryEntry.adjudication.entityActions.some(action => action.id === 'severus_alexander')).toBe(false);
    expect(result.newHistoryEntry.adjudication.deltas.some(delta =>
      delta.type === 'relation' && delta.key.startsWith('severus_alexander:'))).toBe(false);
    expect(result.headlines).not.toContain('Emperor promises bonus to Praetorian Guard.');
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
  });

  it("a no-attempt mock turn whose canned adjudication authors the player's conduct throws the real boundary error", async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'gaius_pontius_magnus');

    await expect(run(questionOnly('What is whispered in the Curia?'), player, entities))
      .rejects.toThrow('AI output violated the player action boundary.');
  });

  it('the gates stay open on an observable attempt (parity with the real short-circuit)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'gaius_pontius_magnus');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.newHistoryEntry.adjudication.entityActions.some(action => action.id === 'severus_alexander')).toBe(true);
  });

  it('a no-attempt turn rejects player-attributed prose in the simulation state (visible-action gate parity)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'severus_alexander');
    const sim = { ...INITIAL_SIMULATION_STATE, major_ongoing_crisis: 'The Emperor marches on the Praetorian camp.' };

    await expect(run(questionOnly('What do the wardens report?'), player, entities, sim))
      .rejects.toThrow('AI output violated the player action boundary.');
  });

  it('phantom spotlight intents for entities absent from the roster are dropped (selectDurableIntents parity)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.updatedNpcIntents.map(i => i.entity_id)).toEqual(['maximinus_thrax']);
    expect(result.newHistoryEntry.npcIntents).toEqual(result.updatedNpcIntents);
  });

  it('dead spotlights hold no durable intent', async () => {
    const entities = ALL_INITIAL_ENTITIES.map(e => e.entity_id === 'maximinus_thrax' ? { ...e, status: 'dead' as const } : e);
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.updatedNpcIntents.map(i => i.entity_id)).toEqual(['praetorian_guard']);
  });
});
