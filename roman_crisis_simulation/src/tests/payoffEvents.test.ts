/**
 * tests/payoffEvents.test.ts
 *
 * Events repurposed as payoff material + moment lines (ROADMAP_PHASE_4.md
 * 4D items 2-3, DESIGN_DECISIONS.md D12/D24):
 *  - the event engine's repeatable/cooldown eligibility and the dual-shape
 *    firing bookkeeping (richer records beside the legacy string set,
 *    events/engine.ts);
 *  - role-agnostic triggers - the Emperor gates are GONE, and the new
 *    historical seeds key off world/sim state;
 *  - the D24 ripe-material helper (selectRipeEventMaterial) and the
 *    adjudication prompt's GM-private HISTORICAL MATERIAL block;
 *  - the narration prompt's moment-line clause (4D.3);
 *  - the reducer's bookkeeping normalization for legacy saves.
 * Pipeline threading (runNewTurn options -> adjudication prompt) is pinned
 * in tests/turnPipeline.test.ts; persistence round-trip of the new field in
 * tests/persistence.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  checkForTriggeredEvent,
  isEventEligible,
  normalizeEventFirings,
  recordEventFiring,
  selectRipeEventMaterial,
  NEAR_COOLDOWN_WINDOW,
} from '../events/engine';
import { ALL_EVENTS } from '../constants/events';
import { buildAdjudicationPrompt, buildHistoricalMaterialBlock, HistoricalMaterialEntry } from '../ai/prompts/adjudication';
import { buildNarrationPrompt } from '../ai/prompts/narration';
import { gameReducer, createInitialGameState } from '../state/gameReducer';
import type { SaveGameState } from '../persistence/saveGame';
import { getMockInitialState } from './mockData';
import {
  makeEntity as baseMakeEntity,
  makeWorldState,
  makeSimulationState as makeSim,
} from './factories';
import { Entity, GameEvent, WorldState, EventFiringRecord } from '../types';

// --- fixtures ---------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return baseMakeEntity({
    entity_id: 'lycinia_stolo',
    name: 'Lycinia Stolo',
    position: 'Informant Broker', // deliberately NOT an Emperor
    location: 'The Suburra',
    resources: { denarii: 20000 },
    current_state_narrative: 'Trading in secrets.',
    ...overrides,
  });
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return makeWorldState({
    week: 5,
    economic_stability: 'Stable',
    political_climate: 'Volatile',
    ...overrides,
  });
}

function eventById(id: string): GameEvent {
  const event = ALL_EVENTS.find(e => e.id === id);
  expect(event).toBeDefined();
  return event!;
}

const fired = (eventId: string, lastFiredTurn: number, timesFired = 1): EventFiringRecord =>
  ({ eventId, lastFiredTurn, timesFired });

// --- authored library shape -------------------------------------------------

describe('constants/events: the authored library is payoff material (4D.2, D12)', () => {
  it('carries the two reworked events plus the new historical seeds, each with a one-line premise', () => {
    const ids = ALL_EVENTS.map(e => e.id);
    expect(ids).toContain('grain_shortage');
    expect(ids).toContain('whispers_of_mutiny');
    expect(ids).toContain('rhine_acclamation');
    expect(ids).toContain('gordian_stirrings');
    expect(ids).toContain('praetorian_pay_crisis');
    for (const event of ALL_EVENTS) {
      expect(event.premise, `${event.id} premise`).toBeTruthy();
      expect(event.options).toHaveLength(3);
      for (const option of event.options) {
        expect(option.deltas.length).toBeGreaterThan(0);
        // The authored-choice DISCARD CONSTRAINT (events/engine.ts): no
        // 'rumor' deltas, whose ledger entries this path would drop.
        expect(option.deltas.every(d => d.type !== 'rumor')).toBe(true);
      }
    }
  });

  it('no trigger fires against the campaign-start state (events are payoffs, not openers)', () => {
    const { entities, worldState } = getMockInitialState();
    const player = entities[0];
    for (const event of ALL_EVENTS) {
      expect(event.trigger(worldState, entities, player, makeSim({ military_status: 'Divided' })), event.id).toBe(false);
    }
  });
});

// --- eligibility: repeatable + cooldown boundaries --------------------------

describe('events/engine: isEventEligible (repeatable + cooldown, 4D.2)', () => {
  const repeatable: GameEvent = { ...eventById('grain_shortage') }; // repeatable, cooldownTurns: 10
  const fireOnce: GameEvent = { ...eventById('gordian_stirrings') }; // no repeatable flag

  it('a never-fired event is always eligible', () => {
    expect(isEventEligible(repeatable, [], 1)).toBe(true);
    expect(isEventEligible(fireOnce, [], 99)).toBe(true);
  });

  it('a fired non-repeatable event is never eligible again (the original fire-once contract)', () => {
    expect(isEventEligible(fireOnce, [fired(fireOnce.id, 2)], 500)).toBe(false);
  });

  it('a fired repeatable event is suppressed strictly inside its cooldown and eligible exactly at expiry (boundary)', () => {
    const firings = [fired(repeatable.id, 5)];
    const cooldown = repeatable.cooldownTurns!;
    expect(isEventEligible(repeatable, firings, 5 + cooldown - 1)).toBe(false); // one turn short
    expect(isEventEligible(repeatable, firings, 5 + cooldown)).toBe(true); // exactly elapsed
    expect(isEventEligible(repeatable, firings, 5 + cooldown + 7)).toBe(true);
  });

  it('checkForTriggeredEvent honors the cooldown end to end: fires, suppresses, then fires again', () => {
    const player = makeEntity();
    const world = makeWorld({ economic_stability: 'Failing' });
    const sim = makeSim();

    // Never fired: grain_shortage triggers and is returned.
    const first = checkForTriggeredEvent(world, [player], [], player, sim, 6);
    expect(first?.id).toBe('grain_shortage');

    // Fired at turn 6: suppressed until the cooldown elapses...
    const firings = [fired('grain_shortage', 6)];
    expect(checkForTriggeredEvent(world, [player], firings, player, sim, 7)).toBeNull();
    expect(checkForTriggeredEvent(world, [player], firings, player, sim, 15)).toBeNull();
    // ...and fires again exactly at expiry (repeatable, D12).
    expect(checkForTriggeredEvent(world, [player], firings, player, sim, 16)?.id).toBe('grain_shortage');
  });
});

// --- dual-shape bookkeeping -------------------------------------------------

describe('events/engine: normalizeEventFirings + recordEventFiring (legacy string[] compatibility)', () => {
  it('normalizes a legacy string[] into conservative records stamped at the fallback turn', () => {
    const records = normalizeEventFirings(['grain_shortage', 'whispers_of_mutiny'], undefined, 12);
    expect(records).toEqual([
      { eventId: 'grain_shortage', lastFiredTurn: 12, timesFired: 1 },
      { eventId: 'whispers_of_mutiny', lastFiredTurn: 12, timesFired: 1 },
    ]);
  });

  it('keeps richer records authoritative and merges only the legacy ids they lack', () => {
    const richer = [fired('grain_shortage', 3, 2)];
    const records = normalizeEventFirings(['grain_shortage', 'gordian_stirrings'], richer, 9);
    expect(records).toEqual([
      { eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 }, // untouched
      { eventId: 'gordian_stirrings', lastFiredTurn: 9, timesFired: 1 }, // merged conservatively
    ]);
    expect(richer).toHaveLength(1); // input never mutated
  });

  it('recordEventFiring appends a first firing to BOTH shapes and bumps a repeat without duplicating the id', () => {
    const first = recordEventFiring([], [], 'grain_shortage', 4);
    expect(first.triggeredEventIds).toEqual(['grain_shortage']);
    expect(first.eventFirings).toEqual([fired('grain_shortage', 4)]);

    const repeat = recordEventFiring(first.triggeredEventIds, first.eventFirings, 'grain_shortage', 15);
    expect(repeat.triggeredEventIds).toEqual(['grain_shortage']); // deduped legacy set
    expect(repeat.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 15, timesFired: 2 }]);
  });
});

// --- role-agnostic triggers (the Emperor gates are gone) --------------------

describe('constants/events: role-agnostic triggers (4D.2)', () => {
  it('grain_shortage fires for a NON-Emperor player once the economy fails, and never without a player', () => {
    const broker = makeEntity(); // Informant Broker
    const failing = makeWorld({ economic_stability: 'Failing' });
    const event = eventById('grain_shortage');
    expect(event.trigger(failing, [broker], broker)).toBe(true);
    expect(event.trigger(makeWorld({ economic_stability: 'Crisis' }), [broker], broker)).toBe(true);
    expect(event.trigger(makeWorld(), [broker], broker)).toBe(false); // Stable economy
    expect(event.trigger(failing, [broker], null)).toBe(false); // no player, no modal
  });

  it("whispers_of_mutiny reads the GUARD's own relationships: sour on the player, warm toward ANY rival - no hardcoded ids", () => {
    const broker = makeEntity();
    const event = eventById('whispers_of_mutiny');
    const guard = (relationships: Entity['relationships']): Entity =>
      makeEntity({ entity_id: 'praetorian_guard', name: 'Praetorian Guard', entity_type: 'group', position: undefined, relationships });

    // Sour on the player AND favoring a rival (any rival - not maximinus_thrax specifically).
    const mutinous = guard({
      [broker.entity_id]: { entity_id: broker.entity_id, relationship_type: 'client', trust_level: -3, recent_interactions: [] },
      some_new_general: { entity_id: 'some_new_general', relationship_type: 'patron', trust_level: 7, recent_interactions: [] },
    });
    expect(event.trigger(makeWorld(), [mutinous, broker], broker)).toBe(true);

    // Sour on the player but favoring no one: no mutiny brewing.
    const merelySour = guard({
      [broker.entity_id]: { entity_id: broker.entity_id, relationship_type: 'client', trust_level: -3, recent_interactions: [] },
    });
    expect(event.trigger(makeWorld(), [merelySour, broker], broker)).toBe(false);

    // Favoring a rival but not sour on the player: no trigger either.
    const merelyCourted = guard({
      [broker.entity_id]: { entity_id: broker.entity_id, relationship_type: 'client', trust_level: 2, recent_interactions: [] },
      some_new_general: { entity_id: 'some_new_general', relationship_type: 'patron', trust_level: 7, recent_interactions: [] },
    });
    expect(event.trigger(makeWorld(), [merelyCourted, broker], broker)).toBe(false);
  });

  it('rhine_acclamation keys off military_status (Rebellious, or Divided under a major crisis)', () => {
    const player = makeEntity();
    const event = eventById('rhine_acclamation');
    expect(event.trigger(makeWorld(), [player], player, makeSim({ military_status: 'Rebellious' }))).toBe(true);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ military_status: 'Divided', major_ongoing_crisis: 'Succession Crisis' }))).toBe(true);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ military_status: 'Divided' }))).toBe(false);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ military_status: 'Loyal', major_ongoing_crisis: 'Civil War' }))).toBe(false);
    expect(event.trigger(makeWorld(), [player], player)).toBe(false); // no sim state supplied
  });

  it('gordian_stirrings keys off a wobbling throne plus a Senate still standing to bless a rival', () => {
    const player = makeEntity();
    const event = eventById('gordian_stirrings');
    expect(event.trigger(makeWorld(), [player], player, makeSim({ imperial_status: 'Contested' }))).toBe(true);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ imperial_status: 'Vacant', senate_status: 'Ascendant' }))).toBe(true);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ imperial_status: 'Stable' }))).toBe(false);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ imperial_status: 'Contested', senate_status: 'Deposed' }))).toBe(false);
  });

  it('praetorian_pay_crisis keys off a failing economy plus an army no longer reliably loyal', () => {
    const player = makeEntity();
    const event = eventById('praetorian_pay_crisis');
    const failing = makeWorld({ economic_stability: 'Failing' });
    expect(event.trigger(failing, [player], player, makeSim({ military_status: 'Divided' }))).toBe(true);
    expect(event.trigger(makeWorld({ economic_stability: 'Crisis' }), [player], player, makeSim({ military_status: 'Rebellious' }))).toBe(true);
    expect(event.trigger(failing, [player], player, makeSim({ military_status: 'Loyal' }))).toBe(false);
    expect(event.trigger(makeWorld(), [player], player, makeSim({ military_status: 'Divided' }))).toBe(false);
  });
});

// --- the D24 ripe-material helper -------------------------------------------

describe('events/engine: selectRipeEventMaterial (4D.2, D24)', () => {
  const player = makeEntity();
  const failing = makeWorld({ economic_stability: 'Failing' });

  it('returns a triggering, never-fired event as RIPE with its authored premise', () => {
    const material = selectRipeEventMaterial(failing, makeSim(), [player], player, [], 6);
    expect(material).toHaveLength(1);
    expect(material[0].event.id).toBe('grain_shortage');
    expect(material[0].status).toBe('ripe');
    expect(material[0].premise).toBe(eventById('grain_shortage').premise);
  });

  it('excludes events whose triggers are not met, whatever their bookkeeping', () => {
    expect(selectRipeEventMaterial(makeWorld(), makeSim(), [player], player, [], 6)).toEqual([]);
  });

  it('marks a cooldown-held repeatable event NEAR inside the window and suppresses it entirely outside', () => {
    const cooldown = eventById('grain_shortage').cooldownTurns!;
    const firings = [fired('grain_shortage', 10)];

    // Deep in cooldown (more than NEAR_COOLDOWN_WINDOW turns left): suppressed.
    const deep = selectRipeEventMaterial(failing, makeSim(), [player], player, firings, 10 + cooldown - NEAR_COOLDOWN_WINDOW - 1);
    expect(deep).toEqual([]);

    // Within the window: NEAR.
    const near = selectRipeEventMaterial(failing, makeSim(), [player], player, firings, 10 + cooldown - NEAR_COOLDOWN_WINDOW);
    expect(near).toHaveLength(1);
    expect(near[0].status).toBe('near');

    // Cooldown elapsed: RIPE again.
    const ripe = selectRipeEventMaterial(failing, makeSim(), [player], player, firings, 10 + cooldown);
    expect(ripe[0].status).toBe('ripe');
  });

  it('a fired non-repeatable event never returns, even with its trigger met', () => {
    const sim = makeSim({ imperial_status: 'Contested' });
    const before = selectRipeEventMaterial(makeWorld(), sim, [player], player, [], 6);
    expect(before.map(m => m.event.id)).toEqual(['gordian_stirrings']);
    const after = selectRipeEventMaterial(makeWorld(), sim, [player], player, [fired('gordian_stirrings', 6)], 40);
    expect(after).toEqual([]);
  });
});

// --- the adjudication prompt's HISTORICAL MATERIAL block --------------------

describe('buildAdjudicationPrompt: the GM-private HISTORICAL MATERIAL block (4D.2, D24)', () => {
  const MATERIAL: HistoricalMaterialEntry[] = [
    { id: 'grain_shortage', title: 'Grain Shortage in the Capital', premise: 'The Egyptian grain fleet fails.', status: 'ripe' },
    { id: 'rhine_acclamation', title: 'Acclamation on the Rhine', premise: 'The legions raise a name upon their shields.', status: 'near' },
  ];

  function buildPrompt(historicalMaterial?: HistoricalMaterialEntry[]): string {
    const { entities, worldState } = getMockInitialState();
    return buildAdjudicationPrompt({
      worldState,
      simulationState: makeSim(),
      playerEntity: entities[0],
      npcEntities: entities.slice(1),
      history: [],
      submission: { observableAttempt: 'Hold court', questionOrContext: null },
      gmInterventionText: '',
      storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
      metaNarrative: 'A succession crisis.',
      historicalMaterial,
    }).prompt;
  }

  it('renders the block with one line per entry when material is supplied', () => {
    const prompt = buildPrompt(MATERIAL);
    expect(prompt).toContain('HISTORICAL MATERIAL');
    expect(prompt).toContain('[RIPE] Grain Shortage in the Capital (grain_shortage): The Egyptian grain fleet fails.');
    expect(prompt).toContain('[NEAR] Acclamation on the Rhine (rhine_acclamation): The legions raise a name upon their shields.');
  });

  it('pins the D24 preference sentence and the D12 verbatim-exception carve-out', () => {
    const prompt = buildPrompt(MATERIAL);
    // D24: when pacing tightens and a current is due, prefer weaving it.
    expect(prompt).toContain('When your PACING JUDGMENT says TIGHTEN and one of these historical currents is due, PREFER weaving its premise');
    expect(prompt).toContain('when you TIGHTEN and none of them is due, craft a custom crisis instead');
    expect(prompt).toContain('When you are NOT tightening, this block asks nothing of you');
    // D12: verbatim scripted firing stays the modal system's exception.
    expect(prompt).toContain('The modal event system may still fire a RIPE entry verbatim as the exception, not the model (D12)');
  });

  it('keeps the material GM-private (D4/D5): provenance never reaches player-facing text', () => {
    const prompt = buildPrompt(MATERIAL);
    expect(prompt).toContain('This block is GM-private material');
    expect(prompt).toContain("never mention it, its titles or ids, or that anything here is authored in 'headlines'");
  });

  it('emits NO block when material is absent or empty - the pre-4D.2 prompt shape', () => {
    expect(buildPrompt(undefined)).not.toContain('HISTORICAL MATERIAL');
    expect(buildPrompt([])).not.toContain('HISTORICAL MATERIAL');
    expect(buildHistoricalMaterialBlock(undefined)).toBe('');
    expect(buildHistoricalMaterialBlock([])).toBe('');
  });
});

// --- the narration moment line (4D.3) ---------------------------------------

describe('buildNarrationPrompt: the moment-line clause (4D.3)', () => {
  it('asks for ONE signature spoken line, in the character\'s voice, only when a scheme visibly culminates (pin)', () => {
    const player = makeEntity();
    const { systemInstruction } = buildNarrationPrompt('A crisis.', player, 'Hold court', []);
    expect(systemInstruction).toContain('Moment Line');
    expect(systemInstruction).toContain("When a named character's visible action clearly culminates or detonates");
    expect(systemInstruction).toContain('ONE short signature spoken line, quoted in their own voice (per CAST VOICES when present)');
    // Bounded: per-character cap, culminations only, no invented facts.
    expect(systemInstruction).toContain('At most one line per character');
    expect(systemInstruction).toContain('only at a true culmination');
    expect(systemInstruction).toContain('reveal nothing beyond those player-perceived events');
  });
});

// --- reducer normalization of the bookkeeping (save compatibility) ----------

describe('state/gameReducer: eventFirings normalization (4D.2 save compatibility)', () => {
  function makeSave(overrides: Partial<SaveGameState> = {}): SaveGameState {
    const { entities, worldState } = getMockInitialState();
    return {
      entities,
      worldState,
      simulationState: makeSim(),
      reports: [],
      turnNumber: 7,
      playerCharacterId: 'severus_alexander',
      turnHistory: [],
      eventHistory: [],
      metaNarrative: 'A loaded crisis.',
      messages: [],
      triggeredEventIds: ['grain_shortage'],
      suggestedActions: [],
      currentEvents: [],
      gmInterventionText: '',
      ...overrides,
    };
  }

  it('GAME_LOADED derives conservative records from a legacy save\'s triggeredEventIds (cooldowns restart at the loaded turn)', () => {
    const result = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: makeSave() });
    expect(result.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 7, timesFired: 1 }]);
    expect(result.triggeredEventIds).toEqual(['grain_shortage']);
  });

  it('GAME_LOADED keeps a persisted richer record authoritative over the legacy set', () => {
    const save = makeSave({ eventFirings: [{ eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 }] });
    const result = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save });
    expect(result.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 }]);
  });

  it('TURN_ROLLED_BACK restores the snapshot\'s bookkeeping with the same normalization', () => {
    const playing = {
      ...createInitialGameState(),
      eventFirings: [{ eventId: 'grain_shortage', lastFiredTurn: 9, timesFired: 3 }],
    };
    const snapshot = makeSave({ eventFirings: [{ eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 }] });
    const restored = gameReducer(playing, { type: 'TURN_ROLLED_BACK', snapshot });
    expect(restored.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 }]);

    const legacySnapshot = makeSave();
    const normalized = gameReducer(playing, { type: 'TURN_ROLLED_BACK', snapshot: legacySnapshot });
    expect(normalized.eventFirings).toEqual([{ eventId: 'grain_shortage', lastFiredTurn: 7, timesFired: 1 }]);
  });
});
