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
import { playerOwnsDelta, samePlayerIdentity } from '../ai/core/playerBoundary';
import { Entity, TurnSubmission } from '../types';

const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });
const questionOnly = (q: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: q });
const privateIntentOnly = (intent: string): TurnSubmission => ({ version: 1, kind: 'structured', privateIntent: intent });

/** Every character components/CharacterSelection.tsx offers. */
const PLAYABLE_PRESET_IDS = [
  'severus_alexander',
  'maximinus_thrax',
  'gaius_pontius_magnus',
  'lycinia_stolo',
] as const;

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

  // C1 (shipping blocker): projectMockAdjudicationForNoAttempt filtered an
  // ENUMERATION of surfaces (entityActions by id, 'relation' deltas by key
  // root, headlines) and missed three more the canned MOCK_ADJUDICATION
  // authors - a 'resource' delta keyed maximinus_thrax, a 'status' delta keyed
  // gaius_pontius_magnus, and remove_entities: ['lycinia_stolo']. Since
  // playerOwnsDelta matches on the key root for EVERY delta type and
  // valueRemovesPlayer matches remove_entities, every no-attempt turn threw
  // for three of the four shipped presets. Mock Mode is a production-visible
  // toggle (components/Header.tsx), so this was user-reachable and
  // deterministic - retry never succeeded. The projection now enforces the
  // INVARIANT (remove everything the actual player owns, on every surface the
  // structural gates examine) rather than a list of surfaces.
  it.each(PLAYABLE_PRESET_IDS)('a no-attempt mock turn commits for preset %s', async entityId => {
    // ALL_INITIAL_ENTITIES is the SHIPPED roster components/CharacterSelection.tsx
    // draws from; tests/mockData.ts's fixture holds only three of the four.
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, entityId);

    const question = await run(questionOnly('What is whispered in the Curia?'), player, entities);
    expect(question.newHistoryEntry.turnNumber).toBe(1);

    const privateIntent = await run(privateIntentOnly('Weigh my options in silence.'), player, entities);
    expect(privateIntent.newHistoryEntry.turnNumber).toBe(1);
  });

  it.each(PLAYABLE_PRESET_IDS)('a no-attempt mock turn owns nothing of preset %s', async entityId => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, entityId);

    const { newHistoryEntry } = await run(questionOnly('What is whispered in the Curia?'), player, entities);
    const { adjudication } = newHistoryEntry;

    // Asserted through playerBoundary.ts's OWN ownership predicate, not a
    // restatement of it: the invariant is "owns nothing", and the carve-outs
    // the predicate encodes (an NPC-authored rumor keyed under the player, a
    // world-driven dependency_level rise) are legitimately still present.
    expect(adjudication.entityActions.some(action => samePlayerIdentity(action.id, player))).toBe(false);
    expect(adjudication.deltas.some(delta => playerOwnsDelta(delta, player))).toBe(false);
    expect((adjudication.remove_entities ?? []).some(id => samePlayerIdentity(id, player))).toBe(false);
  });

  // The gate-wiring lever, rebuilt from INJECTED content so it no longer
  // depends on which preset is playing: a structural violation the mock cannot
  // project away (the player named in a simulation-state remove_entities).
  it.each(PLAYABLE_PRESET_IDS)(
    'the real structural gate still fires in mock mode for preset %s',
    async entityId => {
      const entities = ALL_INITIAL_ENTITIES;
      const player = findEntity(entities, entityId);
      const sim = { ...INITIAL_SIMULATION_STATE, remove_entities: [entityId] } as unknown as typeof INITIAL_SIMULATION_STATE;

      await expect(run(questionOnly('What do the wardens report?'), player, entities, sim))
        .rejects.toThrow('AI output violated the player action boundary.');
    },
  );

  it('the gates stay open on an observable attempt (parity with the real short-circuit)', async () => {
    const entities = getMockInitialState().entities;
    const player = findEntity(entities, 'gaius_pontius_magnus');

    const result = await run(freeform('Hold court'), player, entities);

    expect(result.newHistoryEntry.adjudication.entityActions.some(action => action.id === 'severus_alexander')).toBe(true);
  });

  // CHANGED (prose/structural split): player-attributed PROSE on a
  // player-visible surface is a narrative blemish, not a mechanical violation.
  // The mock runs the same redact-or-throw wiring as ai/core/turn.ts, so the
  // crisis text is scrubbed and the turn commits instead of failing.
  it.each(PLAYABLE_PRESET_IDS)(
    'a no-attempt turn redacts player-attributed simulation-state prose for preset %s',
    async entityId => {
      const entities = ALL_INITIAL_ENTITIES;
      const player = findEntity(entities, entityId);
      const invented = `${player.name} marches on the Praetorian camp.`;
      const sim = { ...INITIAL_SIMULATION_STATE, major_ongoing_crisis: invented };

      const result = await run(questionOnly('What do the wardens report?'), player, entities, sim);

      expect(result.updatedSimulationState.major_ongoing_crisis).not.toContain('marches');
      expect(result.newHistoryEntry.adjudication.gm_private.some(note =>
        note.startsWith('[Boundary]') && note.includes(invented))).toBe(true);
    },
  );

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

