/**
 * tests/npcMinds.test.ts
 *
 * The NPC minds stage (ROADMAP_PHASE_4.md 4C item 4, DESIGN_DECISIONS.md
 * D10/D16/D22): per-spotlight mind calls with BOUNDED knowledge, feeding
 * the adjudicator their decisions (never their private reasoning), run in
 * one parallel flash-tier leg between the Director and adjudication.
 *
 * Covers: the schema pair in lockstep (zNpcMindDecision /
 * NpcMindDecisionSchema), THE ASYMMETRY PIN (a rival's secret scheme
 * present in world state must not appear in a mind's prompt while the
 * mind's own scheme must), pipeline threading with a scripted fake client
 * (minds between storyRelevance and adjudication; decisions in the
 * adjudication prompt; private_reasoning NOT), per-mind soft failure
 * degradation, mind selection (alive/non-player/capped), the mock path,
 * and the history entry's snapshot-window trim. The TurnStage record
 * exhaustiveness is enforced at compile time (components/Chat.tsx's
 * Record<TurnStage, string>); the persistence round-trip lives in
 * tests/persistence.test.ts with its siblings.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Type } from '@google/genai';
import type { GoogleGenAI } from '@google/genai';
import { zNpcMindDecision } from '../ai/core/zodSchemas';
import { NpcMindDecisionSchema } from '../ai/core/schemas';
import { buildNpcMindPrompt, buildMindSelfBrief, MAX_MINDS_PER_TURN, MIND_MEMORY_LINES } from '../ai/prompts/npcMind';
import { buildNpcMindDecisionsBlock } from '../ai/prompts/fragments';
import { runNewTurn, selectMindEntities } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { withOldSnapshotsDropped, KEEP_FULL_SNAPSHOTS } from '../state/gameReducer';
import { mockRunNewTurn, mockGetNpcMindDecision } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE } from '../constants/baseScenario';
import type { Entity, NpcMindDecision, SimulationState, StoryRelevance, TurnHistoryEntry, WorldState } from '../types';

// --- fixtures --------------------------------------------------------------

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
    'Praetorian Camp': { stability: 'Wavering', controlling_faction: null, current_events: [] },
  },
};

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

// The asymmetry cast: A and B are BOTH spotlights; each holds a secret
// scheme and secrets the OTHER's mind must never see. They are placed in
// different locations with empty visibility networks so neither's vantage
// admits the other's private deltas either.
const RIVAL_SCHEME_NAME = 'Poison the Emperor\'s Cup';
const RIVAL_SECRET = 'Keeps a Parthian paymaster in the cellar';
const OWN_SCHEME_NAME = 'The Thracian Ascent';
const OWN_SECRET = 'Fears his own veterans will turn on him';
const PLAYER_SECRET = 'Secretly negotiating with the Germans';

function makeAsymmetryCast(): { player: Entity; npcA: Entity; npcB: Entity } {
  const player = makeEntity({
    entity_id: 'player_1',
    name: 'Gaius Testus',
    location: 'Palatine Hill',
    secrets: [PLAYER_SECRET],
    active_scheme: { name: 'Hold the Throne', overall_goal: 'Survive.', steps: [] },
  });
  const npcA = makeEntity({
    entity_id: 'npc_thrax',
    name: 'Maximinus Thrax',
    position: 'General',
    location: 'Praetorian Camp',
    personality: { ambition: 9, paranoia: 6, loyalty: 2, cunning: 7, honor: 3 },
    skills: { strategy: 9, oratory: 4 },
    beliefs: ['The strong take.'],
    secrets: [OWN_SECRET],
    active_scheme: { name: OWN_SCHEME_NAME, overall_goal: 'Take the purple.', steps: [{ objective: 'Win the Rhine legions', status: 'in_progress' }] },
    memories: [{ turn: 3, event_description: 'Watched the cohorts cheer my name at drill', emotional_impact: 'Notable', involved_entities: [] }],
    relationships: {
      player_1: { entity_id: 'player_1', relationship_type: 'rival', trust_level: -7, perceived_threat: 8, recent_interactions: [] },
    },
  });
  const npcB = makeEntity({
    entity_id: 'npc_venena',
    name: 'Livia Venena',
    position: 'Poisoner',
    location: 'Palatine Hill',
    secrets: [RIVAL_SECRET],
    active_scheme: { name: RIVAL_SCHEME_NAME, overall_goal: 'Kill the Emperor undetected.', steps: [{ objective: 'Obtain the toxin', status: 'in_progress' }] },
  });
  return { player, npcA, npcB };
}

/** A previous turn's history entry whose GM-private material must never surface in a mind prompt. */
const PREVIOUS_GM_NOTE = 'GM-ONLY: Venena has already obtained the toxin.';
function makePreviousEntry(): TurnHistoryEntry {
  return {
    turnNumber: 4,
    playerIntent: 'Hold court',
    adjudication: {
      turn: 4,
      entityActions: [],
      deltas: [
        // A rumor delta carrying GM-private truth bookkeeping (D11): the
        // digest line a mind sees is the rumor TEXT only - is_true/origin_id
        // must never ride along.
        { type: 'rumor', key: 'player_1', delta: 0.7, reason: 'The treasury is whispered to stand empty.', is_true: false, origin_id: 'npc_venena' },
        // A resource delta at npc_thrax's own location - witnessed by A.
        { type: 'resource', key: 'npc_thrax:legion_support', delta: 2, reason: 'Cohorts drilled under his eye.' },
      ],
      headlines: ['The legions drill without pause.'],
      gm_private: [PREVIOUS_GM_NOTE],
    },
    narration: 'A week of drills and whispers.',
  };
}

