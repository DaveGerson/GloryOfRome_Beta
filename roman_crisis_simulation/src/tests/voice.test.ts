/**
 * tests/voice.test.ts
 *
 * Voice & epithet (ROADMAP_PHASE_4.md 4C item 5, DESIGN_DECISIONS.md D10):
 * optional narrative-flavor fields on Entity so minds and narration speak
 * in character.
 *
 * Covers: the schema trio in lockstep (types.ts / zEntity / EntitySchema +
 * CharacterCreationEntitySchema - both fields OPTIONAL, never required, for
 * save/legacy compatibility), THE LEGACY PIN (entities without the fields
 * flow through every builder emitting NOTHING - never the literal string
 * "undefined"), the mind prompt carrying the character's OWN voice, the
 * narration prompt's bounded CAST VOICES block (selected from player-visible
 * event subjects, capped, never the whole roster) threaded through
 * the real pipeline, the epithet-only rule for the omniscient adjudicator
 * briefs (voice never enters getEntityBrief), base-scenario authoring
 * completeness, and the generation prompts requesting both fields. The
 * persistence round-trip lives in tests/persistence.test.ts with its
 * siblings.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Type } from '@google/genai';
import type { GoogleGenAI } from '@google/genai';
import { zEntity } from '../ai/core/zodSchemas';
import { EntitySchema, CharacterCreationEntitySchema } from '../ai/core/schemas';
import { getEntityBrief, buildSpotlightBlock } from '../ai/prompts/fragments';
import { buildMindSelfBrief, buildNpcMindPrompt } from '../ai/prompts/npcMind';
import { buildNarrationPrompt, buildVoiceCastBlock, selectVoiceCast, MAX_VOICE_CAST } from '../ai/prompts/narration';
import { buildEntityBatchPrompt } from '../ai/prompts/worldGen';
import { buildCharacterCreationPrompt } from '../ai/prompts/characterCreation';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { mockCreateCharacter, mockGenerateEntitiesDetails, mockGenerateScenarioStructure } from '../ai/mocks';
import { ALL_INITIAL_ENTITIES } from '../constants/baseScenario';
import type { Entity, SimulationState, WorldState } from '../types';

// --- fixtures --------------------------------------------------------------

const VOICE_A = 'clipped soldier cadence, all iron and grudge';
const EPITHET_A = 'the Iron Hand';
const VOICE_C = 'honeyed auctioneer patter, every favor priced';
const EPITHET_C = 'the Gilded Tongue';
const BYSTANDER_VOICE = 'reedy scholarly drone, dates and precedents';
const BYSTANDER_EPITHET = 'the Archivist';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'npc_generic',
    name: 'Generic Roman',
    entity_type: 'individual',
    status: 'alive',
    location: 'Palatine Hill',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: 'A Roman.',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

/** A pre-4C.5 entity: no voice, no epithet - the legacy-save shape. */
function makeLegacyEntity(overrides: Partial<Entity> = {}): Entity {
  const entity = makeEntity(overrides);
  expect(entity.voice).toBeUndefined();
  expect(entity.epithet).toBeUndefined();
  return entity;
}

afterEach(() => {
  // Drain any capture left active by a test that failed before turn.ts's
  // own catch could call endTurnCapture() itself.
  endTurnCapture();
});

// --- schema trio (types.ts / zod / Gemini responseSchema, lockstep) --------

