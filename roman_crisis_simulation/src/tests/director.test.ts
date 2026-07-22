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
import { selectDurableIntents, buildIntentConsistencyNotes, buildIntentDiscardNotes, MAX_NPC_INTENTS } from '../ai/core/turn';
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

/**
 * Minimal roster rows for selectDurableIntents' alive gate - it reads only
 * entity_id + status. Every id passed here is marked alive; a test that
 * needs a non-alive entity builds its own rows inline.
 */
function aliveRoster(...ids: string[]): { entity_id: string; status: Entity['status'] }[] {
  return ids.map(entity_id => ({ entity_id, status: 'alive' }));
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

  it('binds intent authoring to the character\'s own knowledge - the omniscient-to-bounded channel contract (pin)', () => {
    const { systemInstruction } = buildStoryRelevancePrompt(3, [], getMockInitialState().worldState, [], []);
    // The Director is told the intent text lands in the character's head
    // verbatim, so it must be phrased from the character's own knowledge...
    expect(systemInstruction).toContain('INTENT KNOWLEDGE BOUND');
    expect(systemInstruction).toContain('handed VERBATIM to that character\'s own simulated mind');
    // ...and must never smuggle cast-wide knowledge into it.
    expect(systemInstruction).toContain("NEVER reference another NPC's scheme, secret");
    expect(systemInstruction).toContain('did not witness or hear of');
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

  it('states the three-layer precedence in system instruction AND blocks, with the manifestation carve-out (pin)', () => {
    const { entities, worldState } = getMockInitialState();
    const { systemInstruction } = buildAdjudicationPrompt({
      worldState, simulationState: SIM_STATE, playerEntity: entities[0], npcEntities: entities.slice(1),
      history: [], playerIntent: 'Hold court', gmInterventionText: '', storyRelevance: makeRelevance(),
      metaNarrative: 'A succession crisis.',
    });
    // The precedence rule is stated once as a principle...
    expect(systemInstruction).toContain('DIRECTION PRECEDENCE');
    expect(systemInstruction).toContain('mind decision > Director intent > generic scheme rules');
    // ...and BOTH scheme-MUSTs defer to a mind decision instead of
    // contradicting it.
    expect(systemInstruction).toContain("must advance their 'active_scheme', unless overridden by that entity's mind decision");
    expect(systemInstruction).toContain('proactive action to advance their scheme, unless overridden by a mind decision');

    // The intents block's don't-drift demand is scoped the same way, and it
    // carries the resolution-layer-style carve-out: provenance stays
    // private, the acted-out move's public manifestation does not.
    const intentsBlock = buildDirectorIntentsBlock([makeIntent()]);
    // The cross-reference deliberately avoids the literal 'SPOTLIGHT NPC
    // DECISIONS' title so the block-absence pins elsewhere (prompt must not
    // contain the title when no decisions block exists) stay meaningful.
    expect(intentsBlock).toContain('UNLESS that NPC has an entry in the mind-decisions block');
    expect(intentsBlock).not.toContain('SPOTLIGHT NPC DECISIONS');
    expect(intentsBlock).toContain('mind decision > Director intent > generic scheme rules');
    expect(intentsBlock).toContain('What is private is the provenance');
    expect(intentsBlock).toContain('public manifestation may and should surface in headlines');
  });

  it('emits NO block for absent or empty intents - the pre-Director prompt shape', () => {
    expect(buildPrompt(undefined)).not.toContain('SPOTLIGHT NPC INTENTS');
    expect(buildPrompt([])).not.toContain('SPOTLIGHT NPC INTENTS');
    expect(buildDirectorIntentsBlock(undefined)).toBe('');
    expect(buildDirectorIntentsBlock([])).toBe('');
  });
});

// --- durable-intent selection + the soft consistency contract --------------

describe('selectDurableIntents: spotlights only, alive-gated, capped (4C.3)', () => {
  it('drops intents whose entity is not a spotlight pick', () => {
    const relevance = makeRelevance({
      spotlight_entities: [{ entity_id: 'a', reason: 'r' }],
      spotlight_intents: [
        makeIntent({ entity_id: 'a', intent: 'Kept' }),
        makeIntent({ entity_id: 'offstage', intent: 'Dropped' }),
      ],
    });
    const durable = selectDurableIntents(relevance, aliveRoster('a', 'offstage'));
    expect(durable).toHaveLength(1);
    expect(durable[0].intent).toBe('Kept');
  });

  it('drops an intent whose spotlighted entity is not alive in the roster - a just-died NPC carries no durable intent', () => {
    const relevance = makeRelevance({
      spotlight_entities: [
        { entity_id: 'alive_one', reason: 'r' },
        { entity_id: 'dead_one', reason: 'r' },
        { entity_id: 'exiled_one', reason: 'r' },
        { entity_id: 'ghost', reason: 'r' },
      ],
      spotlight_intents: [
        makeIntent({ entity_id: 'alive_one', intent: 'Kept' }),
        makeIntent({ entity_id: 'dead_one', intent: 'Dropped - died this turn' }),
        makeIntent({ entity_id: 'exiled_one', intent: 'Dropped - exiled' }),
        makeIntent({ entity_id: 'ghost', intent: 'Dropped - absent from roster entirely' }),
      ],
    });
    // dead_one/exiled_one ARE spotlight picks, but the roster shows them not
    // alive; ghost is absent from the roster. Only the alive spotlight's
    // intent may become durable direction fed to the next turn.
    const roster: { entity_id: string; status: Entity['status'] }[] = [
      { entity_id: 'alive_one', status: 'alive' },
      { entity_id: 'dead_one', status: 'dead' },
      { entity_id: 'exiled_one', status: 'exiled' },
    ];
    const durable = selectDurableIntents(relevance, roster);
    expect(durable.map(i => i.entity_id)).toEqual(['alive_one']);
  });

  it('caps at MAX_NPC_INTENTS in emission order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const relevance = makeRelevance({
      spotlight_entities: ids.map(id => ({ entity_id: id, reason: 'r' })),
      spotlight_intents: ids.map(id => makeIntent({ entity_id: id, intent: `Intent of ${id}` })),
    });
    const durable = selectDurableIntents(relevance, aliveRoster(...ids));
    expect(durable).toHaveLength(MAX_NPC_INTENTS);
    expect(durable.map(i => i.entity_id)).toEqual(ids.slice(0, MAX_NPC_INTENTS));
  });

  it('dedupes to ONE intent per entity_id, keeping the FIRST - a duplicate never crowds the cap', () => {
    const relevance = makeRelevance({
      spotlight_entities: [
        { entity_id: 'a', reason: 'r' },
        { entity_id: 'b', reason: 'r' },
        { entity_id: 'c', reason: 'r' },
        { entity_id: 'd', reason: 'r' },
      ],
      spotlight_intents: [
        makeIntent({ entity_id: 'a', intent: 'First for a' }),
        makeIntent({ entity_id: 'a', intent: 'Second for a - dropped' }),
        makeIntent({ entity_id: 'b', intent: 'For b' }),
        makeIntent({ entity_id: 'c', intent: 'For c' }),
        makeIntent({ entity_id: 'd', intent: 'For d' }),
      ],
    });
    const durable = selectDurableIntents(relevance, aliveRoster('a', 'b', 'c', 'd'));
    // Without the dedupe, a's duplicate would consume a cap slot and push
    // d's intent out; with it, all four spotlights keep one intent each.
    expect(durable.map(i => i.entity_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(durable.find(i => i.entity_id === 'a')?.intent).toBe('First for a');
  });
});