/**
 * D46 parity: the mock runs the conservation guard in the real pipeline's
 * slot (after the last boundary, before apply) and closes the week's books
 * as its own step after apply, so a keyless QA pass exercises the same
 * economy a keyed one does - and leaks nothing the real path would not.
 */
describe('mockRunNewTurn / real-pipeline economy parity (D46)', () => {
  const ledgerNet = (lines: ReadonlyArray<{ key: string; amount: number }> | undefined) =>
    (lines ?? []).filter(line => line.key === 'denarii').reduce((sum, line) => sum + line.amount, 0);

  it('an observable-attempt turn folds the alias debit, books the week on the history entry, and adds up', async () => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);
    const { adjudication, ledger } = result.newHistoryEntry;

    // The mock's `gold` debit lands on `denarii` with an [Economy] fold note - never under two names.
    expect(adjudication.deltas.some(delta => delta.key === 'severus_alexander:gold')).toBe(false);
    expect(adjudication.deltas.some(delta => delta.key === 'severus_alexander:denarii' && delta.delta === -1500)).toBe(true);
    expect(adjudication.gm_private.some(note => note.startsWith('[Economy] Folded resource key'))).toBe(true);
    // The Emperor's 12,000 gift is under his allowance (half of 50,000): no clamp.
    expect(adjudication.deltas.some(delta => delta.key === 'severus_alexander:denarii' && delta.delta === 12000)).toBe(true);
    expect(adjudication.gm_private.some(note => note.includes('Clamped an unsourced treasury gain'))).toBe(false);

    // The week closed on the entry, as an engine step - not as deltas.
    expect(ledger?.map(line => line.kind)).toEqual(expect.arrayContaining(['income', 'upkeep']));
    expect(adjudication.deltas.some(delta => delta.reason.includes('wages'))).toBe(false);
    expect(adjudication.gm_private.some(note => note.startsWith('[Ledger] Week closed'))).toBe(true);

    const after = findEntity(result.updatedEntities, 'severus_alexander');
    expect(after.resources.denarii).toBe(50000 - 1500 + 12000 + ledgerNet(ledger));
    expect(after.resources.gold).toBeUndefined();
  });

  it('the guard clamps the mock windfall for a preset whose treasury cannot vouch for it', async () => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, 'maximinus_thrax'); // 15,000 denarii: half is 7,500

    const result = await run(freeform('March on Rome'), player, entities);
    const { adjudication, ledger } = result.newHistoryEntry;

    expect(adjudication.deltas.find(delta => delta.key === 'maximinus_thrax:denarii' && delta.delta > 0)?.delta).toBe(7500);
    expect(adjudication.gm_private.some(note => note.startsWith('[Economy] Clamped an unsourced treasury gain of 12,000 denarii to 7,500'))).toBe(true);
    const after = findEntity(result.updatedEntities, 'maximinus_thrax');
    expect(after.resources.denarii).toBe(15000 - 1500 + 7500 + ledgerNet(ledger));
  });

  it('a no-attempt turn still closes the books - wages fall due whether or not the player acts', async () => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(questionOnly('What do the wardens report?'), player, entities);
    const { adjudication, ledger } = result.newHistoryEntry;

    expect(adjudication.deltas.some(delta => delta.key.startsWith('severus_alexander:'))).toBe(false);
    expect(ledger?.map(line => line.kind)).toEqual(expect.arrayContaining(['income', 'upkeep']));
    expect(findEntity(result.updatedEntities, 'severus_alexander').resources.denarii).toBe(50000 + ledgerNet(ledger));
  });

  it('the ledger is the player\'s alone: every other bag moves only by the canned deltas (D5/D6)', async () => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, 'severus_alexander');

    const result = await run(freeform('Hold court'), player, entities);

    let compared = 0;
    for (const entity of result.updatedEntities) {
      if (entity.entity_id === player.entity_id) continue;
      const before = entities.find(candidate => candidate.entity_id === entity.entity_id);
      if (!before) continue; // an entity the canned adjudication added this turn
      // The canned MOCK_ADJUDICATION moves Thrax's standing by its own delta; no wage, yield or interest touches any NPC.
      const expected = entity.entity_id === 'maximinus_thrax'
        ? { ...before.resources, legion_support: (before.resources.legion_support as number) + 2 }
        : before.resources;
      expect(entity.resources, entity.entity_id).toEqual(expected);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it.each(PLAYABLE_PRESET_IDS)('no [Ledger] or [Economy] marker reaches a player surface for preset %s', async entityId => {
    const entities = ALL_INITIAL_ENTITIES;
    const player = findEntity(entities, entityId);

    const result = await run(freeform('Hold court'), player, entities);
    const gmMarkers = result.newHistoryEntry.adjudication.gm_private.filter(note => note.startsWith('[Ledger]') || note.startsWith('[Economy]'));
    expect(gmMarkers.length).toBeGreaterThan(0);

    const surfaces = [
      result.narration,
      result.playerMonologue,
      result.headlines.join('\n'),
      result.suggestedActions.join('\n'),
      result.updatedReports.map(report => report.claim).join('\n'),
      (result.newHistoryEntry.ledger ?? []).map(line => `${line.text} ${line.detail ?? ''}`).join('\n'),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain('[Ledger]');
      expect(surface).not.toContain('[Economy]');
      for (const note of gmMarkers) expect(surface).not.toContain(note);
    }
  });
});
