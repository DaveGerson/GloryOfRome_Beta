/**
 * tests/director.test.ts
 *
 * The Director stage (ROADMAP_PHASE_4.md 4C item 3, DESIGN_DECISIONS.md
 * D10/D16/D22): storyRelevance upgraded to emit per-spotlight persistent
 * INTENTS with a continuity ruling, the adjudicator consuming those intents
 * as durable direction, and the code-side soft contract that every
 * spotlight holding an intent should have an entityAction.
 *
 * Covers the schema pair in lockstep (zStoryRelevance / StoryRelevanceSchema),
 * the Director prompt's previous-intents + bounded-memory-slice input
 * (memories load-bearing for the first time), the adjudication prompt's
 * intents block + act-in-service demand, the durable-intent
 * filter/cap (`selectDurableIntents`), the consistency-note builder, and
 * the mock-mode continuity loop running offline. Pipeline-level loop
 * threading is pinned in tests/turnPipeline.test.ts (scripted fake client).
 */
import { describe, it, expect } from 'vitest';
import { Type } from '@google/genai';
import { zStoryRelevance, zNpcIntent } from '../ai/core/zodSchemas';
import { StoryRelevanceSchema } from '../ai/core/schemas';
import { buildStoryRelevancePrompt, buildPreviousIntentsBlock, DIRECTOR_MEMORY_LINES } from '../ai/prompts/intelligence';
import { buildAdjudicationPrompt } from '../ai/prompts/adjudication';
import { buildDirectorIntentsBlock } from '../ai/prompts/fragments';
import { selectDurableIntents, buildIntentConsistencyNotes, MAX_NPC_INTENTS } from '../ai/core/turn';
import { mockGetStoryRelevance, mockRunNewTurn } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { Entity, EntityAction, NpcIntent, NpcIntentContinuityEnum, SimulationState, StoryRelevance } from '../types';

const SIM_STATE: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
};

