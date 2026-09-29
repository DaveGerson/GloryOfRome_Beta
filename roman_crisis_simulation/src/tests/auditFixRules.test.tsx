/**
 * tests/auditFixRules.test.tsx
 *
 * Regression pins for the rules audit's confirmed findings: the mortality
 * pipeline (attempt phrasing, the player's own settled outcome reaching
 * narration, survival keeping exile, a missing loss recorded, secret
 * survival ending with a real status change), the engine's refuse-and-record
 * guards (text resources, malformed schemes, relocations read as deaths),
 * the player-only treasury Reports and their unique ids, the authored
 * events (direction, world gate, the blank-crisis Rhine trigger), the
 * Director's intents never naming the player, the resolution helpers'
 * scales, suggestion feasibility, the stream gate's shared marker, and Mock
 * Mode's player-safe quote. The pipeline-level narration pin lives beside
 * its siblings in tests/turnPipeline.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAdjudication, applyDeltas, isDeathClaimDelta } from '../ai/core/engine';
import { processMortality, detectDeathClaims } from '../ai/core/mortality';
import { resolveAction, derivePersonalityModifier, clampDifficulty, deriveInvestigationDifficulty } from '../ai/core/resolution';
import { selectDurableIntents } from '../ai/core/directorIntents';
import { evolveSchemeFromAdjustment, buildMindSchemeDeltas } from '../ai/core/turn';
import { createNarrationStreamGate, createPayloadTextExtractor, splitNarrationSuggestions } from '../ai/core/streamSplit';
import { createPlayerVisibleStreamGate } from '../ai/core/playerBoundary';
import { filterFeasibleSuggestedActions, getActivityResourceRequirement } from '../ai/core/actionFeasibility';
import { AdjudicationSchema, EntitySchema } from '../ai/core/schemas';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildMortalityValidationPrompt } from '../ai/prompts/mortality';
import { buildNarrationPrompt } from '../ai/prompts/narration';
import { buildDirectorIntentsBlock, buildSecretSurvivorsBlock } from '../ai/prompts/fragments';
import { buildEntityBatchPrompt } from '../ai/prompts/worldGen';
import { mockRunNewTurn, mockGenerateScenarioStructure, mockGenerateEntitiesDetails } from '../ai/mocks';
import { ALL_EVENTS } from '../constants/events';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import { applyEventChoiceDeltas, checkForTriggeredEvent, eventRosterIds, selectRipeEventMaterial } from '../events/engine';
import { SchemeLine } from '../components/gm/SchemeLine';
import {
  makeEntity,
  makeAdjudication,
  makeQueuedTextAi,
  makeSimulationState,
  makeStoryRelevance,
  makeNpcIntent,
  makeWorldState,
  buildAdjudicationPromptInput,
} from './factories';
import type { Entity, EventDelta, GameEvent, NpcMindDecision, Scheme, TurnSubmission, WorldState } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the next un-seeded d20 (Math.random) land on `roll`. */
function mockRoll(roll: number) {
  vi.spyOn(Math, 'random').mockReturnValue((roll - 1) / 20);
}

const WORLD: WorldState = makeWorldState({
  regions: {
    Rome: { stability: 'Stable', controlling_faction: null, current_events: [] },
    Ostia: { stability: 'Stable', controlling_faction: null, current_events: [] },
  },
});

function eventById(id: string): GameEvent {
  const event = ALL_EVENTS.find(e => e.id === id);
  if (!event) throw new Error(`no authored event ${id}`);
  return event;
}

const validDisposition = (entity_id: string) =>
  JSON.stringify({ dispositions: [{ entity_id, valid: true, reasoning: 'A real attempt this turn.' }] });

const deathClaim = (key: string, reason = 'An assassin strikes.'): EventDelta =>
  ({ type: 'status', key, delta: 0, reason, new_status: 'dead' });

// --- rules-death-headline-survives-save -------------------------------------

describe('a declared death is phrased as the attempt (rules-death-headline-survives-save)', () => {
  it("tells the adjudicator every trace of a declared death names the attempt, since a hidden roll settles it", () => {
    const { systemInstruction } = buildAdjudicationPrompt(buildAdjudicationPromptInput());
    expect(systemInstruction).toContain('DEATHS ARE CLAIMS');
    expect(systemInstruction).toContain("phrase every trace of a death you declare as the ATTEMPT on that life - in 'headlines'");
    // The STATUS DELTAS example no longer models an accomplished death.
    expect(systemInstruction).not.toContain('Struck down by an assassin');
  });

  it('tells the validator attempt phrasing is expected and never a reason to veto', () => {
    const { systemInstruction } = buildMortalityValidationPrompt({ candidates: [], headlines: [] });
    expect(systemInstruction).toContain('never invalidate a claim merely because the text describes an attempt rather than a death');
  });
});