describe('entity schema pair: voice/epithet optional in zEntity + EntitySchema (lockstep)', () => {
  it('zEntity accepts and round-trips both fields', () => {
    const parsed = zEntity.parse({ ...makeEntity(), voice: VOICE_A, epithet: EPITHET_A });
    expect(parsed.voice).toBe(VOICE_A);
    expect(parsed.epithet).toBe(EPITHET_A);
  });

  it('zEntity accepts a LEGACY entity without the fields, and explicit nulls (model may emit them)', () => {
    const legacy = zEntity.parse(makeLegacyEntity());
    expect(legacy.voice).toBeUndefined();
    expect(legacy.epithet).toBeUndefined();
    expect(zEntity.safeParse({ ...makeEntity(), voice: null, epithet: null }).success).toBe(true);
  });

  it('zEntity rejects non-string values', () => {
    expect(zEntity.safeParse({ ...makeEntity(), voice: 42 }).success).toBe(false);
    expect(zEntity.safeParse({ ...makeEntity(), epithet: ['the', 'Thracian'] }).success).toBe(false);
  });

  it('EntitySchema declares both as nullable strings and NEVER requires them (save-compat pin)', () => {
    const properties = EntitySchema.properties as Record<string, { type: unknown; nullable?: boolean }>;
    for (const field of ['voice', 'epithet']) {
      expect(properties[field].type).toBe(Type.STRING);
      expect(properties[field].nullable).toBe(true);
      expect(EntitySchema.required).not.toContain(field);
    }
  });

  it('CharacterCreationEntitySchema carries the same optional pair (character creation requests them)', () => {
    const properties = CharacterCreationEntitySchema.properties as Record<string, { type: unknown; nullable?: boolean }>;
    for (const field of ['voice', 'epithet']) {
      expect(properties[field].type).toBe(Type.STRING);
      expect(properties[field].nullable).toBe(true);
      expect(CharacterCreationEntitySchema.required).not.toContain(field);
    }
  });
});

// --- THE LEGACY PIN: absent fields emit NOTHING, never "undefined" ----------

describe('legacy entities flow through every builder with no "undefined" artifacts', () => {
  const legacy = makeLegacyEntity({ entity_id: 'npc_legacy', name: 'Old Save Roman' });

  it('getEntityBrief: no epithet renders exactly as before, never the string "undefined"', () => {
    const brief = getEntityBrief(legacy);
    expect(brief).toContain('Old Save Roman (individual)');
    expect(brief).not.toContain('undefined');
  });

  it('buildMindSelfBrief: no voice line, no epithet, never "undefined"', () => {
    const brief = buildMindSelfBrief(legacy);
    expect(brief).toContain('You are Old Save Roman (entity_id: npc_legacy)');
    expect(brief).not.toContain('Your voice');
    expect(brief).not.toContain('undefined');
  });

  it('buildNpcMindPrompt: a whole legacy mind prompt carries no "undefined" artifact', () => {
    const { systemInstruction, prompt } = buildNpcMindPrompt({
      self: legacy, perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year: 235, Week: 4.', turnNumber: 5,
    });
    expect(`${systemInstruction}\n${prompt}`).not.toContain('undefined');
  });

  it('buildVoiceCastBlock: an all-legacy cast emits NO block; empty input emits nothing', () => {
    expect(buildVoiceCastBlock([legacy, makeLegacyEntity({ entity_id: 'npc_legacy_2' })])).toBe('');
    expect(buildVoiceCastBlock([])).toBe('');
  });

  it('buildNarrationPrompt: default/legacy call sites produce no CAST VOICES block and no "undefined"', () => {
    const withoutCast = buildNarrationPrompt('A crisis.', legacy, 'Hold court', [], []);
    expect(withoutCast.prompt).not.toContain('CAST VOICES');
    expect(withoutCast.prompt).not.toContain('undefined');
    // ...and an explicitly all-legacy cast behaves identically.
    const withLegacyCast = buildNarrationPrompt('A crisis.', legacy, 'Hold court', [], [makeLegacyEntity()]);
    expect(withLegacyCast.prompt).not.toContain('CAST VOICES');
    expect(withLegacyCast.prompt).not.toContain('undefined');
  });
});

// --- consumption: brief (epithet only), mind (own voice), narration block ---

describe('getEntityBrief: epithet only - voice never enters the omniscient briefs', () => {
  it('rides the epithet with the name and keeps the voice directive out', () => {
    const flavored = makeEntity({ name: 'Titus Ferrus', position: 'General', voice: VOICE_A, epithet: EPITHET_A });
    const brief = getEntityBrief(flavored);
    expect(brief).toContain(`Titus Ferrus "${EPITHET_A}" (General)`);
    expect(brief).not.toContain(VOICE_A);
    // The same holds through the spotlight block the adjudication prompt uses.
    const block = buildSpotlightBlock([flavored]);
    expect(block).toContain(`"${EPITHET_A}"`);
    expect(block).not.toContain(VOICE_A);
  });
});