const bothSpotlightsRelevanceJson = JSON.stringify({
  spotlight_entities: [
    { entity_id: 'npc_thrax', reason: 'Momentum.' },
    { entity_id: 'npc_venena', reason: 'The poison plot ripens.' },
  ],
  spotlight_intents: [
    { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'continue' },
    { entity_id: 'npc_venena', intent: 'Slip the toxin into the palace kitchens', continuity: 'continue' },
  ],
});

const nonConsequentialAssessmentJson = JSON.stringify({
  is_consequential: false,
  action_category: 'idle conversation',
  relevant_skill: null,
  difficulty: 10,
  opposing_entity_id: null,
  rationale: 'No real risk.',
});

const adjudicationJson = JSON.stringify({
  turn: 5,
  entityActions: [
    { id: 'npc_thrax', intent: 'march', target: null, notes: 'The legions break camp.' },
    { id: 'npc_venena', intent: 'intrigue', target: 'player_1', notes: 'A vial changes hands.' },
  ],
  deltas: [],
  headlines: ['The Rhine stirs.'],
  gm_private: [],
});

const privateConversationJson = JSON.stringify({ dialogueSnippet: 'They met briefly.', deltas: [] });
const simStateJson = JSON.stringify(SIM_STATE);
const narrationText = 'The city holds its breath.\nSUGGESTION: Wait';
const relationshipJson = JSON.stringify({ deltas: [] });

const THRAX_REASONING = 'PRIVATE: I fear my own men more than the Emperor.';
const VENENA_REASONING = 'PRIVATE: The kitchens are watched; the wine cellar is not.';

const thraxDecisionJson = JSON.stringify({
  entity_id: 'npc_thrax',
  chosen_action: 'Muster the Rhine veterans and put the column on the road south.',
  method: 'Night marches, paid scouts ahead.',
  private_reasoning: THRAX_REASONING,
  scheme_adjustment: 'The recruitment step is complete; the march begins.',
});
const venenaDecisionJson = JSON.stringify({
  entity_id: 'npc_venena',
  chosen_action: 'Place the vial with the palace cupbearer.',
  method: 'A bribe and a threat, delivered together.',
  private_reasoning: VENENA_REASONING,
});

// --- a synchronous scripted fake client ------------------------------------

interface MindHarness {
  ai: GoogleGenAI;
  /** Every call in issue order, classified. */
  order: string[];
  /** The most recent user prompt per classified kind ('npcMind:<entity_id>' for minds). */
  prompts: Record<string, string>;
  /** The most recent systemInstruction per classified kind. */
  systems: Record<string, string>;
}