// --- rules-mortality-directive-dead-end -------------------------------------

describe("the player's own settled outcome reaches narration (rules-mortality-directive-dead-end)", () => {
  const player = makeEntity({ entity_id: 'p', name: 'Gaius' });
  const npc = makeEntity({ entity_id: 'n', name: 'Rufus' });

  it("processMortality returns the player's resolved directive", async () => {
    mockRoll(14); // 'survive' - no outcome call
    const { ai } = makeQueuedTextAi(validDisposition('p'));
    const result = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [player, npc], 'p', 3, false);
    expect(result.playerOutcomeDirective).toBe('Narrate a tense but clean escape from death - no lasting cost, no windfall.');
  });

  it("returns no directive for an NPC's fate - that reaches narration only through the digest", async () => {
    mockRoll(3); // 'confirmed_dead' - no outcome call
    const { ai } = makeQueuedTextAi(validDisposition('n'));
    const result = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('n')] }), [player, npc], 'p', 3, false);
    expect(result.playerOutcomeDirective).toBeUndefined();
  });

  it('returns no directive for a vetoed claim', async () => {
    const { ai } = makeQueuedTextAi(JSON.stringify({ dispositions: [{ entity_id: 'p', valid: false, reasoning: 'Invented.' }] }));
    const result = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [player, npc], 'p', 3, false);
    expect(result.playerOutcomeDirective).toBeUndefined();
  });

  it('the narration prompt carries OUTCOME TO NARRATE only when handed one, and is otherwise unchanged', () => {
    const narrator = makeEntity();
    const without = buildNarrationPrompt('A crisis.', narrator, 'Hold court', [], []);
    expect(buildNarrationPrompt('A crisis.', narrator, 'Hold court', [], [], undefined)).toEqual(without);
    expect(without.prompt).not.toContain('OUTCOME TO NARRATE');
    expect(without.systemInstruction).not.toContain('OUTCOME TO NARRATE');

    const directive = 'Narrate a harrowing survival that costs them something concrete and lasting.';
    const withOutcome = buildNarrationPrompt('A crisis.', narrator, 'Hold court', [], [], directive);
    expect(withOutcome.prompt).toContain('OUTCOME TO NARRATE');
    expect(withOutcome.prompt).toContain(directive);
    // It licenses how the moment unfolded, never who stood behind it (D5).
    expect(withOutcome.prompt).toContain('do not name who was behind it unless the PLAYER-PERCEIVED TURN EVENTS do');
    // The standing instruction names it as a source, so "invent no new facts" cannot drop it.
    expect(withOutcome.systemInstruction).toContain('Describe the PLAYER-PERCEIVED TURN EVENTS and the OUTCOME TO NARRATE block strictly');
    expect(withOutcome.systemInstruction).toContain('Do not invent new facts not present in the PLAYER-PERCEIVED TURN EVENTS or the OUTCOME TO NARRATE block.');
  });
});

// --- rules-survived-death-save-unexiles -------------------------------------

describe('surviving a death save keeps the standing status (rules-survived-death-save-unexiles)', () => {
  it('an exiled player who survives the attempt is still in exile', async () => {
    const exiled = makeEntity({ entity_id: 'p', name: 'Gaius', status: 'exiled' });
    mockRoll(12); // 'survive'
    const { ai } = makeQueuedTextAi(validDisposition('p'));
    const { transformedAdjudication } = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [exiled], 'p', 3, false);

    expect(transformedAdjudication.deltas.find(d => d.key === 'p')?.new_status).toBe('exiled');
    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, [exiled], WORLD, 3);
    expect(updatedEntities[0].status).toBe('exiled');
  });

  it('a missing NPC gravely wounded is still missing; an alive one stays alive', async () => {
    const outcome = (id: string) => JSON.stringify({
      outcomes: [{
        entity_id: id,
        deltas: [{ type: 'resource', key: `${id}:influence`, delta: -1, reason: 'The wound costs him standing.', actors: [] }],
        narrative_directive: 'Narrate a survival that leaves him weakened.',
      }],
    });
    const player = makeEntity({ entity_id: 'p' });

    const missing = makeEntity({ entity_id: 'n', name: 'Rufus', status: 'missing', resources: { influence: 3 } });
    mockRoll(14); // 'gravely_wounded'
    const first = makeQueuedTextAi(validDisposition('n'), outcome('n'));
    const missingRun = await processMortality(first.ai, makeAdjudication({ deltas: [deathClaim('n')] }), [player, missing], 'p', 3, false);
    expect(missingRun.transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === 'n')?.new_status).toBe('missing');

    const alive = { ...missing, status: 'alive' as const };
    const second = makeQueuedTextAi(validDisposition('n'), outcome('n'));
    const aliveRun = await processMortality(second.ai, makeAdjudication({ deltas: [deathClaim('n')] }), [player, alive], 'p', 3, false);
    expect(aliveRun.transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === 'n')?.new_status).toBe('alive');
  });
});