describe('buildIntentDiscardNotes: the silent-wipe trace (4C.3)', () => {
  it('records one gm_private note when the Director emitted intents but ALL failed the spotlight filter', () => {
    const relevance = makeRelevance({
      spotlight_entities: [{ entity_id: 'a', reason: 'r' }],
      spotlight_intents: [
        makeIntent({ entity_id: 'ghost_1', intent: 'x' }),
        makeIntent({ entity_id: 'ghost_2', intent: 'y' }),
      ],
    });
    const durable = selectDurableIntents(relevance, aliveRoster('a'));
    expect(durable).toEqual([]);
    const notes = buildIntentDiscardNotes(relevance, durable);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('[Director]');
    expect(notes[0]).toContain('2 emitted intent(s) were discarded');
    expect(notes[0]).toContain('ghost_1, ghost_2');
    expect(notes[0]).toContain('None on record');
  });

  it('records nothing when any intent survives, when none were emitted, or when no spotlights exist', () => {
    // A surviving intent: no wipe happened.
    const surviving = makeRelevance();
    expect(buildIntentDiscardNotes(surviving, selectDurableIntents(surviving, aliveRoster('maximinus_thrax')))).toEqual([]);
    // Legitimate empty emission: nothing was discarded.
    const empty = makeRelevance({ spotlight_intents: [] });
    expect(buildIntentDiscardNotes(empty, selectDurableIntents(empty, aliveRoster('maximinus_thrax')))).toEqual([]);
    // No spotlights at all: the filter dropping everything is the contract,
    // not a wipe worth tracing.
    const noSpotlights = makeRelevance({ spotlight_entities: [], spotlight_intents: [makeIntent()] });
    expect(buildIntentDiscardNotes(noSpotlights, selectDurableIntents(noSpotlights, aliveRoster('maximinus_thrax')))).toEqual([]);
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