describe('buildNpcMindPrompt: the character\'s OWN voice/epithet, in the self-brief', () => {
  it('carries the voice directive and the epithet on the identity line when present', () => {
    const self = makeEntity({ entity_id: 'npc_ferrus', name: 'Titus Ferrus', position: 'General', voice: VOICE_A, epithet: EPITHET_A });
    const brief = buildMindSelfBrief(self);
    expect(brief).toContain(`You are Titus Ferrus "${EPITHET_A}", General (entity_id: npc_ferrus)`);
    expect(brief).toContain(`Your voice - think and speak in this register through every word of your response: ${VOICE_A}.`);
    // And it reaches the assembled prompt.
    const { prompt } = buildNpcMindPrompt({
      self, perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year: 235, Week: 4.', turnNumber: 5,
    });
    expect(prompt).toContain(VOICE_A);
    expect(prompt).toContain(EPITHET_A);
  });
});

describe('buildVoiceCastBlock: bounded flavor lines with the sound-distinct guidance', () => {
  it('renders voice+epithet, voice-only, and epithet-only lines correctly', () => {
    const block = buildVoiceCastBlock([
      makeEntity({ name: 'Titus Ferrus', voice: VOICE_A, epithet: EPITHET_A }),
      makeEntity({ entity_id: 'npc_b', name: 'Voice Only', voice: VOICE_C }),
      makeEntity({ entity_id: 'npc_c', name: 'Epithet Only', epithet: BYSTANDER_EPITHET }),
    ]);
    expect(block).toContain('CAST VOICES');
    expect(block).toContain(`- Titus Ferrus "${EPITHET_A}": ${VOICE_A}`);
    expect(block).toContain(`- Voice Only: ${VOICE_C}`);
    expect(block).toContain(`- Epithet Only "${BYSTANDER_EPITHET}"`);
    expect(block).not.toContain('undefined');
    // The guidance: distinct-sounding quotes, flavor never adds facts.
    expect(block).toContain('let them SOUND like themselves');
    expect(block).toContain('never add events, facts, or knowledge');
  });
});

describe('selectVoiceCast: spotlight + acting entities only, deduped, capped', () => {
  it('keeps spotlight-first order, dedupes, skips unknown ids and flavorless entities', () => {
    const roster = [
      makeEntity({ entity_id: 'npc_a', voice: VOICE_A }),
      makeEntity({ entity_id: 'npc_b', epithet: EPITHET_C }),
      makeLegacyEntity({ entity_id: 'npc_plain' }),
    ];
    const picked = selectVoiceCast(['npc_a', 'npc_plain'], ['npc_missing', 'npc_a', 'npc_b'], roster);
    expect(picked.map(e => e.entity_id)).toEqual(['npc_a', 'npc_b']);
  });

  it('caps at MAX_VOICE_CAST, with flavorless entities dropped BEFORE the cap', () => {
    const flavored = Array.from({ length: MAX_VOICE_CAST + 2 }, (_, i) =>
      makeEntity({ entity_id: `npc_v${i}`, voice: `voice ${i}` }));
    const legacyIds = Array.from({ length: 3 }, (_, i) => `npc_plain${i}`);
    const roster = [...legacyIds.map(id => makeLegacyEntity({ entity_id: id })), ...flavored];
    // Legacy ids come FIRST in the id stream - they must not crowd the cap.
    const picked = selectVoiceCast([...legacyIds, ...flavored.map(e => e.entity_id)], [], roster);
    expect(picked).toHaveLength(MAX_VOICE_CAST);
    expect(picked.map(e => e.entity_id)).toEqual(flavored.slice(0, MAX_VOICE_CAST).map(e => e.entity_id));
  });
});

// --- pipeline: the narration call receives the on-stage voices --------------

const SIM_STATE: SimulationState = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Uneasy',
  major_ongoing_crisis: null,
};

const WORLD_STATE: WorldState = {
  year: 235,
  week: 4,
  economic_stability: 'Strained',
  political_climate: 'Volatile',
  regions: {
    'Palatine Hill': { stability: 'Tense', controlling_faction: null, current_events: [] },
  },
};