// --- rules-loss-band-without-loss ---------------------------------------------

describe('a loss or boon band with nothing authored is recorded (rules-loss-band-without-loss)', () => {
  const player = makeEntity({ entity_id: 'p', name: 'Gaius', resources: { denarii: 1000 } });

  it('an outcome keyed to someone else counts as no outcome: default directive, and the GM note', async () => {
    mockRoll(8); // 'survive_with_loss'
    const { ai } = makeQueuedTextAi(
      validDisposition('p'),
      JSON.stringify({ outcomes: [{ entity_id: 'someone_else', deltas: [], narrative_directive: 'SOMEONE ELSE DIRECTIVE' }] }),
    );
    const { transformedAdjudication, mortalityEvents } = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [player], 'p', 3, false);

    expect(mortalityEvents[0].outcomeSummary).toBe('Narrate a harrowing survival that costs them something concrete and lasting.');
    expect(transformedAdjudication.deltas).toHaveLength(1); // the status delta alone
    expect(transformedAdjudication.gm_private.some(n => n.includes('the survive_with_loss band required a loss but none was authored'))).toBe(true);
  });

  it('a boon band with an empty outcome list is recorded the same way', async () => {
    mockRoll(19); // 'survive_with_boon'
    const { ai } = makeQueuedTextAi(validDisposition('p'), JSON.stringify({ outcomes: [] }));
    const { transformedAdjudication } = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [player], 'p', 3, false);
    expect(transformedAdjudication.gm_private.some(n => n.includes('the survive_with_boon band required a boon but none was authored'))).toBe(true);
  });

  it('an authored loss leaves no such note', async () => {
    mockRoll(8);
    const { ai } = makeQueuedTextAi(
      validDisposition('p'),
      JSON.stringify({ outcomes: [{ entity_id: 'p', deltas: [{ type: 'resource', key: 'p:denarii', delta: -500, reason: 'Ransom paid.', actors: [] }], narrative_directive: 'A costly escape.' }] }),
    );
    const { transformedAdjudication } = await processMortality(ai, makeAdjudication({ deltas: [deathClaim('p')] }), [player], 'p', 3, false);
    expect(transformedAdjudication.gm_private.some(n => n.includes('none was authored'))).toBe(false);
  });
});

// --- rules-secret-truth-survives-confirmed-death --------------------------------

describe('secret survival ends with a real status change (rules-secret-truth-survives-confirmed-death)', () => {
  const secret: NonNullable<Entity['secret_truth']> = { actually_alive: true, hidden_since_turn: 2, motive: 'Revenge.' };
  const nemesis = (status: Entity['status']) => makeEntity({ entity_id: 'n', name: 'Nemesis', status, secret_truth: { ...secret } });

  it('a survivor later confirmed dead (alive -> dead, no pipeline secret) is no longer secretly alive', () => {
    const { updatedEntities } = applyDeltas([deathClaim('n')], [nemesis('alive')], WORLD, 5);
    expect(updatedEntities[0].status).toBe('dead');
    expect(updatedEntities[0].secret_truth).toBeUndefined();
  });

  it('a hidden survivor who returns alive (dead -> alive) sheds the secret', () => {
    const { updatedEntities } = applyDeltas([{ type: 'status', key: 'n', delta: 0, reason: 'Returns.', new_status: 'alive' }], [nemesis('dead')], WORLD, 5);
    expect(updatedEntities[0].secret_truth).toBeUndefined();
  });

  it('a re-declared death (dead -> dead) keeps a legitimate secret survivor', () => {
    const { updatedEntities } = applyDeltas([deathClaim('n')], [nemesis('dead')], WORLD, 5);
    expect(updatedEntities[0].secret_truth).toEqual(secret);
  });

  it("the pipeline's own presumed-dead write still lands", () => {
    const fresh = makeEntity({ entity_id: 'n', name: 'Nemesis' });
    const { updatedEntities } = applyDeltas([{ ...deathClaim('n'), secret_truth: secret }], [fresh], WORLD, 5);
    expect(updatedEntities[0].secret_truth).toEqual(secret);
  });

  it('the adjudicator is offered only publicly dead survivors', () => {
    expect(buildSecretSurvivorsBlock([nemesis('alive')])).toBe('');
    expect(buildSecretSurvivorsBlock([nemesis('dead')])).toContain('Nemesis (n)');
  });
});