/**
 * Classifies by stable systemInstruction markers (the same convention as
 * tests/turnPipeline.test.ts) and responds SYNCHRONOUSLY from the scripted
 * map - order[] then proves the real issue sequence. Mind calls are keyed
 * per character (their prompt names the entity_id) so each mind's prompt
 * and response can be scripted independently, which the one-deferred-per-
 * kind harness in turnPipeline.test.ts cannot do.
 */
function createMindHarness(responses: Record<string, string | Error>): MindHarness {
  const order: string[] = [];
  const prompts: Record<string, string> = {};
  const systems: Record<string, string> = {};

  const classify = (systemInstruction: string, contents: string): string => {
    if (systemInstruction.includes('master storyteller and game master')) return 'storyRelevance';
    if (systemInstruction.includes('Action Assessor')) return 'assessment';
    if (systemInstruction.includes("character's own private mind")) {
      // The prompt's self-brief names the entity_id - key minds per character.
      const match = contents.match(/entity_id: (\w+)/);
      return `npcMind:${match?.[1] ?? 'unknown'}`;
    }
    if (systemInstruction.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
    if (systemInstruction.includes('secret observer')) return 'privateConversation';
    if (systemInstruction.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
    if (systemInstruction.includes('the inner voice of')) return 'monologue';
    if (systemInstruction.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
    if (systemInstruction.includes('narrative analyst AI')) return 'relationshipUpdates';
    throw new Error(`npcMinds test fake: unrecognized call. systemInstruction: ${systemInstruction.slice(0, 120)}`);
  };

  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const systemInstruction = typeof params.config?.systemInstruction === 'string' ? params.config.systemInstruction : '';
    const kind = classify(systemInstruction, params.contents);
    order.push(kind);
    prompts[kind] = params.contents;
    systems[kind] = systemInstruction;
    const scripted = responses[kind];
    if (scripted === undefined) throw new Error(`npcMinds test fake: no scripted response for '${kind}'`);
    if (scripted instanceof Error) throw scripted;
    return { text: scripted };
  });

  const ai = { models: { generateContent } } as unknown as GoogleGenAI;
  return { ai, order, prompts, systems };
}

function baseResponses(): Record<string, string | Error> {
  return {
    storyRelevance: bothSpotlightsRelevanceJson,
    assessment: nonConsequentialAssessmentJson,
    'npcMind:npc_thrax': thraxDecisionJson,
    'npcMind:npc_venena': venenaDecisionJson,
    adjudication: adjudicationJson,
    privateConversation: privateConversationJson,
    simulationState: simStateJson,
    monologue: 'I watch the roads.',
    narration: narrationText,
    relationshipUpdates: relationshipJson,
  };
}

function runAsymmetryTurn(harness: MindHarness) {
  const { player, npcA, npcB } = makeAsymmetryCast();
  return runNewTurn(
    harness.ai, 'Hold court', player, 5, [player, npcA, npcB], WORLD_STATE, SIM_STATE,
    [makePreviousEntry()], [], [], [
      { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'continue' },
      { entity_id: 'npc_venena', intent: 'Slip the toxin into the palace kitchens', continuity: 'continue' },
    ], '', false, 'Grim political thriller'
  );
}

afterEach(() => {
  // Drain any capture left active by a test that failed before turn.ts's
  // own catch could call endTurnCapture() itself.
  endTurnCapture();
});

// --- schema pair (zod + Gemini responseSchema, lockstep) -------------------

describe('mind schema pair: zNpcMindDecision + NpcMindDecisionSchema (lockstep)', () => {
  it('zNpcMindDecision accepts a full decision and one without scheme_adjustment', () => {
    const full = zNpcMindDecision.parse(JSON.parse(thraxDecisionJson));
    expect(full.chosen_action).toContain('Muster the Rhine veterans');
    expect(full.scheme_adjustment).toContain('march begins');
    const minimal = zNpcMindDecision.parse(JSON.parse(venenaDecisionJson));
    expect(minimal.scheme_adjustment).toBeUndefined();
    // Null is also fine - the model may emit it explicitly.
    expect(zNpcMindDecision.safeParse({ ...JSON.parse(venenaDecisionJson), scheme_adjustment: null }).success).toBe(true);
  });

  it('zNpcMindDecision rejects a decision missing any required field', () => {
    const valid = JSON.parse(venenaDecisionJson);
    for (const field of ['entity_id', 'chosen_action', 'method', 'private_reasoning']) {
      const broken = { ...valid };
      delete broken[field];
      expect(zNpcMindDecision.safeParse(broken).success).toBe(false);
    }
  });

  it('the Gemini responseSchema requires the SAME fields, with scheme_adjustment optional/nullable (lockstep pin)', () => {
    expect(NpcMindDecisionSchema.required).toEqual(['entity_id', 'chosen_action', 'method', 'private_reasoning']);
    const properties = NpcMindDecisionSchema.properties as Record<string, { type: unknown; nullable?: boolean }>;
    expect(Object.keys(properties).sort()).toEqual(['chosen_action', 'entity_id', 'method', 'private_reasoning', 'scheme_adjustment'].sort());
    expect(properties.scheme_adjustment.nullable).toBe(true);
    expect(properties.private_reasoning.type).toBe(Type.STRING);
  });
});

// --- the mind prompt: in-character, bounded ---------------------------------

describe('buildNpcMindPrompt: in-character address with bounded knowledge', () => {
  const { npcA } = makeAsymmetryCast();

  it('addresses the character in character with the stable classifier marker and its exact entity_id contract', () => {
    const { systemInstruction } = buildNpcMindPrompt({
      self: npcA, perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year: 235, Week: 4.', turnNumber: 5,
    });
    expect(systemInstruction).toContain("character's own private mind");
    expect(systemInstruction).toContain('You are Maximinus Thrax, General');
    expect(systemInstruction).toContain('"npc_thrax"');
    // The bounded-knowledge contract is stated to the model itself.
    expect(systemInstruction).toContain('You know NOTHING beyond it');
  });

  it('carries the OWN full brief: scheme, secrets, personality, skills, beliefs, relationships, memories', () => {
    const { prompt } = buildNpcMindPrompt({
      self: npcA,
      perceivedChanges: [{ text: 'Your legion support grows.', source: 'self', tabs: [], subject: 'npc_thrax', deltaType: 'resource', deltaKey: 'npc_thrax:legion_support' }],
      publicHeadlines: ['The legions drill without pause.'],
      worldSummary: 'Year: 235, Week: 4. Political Climate: Volatile. Economic Stability: Strained.',
      turnNumber: 5,
      directorIntent: { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'continue' },
    });
    expect(prompt).toContain(OWN_SCHEME_NAME);
    expect(prompt).toContain(OWN_SECRET);
    expect(prompt).toContain('ambition 9');
    expect(prompt).toContain('strategy:9');
    expect(prompt).toContain('The strong take.');
    expect(prompt).toContain('player_1(trust:-7');
    expect(prompt).toContain('Watched the cohorts cheer my name at drill');
    expect(prompt).toContain('[self] Your legion support grows.');
    expect(prompt).toContain('The legions drill without pause.');
    // The Director intent is recast as the character's own carried resolve.
    expect(prompt).toContain('YOUR RESOLVE');
    expect(prompt).toContain('March the Rhine legions on Rome');
  });

  it('omits the resolve block when no Director intent exists, and bounds the memory slice at MIND_MEMORY_LINES', () => {
    const memories = Array.from({ length: MIND_MEMORY_LINES + 2 }, (_, i) => ({
      turn: i + 1, event_description: `Remembered thing ${i + 1}`, emotional_impact: 'Notable', involved_entities: [],
    }));
    const { prompt } = buildNpcMindPrompt({
      self: makeEntity({ memories }), perceivedChanges: [], publicHeadlines: [], worldSummary: 'Year: 235, Week: 4.', turnNumber: 5,
    });
    expect(prompt).not.toContain('YOUR RESOLVE');
    for (let i = 3; i <= MIND_MEMORY_LINES + 2; i++) {
      expect(prompt).toContain(`Remembered thing ${i}`);
    }
    // Whole-line pins: 'Remembered thing 1' would substring-match 10+.
    expect(prompt).not.toContain('Remembered thing 1\n');
    expect(prompt).not.toContain('Remembered thing 2\n');
  });

  it('buildMindSelfBrief never serializes secret_truth (defense in depth - dead entities never reach a mind anyway)', () => {
    const hidden = makeEntity({
      secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'NEVER-LEAK-MOTIVE' },
    });
    expect(buildMindSelfBrief(hidden)).not.toContain('NEVER-LEAK-MOTIVE');
    expect(buildMindSelfBrief(hidden)).not.toContain('secret_truth');
  });
});

