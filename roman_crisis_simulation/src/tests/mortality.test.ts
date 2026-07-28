/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rollD20,
  resolvePlayerDeathSave,
  resolveNpcFate,
  createSeededRng,
  PLAYER_DEATH_SAVE_TABLE,
  NPC_FATE_TABLE,
} from '../ai/core/resolution';
import { processMortality } from '../ai/core/mortality';
import { applyDeltas } from '../ai/core/engine';
import { buildMortalityOutcomePrompt } from '../ai/prompts/mortality';
import type { GeminiClient } from '../ai/core/geminiService';
import type { Adjudication, Entity } from '../types';

// --- fixtures -------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'test_entity',
    name: 'Test Entity',
    entity_type: 'individual',
    status: 'alive',
    location: 'Palatine Hill',
    relationships: {},
    memories: [],
    resources: { denarii: 1000 },
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

function makeAdjudication(deltas: Adjudication['deltas'] = []): Adjudication {
  return {
    turn: 5,
    entityActions: [],
    deltas,
    headlines: ['Something dramatic happened.'],
    gm_private: [],
  };
}

/** Minimal mock GeminiClient matching geminiService.test.ts's convention - a queue of raw-text responses. */
function makeMockAi(...responses: string[]): { ai: GeminiClient; generateContent: ReturnType<typeof vi.fn> } {
  const generateContent = vi.fn();
  responses.forEach(text => generateContent.mockResolvedValueOnce({ text }));
  return { ai: { models: { generateContent } }, generateContent };
}

describe('ai/core/resolution.ts', () => {
  describe('resolvePlayerDeathSave - all 20 rolls (D2)', () => {
    it('maps every roll to the exact documented band', () => {
      for (let roll = 1; roll <= 20; roll++) {
        const outcome = resolvePlayerDeathSave(roll);
        if (roll <= PLAYER_DEATH_SAVE_TABLE.DIES_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('dies');
          expect(outcome.dies).toBe(true);
          expect(outcome.needsLoss).toBe(false);
          expect(outcome.needsBoon).toBe(false);
        } else if (roll <= PLAYER_DEATH_SAVE_TABLE.SURVIVE_WITH_LOSS_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('survive_with_loss');
          expect(outcome.dies).toBe(false);
          expect(outcome.needsLoss).toBe(true);
          expect(outcome.needsBoon).toBe(false);
        } else if (roll <= PLAYER_DEATH_SAVE_TABLE.SURVIVE_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('survive');
          expect(outcome.dies).toBe(false);
          expect(outcome.needsLoss).toBe(false);
          expect(outcome.needsBoon).toBe(false);
        } else {
          expect(outcome.band, `roll ${roll}`).toBe('survive_with_boon');
          expect(outcome.dies).toBe(false);
          expect(outcome.needsLoss).toBe(false);
          expect(outcome.needsBoon).toBe(true);
        }
        expect(outcome.roll).toBe(roll);
      }
    });

    it('rejects rolls outside 1-20', () => {
      expect(() => resolvePlayerDeathSave(0)).toThrow();
      expect(() => resolvePlayerDeathSave(21)).toThrow();
      expect(() => resolvePlayerDeathSave(3.5)).toThrow();
    });
  });

  describe('resolveNpcFate - all 20 rolls (D3)', () => {
    it('maps every roll to the exact documented band', () => {
      for (let roll = 1; roll <= 20; roll++) {
        const outcome = resolveNpcFate(roll);
        if (roll <= NPC_FATE_TABLE.CONFIRMED_DEAD_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('confirmed_dead');
          expect(outcome.publicStatus).toBe('dead');
          expect(outcome.secretlyAlive).toBe(false);
          expect(outcome.needsLoss).toBe(false);
        } else if (roll <= NPC_FATE_TABLE.GRAVELY_WOUNDED_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('gravely_wounded');
          expect(outcome.publicStatus).toBe('alive');
          expect(outcome.secretlyAlive).toBe(false);
          expect(outcome.needsLoss).toBe(true);
        } else if (roll <= NPC_FATE_TABLE.PRESUMED_DEAD_MAX) {
          expect(outcome.band, `roll ${roll}`).toBe('presumed_dead');
          expect(outcome.publicStatus).toBe('dead');
          expect(outcome.secretlyAlive).toBe(true);
          expect(outcome.needsLoss).toBe(false);
        } else {
          expect(outcome.band, `roll ${roll}`).toBe('escapes_openly');
          expect(outcome.publicStatus).toBe('alive');
          expect(outcome.secretlyAlive).toBe(false);
          expect(outcome.needsLoss).toBe(false);
        }
        // The NPC fate table has no boon band (D3).
        expect(outcome.needsBoon).toBe(false);
        expect(outcome.roll).toBe(roll);
      }
    });

    it('rejects rolls outside 1-20', () => {
      expect(() => resolveNpcFate(0)).toThrow();
      expect(() => resolveNpcFate(21)).toThrow();
    });
  });

  describe('rollD20', () => {
    it('always returns an integer in [1, 20]', () => {
      for (let i = 0; i < 200; i++) {
        const roll = rollD20();
        expect(Number.isInteger(roll)).toBe(true);
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(20);
      }
    });
  });
});