// --- rules-relocation-read-as-death -------------------------------------------

describe('a relocation is never read as a death (rules-relocation-read-as-death)', () => {
  const flee: EventDelta = { type: 'status', key: 'n', delta: 0, reason: 'Flees Rome for Ostia after the Emperor was slain.', new_location: 'Ostia' };
  const npc = makeEntity({ entity_id: 'n', name: 'Rufus', location: 'Rome' });

  it('a new_location-only delta is no death claim, whatever its reason says', () => {
    expect(isDeathClaimDelta(flee)).toBe(false);
    expect(isDeathClaimDelta({ ...flee, new_status: null } as unknown as EventDelta)).toBe(false);
    expect(detectDeathClaims([flee], [npc], 'p')).toEqual([]);
  });

  it('the engine moves the entity and leaves it alive', () => {
    const { updatedEntities } = applyDeltas([flee], [npc], WORLD, 4);
    expect(updatedEntities[0].status).toBe('alive');
    expect(updatedEntities[0].location).toBe('Ostia');
  });

  it('a legacy delta with neither structured field is still parsed', () => {
    const legacy: EventDelta = { type: 'status', key: 'n', delta: 0, reason: 'Slain in the forum.' };
    expect(isDeathClaimDelta(legacy)).toBe(true);
    expect(applyDeltas([legacy], [npc], WORLD, 4).updatedEntities[0].status).toBe('dead');
  });
});

// --- rules-npc-treasury-reports-leak / knowledge-npc-treasury-report-leak ------

describe('treasury Reports are the player\'s alone (rules-npc-treasury-reports-leak)', () => {
  const player = makeEntity({ entity_id: 'p', resources: { denarii: 100 } });
  const crassus = makeEntity({ entity_id: 'crassus', name: 'Crassus', location: 'Antioch', resources: { denarii: 6000 } });
  const overdraw = (key: string, delta: number): EventDelta => ({ type: 'resource', key, delta, reason: 'Pays the legions.' });

  it("an NPC's overdraft accrues its debt but mints no Report", () => {
    const { updatedEntities, updatedReports } = applyAdjudication(
      makeAdjudication({ deltas: [overdraw('crassus:denarii', -9000)] }), [player, crassus], WORLD, [], [], { playerEntityId: 'p' },
    );
    expect(updatedReports).toEqual([]);
    const after = updatedEntities.find(e => e.entity_id === 'crassus')!;
    expect(after.resources.denarii).toBe(0);
    expect(after.resources.debt_denarii).toBe(3000);
  });

  it("the player's own overdraft still reports", () => {
    const { updatedReports } = applyAdjudication(
      makeAdjudication({ deltas: [overdraw('p:denarii', -600)] }), [player, crassus], WORLD, [], [], { playerEntityId: 'p' },
    );
    expect(updatedReports.map(r => r.claim)).toEqual(['Your coffers run dry — the shortfall of 500 denarii is owed to your creditors.']);
  });

  it('with no player id, no treasury Report is minted at all', () => {
    const { newReports, updatedEntities } = applyDeltas([overdraw('p:denarii', -600)], [player], WORLD, 4);
    expect(newReports).toEqual([]);
    expect(updatedEntities[0].resources.debt_denarii).toBe(500);
  });
});

// --- rules-systemic-report-id-collision ---------------------------------------

describe('treasury Report ids are unique within a turn (rules-systemic-report-id-collision)', () => {
  it('two overdrafts in the same millisecond mint distinct ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const player = makeEntity({ entity_id: 'p', resources: { denarii: 1000 } });
    const { newReports } = applyDeltas(
      [{ type: 'resource', key: 'p:denarii', delta: -3000, reason: 'A' }, { type: 'resource', key: 'p:denarii', delta: -2000, reason: 'B' }],
      [player], WORLD, 4, 'p',
    );
    expect(newReports).toHaveLength(2);
    expect(new Set(newReports.map(r => r.id)).size).toBe(2);
  });
});

// --- rules-numeric-delta-on-string-resource -----------------------------------

describe('a numeric delta never corrupts a text resource (rules-numeric-delta-on-string-resource)', () => {
  it('refuses and records deltas on string and list resources, and still creates new numeric ones', () => {
    const player = makeEntity({
      entity_id: 'p',
      resources: { denarii: 10, blackmail_material: 'Letters from the senator', informants: ['a', 'b'] },
    });
    const adjudication = makeAdjudication({
      deltas: [
        { type: 'resource', key: 'p:blackmail_material', delta: -1, reason: 'Used.' },
        { type: 'resource', key: 'p:informants', delta: 1, reason: 'Recruited.' },
        { type: 'resource', key: 'p:favors', delta: 2, reason: 'Owed.' },
      ],
    });
    const { updatedEntities } = applyAdjudication(adjudication, [player], WORLD, [], [], { playerEntityId: 'p' });
    expect(updatedEntities[0].resources).toEqual({ denarii: 10, blackmail_material: 'Letters from the senator', informants: ['a', 'b'], favors: 2 });
    expect(adjudication.gm_private.filter(n => n.includes("Refused a numeric 'resource' delta"))).toHaveLength(2);
  });
});

