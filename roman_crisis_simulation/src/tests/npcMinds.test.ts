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
import { runNewTurn, selectMindEntities, selectUnrememberedChanges, evolveSchemeFromAdjustment, buildMindSchemeDeltas, MAX_SCHEME_STEPS, type RunNewTurnOptions } from '../ai/core/turn';
import { applyDeltas } from '../ai/core/engine';
import { MAX_NPC_MEMORY_LINES_PER_TURN } from '../perception/npcPerception';
import { buildPerceivedDigest, type PerceivedChange } from '../perception/visibility';
import { endTurnCapture } from '../ai/core/geminiService';
import { withOldSnapshotsDropped, KEEP_FULL_SNAPSHOTS } from '../state/gameReducer';
import { mockRunNewTurn, mockGetNpcMindDecision } from '../ai/mocks';
import { getMockInitialState } from './mockData';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE } from '../constants/baseScenario';
import type { PrivateSceneNpcMemoryProjection } from '../privateScene/model';
import type { Entity, EventDelta, NpcMindDecision, Scheme, SimulationState, StoryRelevance, TurnHistoryEntry, TurnSubmission, WorldState } from '../types';

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

const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });

// The asymmetry cast: A and B are BOTH spotlights; each holds a secret
// scheme and secrets the OTHER's mind must never see. They are placed in
// different locations with empty visibility networks so neither's vantage
// admits the other's private deltas either.
const RIVAL_SCHEME_NAME = 'Poison the Emperor\'s Cup';
const RIVAL_SECRET = 'Keeps a Parthian paymaster in the cellar';
const OWN_SCHEME_NAME = 'The Thracian Ascent';
const OWN_SECRET = 'Fears his own veterans will turn on him';
const PLAYER_SECRET = 'Secretly negotiating with the Germans';
const PLAYER_SCHEME_NAME = 'Hold the Throne Against All';
// A publicly-dead hidden survivor (D3 secret_truth) in the roster: its
// GM-private motive must never reach any mind's prompt.
const HIDDEN_MOTIVE = 'Waits in a Capri villa to reclaim the purple';
const PRIVATE_SCENE_NPC_SPEECH = 'Three cohorts have sworn to me.';
const PRIVATE_SCENE_NPC_INTENT = 'Bluff; only one cohort is loyal.';
const PRIVATE_SCENE_UNRELATED_TRUTH = 'WORLD_TRUTH_SENTINEL: exactly one cohort exists.';
const PRIVATE_SCENE_PLAYER_INTENT = 'PLAYER_PRIVATE_INTENT_MUST_NOT_REACH_NPC_MIND';

function makeHiddenSurvivor(): Entity {
  return makeEntity({
    entity_id: 'npc_hidden',
    name: 'Vanished Prefect',
    status: 'dead',
    secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: HIDDEN_MOTIVE },
  });
}

function makeAsymmetryCast(): { player: Entity; npcA: Entity; npcB: Entity } {
  const player = makeEntity({
    entity_id: 'player_1',
    name: 'Gaius Testus',
    location: 'Palatine Hill',
    secrets: [PLAYER_SECRET],
    active_scheme: { name: PLAYER_SCHEME_NAME, overall_goal: 'Survive.', steps: [] },
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
    { id: 'npc_thrax', intent: 'march', target: null, notes: 'The legions break camp.', actors: ['npc_thrax'] },
    { id: 'npc_venena', intent: 'intrigue', target: 'player_1', notes: 'A vial changes hands.', actors: ['npc_venena'] },
  ],
  deltas: [],
  headlines: [{ text: 'The Rhine stirs.', actors: ['npc_thrax'] }],
  gm_private: [],
});

// Raw provider interchange (zSimulationState): SIM_STATE (the committed
// fixture, also used directly as runNewTurn's currentSimulationState arg)
// plus the actors-attribution sibling a real captured response carries.
const simStateJson = JSON.stringify({ ...SIM_STATE, actors: [] });
// Task 4: narration is a structured-output call - RAW PROVIDER INTERCHANGE
// shape ({text, actors}); actors: [] (this fixture only ever runs on an
// observable-attempt turn, where the declared-actors gate is inert anyway).
const narrationText = JSON.stringify({ text: 'The city holds its breath.\nSUGGESTION: Wait', actors: [] });

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
 * Classifies a call by its stable systemInstruction markers (the same
 * convention as tests/turnPipeline.test.ts). Module-level so BOTH fakes in
 * this file - the synchronous scripted harness below and the deferred
 * concurrency harness - share one classifier. Mind calls are keyed per
 * character (their prompt names the entity_id).
 */