function makeIntent(overrides: Partial<NpcIntent> = {}): NpcIntent {
  return { entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions', continuity: 'new', ...overrides };
}

function makeRelevance(overrides: Partial<StoryRelevance> = {}): StoryRelevance {
  return {
    spotlight_entities: [{ entity_id: 'maximinus_thrax', reason: 'Momentum.' }],
    spotlight_intents: [makeIntent()],
    ...overrides,
  };
}

// --- schema pair (zod + Gemini responseSchema, lockstep) -------------------

describe('Director schema pair: spotlight_intents in zStoryRelevance + StoryRelevanceSchema (lockstep)', () => {
  it('zStoryRelevance accepts a response carrying well-formed spotlight_intents', () => {
    const parsed = zStoryRelevance.parse({
      spotlight_entities: [{ entity_id: 'a', reason: 'r' }],
      spotlight_intents: [
        { entity_id: 'a', intent: 'Seize the grain supply', continuity: 'continue' },
        { entity_id: 'b', intent: 'Flee the city', continuity: 'pivot' },
      ],
    });
    expect(parsed.spotlight_intents).toHaveLength(2);
    expect(parsed.spotlight_intents[0].continuity).toBe('continue');
  });

  it('zStoryRelevance REQUIRES spotlight_intents - the old intent-less shape no longer validates', () => {
    expect(zStoryRelevance.safeParse({ spotlight_entities: [] }).success).toBe(false);
    // An empty list is fine (no spotlights picked) - only omission fails.
    expect(zStoryRelevance.safeParse({ spotlight_entities: [], spotlight_intents: [] }).success).toBe(true);
  });

  it('zNpcIntent rejects a continuity value outside the enum, and requires every intent field', () => {
    expect(zNpcIntent.safeParse({ entity_id: 'a', intent: 'x', continuity: 'meander' }).success).toBe(false);
    expect(zNpcIntent.safeParse({ entity_id: 'a', continuity: 'new' }).success).toBe(false);
    expect(zNpcIntent.safeParse({ intent: 'x', continuity: 'new' }).success).toBe(false);
    expect(zNpcIntent.safeParse({ entity_id: 'a', intent: 'x', continuity: 'new' }).success).toBe(true);
  });

  it('the Gemini responseSchema requires spotlight_intents with the SAME per-item fields and continuity enum (lockstep pin)', () => {
    expect(StoryRelevanceSchema.required).toContain('spotlight_intents');
    const intentsSchema = (StoryRelevanceSchema.properties as Record<string, any>).spotlight_intents;
    expect(intentsSchema.type).toBe(Type.ARRAY);
    expect(intentsSchema.items.required).toEqual(['entity_id', 'intent', 'continuity']);
    expect(intentsSchema.items.properties.continuity.enum).toEqual(NpcIntentContinuityEnum);
  });
});

// --- Director prompt: previous-intents block + bounded memory slices -------

describe('buildStoryRelevancePrompt: the Director input (previous intents, schemes, memory slices)', () => {
  function makeNpc(overrides: Partial<Entity> = {}): Entity {
    return {
      entity_id: 'maximinus_thrax',
      name: 'Maximinus Thrax',
      entity_type: 'individual',
      status: 'alive',
      position: 'General',
      location: 'Praetorian Camp',
      relationships: {},
      memories: [],
      resources: {},
      visibility_network: [],
      current_state_narrative: '',
      short_term_goals: [],
      long_term_ambitions: [],
      active_scheme: {
        name: 'The Thracian Ascent',
        overall_goal: 'Take the purple by force of the legions.',
        steps: [{ objective: 'Win the Rhine legions', status: 'in_progress' }],
      },
      ...overrides,
    };
  }

  it('carries the persistent-intent task and continuity rulings in the system instruction, alongside the storyteller marker', () => {
    const { systemInstruction } = buildStoryRelevancePrompt(3, [], getMockInitialState().worldState, [], []);
    // The stable classifier marker other tests key on must survive the upgrade.
    expect(systemInstruction).toContain('master storyteller and game master');
    expect(systemInstruction).toContain('Persistent Intents');
    for (const continuity of NpcIntentContinuityEnum) {
      expect(systemInstruction).toContain(`'${continuity}'`);
    }
    // Intents are GM-private direction (D4/D5).
    expect(systemInstruction).toContain('never reach the player');
  });

  it('feeds the previous turn\'s intents with each holder\'s active scheme and its last DIRECTOR_MEMORY_LINES perception-grounded memory lines', () => {
    const memories = Array.from({ length: DIRECTOR_MEMORY_LINES + 2 }, (_, i) => ({
      turn: i + 1,
      event_description: `Witnessed event number ${i + 1}`,
      emotional_impact: 'Notable',
      involved_entities: [],
    }));
    const npc = makeNpc({ memories });
    const previous = [makeIntent({ intent: 'Court the Rhine legions in secret', continuity: 'continue' })];

    const { prompt } = buildStoryRelevancePrompt(5, ['A mutiny brews.'], getMockInitialState().worldState, [npc], previous);

    expect(prompt).toContain("PREVIOUS TURN'S INTENTS");
    expect(prompt).toContain('Court the Rhine legions in secret');
    expect(prompt).toContain('continuity last turn: continue');
    expect(prompt).toContain('The Thracian Ascent: Take the purple by force of the legions.');
    // Bounded slice: the LAST five memory lines are present...
    for (let i = 3; i <= DIRECTOR_MEMORY_LINES + 2; i++) {
      expect(prompt).toContain(`Witnessed event number ${i}`);
    }
    // ...and the two oldest are excluded (whole-line pin: 'Witnessed event
    // number 1' would substring-match number 10+ if memories grew).
    expect(prompt).not.toContain('Witnessed event number 1\n');
    expect(prompt).not.toContain('Witnessed event number 2\n');
  });

  it('renders a none-on-record line when no previous intents exist, ruling everything new', () => {
    const { prompt } = buildStoryRelevancePrompt(1, [], getMockInitialState().worldState, [makeNpc()], []);
    expect(prompt).toContain('None on record');
    expect(prompt).toContain("'new'");
  });

  it('lists the alive cast with exact entity_ids and scheme one-liners, excluding the dead', () => {
    const alive = makeNpc();
    const dead = makeNpc({ entity_id: 'dead_senator', name: 'Dead Senator', status: 'dead', active_scheme: undefined });
    const { prompt } = buildStoryRelevancePrompt(2, [], getMockInitialState().worldState, [alive, dead], []);
    expect(prompt).toContain('CAST');
    expect(prompt).toContain('maximinus_thrax — Maximinus Thrax (General)');
    expect(prompt).not.toContain('dead_senator');
  });

  it('buildPreviousIntentsBlock tolerates an intent holder missing from the roster (removed entity) - intent line only, no scheme/memories', () => {
    const block = buildPreviousIntentsBlock([makeIntent({ entity_id: 'gone_entity', intent: 'A ghost of direction' })], []);
    expect(block).toContain('gone_entity');
    expect(block).toContain('A ghost of direction');
    expect(block).not.toContain('Active scheme');
    expect(block).not.toContain('Recent memories');
  });
});

// --- adjudication prompt: the intents block + act-in-service demand --------

describe('buildAdjudicationPrompt: the Director intents block (prompt lockstep)', () => {
  function buildPrompt(npcIntents?: NpcIntent[]): string {
    const { entities, worldState } = getMockInitialState();
    const { prompt } = buildAdjudicationPrompt({
      worldState,
      simulationState: SIM_STATE,
      playerEntity: entities[0],
      npcEntities: entities.slice(1),
      history: [],
      playerIntent: 'Hold court',
      gmInterventionText: '',
      storyRelevance: makeRelevance(),
      metaNarrative: 'A succession crisis.',
      npcIntents,
    });
    return prompt;
  }

  it('injects the SPOTLIGHT NPC INTENTS block with the act-in-service demand and each intent line', () => {
    const prompt = buildPrompt([
      makeIntent({ intent: 'March the Rhine legions on Rome', continuity: 'pivot' }),
      makeIntent({ entity_id: 'gaius_pontius_magnus', intent: 'Buy the Praetorians quietly', continuity: 'new' }),
    ]);
    expect(prompt).toContain('SPOTLIGHT NPC INTENTS');
    expect(prompt).toContain('act in service of their stated intent');
    expect(prompt).toContain('- maximinus_thrax: "March the Rhine legions on Rome" [pivot]');
    expect(prompt).toContain('- gaius_pontius_magnus: "Buy the Praetorians quietly" [new]');
    // GM-private discipline: the block itself forbids restating intents on player surfaces.
    expect(prompt).toContain('never restate them');
  });

  it('emits NO block for absent or empty intents - the pre-Director prompt shape', () => {
    expect(buildPrompt(undefined)).not.toContain('SPOTLIGHT NPC INTENTS');
    expect(buildPrompt([])).not.toContain('SPOTLIGHT NPC INTENTS');
    expect(buildDirectorIntentsBlock(undefined)).toBe('');
    expect(buildDirectorIntentsBlock([])).toBe('');
  });
});

// --- durable-intent selection + the soft consistency contract --------------

describe('selectDurableIntents: spotlights only, capped (4C.3)', () => {
  it('drops intents whose entity is not a spotlight pick', () => {
    const relevance = makeRelevance({
      spotlight_entities: [{ entity_id: 'a', reason: 'r' }],
      spotlight_intents: [
        makeIntent({ entity_id: 'a', intent: 'Kept' }),
        makeIntent({ entity_id: 'offstage', intent: 'Dropped' }),
      ],
    });
    const durable = selectDurableIntents(relevance);
    expect(durable).toHaveLength(1);
    expect(durable[0].intent).toBe('Kept');
  });

  it('caps at MAX_NPC_INTENTS in emission order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const relevance = makeRelevance({
      spotlight_entities: ids.map(id => ({ entity_id: id, reason: 'r' })),
      spotlight_intents: ids.map(id => makeIntent({ entity_id: id, intent: `Intent of ${id}` })),
    });
    const durable = selectDurableIntents(relevance);
    expect(durable).toHaveLength(MAX_NPC_INTENTS);
    expect(durable.map(i => i.entity_id)).toEqual(ids.slice(0, MAX_NPC_INTENTS));
  });
});