// --- rules-malformed-scheme-turn-loop -------------------------------------------

describe('a malformed scheme is refused, and a stored one cannot break a turn (rules-malformed-scheme-turn-loop)', () => {
  const standing: Scheme = { name: 'Old Design', overall_goal: 'Keep power', steps: [{ objective: 'Hold the Curia', status: 'in_progress' }] };
  const corrupt = { name: 'The Long Knife', overall_goal: 'Kill the consul', plan: ['strike'] } as unknown as Scheme;

  it('the engine keeps the standing scheme and records the refusal', () => {
    const npc = makeEntity({ entity_id: 'n', active_scheme: standing });
    const adjudication = makeAdjudication({ deltas: [{ type: 'scheme', key: 'n', delta: 0, reason: JSON.stringify(corrupt) }] });
    const { updatedEntities } = applyAdjudication(adjudication, [npc], WORLD, []);
    expect(updatedEntities[0].active_scheme).toEqual(standing);
    expect(adjudication.gm_private.some(n => n.includes("Refused a 'scheme' delta for 'n'"))).toBe(true);
  });

  it('a well-formed scheme still replaces the standing one', () => {
    const npc = makeEntity({ entity_id: 'n', active_scheme: standing });
    const next: Scheme = { name: 'New Design', overall_goal: 'Take the throne', steps: [] };
    const { updatedEntities, gmNotes } = applyDeltas([{ type: 'scheme', key: 'n', delta: 0, reason: JSON.stringify(next) }], [npc], WORLD, 4);
    expect(updatedEntities[0].active_scheme).toEqual(next);
    expect(gmNotes).toEqual([]);
  });

  it("a mind's adjustment to a stored stepless scheme reseeds it instead of throwing", () => {
    expect(evolveSchemeFromAdjustment(corrupt, 'Strike at dawn')).toEqual({
      name: 'Evolving design', overall_goal: 'Strike at dawn', steps: [{ objective: 'Strike at dawn', status: 'in_progress' }],
    });
    const decision: NpcMindDecision = { entity_id: 'n', chosen_action: 'Waits.', method: 'Quietly.', private_reasoning: '...', scheme_adjustment: 'Strike at dawn' };
    expect(() => buildMindSchemeDeltas([decision], [makeEntity({ entity_id: 'n', active_scheme: corrupt })])).not.toThrow();
  });

  it('the GM console renders a stored stepless scheme', () => {
    const html = renderToStaticMarkup(<SchemeLine scheme={corrupt} />);
    expect(html).toContain('The Long Knife');
  });
});

// --- rules-event-choice-relation-direction --------------------------------------

describe("authored choices move the faction's opinion of the player (rules-event-choice-relation-direction)", () => {
  it("buying the Guard in whispers_of_mutiny raises the Guard's trust in the player - and quiets the trigger", () => {
    const entities = structuredClone(ALL_INITIAL_ENTITIES);
    const guardSeed = entities.find(e => e.entity_id === 'praetorian_guard')!;
    guardSeed.relationships.maximinus_thrax.trust_level = 8; // a rival courted: the mutiny current runs
    const player = entities.find(e => e.entity_id === 'severus_alexander')!;
    const event = eventById('whispers_of_mutiny');
    expect(event.trigger(INITIAL_WORLD_STATE, entities, player)).toBe(true);

    const playerTrustBefore = player.relationships.praetorian_guard.trust_level;
    const { updatedEntities } = applyEventChoiceDeltas(event.options[0], player, entities, structuredClone(INITIAL_WORLD_STATE), 3);
    const guard = updatedEntities.find(e => e.entity_id === 'praetorian_guard')!;
    const playerAfter = updatedEntities.find(e => e.entity_id === 'severus_alexander')!;

    expect(guard.relationships.severus_alexander.trust_level).toBe(-2 + 4);
    expect(guard.relationships.severus_alexander.recent_interactions).toContain('Turn 3: Promised a massive loyalty bonus.');
    expect(playerAfter.relationships.praetorian_guard.trust_level).toBe(playerTrustBefore);
    expect(event.trigger(INITIAL_WORLD_STATE, updatedEntities, playerAfter)).toBe(false);
  });

  it('every authored relation delta keys the faction first and the player second', () => {
    for (const event of ALL_EVENTS) {
      for (const option of event.options) {
        for (const delta of option.deltas.filter(d => d.type === 'relation')) {
          expect(delta.key.split(':')[1], `${event.id}: ${delta.key}`).toBe('PLAYER_CHARACTER');
        }
      }
    }
  });
});