describe('ai/core/mortality.ts processMortality', () => {
  const playerId = 'player_char';
  const npcId = 'senator_rufus';

  let player: Entity;
  let npc: Entity;
  let entities: Entity[];

  beforeEach(() => {
    player = makeEntity({ entity_id: playerId, name: 'Gaius Vibius', status: 'alive' });
    npc = makeEntity({ entity_id: npcId, name: 'Senator Rufus', status: 'alive' });
    entities = [player, npc];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mocks Math.random so rollD20() returns exactly `roll`. */
  function mockRoll(roll: number) {
    vi.spyOn(Math, 'random').mockReturnValue((roll - 1) / 20);
  }

  it('makes zero extra AI calls when the adjudication has no death claims', async () => {
    const adjudication = makeAdjudication([
      { type: 'resource', key: `${playerId}:denarii`, delta: 100, reason: 'Tax collection.' },
    ]);
    const { generateContent } = makeMockAi(); // no responses queued - any call would throw
    const ai: GeminiClient = { models: { generateContent } };

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(mortalityEvents).toEqual([]);
    expect(transformedAdjudication).toBe(adjudication);
  });

  it('bypasses entirely in mock mode, even with a death claim present', async () => {
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Struck down.', new_status: 'dead' },
    ]);
    const { generateContent } = makeMockAi();
    const ai: GeminiClient = { models: { generateContent } };

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, true
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(mortalityEvents).toEqual([]);
    expect(transformedAdjudication).toBe(adjudication);
  });

  it('invalidated death claim: strips the death, entity stays alive', async () => {
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Slain by an assassin.', new_status: 'dead' },
    ]);
    const { ai, generateContent } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: false, reasoning: 'No assassin was present this turn.' }] })
    );

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    expect(generateContent).toHaveBeenCalledTimes(1); // validation only - no roll, no outcome call
    expect(mortalityEvents).toHaveLength(1);
    expect(mortalityEvents[0]).toMatchObject({ entity_id: playerId, valid: false });
    expect(mortalityEvents[0].roll).toBeUndefined();

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === playerId);
    expect(statusDelta?.new_status).toBe('alive');

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    expect(updatedEntities.find(e => e.entity_id === playerId)?.status).toBe('alive');
  });

  it('invalidated death claim preserves a non-alive current status (exiled stays exiled)', async () => {
    // Vetoing a hallucinated death of an exiled entity must not quietly
    // restore them to 'alive'.
    npc.status = 'exiled';
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'Dies alone in exile.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: false, reasoning: 'Nothing in the turn supports this death.' }] })
    );

    const { transformedAdjudication } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId);
    expect(statusDelta?.new_status).toBe('exiled');

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    expect(updatedEntities.find(e => e.entity_id === npcId)?.status).toBe('exiled');
  });

  it('a forged secret_truth on the claim delta never survives an invalidated claim', async () => {
    const adjudication = makeAdjudication([
      {
        type: 'status', key: playerId, delta: 0, reason: 'Slain by an assassin.', new_status: 'dead',
        secret_truth: { actually_alive: true, hidden_since_turn: 1, motive: 'forged' },
      },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: false, reasoning: 'No assassin was present this turn.' }] })
    );

    const { transformedAdjudication } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === playerId);
    expect(statusDelta?.secret_truth).toBeUndefined();

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    expect(updatedEntities.find(e => e.entity_id === playerId)?.secret_truth).toBeUndefined();
  });

  it('validated player death, roll 3 -> dies (run ends)', async () => {
    mockRoll(3);
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Cut down in the Forum.', new_status: 'dead' },
    ]);
    const { ai, generateContent } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: true, reasoning: 'A real ambush occurred this turn.' }] })
    );

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    // 'dies' needs no outcome content - one call only.
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(mortalityEvents[0]).toMatchObject({ entity_id: playerId, valid: true, roll: 3, band: 'dies' });

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === playerId);
    expect(statusDelta?.new_status).toBe('dead');
  });

  it('validated player death, roll 8 -> survives with a real loss (applies loss deltas)', async () => {
    mockRoll(8);
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Ambushed on the road.', new_status: 'dead' },
    ]);
    const { ai, generateContent } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: true, reasoning: 'A real ambush occurred this turn.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: playerId,
            deltas: [{ type: 'resource', key: `${playerId}:denarii`, delta: -500, reason: 'Bribed the ambushers to let him live.' }],
            narrative_directive: 'Narrate a costly, humiliating escape.',
          },
        ],
      })
    );

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    expect(generateContent).toHaveBeenCalledTimes(2); // validation + outcome
    expect(mortalityEvents[0]).toMatchObject({ entity_id: playerId, valid: true, roll: 8, band: 'survive_with_loss' });
    expect(mortalityEvents[0].outcomeSummary).toBe('Narrate a costly, humiliating escape.');

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === playerId);
    expect(statusDelta?.new_status).toBe('alive');

    const lossDelta = transformedAdjudication.deltas.find(d => d.type === 'resource' && d.key === `${playerId}:denarii`);
    expect(lossDelta).toBeDefined();
    expect(lossDelta?.delta).toBe(-500);

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    const updatedPlayer = updatedEntities.find(e => e.entity_id === playerId)!;
    expect(updatedPlayer.status).toBe('alive');
    expect(updatedPlayer.resources.denarii).toBe(500); // 1000 - 500
  });

  it('rejects status deltas authored by the outcome call (security gate: only the fate roll decides status)', async () => {
    mockRoll(8);
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Ambushed on the road.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: true, reasoning: 'A real ambush occurred.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: playerId,
            deltas: [
              { type: 'resource', key: `${playerId}:denarii`, delta: -500, reason: 'Bribed the ambushers.' },
              // A rogue status delta targeting ANOTHER entity - must be dropped,
              // never applied: it would kill the NPC outside the fate pipeline.
              { type: 'status', key: npcId, delta: 0, reason: 'Cut down in the crossfire.', new_status: 'dead' },
            ],
            narrative_directive: 'Narrate a costly escape.',
          },
        ],
      })
    );

    const { transformedAdjudication } = await processMortality(ai, adjudication, entities, playerId, 5, false);

    // The safe side-effect delta survives; the rogue status delta does not.
    expect(transformedAdjudication.deltas.find(d => d.type === 'resource' && d.key === `${playerId}:denarii`)).toBeDefined();
    expect(transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId)).toBeUndefined();
    // The rejection is recorded for the GM console.
    expect(transformedAdjudication.gm_private.some(n => n.includes('REJECTED') && n.includes(npcId))).toBe(true);

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    expect(updatedEntities.find(e => e.entity_id === npcId)?.status).toBe('alive');
  });

  it('validated NPC death, roll 17 -> presumed dead: public status dead, secretly alive', async () => {
    mockRoll(17);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'Assassinated in his villa.', new_status: 'dead' },
    ]);
    const { ai, generateContent } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real assassination attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: npcId,
            deltas: [],
            narrative_directive: 'Narrate his apparent death as confirmed - do not hint at survival.',
            secret_motive: 'He faked his death to escape his creditors and plot revenge.',
          },
        ],
      })
    );

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 7, false
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(mortalityEvents[0]).toMatchObject({ entity_id: npcId, valid: true, roll: 17, band: 'presumed_dead' });

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId);
    expect(statusDelta?.new_status).toBe('dead'); // PUBLIC status stays dead
    expect(statusDelta?.secret_truth).toEqual({
      actually_alive: true,
      hidden_since_turn: 7,
      motive: 'He faked his death to escape his creditors and plot revenge.',
    });

    // Applying the delta: entity is publicly dead, but carries secret_truth.
    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 7);
    const updatedNpc = updatedEntities.find(e => e.entity_id === npcId)!;
    expect(updatedNpc.status).toBe('dead');
    expect(updatedNpc.secret_truth?.actually_alive).toBe(true);
  });

  it("the pipeline's own secretlyAlive write replaces, never merges with, a forged one", async () => {
    mockRoll(17);
    const forgedSecretTruth = { actually_alive: false, hidden_since_turn: 99, motive: 'FORGED' } as unknown as Entity['secret_truth'];
    const adjudication = makeAdjudication([
      {
        type: 'status', key: npcId, delta: 0, reason: 'Assassinated in his villa.', new_status: 'dead',
        secret_truth: forgedSecretTruth,
      },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real assassination attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: npcId,
            deltas: [],
            narrative_directive: 'Narrate his apparent death as confirmed - do not hint at survival.',
            secret_motive: 'He faked his death to escape his creditors and plot revenge.',
          },
        ],
      })
    );

    const { transformedAdjudication } = await processMortality(
      ai, adjudication, entities, playerId, 7, false
    );

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId);
    expect(statusDelta?.secret_truth).toEqual({
      actually_alive: true,
      hidden_since_turn: 7,
      motive: 'He faked his death to escape his creditors and plot revenge.',
    });
    expect(JSON.stringify(transformedAdjudication)).not.toContain('FORGED');
  });

  it('rejects a mortality outcome directive that exposes its hidden fate band and die result', async () => {
    mockRoll(17);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'Assassinated in his villa.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real assassination attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [{
          entity_id: npcId,
          deltas: [],
          narrative_directive: 'Expose presumed_dead because the die rolled 17.',
          secret_motive: 'He hides beyond the city.',
        }],
      }),
    );

    let thrown: unknown;
    try {
      await processMortality(ai, adjudication, entities, playerId, 7, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('player-visible mechanics boundary');
    expect((thrown as Error).message).not.toContain('presumed_dead');
    expect(adjudication.deltas[0]).toMatchObject({ new_status: 'dead', reason: 'Assassinated in his villa.' });
  });

  it('validated NPC death, roll 20 -> escapes openly: alive, no secret state', async () => {
    mockRoll(20);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead' },
    ]);
    const { ai, generateContent } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: npcId,
            deltas: [{ type: 'relation', key: `${npcId}:${playerId}:perceived_threat`, delta: 2, reason: 'Now knows an attempt was made publicly.' }],
            narrative_directive: 'Narrate a visible, witnessed escape.',
          },
        ],
      })
    );

    const { transformedAdjudication, mortalityEvents } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(mortalityEvents[0]).toMatchObject({ entity_id: npcId, valid: true, roll: 20, band: 'escapes_openly' });

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId);
    expect(statusDelta?.new_status).toBe('alive');
    expect(statusDelta?.secret_truth).toBeUndefined();

    const { updatedEntities } = applyDeltas(transformedAdjudication.deltas, entities, { year: 1, week: 1, economic_stability: '', political_climate: '', regions: {} }, 5);
    const updatedNpc = updatedEntities.find(e => e.entity_id === npcId)!;
    expect(updatedNpc.status).toBe('alive');
    expect(updatedNpc.secret_truth).toBeUndefined();
  });

  it('a forged secret_truth never survives a validated non-secret fate band', async () => {
    mockRoll(20);
    const adjudication = makeAdjudication([
      {
        type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead',
        secret_truth: { actually_alive: true, hidden_since_turn: 1, motive: 'forged' },
      },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [
          {
            entity_id: npcId,
            deltas: [],
            narrative_directive: 'Narrate a visible, witnessed escape.',
          },
        ],
      })
    );

    const { transformedAdjudication } = await processMortality(
      ai, adjudication, entities, playerId, 5, false
    );

    const statusDelta = transformedAdjudication.deltas.find(d => d.type === 'status' && d.key === npcId);
    expect(statusDelta?.secret_truth).toBeUndefined();
  });

  it.each([
    ['player resource', { type: 'resource', key: `${playerId}:denarii`, delta: -500, reason: 'The imperial treasury pays the price.' }],
    ['unrelated relation', { type: 'relation', key: `${playerId}:${playerId}:perceived_threat`, delta: -2, reason: 'The emperor now mistrusts himself.' }],
    ['world state', { type: 'world', key: 'political_climate', delta: 0, reason: 'The Empire collapses into panic.' }],
  ])('fails the mortality response before apply when an NPC outcome authors an unauthorized %s effect', async (_label, injectedDelta) => {
    mockRoll(20);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead' },
    ]);
    const original = JSON.parse(JSON.stringify(adjudication));
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [{
          entity_id: npcId,
          deltas: [injectedDelta],
          narrative_directive: 'Narrate a visible, witnessed escape.',
        }],
      }),
    );

    let thrown: unknown;
    try {
      await processMortality(ai, adjudication, entities, playerId, 5, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AI output violated the mortality outcome boundary.');
    expect((thrown as Error).message).not.toContain(injectedDelta.reason);
    expect(adjudication).toEqual(original);
  });

  it('allows all four candidate-owned mortality side-effect types with their existing valid shapes', async () => {
    mockRoll(20);
    npc.resources = { influence: 5 };
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [{
          entity_id: npcId,
          deltas: [
            { type: 'resource', key: `${npcId}:influence`, delta: -2, reason: 'His failed defense costs political standing.' },
            { type: 'relation', key: `${npcId}:${playerId}:perceived_threat`, delta: 2, reason: 'He now fears the imperial court.' },
            { type: 'scheme', key: npcId, delta: 0, reason: JSON.stringify({ name: 'Flight', overall_goal: 'Reach safety.', steps: [] }) },
            { type: 'rumor', key: npcId, delta: 0.8, reason: 'Rufus survived an assassin.', is_true: true, origin_id: npcId, topic: 'survival' },
          ],
          narrative_directive: 'Narrate a visible, witnessed escape.',
        }],
      }),
    );

    const { transformedAdjudication } = await processMortality(ai, adjudication, entities, playerId, 5, false);

    expect(transformedAdjudication.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resource', key: `${npcId}:influence`, delta: -2 }),
      expect.objectContaining({ type: 'relation', key: `${npcId}:${playerId}:perceived_threat`, delta: 2 }),
      expect.objectContaining({ type: 'scheme', key: npcId }),
      expect.objectContaining({ type: 'rumor', key: npcId, origin_id: npcId }),
    ]));
  });

  it('keeps the existing GM-traced status-delta drop when an NPC outcome tries to alter player status', async () => {
    mockRoll(20);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [{
          entity_id: npcId,
          deltas: [{ type: 'status', key: playerId, delta: 0, reason: 'The emperor falls too.', new_status: 'dead' }],
          narrative_directive: 'Narrate a visible, witnessed escape.',
        }],
      }),
    );

    const { transformedAdjudication } = await processMortality(ai, adjudication, entities, playerId, 5, false);

    expect(transformedAdjudication.deltas.find(delta => delta.type === 'status' && delta.key === playerId)).toBeUndefined();
    expect(transformedAdjudication.gm_private).toContainEqual(
      expect.stringContaining(`REJECTED a 'status' delta authored by the outcome call (key: ${playerId})`),
    );
  });

  it('accepts documented candidate-related fallout in either relation direction and a real third-party rumor origin', async () => {
    mockRoll(20);
    const adjudication = makeAdjudication([
      { type: 'status', key: npcId, delta: 0, reason: 'An assassin struck at the Senator.', new_status: 'dead' },
    ]);
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
      JSON.stringify({
        outcomes: [{
          entity_id: npcId,
          deltas: [
            { type: 'relation', key: `${playerId}:${npcId}:perceived_threat`, delta: 2, reason: 'The emperor sees Rufus as newly dangerous.' },
            { type: 'rumor', key: npcId, delta: 0.8, reason: 'Rufus survived an assassin.', is_true: true, origin_id: playerId, topic: 'survival' },
          ],
          narrative_directive: 'Narrate a visible, witnessed escape.',
        }],
      }),
    );

    const { transformedAdjudication } = await processMortality(ai, adjudication, entities, playerId, 5, false);

    expect(transformedAdjudication.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'relation', key: `${playerId}:${npcId}:perceived_threat` }),
      expect.objectContaining({ type: 'rumor', key: npcId, origin_id: playerId }),
    ]));
  });

  it('never mutates the original adjudication object passed in', async () => {
    mockRoll(3);
    const adjudication = makeAdjudication([
      { type: 'status', key: playerId, delta: 0, reason: 'Cut down.', new_status: 'dead' },
    ]);
    const originalDeltaReason = adjudication.deltas[0].reason;
    const { ai } = makeMockAi(
      JSON.stringify({ dispositions: [{ entity_id: playerId, valid: true, reasoning: 'Real.' }] })
    );

    await processMortality(ai, adjudication, entities, playerId, 5, false);

    expect(adjudication.deltas[0].reason).toBe(originalDeltaReason);
    expect(adjudication.deltas[0].new_status).toBe('dead');
    expect(adjudication.gm_private).toEqual([]);
  });

  it('draws fate rolls from a supplied seeded rng: same seed -> same roll/band, and Math.random is never touched', async () => {
    const randomSpy = vi.spyOn(Math, 'random');

    const run = async () => {
      const adjudication = makeAdjudication([
        { type: 'status', key: npcId, delta: 0, reason: 'Cut down in the Curia.', new_status: 'dead' },
      ]);
      const { ai } = makeMockAi(
        JSON.stringify({ dispositions: [{ entity_id: npcId, valid: true, reasoning: 'A real attempt occurred.' }] }),
        // Queued for bands whose content needs the outcome call; unused otherwise.
        JSON.stringify({ outcomes: [{ entity_id: npcId, deltas: [], narrative_directive: 'Narrate the aftermath.', secret_motive: null }] })
      );
      return processMortality(ai, adjudication, entities, playerId, 5, false, createSeededRng(0xc0ffee));
    };

    const first = await run();
    const second = await run();

    expect(first.mortalityEvents[0].roll).toBeGreaterThanOrEqual(1);
    expect(first.mortalityEvents[0].roll).toBeLessThanOrEqual(20);
    expect(second.mortalityEvents[0].roll).toBe(first.mortalityEvents[0].roll);
    expect(second.mortalityEvents[0].band).toBe(first.mortalityEvents[0].band);
    // The seeded generator's first draw reproduces the roll independently.
    expect(rollD20(createSeededRng(0xc0ffee))).toBe(first.mortalityEvents[0].roll);
    // With an rng supplied, nothing in the pipeline falls back to Math.random.
    expect(randomSpy).not.toHaveBeenCalled();
  });
});

describe('mortality outcome prompt authorization contract', () => {
  it('matches the existing fallout semantics enforced by the code boundary', () => {
    const { systemInstruction } = buildMortalityOutcomePrompt({
      candidates: [{
        entity_id: 'senator_rufus',
        name: 'Senator Rufus',
        isPlayer: false,
        band: 'escapes_openly',
        cause: 'An assassin struck.',
        entityBrief: 'Rufus is a senator in Rome.',
      }],
    });

    expect(systemInstruction).toContain('resource and scheme deltas MUST target the candidate');
    expect(systemInstruction).toContain('relation delta may place the candidate on either side');
    expect(systemInstruction).toContain('rumor key MUST be the candidate entity_id');
    expect(systemInstruction).toContain('origin_id may name any real entity who spreads it');
    expect(systemInstruction).not.toContain('origin_id MUST be the candidate');
  });
});