/** Classifies a call by its stable systemInstruction markers (the convention from tests/npcMinds.test.ts / turnPipeline.test.ts). */
function classifyCall(systemInstruction: string, contents: string): string {
  if (systemInstruction.includes('master storyteller and game master')) return 'storyRelevance';
  if (systemInstruction.includes('Action Assessor')) return 'assessment';
  if (systemInstruction.includes("character's own private mind")) {
    const match = contents.match(/entity_id: (\w+)/);
    return `npcMind:${match?.[1] ?? 'unknown'}`;
  }
  if (systemInstruction.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
  if (systemInstruction.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (systemInstruction.includes('the inner voice of')) return 'monologue';
  if (systemInstruction.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
  throw new Error(`voice test fake: unrecognized call. systemInstruction: ${systemInstruction.slice(0, 120)}`);
}

function createHarness(responses: Record<string, string>) {
  const prompts: Record<string, string> = {};
  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const systemInstruction = typeof params.config?.systemInstruction === 'string' ? params.config.systemInstruction : '';
    const kind = classifyCall(systemInstruction, params.contents);
    prompts[kind] = params.contents;
    const scripted = responses[kind];
    if (scripted === undefined) throw new Error(`voice test fake: no scripted response for '${kind}'`);
    return { text: scripted };
  });
  const ai = { models: { generateContent } } as unknown as GoogleGenAI;
  return { ai, prompts };
}

describe('runNewTurn: the narration prompt carries the BOUNDED visible-event voice cast', () => {
  it('includes voices for player-visible event subjects, excludes bystanders, keeps voice out of the adjudicator', async () => {
    const player = makeLegacyEntity({ entity_id: 'player_1', name: 'Gaius Testus' });
    // Spotlight (and mind-eligible) NPC with full flavor.
    const npcA = makeEntity({ entity_id: 'npc_a', name: 'Titus Ferrus', position: 'General', voice: VOICE_A, epithet: EPITHET_A });
    // NOT a spotlight, but ACTS this turn (entityActions) - an involved entity.
    const npcC = makeEntity({ entity_id: 'npc_c', name: 'Aulus Blandus', voice: VOICE_C, epithet: EPITHET_C });
    // Carries flavor but is neither spotlighted nor acting - stays OUT of the block.
    const bystander = makeEntity({ entity_id: 'npc_bystander', name: 'Quintus Custos', voice: BYSTANDER_VOICE, epithet: BYSTANDER_EPITHET });

    const responses: Record<string, string> = {
      storyRelevance: JSON.stringify({
        spotlight_entities: [{ entity_id: 'npc_a', reason: 'On the move.' }],
        spotlight_intents: [],
      }),
      assessment: JSON.stringify({
        is_consequential: false, action_category: 'idle conversation', relevant_skill: null,
        difficulty: 10, opposing_entity_id: null, rationale: 'No real risk.',
      }),
      'npcMind:npc_a': JSON.stringify({
        entity_id: 'npc_a', chosen_action: 'March at dawn.', method: 'Quietly.', private_reasoning: 'Mine alone.',
      }),
      adjudication: JSON.stringify({
        turn: 5,
        entityActions: [
          { id: 'npc_a', intent: 'march', target: null, notes: 'The column moves.', actors: ['npc_a'] },
          { id: 'npc_c', intent: 'intrigue', target: 'player_1', notes: 'A whisper campaign.', actors: ['npc_c'] },
        ],
        deltas: [
          { type: 'resource', key: 'npc_a:denarii', delta: 1, reason: 'A visible payment.', actors: ['npc_a'] },
          { type: 'resource', key: 'npc_c:denarii', delta: 1, reason: 'A visible payment.', actors: ['npc_c'] },
        ],
        headlines: [{ text: 'The column moves.', actors: ['npc_a'] }], gm_private: [],
      }),
      // Raw provider interchange (zSimulationState): the committed SIM_STATE
      // fixture plus the actors-attribution sibling a real captured
      // response carries.
      simulationState: JSON.stringify({ ...SIM_STATE, actors: [] }),
      // Task 4: getPlayerMonologue/narration are structured-output calls -
      // RAW PROVIDER INTERCHANGE shape ({text, actors}); actors: [] (an
      // observable-attempt-only fixture, where the declared-actors gate is
      // inert regardless).
      monologue: JSON.stringify({ text: 'I watch the roads.', actors: [] }),
      narration: JSON.stringify({ text: 'The city stirs.\nSUGGESTION: Wait', actors: [] }),
    };
    const harness = createHarness(responses);

    await runNewTurn(
      harness.ai, 'Hold court', player, 5, [player, npcA, npcC, bystander], WORLD_STATE, SIM_STATE,
      [], [], [], [], '', false, 'Grim political thriller'
    );

    // The narration prompt carries the CAST VOICES block for exactly the
    // NPCs already named by player-visible events...
    const narrationPrompt = harness.prompts.narration;
    expect(narrationPrompt).toContain('CAST VOICES');
    expect(narrationPrompt).toContain(`- Titus Ferrus "${EPITHET_A}": ${VOICE_A}`);
    expect(narrationPrompt).toContain(`- Aulus Blandus "${EPITHET_C}": ${VOICE_C}`);
    // ...and NOT the flavored bystander (bounded: never the whole roster).
    expect(narrationPrompt).not.toContain(BYSTANDER_VOICE);
    expect(narrationPrompt).not.toContain('undefined');

    // The mind prompt spoke in the character's own voice...
    expect(harness.prompts['npcMind:npc_a']).toContain(VOICE_A);
    // ...while the omniscient adjudicator brief got the epithet ONLY.
    expect(harness.prompts.adjudication).toContain(`"${EPITHET_A}"`);
    expect(harness.prompts.adjudication).not.toContain(VOICE_A);
    expect(harness.prompts.adjudication).not.toContain(BYSTANDER_VOICE);
  });
});

// --- authoring completeness: base cast + mocks ------------------------------

describe('base scenario: every entity carries an authored voice and epithet (4C.5 completeness)', () => {
  it('all initial entities have non-empty voice and epithet', () => {
    for (const entity of ALL_INITIAL_ENTITIES) {
      expect(entity.voice, `${entity.entity_id} missing voice`).toBeTruthy();
      expect(entity.epithet, `${entity.entity_id} missing epithet`).toBeTruthy();
    }
  });

  it('voices and epithets are DISTINCT across the cast', () => {
    const voices = ALL_INITIAL_ENTITIES.map(e => e.voice);
    const epithets = ALL_INITIAL_ENTITIES.map(e => e.epithet);
    expect(new Set(voices).size).toBe(voices.length);
    expect(new Set(epithets).size).toBe(epithets.length);
  });
});

describe('mock entities carry voice/epithet like real worldgen output', () => {
  it('mockCreateCharacter and mockGenerateEntitiesDetails entities all carry both fields', async () => {
    const created = await mockCreateCharacter('a stern veteran');
    expect(created.voice).toBeTruthy();
    expect(created.epithet).toBeTruthy();

    const structure = await mockGenerateScenarioStructure('meta', 'player');
    const generated = await mockGenerateEntitiesDetails(structure.worldState, structure.playerStub, structure.npcStubs);
    for (const entity of generated) {
      expect(entity.voice, `${entity.entity_id} missing voice`).toBeTruthy();
      expect(entity.epithet, `${entity.entity_id} missing epithet`).toBeTruthy();
    }
  });
});

// --- generation prompts request the fields ----------------------------------

describe('generation prompts ask for voice/epithet (prompt + schema in lockstep)', () => {
  it('the world-gen entity-batch prompt requests both fields for every entity', () => {
    const stub = { entity_id: 'npc_x', name: 'X', entity_type: 'individual' as const, position: 'Senator', brief_description: 'A senator.' };
    const { systemInstruction } = buildEntityBatchPrompt([stub], [stub], 'A crisis.', WORLD_STATE);
    expect(systemInstruction).toContain("'voice'");
    expect(systemInstruction).toContain("'epithet'");
    expect(systemInstruction).toContain('DISTINCT');
  });

  it('the character-creation prompt requests both fields', () => {
    const { systemInstruction } = buildCharacterCreationPrompt('a cunning merchant', []);
    expect(systemInstruction).toContain("'voice'");
    expect(systemInstruction).toContain("'epithet'");
  });
});