// --- THE ASYMMETRY PIN (D10/D22 - the point of the stage) -------------------

describe('runNewTurn npc_minds: the information-asymmetry pin', () => {
  it("a mind's prompt contains its OWN scheme/secrets but NEVER the rival's, the player's privates, gm_private, or rumor truth flags", async () => {
    const harness = createMindHarness(baseResponses());
    await runAsymmetryTurn(harness);

    const thraxPrompt = harness.prompts['npcMind:npc_thrax'];
    const thraxSystem = harness.systems['npcMind:npc_thrax'];
    const venenaPrompt = harness.prompts['npcMind:npc_venena'];
    expect(thraxPrompt).toBeDefined();
    expect(venenaPrompt).toBeDefined();
    const thraxFullText = `${thraxSystem}\n${thraxPrompt}`;

    // OWN knowledge is present...
    expect(thraxPrompt).toContain(OWN_SCHEME_NAME);
    expect(thraxPrompt).toContain(OWN_SECRET);
    // ...the rival's secret scheme and secrets - present in the SAME world
    // state, and in Venena's own prompt - are NOT.
    expect(venenaPrompt).toContain(RIVAL_SCHEME_NAME);
    expect(venenaPrompt).toContain(RIVAL_SECRET);
    expect(thraxFullText).not.toContain(RIVAL_SCHEME_NAME);
    expect(thraxFullText).not.toContain(RIVAL_SECRET);
    // ...and symmetrically, Venena never sees Thrax's privates.
    expect(venenaPrompt).not.toContain(OWN_SCHEME_NAME);
    expect(venenaPrompt).not.toContain(OWN_SECRET);
    // The player's private data never enters any mind.
    expect(thraxFullText).not.toContain(PLAYER_SECRET);
    expect(`${harness.systems['npcMind:npc_venena']}\n${venenaPrompt}`).not.toContain(PLAYER_SECRET);
    // GM-private material from the previous turn never enters a mind.
    expect(thraxFullText).not.toContain(PREVIOUS_GM_NOTE);
    expect(venenaPrompt).not.toContain(PREVIOUS_GM_NOTE);
    // Rumor truth bookkeeping (D11) never rides into a mind's digest: the
    // rumor's TEXT is public, its truth flag and origin are not.
    expect(thraxPrompt).toContain('The treasury is whispered to stand empty.');
    expect(thraxPrompt).not.toContain('is_true');
    expect(thraxPrompt).not.toContain('origin_id');
  });

  it("each mind's perceived digest is ITS vantage: Thrax (at the camp) witnesses his own camp delta, Venena (on the Palatine) does not", async () => {
    const harness = createMindHarness(baseResponses());
    await runAsymmetryTurn(harness);

    // The previous turn's npc_thrax resource delta is 'self' for Thrax...
    expect(harness.prompts['npcMind:npc_thrax']).toContain('Your legion support grows.');
    // ...and invisible to Venena: different location, no network reach.
    expect(harness.prompts['npcMind:npc_venena']).not.toContain('legion support');
  });
});