function classifyCall(systemInstruction: string, contents: string): string {
  if (systemInstruction.includes('master storyteller and game master')) return 'storyRelevance';
  if (systemInstruction.includes('Action Assessor')) return 'assessment';
  if (systemInstruction.includes("character's own private mind")) {
    // The prompt's self-brief names the entity_id - key minds per character.
    const match = contents.match(/entity_id: (\w+)/);
    return `npcMind:${match?.[1] ?? 'unknown'}`;
  }
  if (systemInstruction.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
  if (systemInstruction.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (systemInstruction.includes('the inner voice of')) return 'monologue';
  if (systemInstruction.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
  throw new Error(`npcMinds test fake: unrecognized call. systemInstruction: ${systemInstruction.slice(0, 120)}`);
}

/**
 * Responds SYNCHRONOUSLY from the scripted map - order[] then proves the
 * real issue sequence. Each mind's prompt and response can be scripted
 * independently, which the one-deferred-per-kind harness in
 * turnPipeline.test.ts cannot do.
 */
function createMindHarness(responses: Record<string, string | Error>): MindHarness {
  const order: string[] = [];
  const prompts: Record<string, string> = {};
  const systems: Record<string, string> = {};

  const classify = classifyCall;

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
    simulationState: simStateJson,
    // Task 4: getPlayerMonologue is a structured-output call - same RAW
    // PROVIDER INTERCHANGE shape as narration above.
    monologue: JSON.stringify({ text: 'I watch the roads.', actors: [] }),
    narration: narrationText,
  };
}

function runAsymmetryTurn(harness: MindHarness, options?: RunNewTurnOptions, submission: TurnSubmission = freeform('Hold court')) {
  const { player, npcA, npcB } = makeAsymmetryCast();
  // The hidden survivor rides in the roster so the asymmetry pin covers
  // secret_truth: its motive reaches the (omniscient) adjudicator's
  // GM-SECRET block but must never reach any mind.
  return runNewTurn(
    harness.ai, submission, player, 5, [player, npcA, npcB, makeHiddenSurvivor()], WORLD_STATE, SIM_STATE,
    [makePreviousEntry()], [], [], [
      { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'continue' },
      { entity_id: 'npc_venena', intent: 'Slip the toxin into the palace kitchens', continuity: 'continue' },
    ], '', false, 'Grim political thriller', options
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
      turn: i + 1, event_description: `Remembered thing ${i + 1}`, emotional_impact: 'Notable', involved_entities: [] as string[],
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
  it('routes at most three completed private-scene memories only to their participating NPC mind', async () => {
    const harness = createMindHarness(baseResponses());
    const memory = (index: number): PrivateSceneNpcMemoryProjection & { unrelatedTruth: string } => ({
      closureReason: 'player_ended',
      transcript: [
        { sequence: 1, speaker: 'player', text: `PARTICIPANT_TRANSCRIPT_${index}` },
        { sequence: 2, speaker: 'npc', text: `NPC_TRANSCRIPT_${index}` },
      ],
      speechActs: [{ speaker: 'npc', kind: 'claim', text: `${PRIVATE_SCENE_NPC_SPEECH} [memory ${index}]` }],
      lastWord: `Last word ${index}`,
      npcPrivate: {
        sincerity: 'deceptive',
        hiddenIntent: `${PRIVATE_SCENE_NPC_INTENT} [memory ${index}]`,
        plannedFollowThrough: [`Plan ${index}`],
      },
      unrelatedTruth: PRIVATE_SCENE_UNRELATED_TRUTH,
    });

    await runAsymmetryTurn(
      harness,
      { privateSceneNpcMemoriesByNpcId: { npc_thrax: [memory(1), memory(2), memory(3), memory(4)] } },
      { version: 1, kind: 'structured', actions: ['Hold court'], privateIntent: PRIVATE_SCENE_PLAYER_INTENT },
    );

    const thraxPrompt = harness.prompts['npcMind:npc_thrax'];
    const venenaPrompt = harness.prompts['npcMind:npc_venena'];
    const thraxBlock = thraxPrompt.match(/PRIVATE AUDIENCE MEMORIES[\s\S]*?END PRIVATE AUDIENCE MEMORIES/)?.[0] ?? '';
    expect(thraxBlock).toContain(`${PRIVATE_SCENE_NPC_SPEECH} [memory 1]`);
    expect(thraxBlock).toContain(`${PRIVATE_SCENE_NPC_SPEECH} [memory 2]`);
    expect(thraxBlock).toContain(`${PRIVATE_SCENE_NPC_SPEECH} [memory 3]`);
    expect(thraxBlock).not.toContain(`${PRIVATE_SCENE_NPC_SPEECH} [memory 4]`);
    expect(thraxBlock).toContain(PRIVATE_SCENE_NPC_INTENT);
    expect(thraxBlock).toContain('PARTICIPANT_TRANSCRIPT_1');
    expect(thraxBlock).toContain('NPC_TRANSCRIPT_3');
    expect(thraxBlock).not.toContain('PARTICIPANT_TRANSCRIPT_4');
    expect(thraxBlock).not.toContain(PRIVATE_SCENE_UNRELATED_TRUTH);
    expect(thraxBlock).not.toContain(PRIVATE_SCENE_PLAYER_INTENT);
    expect(venenaPrompt).not.toContain('PRIVATE AUDIENCE MEMORIES');
    expect(venenaPrompt).not.toContain(PRIVATE_SCENE_NPC_SPEECH);
    expect(`${harness.systems['npcMind:npc_thrax']}\n${thraxPrompt}`).toMatch(/spoken .*claims, not .*truth/i);
    expect(`${harness.systems['npcMind:npc_thrax']}\n${thraxPrompt}`).toMatch(/hidden intent .*plan, not .*happened/i);
    expect(`${harness.systems['npcMind:npc_thrax']}\n${thraxPrompt}`).toMatch(/only .*adjudication.*deltas.*consequences/i);
  });

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
    // The player's private data never enters any mind - neither their
    // secrets nor their active_scheme NAME.
    const venenaFullText = `${harness.systems['npcMind:npc_venena']}\n${venenaPrompt}`;
    expect(thraxFullText).not.toContain(PLAYER_SECRET);
    expect(venenaFullText).not.toContain(PLAYER_SECRET);
    expect(thraxFullText).not.toContain(PLAYER_SCHEME_NAME);
    expect(venenaFullText).not.toContain(PLAYER_SCHEME_NAME);
    // The hidden survivor's secret_truth (D3) - present in the roster and
    // in the adjudicator's GM-SECRET block - never enters a mind.
    expect(thraxFullText).not.toContain(HIDDEN_MOTIVE);
    expect(venenaFullText).not.toContain(HIDDEN_MOTIVE);
    expect(harness.prompts.adjudication).toContain(HIDDEN_MOTIVE); // the omniscient adjudicator DOES see it - the asymmetry is real, not vacuous
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

// --- the digest/memory double-count filter (memory stamp vs re-derived digest) ---

describe('selectUnrememberedChanges + mind assembly: no line shows twice in one prompt', () => {
  function makeChange(text: string): PerceivedChange {
    return { text, source: 'self', tabs: [], subject: 'npc_thrax', deltaType: 'resource', deltaKey: 'npc_thrax:legion_support' };
  }
  function makeMemory(turn: number, text: string) {
    return { turn, event_description: text, emotional_impact: 'Notable', involved_entities: [] as string[] };
  }

  it('drops lines stamped as PREVIOUS-turn memories, keeps unstamped lines, and never matches an older turn\'s identical text', () => {
    const changes = [makeChange('Stamped line.'), makeChange('Unstamped line.'), makeChange('Old echo.')];
    const memories = [
      makeMemory(4, 'Stamped line.'),
      // Same text, OLDER turn: a different event - must not suppress the
      // fresh digest line.
      makeMemory(2, 'Old echo.'),
    ];
    expect(selectUnrememberedChanges(changes, memories, 4).map(c => c.text)).toEqual(['Unstamped line.', 'Old echo.']);
  });

  it('keeps the full digest for an un-stamped viewer (excluded from the perceiving set) and when no previous turn exists', () => {
    const changes = [makeChange('A.'), makeChange('B.')];
    expect(selectUnrememberedChanges(changes, [], 4)).toEqual(changes);
    expect(selectUnrememberedChanges(changes, [makeMemory(4, 'A.')], undefined)).toEqual(changes);
  });

  it('keeps a beyond-cap line: only what the stamp actually recorded filters', () => {
    // A busy previous turn: the stamp kept only MAX_NPC_MEMORY_LINES_PER_TURN
    // of the digest's lines; the dropped line's ONLY channel is the digest.
    const digest = Array.from({ length: MAX_NPC_MEMORY_LINES_PER_TURN + 1 }, (_, i) => makeChange(`Line ${i}.`));
    const stamped = digest.slice(0, MAX_NPC_MEMORY_LINES_PER_TURN).map(c => makeMemory(4, c.text));
    const kept = selectUnrememberedChanges(digest, stamped, 4);
    expect(kept.map(c => c.text)).toEqual([`Line ${MAX_NPC_MEMORY_LINES_PER_TURN}.`]);
  });

  it('pipeline: a stamped line renders ONCE (memory block), not again in the digest block; an un-stamped viewer keeps her full digest', async () => {
    const harness = createMindHarness(baseResponses());
    const { player, npcA, npcB } = makeAsymmetryCast();
    // Thrax's memories already hold the previous turn's stamped line - the
    // exact describeDelta text his re-derived digest would produce for the
    // previous entry's npc_thrax resource delta.
    npcA.memories = [
      ...npcA.memories,
      { turn: 4, event_description: 'Your legion support grows.', emotional_impact: 'Notable', involved_entities: [] },
    ];
    await runNewTurn(
      harness.ai, freeform('Hold court'), player, 5, [player, npcA, npcB], WORLD_STATE, SIM_STATE,
      [makePreviousEntry()], [], [], [], '', false, 'Grim political thriller'
    );

    const thraxPrompt = harness.prompts['npcMind:npc_thrax'];
    // Present once, as the stamped memory...
    expect(thraxPrompt).toContain('T4: Your legion support grows.');
    // ...and NOT duplicated in the digest block.
    expect(thraxPrompt).not.toContain('[self] Your legion support grows.');
    // Venena (no stamped memories) still receives her full digest - the
    // public rumor line reaches her through the digest channel only.
    expect(harness.prompts['npcMind:npc_venena']).toContain('Rumor reaches you: "The treasury is whispered to stand empty."');
  });
});

// --- pipeline threading -----------------------------------------------------

describe('runNewTurn npc_minds: pipeline threading and adjudicator consumption', () => {
  it('runs minds between storyRelevance/assessment and adjudication, feeds decisions (not reasoning) to the adjudicator, and records results on the history entry', async () => {
    const harness = createMindHarness(baseResponses());
    const onStage = vi.fn();
    const { player, npcA, npcB } = makeAsymmetryCast();
    const result = await runNewTurn(
      harness.ai, freeform('Hold court'), player, 5, [player, npcA, npcB], WORLD_STATE, SIM_STATE,
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

  it('launches ALL mind calls concurrently (Promise.all): both are ISSUED before either response resolves', async () => {
    // The withheld-deferred pattern from tests/turnPipeline.test.ts: every
    // non-mind call answers synchronously from the scripted map, while BOTH
    // mind responses are withheld behind deferred promises. If the pipeline
    // regressed to a sequential per-mind loop, the second mind call would
    // never be issued until the first resolves - the Promise.all on the
    // issued-signals below would then hang and the test would time out.
    const scripted = baseResponses();
    const mindKinds = ['npcMind:npc_thrax', 'npcMind:npc_venena'] as const;
    const issued: Record<string, { promise: Promise<void>; resolve: () => void }> = {};
    const withheld: Record<string, { promise: Promise<string>; resolve: (v: string) => void }> = {};
    for (const kind of mindKinds) {
      let issuedResolve!: () => void;
      const issuedPromise = new Promise<void>(res => { issuedResolve = res; });
      issued[kind] = { promise: issuedPromise, resolve: issuedResolve };
      let responseResolve!: (v: string) => void;
      const responsePromise = new Promise<string>(res => { responseResolve = res; });
      withheld[kind] = { promise: responsePromise, resolve: responseResolve };
    }

    const order: string[] = [];
    const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
      const systemInstruction = typeof params.config?.systemInstruction === 'string' ? params.config.systemInstruction : '';
      const kind = classifyCall(systemInstruction, params.contents);
      order.push(kind);
      if (kind.startsWith('npcMind:')) {
        issued[kind].resolve();
        return { text: await withheld[kind].promise };
      }
      const response = scripted[kind];
      if (response === undefined) throw new Error(`concurrency fake: no scripted response for '${kind}'`);
      if (response instanceof Error) throw response;
      return { text: response };
    });
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;

    const { player, npcA, npcB } = makeAsymmetryCast();
    const turnPromise = runNewTurn(
      ai, freeform('Hold court'), player, 5, [player, npcA, npcB], WORLD_STATE, SIM_STATE,
      [makePreviousEntry()], [], [], [], '', false, 'Grim political thriller'
    );
    turnPromise.catch(() => {}); // consumed properly below

    // Both mind requests were issued while NEITHER response has settled.
    await Promise.all(mindKinds.map(kind => issued[kind].promise));
    expect(order.filter(kind => kind.startsWith('npcMind:')).sort()).toEqual([...mindKinds].sort());
    // Adjudication is still gated on the minds' join.
    expect(order).not.toContain('adjudication');

    withheld['npcMind:npc_thrax'].resolve(thraxDecisionJson);
    withheld['npcMind:npc_venena'].resolve(venenaDecisionJson);
    const result = await turnPromise;
    expect(result.newHistoryEntry.npcMindResults).toHaveLength(2);
  });

  it('zero mind-eligible spotlights: no npc_minds stage, no decisions block, entry omits npcMindResults', async () => {
    const responses = baseResponses();
    responses.storyRelevance = JSON.stringify({ spotlight_entities: [], spotlight_intents: [] });
    const harness = createMindHarness(responses);
    const onStage = vi.fn();
    const { player } = makeAsymmetryCast();
    const result = await runNewTurn(
      harness.ai, freeform('Hold court'), player, 5, [player], WORLD_STATE, SIM_STATE,
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

    // The failure is recorded as a GM-private note (GM console only). Filter
    // to the FAILURE note specifically: the surviving Thrax mind returned a
    // scheme_adjustment (thraxDecisionJson), which now also emits a [Mind]
    // note for its applied scheme evolution (D30) - a different [Mind] note.
    const failureNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Mind]') && n.includes('mind call failed'));
    expect(failureNotes).toHaveLength(1);
    expect(failureNotes[0]).toContain('npc_venena');
    expect(failureNotes[0]).toContain('Director intent alone');

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

// --- main adjudication relation deltas join the committed record -----------

describe('runNewTurn main adjudication: relationship deltas are committed, applied once, and player-perceivable', () => {
  it('commits and applies an adjudicator relation delta once, and the player digest classifies a self-visible one', async () => {
    const responses = baseResponses();
    responses.adjudication = JSON.stringify({
      turn: 5,
      entityActions: [],
      deltas: [
        { type: 'relation', key: 'player_1:npc_thrax:trust_level', delta: -2, reason: 'The vial changing hands gnaws at him.', actors: ['npc_thrax'] },
      ],
      headlines: [{ text: 'The Rhine stirs.', actors: [] }],
      gm_private: [],
    });
    const harness = createMindHarness(responses);
    const result = await runAsymmetryTurn(harness);

    // Committed: the adjudicator delta is part of the entry's ground-truth
    // record - visible to the GM console, the player digest, and next
    // turn's NPC mind digests.
    const committed = result.newHistoryEntry.adjudication.deltas.filter(
      d => d.type === 'relation' && d.key === 'player_1:npc_thrax:trust_level'
    );
    expect(committed).toHaveLength(1);

    // Applied to state exactly ONCE: base 0 + (-2) = -2, not -4.
    const playerAfter = result.updatedEntities.find(e => e.entity_id === 'player_1')!;
    expect(playerAfter.relationships['npc_thrax'].trust_level).toBe(-2);

    // The player digest derived from the committed entry (the identical
    // buildPerceivedDigest inputs App.tsx uses at commit) picks it up under
    // the normal D5 rules: the player is entity_a, so it is 'self'.
    const digest = buildPerceivedDigest(result.newHistoryEntry.adjudication.deltas, playerAfter, result.updatedEntities, WORLD_STATE);
    const line = digest.find(c => c.deltaKey === 'player_1:npc_thrax:trust_level');
    expect(line?.source).toBe('self');
    expect(line?.text).toBe('Your trust toward Maximinus Thrax shifts.');
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

  it('states precedence over intents/schemes, forbids ADDITIONAL scheme-actions for a decided NPC, and carves out the public manifestation (pin)', () => {
    const block = buildNpcMindDecisionsBlock([
      { entity_id: 'npc_a', chosen_action: 'Seize the granary', method: 'At dawn', private_reasoning: 'r' },
    ]);
    // The precedence sentence - same wording the system instruction and the
    // intents block state.
    expect(block).toContain('mind decision > Director intent > generic scheme rules');
    // Closes the double-act vector: the decided move IS the proactive move.
    expect(block).toContain('do NOT generate additional, independent scheme-advancing actions');
    expect(block).toContain("IS that character's proactive move this turn");
    // The resolution-layer-style carve-out: provenance private, the acted
    // move's manifestation public.
    expect(block).toContain('What is private is the provenance');
    expect(block).toContain('public manifestation may and should surface in headlines');
  });

  it("renders scheme_adjustment as the character's OWN evolving scheme (D30, load-bearing) and forbids a competing adjudicator scheme delta - absent when the mind omitted it", () => {
    const withHint = buildNpcMindDecisionsBlock([
      { entity_id: 'npc_a', chosen_action: 'Seize the granary', method: 'At dawn', private_reasoning: 'r', scheme_adjustment: 'The granary step is done; next, the docks.' },
    ]);
    expect(withHint).toContain('their scheme shifts: "The granary step is done; next, the docks."');
    // D30: the shift is the character's own evolving scheme, owned by its
    // mind; the adjudicator must not emit a competing 'scheme' delta for it.
    expect(withHint).toContain('owned by its mind');
    expect(withHint).toContain("do NOT emit a 'scheme' delta for such an entity");
    const withoutHint = buildNpcMindDecisionsBlock([
      { entity_id: 'npc_a', chosen_action: 'Seize the granary', method: 'At dawn', private_reasoning: 'r' },
    ]);
    expect(withoutHint).not.toContain('their scheme shifts:');
    // Null (the model may emit it explicitly) behaves like omission.
    const withNull = buildNpcMindDecisionsBlock([
      { entity_id: 'npc_a', chosen_action: 'Seize the granary', method: 'At dawn', private_reasoning: 'r', scheme_adjustment: null },
    ]);
    expect(withNull).not.toContain('their scheme shifts:');
  });
});

// --- D30: minds continuously evolve their own schemes -----------------------

describe('D30: a mind evolves its OWN active_scheme (load-bearing scheme_adjustment)', () => {
  describe('evolveSchemeFromAdjustment: a faithful, engine-parseable Scheme evolution', () => {
    it("folds the one-liner in as the plan's next in_progress step, preserving name/goal/prior steps", () => {
      const current: Scheme = { name: 'The Thracian Ascent', overall_goal: 'Take the purple.', steps: [{ objective: 'Win the Rhine legions', status: 'in_progress' }] };
      const evolved = evolveSchemeFromAdjustment(current, '  The recruitment is done; the march begins.  ');
      expect(evolved.name).toBe('The Thracian Ascent');
      expect(evolved.overall_goal).toBe('Take the purple.');
      expect(evolved.steps).toEqual([
        { objective: 'Win the Rhine legions', status: 'in_progress' },
        // Trimmed, appended as the plan's next step.
        { objective: 'The recruitment is done; the march begins.', status: 'in_progress' },
      ]);
    });

    it('seeds a minimal, valid Scheme when the entity has no prior scheme', () => {
      const seeded = evolveSchemeFromAdjustment(undefined, 'Begin buying silence in the Subura.');
      expect(seeded.steps).toEqual([{ objective: 'Begin buying silence in the Subura.', status: 'in_progress' }]);
      expect(seeded.overall_goal).toBe('Begin buying silence in the Subura.');
      expect(seeded.name.length).toBeGreaterThan(0);
    });

    it('caps steps at MAX_SCHEME_STEPS, dropping the oldest', () => {
      const steps = Array.from({ length: MAX_SCHEME_STEPS }, (_, i) => ({ objective: `step ${i}`, status: 'completed' as const }));
      const evolved = evolveSchemeFromAdjustment({ name: 'Long Game', overall_goal: 'Endure.', steps }, 'the newest move');
      expect(evolved.steps).toHaveLength(MAX_SCHEME_STEPS);
      // Oldest ('step 0') dropped; the newest note is last.
      expect(evolved.steps[0].objective).toBe('step 1');
      expect(evolved.steps.at(-1)?.objective).toBe('the newest move');
    });
  });

  describe('buildMindSchemeDeltas: one committed, engine-parseable scheme delta per evolving mind', () => {
    const cast: Entity[] = [
      makeEntity({ entity_id: 'npc_thrax', name: 'Maximinus Thrax', active_scheme: { name: 'The Thracian Ascent', overall_goal: 'Take the purple.', steps: [{ objective: 'Win the Rhine legions', status: 'in_progress' }] } }),
      makeEntity({ entity_id: 'npc_venena', name: 'Livia Venena' }),
    ];

    it('emits a 0-delta scheme delta keyed by entity_id whose reason is a JSON Scheme; skips blank/absent adjustments and unknown ids', () => {
      const decisions: NpcMindDecision[] = [
        { entity_id: 'npc_thrax', chosen_action: 'March', method: 'fast', private_reasoning: 'r', scheme_adjustment: 'The march begins.' },
        { entity_id: 'npc_venena', chosen_action: 'Wait', method: 'quiet', private_reasoning: 'r' }, // no adjustment -> no delta
        { entity_id: 'npc_thrax', chosen_action: 'x', method: 'y', private_reasoning: 'r', scheme_adjustment: '   ' }, // blank -> no delta
        { entity_id: 'npc_ghost', chosen_action: 'x', method: 'y', private_reasoning: 'r', scheme_adjustment: 'evolve' }, // not in roster -> no delta
      ];
      const deltas = buildMindSchemeDeltas(decisions, cast);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toMatchObject({ type: 'scheme', key: 'npc_thrax', delta: 0 });
      const parsed = JSON.parse(deltas[0].reason) as Scheme;
      expect(parsed.name).toBe('The Thracian Ascent');
      expect(parsed.steps.at(-1)?.objective).toBe('The march begins.');
    });

    it('the emitted delta parses through engine.ts applyDeltas and updates active_scheme (parsing not broken)', () => {
      const deltas = buildMindSchemeDeltas(
        [{ entity_id: 'npc_thrax', chosen_action: 'March', method: 'fast', private_reasoning: 'r', scheme_adjustment: 'The march begins.' }],
        cast
      );
      const { updatedEntities } = applyDeltas(deltas, cast, WORLD_STATE, 5);
      const thrax = updatedEntities.find(e => e.entity_id === 'npc_thrax')!;
      expect(thrax.active_scheme?.name).toBe('The Thracian Ascent');
      expect(thrax.active_scheme?.steps.map(s => s.objective)).toContain('The march begins.');
    });
  });

  describe('runNewTurn: the mind-driven scheme evolution is committed and applied once', () => {
    it("a mind's scheme_adjustment produces a committed 'scheme' delta that evolves ONLY that entity's active_scheme, with a [Mind] note", async () => {
      const harness = createMindHarness(baseResponses());
      const result = await runAsymmetryTurn(harness);

      // Thrax's mind returned a scheme_adjustment (thraxDecisionJson); Venena's did not.
      const schemeDeltas = result.newHistoryEntry.adjudication.deltas.filter((d: EventDelta) => d.type === 'scheme');
      const thraxScheme = schemeDeltas.filter((d: EventDelta) => d.key === 'npc_thrax');
      expect(thraxScheme).toHaveLength(1);
      const parsed = JSON.parse(thraxScheme[0].reason) as Scheme;
      expect(parsed.name).toBe(OWN_SCHEME_NAME);
      expect(parsed.steps.at(-1)?.objective).toBe('The recruitment step is complete; the march begins.');
      // No scheme delta for Venena (she evolved nothing this turn).
      expect(schemeDeltas.some((d: EventDelta) => d.key === 'npc_venena')).toBe(false);

      // Applied to state: Thrax's own active_scheme carries the new step.
      const thrax = result.updatedEntities.find(e => e.entity_id === 'npc_thrax')!;
      expect(thrax.active_scheme?.name).toBe(OWN_SCHEME_NAME);
      expect(thrax.active_scheme?.steps.map(s => s.objective)).toContain('The recruitment step is complete; the march begins.');

      // A GM-private [Mind] note records the applied evolution (GM console only).
      const mindNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Mind]'));
      expect(mindNotes.some(n => n.includes('npc_thrax') && n.includes('active_scheme'))).toBe(true);
    });

    it('precedence/dedup: the mind wins over a competing adjudicator scheme delta for the same entity; the adjudicator still owns non-minded (and non-evolving minded) entities schemes', async () => {
      const responses = baseResponses();
      responses.adjudication = JSON.stringify({
        turn: 5,
        entityActions: [],
        deltas: [
          // Same entity whose mind evolved its scheme -> superseded (no double-apply).
          { type: 'scheme', key: 'npc_thrax', delta: 0, reason: JSON.stringify({ name: 'Adjudicator Override', overall_goal: "Not the mind's plan.", steps: [] }), actors: [] },
          // A minded entity whose mind did NOT evolve -> adjudicator keeps ownership.
          { type: 'scheme', key: 'npc_venena', delta: 0, reason: JSON.stringify({ name: 'Venena Adjudicator Scheme', overall_goal: 'Poison on.', steps: [] }), actors: [] },
          // A non-minded bystander -> adjudicator owns it (DYNAMIC SCHEMES).
          { type: 'scheme', key: 'npc_bystander', delta: 0, reason: JSON.stringify({ name: 'Bystander Scheme', overall_goal: 'Watch.', steps: [] }), actors: [] },
        ],
        headlines: [{ text: 'The Rhine stirs.', actors: [] }],
        gm_private: [],
      });
      const harness = createMindHarness(responses);
      const { player, npcA, npcB } = makeAsymmetryCast();
      const bystander = makeEntity({ entity_id: 'npc_bystander', name: 'A Bystander', location: 'Palatine Hill' });
      const result = await runNewTurn(
        harness.ai, freeform('Hold court'), player, 5, [player, npcA, npcB, bystander], WORLD_STATE, SIM_STATE,
        [makePreviousEntry()], [], [], [], '', false, 'Grim political thriller'
      );

      const schemeDeltas = result.newHistoryEntry.adjudication.deltas.filter((d: EventDelta) => d.type === 'scheme');
      // Exactly one scheme delta for Thrax: the mind's, not the adjudicator's override.
      const thraxScheme = schemeDeltas.filter((d: EventDelta) => d.key === 'npc_thrax');
      expect(thraxScheme).toHaveLength(1);
      expect((JSON.parse(thraxScheme[0].reason) as Scheme).name).toBe(OWN_SCHEME_NAME);
      expect(thraxScheme[0].reason).not.toContain('Adjudicator Override');
      // Applied once: Thrax's scheme is the mind's evolution, never the override.
      const thrax = result.updatedEntities.find(e => e.entity_id === 'npc_thrax')!;
      expect(thrax.active_scheme?.name).toBe(OWN_SCHEME_NAME);

      // Venena (minded, no scheme_adjustment) keeps the ADJUDICATOR's scheme.
      const venena = result.updatedEntities.find(e => e.entity_id === 'npc_venena')!;
      expect(venena.active_scheme?.name).toBe('Venena Adjudicator Scheme');
      // Bystander (non-minded) keeps the ADJUDICATOR's scheme (DYNAMIC SCHEMES).
      const byst = result.updatedEntities.find(e => e.entity_id === 'npc_bystander')!;
      expect(byst.active_scheme?.name).toBe('Bystander Scheme');

      // The supersession is traced for the GM console (D4/D5 - GM-only).
      const mindNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Mind]'));
      expect(mindNotes.some(n => n.includes('Superseded') && n.includes('npc_thrax'))).toBe(true);
    });

    it('D28: the mind-applied scheme reaches a co-located witness only as "something afoot", never its name or nature', () => {
      // The committed scheme delta a mind evolution produces...
      const cast: Entity[] = [
        makeEntity({ entity_id: 'npc_thrax', name: 'Maximinus Thrax', location: 'Praetorian Camp', active_scheme: { name: OWN_SCHEME_NAME, overall_goal: 'Take the purple.', steps: [] } }),
      ];
      const [schemeDelta] = buildMindSchemeDeltas(
        [{ entity_id: 'npc_thrax', chosen_action: 'March', method: 'fast', private_reasoning: 'r', scheme_adjustment: 'The recruitment step is complete; the march begins.' }],
        cast
      );
      // ...perceived by a witness standing in the same camp.
      const witness = makeEntity({ entity_id: 'npc_watch', name: 'A Sentry', location: 'Praetorian Camp' });
      const digest = buildPerceivedDigest([schemeDelta], witness, [...cast, witness], WORLD_STATE);
      const line = digest.find(c => c.deltaKey === 'npc_thrax');
      expect(line?.text).toBe('You sense Maximinus Thrax is plotting something.');
      // Neither the scheme's NAME nor the evolution note ever leaks (D28).
      expect(line?.text).not.toContain(OWN_SCHEME_NAME);
      expect(line?.text).not.toContain('recruitment step');
    });
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
    const result = await mockRunNewTurn(freeform('Hold court'), player, 1, entities, INITIAL_WORLD_STATE, [], '', 'A crisis.', SIM_STATE, [], []);
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