// --- rules-rome-events-in-generated-worlds --------------------------------------

describe("Rome's authored events stay in Rome (rules-rome-events-in-generated-worlds)", () => {
  const unrest = makeSimulationState({ military_status: 'Divided', major_ongoing_crisis: 'War on every border', imperial_status: 'Contested' });

  it('a generated world without the Roman bodies meets none of them, fired or offered', async () => {
    const { worldState, playerStub, npcStubs } = await mockGenerateScenarioStructure('Horror in Britannia', 'An inquisitor');
    const entities = await mockGenerateEntitiesDetails(worldState, playerStub, npcStubs);
    const player = entities.find(e => e.entity_id === playerStub.entity_id)!;
    const failing = { ...worldState, economic_stability: 'Failing' };

    expect(checkForTriggeredEvent(failing, entities, [], player, unrest, 2)).toBeNull();
    expect(selectRipeEventMaterial(failing, unrest, entities, player, [], 2)).toEqual([]);
  });

  it('the base scenario still meets them', () => {
    const entities = structuredClone(ALL_INITIAL_ENTITIES);
    const player = entities.find(e => e.entity_id === 'severus_alexander')!;
    const failing = { ...structuredClone(INITIAL_WORLD_STATE), economic_stability: 'Failing' };
    expect(checkForTriggeredEvent(failing, entities, [], player, makeSimulationState(), 2)?.id).toBe('grain_shortage');
  });

  it("an event's roster is read from its own choices, never the placeholder", () => {
    expect(eventRosterIds(eventById('grain_shortage')).sort()).toEqual(['roman_senate', 'senatorial_party']);
    expect(eventRosterIds(eventById('praetorian_pay_crisis')).sort()).toEqual(['military_cabal', 'praetorian_guard']);
  });
});

// --- rules-rhine-fires-on-empty-crisis --------------------------------------------

describe('a blank crisis is no crisis (rules-rhine-fires-on-empty-crisis)', () => {
  it.each(['', '   '])('the Rhine acclamation stays quiet for a divided army under crisis %j', crisis => {
    const player = makeEntity();
    const rhine = eventById('rhine_acclamation');
    expect(rhine.trigger(makeWorldState(), [player], player, makeSimulationState({ military_status: 'Divided', major_ongoing_crisis: crisis }))).toBe(false);
  });

  it('a named crisis still gives a divided army its cover', () => {
    const player = makeEntity();
    const rhine = eventById('rhine_acclamation');
    expect(rhine.trigger(makeWorldState(), [player], player, makeSimulationState({ military_status: 'Divided', major_ongoing_crisis: 'Succession Crisis' }))).toBe(true);
  });
});

// --- rules-director-intent-for-player ---------------------------------------------

describe('Director intents never name the player (rules-director-intent-for-player)', () => {
  const relevance = makeStoryRelevance({
    spotlight_entities: [{ entity_id: 'p', reason: 'r' }, { entity_id: 'n', reason: 'r' }],
    spotlight_intents: [makeNpcIntent({ entity_id: 'p' }), makeNpcIntent({ entity_id: 'n' })],
  });

  it('selectDurableIntents drops an intent naming the player', () => {
    const durable = selectDurableIntents(relevance, [{ entity_id: 'p', status: 'alive' }, { entity_id: 'n', status: 'alive' }], 'p');
    expect(durable.map(i => i.entity_id)).toEqual(['n']);
  });

  it("the adjudication prompt's intents block never renders one", () => {
    const block = buildDirectorIntentsBlock(relevance.spotlight_intents, 'p');
    expect(block).toContain('- n:');
    expect(block).not.toContain('- p:');
    expect(buildDirectorIntentsBlock([makeNpcIntent({ entity_id: 'p' })], 'p')).toBe('');
  });

  it('Mock Mode as Maximinus Thrax commits no intent for him', async () => {
    const thrax = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'maximinus_thrax')!;
    const result = await mockRunNewTurn(
      { version: 1, kind: 'freeform', text: 'Rally the legions' }, thrax, 1, structuredClone(ALL_INITIAL_ENTITIES),
      structuredClone(INITIAL_WORLD_STATE), [], '', 'A crisis.', structuredClone(INITIAL_SIMULATION_STATE), [], [],
    );
    expect(result.updatedNpcIntents.map(i => i.entity_id)).not.toContain('maximinus_thrax');
  });
});