// --- pipeline threading -----------------------------------------------------

describe('runNewTurn npc_minds: pipeline threading and adjudicator consumption', () => {
  it('runs minds between storyRelevance/assessment and adjudication, feeds decisions (not reasoning) to the adjudicator, and records results on the history entry', async () => {
    const harness = createMindHarness(baseResponses());
    const onStage = vi.fn();
    const { player, npcA, npcB } = makeAsymmetryCast();
    const result = await runNewTurn(
      harness.ai, 'Hold court', player, 5, [player, npcA, npcB], WORLD_STATE, SIM_STATE,
      [makePreviousEntry()], [], [], [], '', false, 'Grim political thriller', { onStage }
    );

    // Position: both minds issue after storyRelevance+assessment and before
    // adjudication (the one added leg between the Director and adjudication).
    const mindIndexes = harness.order.map((k, i) => (k.startsWith('npcMind:') ? i : -1)).filter(i => i >= 0);
    expect(mindIndexes).toHaveLength(2);
    const adjudicationIndex = harness.order.indexOf('adjudication');
    expect(Math.min(...mindIndexes)).toBeGreaterThan(harness.order.indexOf('storyRelevance'));
    expect(Math.min(...mindIndexes)).toBeGreaterThan(harness.order.indexOf('assessment'));
    expect(Math.max(...mindIndexes)).toBeLessThan(adjudicationIndex);

    // The stage notification fires once, between story_relevance and adjudication.
    const stages = onStage.mock.calls.map(c => c[0]);
    expect(stages.filter(s => s === 'npc_minds')).toHaveLength(1);
    expect(stages.indexOf('npc_minds')).toBeGreaterThan(stages.indexOf('story_relevance'));
    expect(stages.indexOf('npc_minds')).toBeLessThan(stages.indexOf('adjudication'));

    // The adjudication prompt consumes the decisions block: entity,
    // chosen_action, method - and the act-it-out contract...
    const adjudicationPrompt = harness.prompts.adjudication;
    expect(adjudicationPrompt).toContain('SPOTLIGHT NPC DECISIONS');
    expect(adjudicationPrompt).toContain('Muster the Rhine veterans and put the column on the road south.');
    expect(adjudicationPrompt).toContain('Night marches, paid scouts ahead.');
    expect(adjudicationPrompt).toContain('Place the vial with the palace cupbearer.');
    expect(adjudicationPrompt).toContain('MUST be this chosen action');
    // ...but NEVER the minds' private reasoning (lean context; a mind may be
    // wrong about itself - and the reasoning is the most GM-private text of all).
    expect(adjudicationPrompt).not.toContain(THRAX_REASONING);
    expect(adjudicationPrompt).not.toContain(VENENA_REASONING);
    expect(adjudicationPrompt).not.toContain('PRIVATE:');

    // The history entry carries the turn's full decisions (reasoning
    // included - the GM console's D7 tuning payoff), entity ids normalized.
    expect(result.newHistoryEntry.npcMindResults).toHaveLength(2);
    expect(result.newHistoryEntry.npcMindResults?.map(d => d.entity_id).sort()).toEqual(['npc_thrax', 'npc_venena']);
    expect(result.newHistoryEntry.npcMindResults?.find(d => d.entity_id === 'npc_thrax')?.private_reasoning).toBe(THRAX_REASONING);

    // Mind calls are captured like every other call (the eval corpus rides
    // on this), suffixed per character.
    const mindCalls = (result.newHistoryEntry.rawCalls ?? []).filter(c => c.callName.startsWith('npcMind:'));
    expect(mindCalls.map(c => c.callName).sort()).toEqual(['npcMind:npc_thrax', 'npcMind:npc_venena']);
  });

  it('zero mind-eligible spotlights: no npc_minds stage, no decisions block, entry omits npcMindResults', async () => {
    const responses = baseResponses();
    responses.storyRelevance = JSON.stringify({ spotlight_entities: [], spotlight_intents: [] });
    const harness = createMindHarness(responses);
    const onStage = vi.fn();
    const { player } = makeAsymmetryCast();
    const result = await runNewTurn(
      harness.ai, 'Hold court', player, 5, [player], WORLD_STATE, SIM_STATE,
      [], [], [], [], '', false, 'Grim political thriller', { onStage }
    );

    expect(harness.order.some(k => k.startsWith('npcMind:'))).toBe(false);
    expect(onStage.mock.calls.map(c => c[0])).not.toContain('npc_minds');
    expect(harness.prompts.adjudication).not.toContain('SPOTLIGHT NPC DECISIONS');
    expect(result.newHistoryEntry.npcMindResults).toBeUndefined();
  });
});