describe('buildIntentConsistencyNotes: the soft entityActions-vs-intent contract (4C.3)', () => {
  const actions: EntityAction[] = [
    { id: 'maximinus_thrax', intent: 'march', target: null, notes: 'The legions break camp.' },
  ];

  it('records one gm_private note per spotlight whose intent has no matching entityAction', () => {
    const notes = buildIntentConsistencyNotes(actions, [
      makeIntent(), // has an action - no note
      makeIntent({ entity_id: 'praetorian_guard', intent: 'Extract the donative first', continuity: 'continue' }),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('[Director]');
    expect(notes[0]).toContain('praetorian_guard');
    expect(notes[0]).toContain('Extract the donative first');
    // Soft contract: the note says so explicitly - nothing is forced.
    expect(notes[0]).toContain('soft contract');
  });

  it('records nothing when every intent holder acted, or when there are no intents', () => {
    expect(buildIntentConsistencyNotes(actions, [makeIntent()])).toEqual([]);
    expect(buildIntentConsistencyNotes([], [])).toEqual([]);
  });
});

// --- mock mode: the continuity loop runs offline ---------------------------

describe('mock mode: the Director loop runs offline (4C.3)', () => {
  it('mockGetStoryRelevance emits intents for the mock spotlight pair, ruling continuity from the previous intents', async () => {
    const fresh = await mockGetStoryRelevance(1);
    expect(fresh.spotlight_intents.map(i => i.entity_id)).toEqual(['maximinus_thrax', 'praetorian_guard']);
    expect(fresh.spotlight_intents.every(i => i.continuity === 'new')).toBe(true);
    expect(fresh.spotlight_intents.every(i => i.intent.length > 0)).toBe(true);

    const followUp = await mockGetStoryRelevance(2, [fresh.spotlight_intents[0]]);
    expect(followUp.spotlight_intents.find(i => i.entity_id === 'maximinus_thrax')?.continuity).toBe('continue');
    expect(followUp.spotlight_intents.find(i => i.entity_id === 'praetorian_guard')?.continuity).toBe('new');
  });

  it('mockRunNewTurn threads prior intents through and commits this turn\'s on the result AND the history entry', async () => {
    const { entities, worldState } = getMockInitialState();
    const player = entities[0];

    const first = await mockRunNewTurn('Hold court', player, 1, entities, worldState, [], '', 'A crisis.', SIM_STATE, [], []);
    expect(first.updatedNpcIntents.length).toBeGreaterThan(0);
    expect(first.updatedNpcIntents.every(i => i.continuity === 'new')).toBe(true);
    expect(first.newHistoryEntry.npcIntents).toEqual(first.updatedNpcIntents);

    // The loop: feeding turn 1's committed intents into turn 2 flips the
    // mock spotlights' continuity to 'continue'.
    const second = await mockRunNewTurn('Hold court again', player, 2, entities, worldState, [], '', 'A crisis.', SIM_STATE, [], first.updatedNpcIntents);
    expect(second.updatedNpcIntents.length).toBeGreaterThan(0);
    expect(second.updatedNpcIntents.every(i => i.continuity === 'continue')).toBe(true);
  });
});