// --- rules-offscale-traits-auto-crit -----------------------------------------------

describe('skills and traits count only on their scales (rules-offscale-traits-auto-crit)', () => {
  const traits = (cunning: number) => ({ ambition: 5, paranoia: 5, loyalty: 5, cunning, honor: 5 });

  it('a 0-100 trait weighs no more than a 10', () => {
    const offScale = derivePersonalityModifier({ personality: traits(85), relevantSkill: 'intrigue', actionCategory: 'infiltration' });
    expect(offScale).toBe(derivePersonalityModifier({ personality: traits(10), relevantSkill: 'intrigue', actionCategory: 'infiltration' }));
  });

  it('a 90 skill cannot turn a natural 1 into a critical success', () => {
    const personalityModifier = derivePersonalityModifier({ personality: traits(85), relevantSkill: 'intrigue', actionCategory: 'infiltration' });
    const result = resolveAction({ roll: 1, relevantSkillValue: 90, personalityModifier, oppositionModifier: -5, difficulty: clampDifficulty(99) });
    expect(result.total).toBe(1 + 10 + 2.5 - 5);
    expect(result.tier).toBe('critical_failure');
    expect(resolveAction({ roll: 10, relevantSkillValue: -4, personalityModifier: 0, oppositionModifier: 0, difficulty: 10 }).total).toBe(10);
  });

  it("an investigation target's 0-100 paranoia and intrigue count as 10s", () => {
    const offScale = makeEntity({ personality: { ...traits(5), paranoia: 20 }, skills: { intrigue: 20 } });
    const topOfScale = makeEntity({ personality: { ...traits(5), paranoia: 10 }, skills: { intrigue: 10 } });
    expect(deriveInvestigationDifficulty(offScale)).toBe(22);
    expect(deriveInvestigationDifficulty(offScale)).toBe(deriveInvestigationDifficulty(topOfScale));
    const belowScale = makeEntity({ personality: { ...traits(5), paranoia: 0 }, skills: { intrigue: 10 } });
    expect(deriveInvestigationDifficulty(belowScale)).toBe(12 + (1 - 5) + (10 - 5));
  });

  it('world generation is told the 1-10 scales', () => {
    const properties = EntitySchema.properties as Record<string, { description?: string }>;
    expect(properties.personality.description).toContain('rated 1-10');
    expect(properties.skills.description).toContain('rated 1-10');
    const stub = { entity_id: 'a', name: 'A', entity_type: 'individual' as const, position: 'Legate', brief_description: 'A soldier.' };
    const { systemInstruction } = buildEntityBatchPrompt([stub], [stub], 'A crisis.', WORLD);
    expect(systemInstruction).toContain('from 1 to 10');
  });
});

// --- rules-feasibility-false-positives ----------------------------------------------

describe('a suggestion that names a cost without paying it survives (rules-feasibility-false-positives)', () => {
  it("keeps tailored suggestions a penniless, legionless player can act on", () => {
    const broke = makeEntity({ entity_id: 'broke', resources: { denarii: 0 } });
    const tailored = [
      'Refuse the bribe Thrax offers you',
      "Expose Thrax's bribery of the Guard before the Senate",
      'Pay special attention to the letters arriving from the Rhine',
      'Warn the Senate that Thrax may march the legions on Rome',
    ];
    expect(filterFeasibleSuggestedActions(tailored, broke)).toEqual(tailored);
  });

  it('still recognizes the actor paying for it', () => {
    for (const spending of ['Try to bribe the Praetorians', 'Pay off the Senate leadership', 'Bribe a guard at the palace gate', 'Offer a bribe to the tribune', 'Hire spies in the Curia']) {
      expect(getActivityResourceRequirement(spending)?.category, spending).toBe('financial');
    }
    expect(getActivityResourceRequirement('March the legions on Rome')?.category).toBe('military');
  });
});

// --- voice-stream-gate-inline-suggestion ----------------------------------------------