// --- soft failure degradation ----------------------------------------------

describe('runNewTurn npc_minds: per-mind failure degrades softly', () => {
  it('one failing mind never fails the turn: a [Mind] gm_private note is recorded, the survivor still feeds the adjudicator, and the failed spotlight keeps its Director-intent fallback', async () => {
    const responses = baseResponses();
    // Venena's mind explodes (a non-transient failure - geminiService
    // surfaces it as a fatal AiServiceError after no retry).
    responses['npcMind:npc_venena'] = new Error('mind service exploded');
    const harness = createMindHarness(responses);
    const result = await runAsymmetryTurn(harness);

    // The turn completed and the surviving mind's decision reached the
    // adjudicator...
    expect(result.narration).toContain('The city holds its breath.');
    const adjudicationPrompt = harness.prompts.adjudication;
    expect(adjudicationPrompt).toContain('SPOTLIGHT NPC DECISIONS');
    expect(adjudicationPrompt).toContain('Muster the Rhine veterans and put the column on the road south.');
    expect(adjudicationPrompt).not.toContain('Place the vial with the palace cupbearer.');
    // ...while the failed spotlight's Director intent still stands in the
    // intents block - the adjudicator falls back to it alone.
    expect(adjudicationPrompt).toContain('Slip the toxin into the palace kitchens');

    // The failure is recorded as a GM-private note (GM console only).
    const mindNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Mind]'));
    expect(mindNotes).toHaveLength(1);
    expect(mindNotes[0]).toContain('npc_venena');
    expect(mindNotes[0]).toContain('Director intent alone');

    // Only the surviving decision is on the entry.
    expect(result.newHistoryEntry.npcMindResults).toHaveLength(1);
    expect(result.newHistoryEntry.npcMindResults?.[0].entity_id).toBe('npc_thrax');
  });

  it('ALL minds failing still completes the turn with no decisions block at all', async () => {
    const responses = baseResponses();
    responses['npcMind:npc_thrax'] = new Error('mind service exploded');
    responses['npcMind:npc_venena'] = new Error('mind service exploded');
    const harness = createMindHarness(responses);
    const result = await runAsymmetryTurn(harness);

    expect(result.narration).toContain('The city holds its breath.');
    expect(harness.prompts.adjudication).not.toContain('SPOTLIGHT NPC DECISIONS');
    expect(result.newHistoryEntry.npcMindResults).toBeUndefined();
    expect(result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Mind]'))).toHaveLength(2);
  });
});

// --- mind selection ---------------------------------------------------------

describe('selectMindEntities: alive, non-player, deduped, capped (4C.4/D22)', () => {
  function relevanceFor(ids: string[]): StoryRelevance {
    return {
      spotlight_entities: ids.map(id => ({ entity_id: id, reason: 'r' })),
      spotlight_intents: [],
    };
  }

  it('keeps spotlight order, skips the player, the dead, unknown ids, and duplicates', () => {
    const player = makeEntity({ entity_id: 'player_1' });
    const alive = makeEntity({ entity_id: 'npc_a' });
    const dead = makeEntity({ entity_id: 'npc_dead', status: 'dead' });
    const picked = selectMindEntities(
      relevanceFor(['npc_dead', 'player_1', 'npc_missing', 'npc_a', 'npc_a']),
      [player, alive, dead],
      'player_1'
    );
    expect(picked.map(e => e.entity_id)).toEqual(['npc_a']);
  });

  it('caps at MAX_MINDS_PER_TURN in spotlight order', () => {
    const ids = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'];
    const roster = ids.map(id => makeEntity({ entity_id: id }));
    const picked = selectMindEntities(relevanceFor(ids), roster, 'player_1');
    expect(picked).toHaveLength(MAX_MINDS_PER_TURN);
    expect(picked.map(e => e.entity_id)).toEqual(ids.slice(0, MAX_MINDS_PER_TURN));
  });
});

// --- adjudication block builder ---------------------------------------------

describe('buildNpcMindDecisionsBlock: decisions in, reasoning never', () => {
  it('emits entity/action/method lines with the GM-private discipline, and no block for empty/absent input', () => {
    const decisions: NpcMindDecision[] = [
      { entity_id: 'npc_a', chosen_action: 'Seize the granary', method: 'At dawn, with hired hands', private_reasoning: 'SECRET-REASONING' },
    ];
    const block = buildNpcMindDecisionsBlock(decisions);
    expect(block).toContain('npc_a chose to: "Seize the granary" — method: At dawn, with hired hands');
    expect(block).toContain('never restate them');
    expect(block).not.toContain('SECRET-REASONING');
    expect(buildNpcMindDecisionsBlock([])).toBe('');
    expect(buildNpcMindDecisionsBlock(undefined)).toBe('');
  });
});

// --- mock mode: the loop runs offline ---------------------------------------