describe('the stream gate and the committed split share one marker (voice-stream-gate-inline-suggestion)', () => {
  /** The live composition turn.ts runs, fed one character at a time; returns every release. */
  function streamReleases(text: string): string[] {
    const extractor = createPayloadTextExtractor();
    const gate = createNarrationStreamGate();
    const visible = createPlayerVisibleStreamGate();
    const releases: string[] = [];
    for (const ch of JSON.stringify({ text, actors: [] })) {
      const released = visible.push(gate(extractor.push(ch)));
      if (released !== null) releases.push(released);
    }
    return releases;
  }

  it.each([
    ['inline', 'The gate holds. SUGGESTION: Bribe the guards.\nSUGGESTION: Visit the Curia.'],
    ['bold', 'The gate holds.\n**SUGGESTION:** Bribe the guards.\n**SUGGESTION:** Visit the Curia.'],
    ['bulleted', 'The gate holds.\n\n- SUGGESTION: Bribe the guards.\n- SUGGESTION: Visit the Curia.'],
    ['line-bold', 'The gate holds.\n**SUGGESTION: Bribe the guards.**\n**SUGGESTION: Visit the Curia.**'],
    ['numbered', 'The gate holds.\n1. SUGGESTION: Bribe the guards.\n2. SUGGESTION: Visit the Curia.'],
    ['numbered-paren', 'The gate holds.\n1) SUGGESTION: Bribe the guards.\n2) SUGGESTION: Visit the Curia.'],
    ['numbered-bold', 'The gate holds.\n\n1. **SUGGESTION:** Bribe the guards.\n2. **SUGGESTION:** Visit the Curia.'],
  ])('a %s marker never streams, and commits cleanly', (_label, text) => {
    for (const released of streamReleases(text)) {
      expect(released).not.toMatch(/SUGGESTION|Bribe|\*|\n\s*\d/);
    }
    expect(splitNarrationSuggestions(text)).toEqual({
      narration: 'The gate holds.',
      suggestions: ['Bribe the guards.', 'Visit the Curia.'],
    });
  });

  it('holds back markup and a partial marker until the stream proves what they are', () => {
    const gate = createNarrationStreamGate();
    expect(gate('The gate holds.\n**SUGG')).toBe('The gate holds.');
    expect(gate('The gate holds. **')).toBe('The gate holds.');
    expect(gate('The gate holds. **Rome** burns')).toBe('The gate holds. **Rome** burns');
    expect(gate('The gate holds.\n1. SUGG')).toBe('The gate holds.');
    expect(gate('The gate holds.\n2.')).toBe('The gate holds.');
    expect(gate('The gate holds.\n1. The legions wait')).toBe('The gate holds.\n1. The legions wait');
  });

  it("keeps an italic phrase that closes the narration, and a year that ends its sentence", () => {
    expect(splitNarrationSuggestions('He whispers *alea iacta est*\nSUGGESTION: Cross the river.').narration).toBe('He whispers *alea iacta est*');
    expect(splitNarrationSuggestions('It is the year 235.\nSUGGESTION: Cross the river.').narration).toBe('It is the year 235.');
    expect(createNarrationStreamGate()('It is the year 235.')).toBe('It is the year 235.');
  });

  it('keeps emphasis a suggestion opens and closes itself', () => {
    expect(splitNarrationSuggestions('The gate holds.\nSUGGESTION: Whisper *alea iacta est*\nSUGGESTION: Bribe *the* guards.**').suggestions)
      .toEqual(['Whisper *alea iacta est*', 'Bribe *the* guards.']);
  });
});

// --- mock-narration-leaks-entity-id ------------------------------------------------

describe('Mock Mode quotes the action as the player wrote it (mock-narration-leaks-entity-id)', () => {
  it('names a recipient by display name, never by entity id, and quotes no private intent', async () => {
    const alexander = ALL_INITIAL_ENTITIES.find(e => e.entity_id === 'severus_alexander')!;
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      messagesOrOrders: [{ recipient: { kind: 'known_entity', entityId: 'julia_mamaea', displayName: 'Julia Mamaea' }, command: 'Come to me at the ninth hour.' }],
      privateIntent: 'PRIVATE_INTENT_NOT_AN_ACTION',
    };
    const result = await mockRunNewTurn(
      submission, alexander, 1, structuredClone(ALL_INITIAL_ENTITIES), structuredClone(INITIAL_WORLD_STATE),
      [], '', 'A crisis.', structuredClone(INITIAL_SIMULATION_STATE), [], [],
    );
    expect(result.narration).toContain('To: Julia Mamaea\nCome to me at the ninth hour.');
    expect(result.narration).not.toContain('[julia_mamaea]');
    expect(result.narration).not.toContain('PRIVATE_INTENT_NOT_AN_ACTION');
  });
});

// --- knowledge-region-noop-announced (schema half) ---------------------------------

describe("the region delta's documented key is the one the engine applies (knowledge-region-noop-announced)", () => {
  it("documents '<region name>:stability', which changes the region's stability", () => {
    const keyDescription = AdjudicationSchema.properties.deltas.items.properties.key.description;
    expect(keyDescription).toContain("For 'region', use '<region name>:stability'");
    expect(keyDescription).not.toContain("use the region's name.");
    const { updatedWorldState } = applyDeltas([{ type: 'region', key: 'Rome:stability', delta: 0, reason: 'Riots' }], [], WORLD, 3);
    expect(updatedWorldState.regions.Rome.stability).toBe('Riots');
  });
});