describe('mock mode: minds for the mock spotlight pair (4C.4)', () => {
  it('mockGetNpcMindDecision returns canned decisions for the pair and an in-character fallback otherwise', async () => {
    const { entities } = getMockInitialState();
    const thrax = entities.find(e => e.entity_id === 'maximinus_thrax')!;
    const canned = await mockGetNpcMindDecision(thrax);
    expect(canned.entity_id).toBe('maximinus_thrax');
    expect(canned.chosen_action.length).toBeGreaterThan(0);
    expect(canned.private_reasoning.length).toBeGreaterThan(0);

    const stranger = makeEntity({ entity_id: 'npc_stranger', name: 'A Stranger' });
    const fallback = await mockGetNpcMindDecision(stranger, { entity_id: 'npc_stranger', intent: 'Vanish into the crowd', continuity: 'new' });
    expect(fallback.entity_id).toBe('npc_stranger');
    expect(fallback.private_reasoning).toContain('Vanish into the crowd');
  });

  it('mockRunNewTurn carries mind decisions for the mock spotlight pair on the history entry, end to end', async () => {
    // The real base-campaign roster (constants/baseScenario.ts) - the mock
    // spotlight pair (thrax + the Guard) both exist there, so this is the
    // roster the offline loop actually runs against in mock mode.
    const entities = ALL_INITIAL_ENTITIES.map(e => ({ ...e }));
    const player = entities.find(e => e.entity_id === 'severus_alexander')!;
    const result = await mockRunNewTurn('Hold court', player, 1, entities, INITIAL_WORLD_STATE, [], '', 'A crisis.', SIM_STATE, [], []);
    const minds = result.newHistoryEntry.npcMindResults;
    expect(minds).toBeDefined();
    expect(minds!.map(d => d.entity_id).sort()).toEqual(['maximinus_thrax', 'praetorian_guard']);
    expect(minds!.length).toBeLessThanOrEqual(MAX_MINDS_PER_TURN);
    for (const decision of minds!) {
      expect(decision.chosen_action.length).toBeGreaterThan(0);
      expect(decision.method.length).toBeGreaterThan(0);
      expect(decision.private_reasoning.length).toBeGreaterThan(0);
    }
  });
});

// --- history bounding: trimmed with the snapshot window ----------------------

describe('withOldSnapshotsDropped: npcMindResults trims with the snapshot window', () => {
  function makeHistoryEntry(turnNumber: number): TurnHistoryEntry {
    return {
      turnNumber,
      playerIntent: `act ${turnNumber}`,
      adjudication: { turn: turnNumber, entityActions: [], deltas: [], headlines: [], gm_private: [] },
      postTurnEntities: [],
      perceivingNpcIds: ['npc_a'],
      npcMindResults: [
        { entity_id: 'npc_a', chosen_action: `move ${turnNumber}`, method: 'quietly', private_reasoning: 'mine alone' },
      ],
    };
  }

  it('drops npcMindResults from entries older than KEEP_FULL_SNAPSHOTS, keeps it on recent ones', () => {
    const history = Array.from({ length: KEEP_FULL_SNAPSHOTS + 3 }, (_, i) => makeHistoryEntry(i + 1));
    const trimmed = withOldSnapshotsDropped(history);
    trimmed.forEach((entry, index) => {
      if (index < 3) {
        expect('npcMindResults' in entry).toBe(false);
        expect('postTurnEntities' in entry).toBe(false);
        expect('perceivingNpcIds' in entry).toBe(false);
      } else {
        expect(entry.npcMindResults).toBeDefined();
      }
    });
  });

  it('an old entry carrying ONLY npcMindResults (snapshot already gone) is still trimmed', () => {
    const bare: TurnHistoryEntry[] = Array.from({ length: KEEP_FULL_SNAPSHOTS + 1 }, (_, i) => {
      const { postTurnEntities, perceivingNpcIds, ...rest } = makeHistoryEntry(i + 1);
      return rest;
    });
    const trimmed = withOldSnapshotsDropped(bare);
    expect('npcMindResults' in trimmed[0]).toBe(false);
    expect(trimmed[KEEP_FULL_SNAPSHOTS].npcMindResults).toBeDefined();
  });
});
