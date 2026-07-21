/**
 * tests/turnPipeline.test.ts
 *
 * Exercises `runNewTurn`'s REAL (non-mock) pipeline (ai/core/turn.ts) with a
 * scripted fake `GoogleGenAI` client, proving the Phase 3 item 3
 * parallelization (ROADMAP_0_MASTER_PLAN.md) actually runs `simulation_state`
 * / `monologue` / `narration` CONCURRENTLY rather than sequentially, while
 * `story_relevance` -> `adjudication` stay sequential and
 * `relationship_updates` still waits on the narration text.
 *
 * The fake client classifies each `ai.models.generateContent`/
 * `generateContentStream` call by inspecting `config.systemInstruction`
 * (every `buildXPrompt` in ai/prompts/*.ts has distinct, stable wording -
 * see the `classify` function below) and resolves it from a
 * manually-controlled deferred promise, so the test can prove exactly what
 * has and hasn't been issued at each point in time - no real timers, no
 * real network.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import { rollD20, createSeededRng } from '../ai/core/resolution';
import type { Entity, WorldState, SimulationState, Report, TruthLedgerEntry } from '../types';

// --- fixtures ---------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'player_1',
    name: 'Gaius Testus',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: { denarii: 1000 },
    visibility_network: [],
    current_state_narrative: 'Testing.',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

const worldState: WorldState = {
  year: 1,
  week: 1,
  economic_stability: 'Stable',
  political_climate: 'Tense',
  regions: {},
};

const simulationState: SimulationState = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Content',
  major_ongoing_crisis: null,
};

// storyRelevance names ZERO spotlight entities so the conditional
// private_conversation step (>= 2 spotlight entities) never fires, and the
// adjudication below carries no death-claim delta so the mortality
// pipeline's fast path (zero extra AI calls) applies - see
// ai/core/mortality.ts / tests/mortality.test.ts. Both are deliberately
// kept OUT of scope here: this file audits the NEW parallel section only,
// and the conditional-stage logic upstream of it is untouched by this
// refactor.
const storyRelevanceJson = JSON.stringify({ spotlight_entities: [], spotlight_intents: [] });

// The resolution layer's assessment call (ROADMAP_0_MASTER_PLAN.md Phase 3
// item 4) runs CONCURRENTLY with storyRelevance - see ai/core/turn.ts step 0.
// This default response marks the action non-consequential, so the bulk of
// this file's tests (which audit the parallelization introduced by Phase 3
// item 3, not the resolution layer itself) see NO PLAYER ACTION OUTCOME
// block and NO resolutionTrace - i.e. the adjudicator behaves exactly as it
// did before the resolution layer existed. The dedicated resolution-layer
// tests below use their own consequential response instead.
const nonConsequentialAssessmentJson = JSON.stringify({
  is_consequential: false,
  action_category: 'idle conversation',
  relevant_skill: null,
  difficulty: 10,
  opposing_entity_id: null,
  rationale: 'No real risk or opposition in this action.',
});

const adjudicationJson = JSON.stringify({
  turn: 2,
  entityActions: [],
  deltas: [{ type: 'resource', key: 'player_1:denarii', delta: 50, reason: 'Tax income.' }],
  headlines: ['The treasury grows.'],
  gm_private: [],
});

const simStateResponse = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Content',
  major_ongoing_crisis: null,
};
const simStateJson = JSON.stringify(simStateResponse);

const monologueText = 'I must tread carefully among the wolves of the Senate.';

const NARRATION_PROSE = 'The Senate convenes.';
const narrationFullText =
  `${NARRATION_PROSE}\nSUGGESTION: Bribe a senator\nSUGGESTION: Fortify the walls\nSUGGESTION: Consult the augurs`;

const relationshipJson = JSON.stringify({ deltas: [] });

// --- deferred / harness plumbing ---------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Awaits N microtask turns - used only to assert something has NOT happened yet (no real timers). */
async function tick(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

type CallKind =
  | 'storyRelevance'
  | 'assessment'
  | 'npcMind'
  | 'adjudication'
  | 'privateConversation'
  | 'mortalityValidation'
  | 'mortalityOutcome'
  | 'simulationState'
  | 'monologue'
  | 'narration'
  | 'relationshipUpdates';

const ALL_KINDS: CallKind[] = [
  'storyRelevance',
  'assessment',
  'npcMind',
  'adjudication',
  'privateConversation',
  'mortalityValidation',
  'mortalityOutcome',
  'simulationState',
  'monologue',
  'narration',
  'relationshipUpdates',
];

/**
 * Classifies a call by its (stable, distinct-per-callsite) systemInstruction
 * text - see ai/prompts/adjudication.ts, ai/prompts/assessment.ts,
 * ai/prompts/intelligence.ts, ai/prompts/narration.ts for the exact wording
 * each marker is drawn from.
 */
function classify(systemInstruction: unknown): CallKind {
  const s = typeof systemInstruction === 'string' ? systemInstruction : '';
  if (s.includes('master storyteller and game master')) return 'storyRelevance';
  if (s.includes('Action Assessor')) return 'assessment';
  if (s.includes("character's own private mind")) return 'npcMind';
  if (s.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
  if (s.includes('secret observer')) return 'privateConversation';
  if (s.includes('Mortality Validator')) return 'mortalityValidation';
  if (s.includes('Mortality Outcome Author')) return 'mortalityOutcome';
  if (s.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (s.includes('the inner voice of')) return 'monologue';
  if (s.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
  if (s.includes('narrative analyst AI')) return 'relationshipUpdates';
  throw new Error(`turnPipeline test fake: unrecognized call. systemInstruction: ${s.slice(0, 200)}`);
}

interface Harness {
  ai: GoogleGenAI;
  order: CallKind[];
  /** Resolves the instant a given call reaches the fake client (before its response is provided). */
  issued: Record<CallKind, Deferred<void>>;
  /** The test resolves/rejects these to control when (and how) each call's network round-trip settles. */
  response: Record<CallKind, Deferred<string>>;
  /** The `contents` (user prompt) string of the most recent call of each kind - lets a test inspect e.g. whether the adjudication prompt carried a PLAYER ACTION OUTCOME block. */
  promptsByKind: Partial<Record<CallKind, string>>;
  generateContent: ReturnType<typeof vi.fn>;
  generateContentStream: ReturnType<typeof vi.fn>;
}

/**
 * Builds a fake GoogleGenAI-shaped client. `streamNarration: true` routes
 * the narration call through `generateContentStream` (an async generator
 * split into a prose chunk + a suggestions chunk) instead of
 * `generateContent`, exercising the streaming path unchanged inside the new
 * parallel block (ROADMAP_0_MASTER_PLAN.md Phase 3 item 2 composing with
 * item 3).
 */
function createHarness(streamNarration = false): Harness {
  const order: CallKind[] = [];
  const issued = Object.fromEntries(ALL_KINDS.map(k => [k, createDeferred<void>()])) as Record<CallKind, Deferred<void>>;
  const response = Object.fromEntries(ALL_KINDS.map(k => [k, createDeferred<string>()])) as Record<CallKind, Deferred<string>>;
  const promptsByKind: Partial<Record<CallKind, string>> = {};

  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
    promptsByKind[kind] = params.contents;
    issued[kind].resolve();
    const text = await response[kind].promise;
    return { text };
  });

  const generateContentStream = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
    promptsByKind[kind] = params.contents;
    issued[kind].resolve();
    const fullText = await response[kind].promise;
    async function* gen() {
      const marker = '\nSUGGESTION:';
      const idx = fullText.indexOf(marker);
      if (idx === -1) {
        yield { text: fullText };
        return;
      }
      // Split across two chunks to exercise createNarrationStreamGate's
      // buffering (see streamSplit.ts) - the marker must never leak even
      // when it arrives in a later chunk than the prose.
      yield { text: fullText.slice(0, idx) };
      yield { text: fullText.slice(idx) };
    }
    return gen();
  });

  const ai = {
    models: streamNarration ? { generateContent, generateContentStream } : { generateContent },
  } as unknown as GoogleGenAI;

  return { ai, order, issued, response, promptsByKind, generateContent, generateContentStream };
}

afterEach(() => {
  // Drain any capture left active by a test that failed before turn.ts's
  // own catch block could call endTurnCapture() itself.
  endTurnCapture();
});

// --- tests ---------------------------------------------------------------

describe('ai/core/turn.ts runNewTurn - Phase 3 item 3 pipeline parallelization', () => {
  it('runs simulation-state/monologue/narration concurrently, keeps story-relevance -> adjudication sequential, and defers relationship-updates until narration resolves', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const onStage = vi.fn();

    const turnPromise = runNewTurn(
      h.ai,
      'Address the Senate',
      player,
      2,
      [player],
      worldState,
      simulationState,
      [],
      [],
      [],
      [],
      '',
      false,
      'Grim political thriller',
      { onStage }
    );
    turnPromise.catch(() => {}); // consumed properly below; just guards intermediate awaits in this test

    // --- story_relevance and assessment run CONCURRENTLY (Phase 3 item 4 -
    // resolution layer), and BOTH must resolve before adjudication starts ---
    await Promise.all([h.issued.storyRelevance.promise, h.issued.assessment.promise]);
    expect(h.order).toEqual(['storyRelevance', 'assessment']);

    let adjudicationIssuedEarly = false;
    h.issued.adjudication.promise.then(() => { adjudicationIssuedEarly = true; });
    await tick();
    expect(adjudicationIssuedEarly).toBe(false); // adjudication must NOT start before story-relevance/assessment resolve

    // Resolve story-relevance only - adjudication must still not start,
    // since it also awaits the assessment leg (same Promise.all).
    h.response.storyRelevance.resolve(storyRelevanceJson);
    await tick();
    expect(adjudicationIssuedEarly).toBe(false);

    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    await h.issued.adjudication.promise;
    expect(h.order).toEqual(['storyRelevance', 'assessment', 'adjudication']);

    // Non-consequential path (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4): no
    // PLAYER ACTION OUTCOME block is injected into the adjudication prompt -
    // the adjudicator sees exactly what it did before the resolution layer
    // existed.
    expect(h.promptsByKind.adjudication).not.toContain('PLAYER ACTION OUTCOME');

    h.response.adjudication.resolve(adjudicationJson);

    // --- (i) simulation_state / monologue / narration are ALL issued
    // before ANY of them resolves - true concurrency, not sequential. If
    // the pipeline regressed to sequential legs, this await would hang
    // (never observe all three issued) since none of their responses have
    // been provided yet.
    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    expect(h.order).toEqual(['storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration']);

    // --- (ii) relationship_updates must NOT be issued until narration resolves ---
    let relUpdatesIssuedEarly = false;
    h.issued.relationshipUpdates.promise.then(() => { relUpdatesIssuedEarly = true; });
    await tick();
    expect(relUpdatesIssuedEarly).toBe(false);

    // Resolve two of the three legs but withhold narration - relationship
    // updates must still not fire.
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    await tick();
    expect(relUpdatesIssuedEarly).toBe(false);
    expect(h.order).not.toContain('relationshipUpdates');

    h.response.narration.resolve(narrationFullText);
    await h.issued.relationshipUpdates.promise;
    expect(h.order).toEqual([
      'storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration', 'relationshipUpdates',
    ]);

    h.response.relationshipUpdates.resolve(relationshipJson);

    // --- (iii) final result matches sequential semantics -----------------
    const result = await turnPromise;

    expect(result.narration).toBe(NARRATION_PROSE);
    expect(result.suggestedActions).toEqual(['Bribe a senator', 'Fortify the walls', 'Consult the augurs']);
    expect(result.playerMonologue).toBe(monologueText);
    expect(result.updatedSimulationState).toEqual(simStateResponse);
    expect(result.headlines).toEqual(['The treasury grows.']);
    expect(result.updatedEntities.find(e => e.entity_id === 'player_1')?.resources.denarii).toBe(1050);

    // Non-consequential action: no resolution-layer trace at all - no roll
    // was ever made (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4).
    expect(result.newHistoryEntry.resolutionTrace).toBeUndefined();

    // onStage fired once per real stage, in the exact documented order -
    // private_conversation/mortality correctly skipped this turn (no
    // spotlight entities, no death claim). The assessment call does NOT get
    // its own stage - it shares 'story_relevance' (see TurnStage's doc
    // comment in ai/core/turn.ts).
    expect(onStage.mock.calls.map(c => c[0])).toEqual([
      'story_relevance', 'adjudication', 'simulation_state', 'monologue', 'narration', 'relationship_updates',
    ]);

    // Capture ordering: every call recorded exactly once, none corrupted by
    // the concurrent interleaving of recordCall pushes (ai/core/geminiService.ts).
    const rawCalls = result.newHistoryEntry.rawCalls ?? [];
    expect(rawCalls.map(r => r.callName).sort()).toEqual(
      ['storyRelevance', 'assessment', 'adjudication', 'updatedSimulationState', 'playerMonologue', 'narration', 'relationshipUpdates'].sort()
    );
    expect(rawCalls.every(r => r.validated)).toBe(true);
    expect(rawCalls).toHaveLength(7);
  });

  it('streams narration via generateContentStream inside the same parallel block, still concurrent with simulation-state/monologue', async () => {
    const h = createHarness(true);
    const player = makeEntity();
    const onNarrationChunk = vi.fn();

    const turnPromise = runNewTurn(
      h.ai,
      'Address the Senate',
      player,
      2,
      [player],
      worldState,
      simulationState,
      [],
      [],
      [],
      [],
      '',
      false,
      'Grim political thriller',
      { onNarrationChunk }
    );
    turnPromise.catch(() => {});

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    await h.issued.adjudication.promise;
    h.response.adjudication.resolve(adjudicationJson);

    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    expect(h.order).toEqual(['storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration']);
    // Narration went through the STREAMING path, not plain generateContent.
    expect(h.generateContentStream).toHaveBeenCalledTimes(1);

    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await turnPromise;

    expect(result.narration).toBe(NARRATION_PROSE);
    expect(result.playerMonologue).toBe(monologueText);
    expect(result.updatedSimulationState).toEqual(simStateResponse);

    // The stream gate must never let a SUGGESTION line leak into a chunk.
    expect(onNarrationChunk).toHaveBeenCalled();
    for (const call of onNarrationChunk.mock.calls) {
      expect(call[0]).not.toContain('SUGGESTION');
    }
    expect(onNarrationChunk.mock.calls.at(-1)?.[0]).toBe(NARRATION_PROSE);
  });

  it('propagates a rejection in one parallel leg as the turn failure (Promise.all fail-fast) without an unhandled-rejection warning from the surviving legs', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const turnPromise = runNewTurn(
        h.ai, 'Address the Senate', player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
      );
      turnPromise.catch(() => {}); // the turn's own rejection is handled deliberately - not what we're testing here

      h.response.storyRelevance.resolve(storyRelevanceJson);
      h.response.assessment.resolve(nonConsequentialAssessmentJson);
      await h.issued.adjudication.promise;
      h.response.adjudication.resolve(adjudicationJson);

      await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);

      // Fail the monologue leg first.
      h.response.monologue.reject(new Error('monologue leg exploded'));

      await expect(turnPromise).rejects.toMatchObject({
        name: 'AiServiceError',
        kind: 'fatal',
        callName: 'playerMonologue',
      });

      // The two SURVIVING legs settle only AFTER the turn has already
      // failed (one success, one later failure) - neither must produce a
      // Node 'unhandledRejection' event, since Promise.all attached a
      // handler to every promise in its array up front.
      h.response.simulationState.resolve(simStateJson);
      h.response.narration.reject(new Error('narration leg also exploded, after the fact'));

      await tick(30);

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});

// --- Campaign truth-ledger threading (DESIGN_DECISIONS.md D11) ------------

describe('ai/core/turn.ts runNewTurn - campaign truth-ledger threading (D11)', () => {
  it('preserves a NON-EMPTY prior campaign ledger and appends this turn\'s rumor entries, alongside the prior report log', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    // A campaign already in progress: one prior ledger entry and its linked
    // Report. If the pipeline stopped threading currentTruthLedger into
    // applyAdjudication (returning only this turn's entries), this test
    // fails - the prior entry would vanish from updatedTruthLedger.
    const priorLedger: TruthLedgerEntry[] = [
      { id: 'truth_prior', turn: 1, claim: 'An earlier lie', aboutId: 'npc_x', isTrue: false, originId: 'npc_x', reportId: 'report_prior' },
    ];
    const priorReports: Report[] = [
      { id: 'report_prior', turn: 1, source: 'rumor', about: 'npc_x', claim: 'An earlier lie', credibility: 0.4 },
    ];

    const adjudicationWithRumorJson = JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [
        { type: 'rumor', key: 'player_1', delta: 0.6, reason: 'The treasury is whispered to stand empty.', is_true: false, origin_id: 'npc_x' },
      ],
      headlines: ['Whispers in the forum.'],
      gm_private: [],
    });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationWithRumorJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await runNewTurn(
      h.ai, 'Hold court', player, 2, [player], worldState, simulationState, [], priorReports, priorLedger, [], '', false, 'Grim political thriller'
    );

    // The prior campaign entry survives verbatim at the head of the ledger...
    expect(result.updatedTruthLedger).toHaveLength(2);
    expect(result.updatedTruthLedger[0]).toEqual(priorLedger[0]);
    // ...and this turn's rumor is appended with its ruled disposition intact.
    const appended = result.updatedTruthLedger[1];
    expect(appended.isTrue).toBe(false);
    expect(appended.originId).toBe('npc_x');
    expect(appended.assumed).toBeUndefined();
    // The report log accretes the same way: prior report kept, new one linked.
    expect(result.updatedReports).toHaveLength(2);
    expect(result.updatedReports[0]).toEqual(priorReports[0]);
    expect(result.updatedReports.some(r => r.id === appended.reportId)).toBe(true);
    // Inputs were never mutated.
    expect(priorLedger).toHaveLength(1);
    expect(priorReports).toHaveLength(1);
  });
});

// --- Director continuity loop (ROADMAP_PHASE_4.md 4C item 3) --------------

describe('ai/core/turn.ts runNewTurn - Director continuity loop (4C.3)', () => {
  it('feeds prior npcIntents into the Director prompt, threads the Director\'s intents into the adjudication prompt, commits the durable slice, and notes a spotlight missing its entityAction', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const thrax = makeEntity({ entity_id: 'npc_thrax', name: 'Maximinus Thrax' });
    const guard = makeEntity({ entity_id: 'npc_guard', name: 'Praetorian Guard' });

    // The reducer's persisted slice from LAST turn - what the loop feeds back in.
    const priorIntents = [
      { entity_id: 'npc_thrax', intent: 'Court the Rhine legions in secret', continuity: 'new' as const },
    ];

    // The Director's response: two spotlights with intents, plus one intent
    // for a NON-spotlight entity that must never survive selection.
    const directorJson = JSON.stringify({
      spotlight_entities: [
        { entity_id: 'npc_thrax', reason: 'Momentum.' },
        { entity_id: 'npc_guard', reason: 'Wavering.' },
      ],
      spotlight_intents: [
        { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'pivot' },
        { entity_id: 'npc_guard', intent: 'Extract the donative before pledging swords', continuity: 'new' },
        { entity_id: 'npc_offstage', intent: 'A stray non-spotlight intent', continuity: 'new' },
      ],
    });

    // The adjudicator acts for thrax but NOT for the guard - the soft
    // contract must record a [Director] gm_private note for the guard only.
    const adjudicationWithOneActionJson = JSON.stringify({
      turn: 2,
      entityActions: [
        { id: 'npc_thrax', intent: 'march', target: null, notes: 'The legions break camp.' },
      ],
      deltas: [],
      headlines: ['The Rhine stirs.'],
      gm_private: [],
    });

    h.response.storyRelevance.resolve(directorJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    // Two spotlights -> two mind calls (4C.4). The harness holds ONE
    // deferred per kind, so both minds receive this same decision JSON; the
    // pipeline normalizes each decision's entity_id to the character it
    // actually asked, which is all this test needs (the mind feature's own
    // assertions live in tests/npcMinds.test.ts).
    h.response.npcMind.resolve(JSON.stringify({
      entity_id: 'npc_thrax',
      chosen_action: 'Rally the Rhine veterans to my standard.',
      method: 'Camp fires, oaths, and donatives.',
      private_reasoning: 'The purple is within reach.',
    }));
    h.response.adjudication.resolve(adjudicationWithOneActionJson);
    // Both spotlights resolve to real entities, so the private-conversation
    // step runs this turn - scripted to a no-op meeting.
    h.response.privateConversation.resolve(JSON.stringify({ dialogueSnippet: 'They met briefly.', deltas: [] }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await runNewTurn(
      h.ai, 'Hold court', player, 2, [player, thrax, guard], worldState, simulationState, [], [], [], priorIntents, '', false, 'Grim political thriller'
    );

    // (a) The loop's INPUT: the prior committed intent reached the Director's
    // prompt verbatim, inside the previous-intents block, and the cast
    // roster names the real entity ids.
    const directorPrompt = h.promptsByKind.storyRelevance ?? '';
    expect(directorPrompt).toContain("PREVIOUS TURN'S INTENTS");
    expect(directorPrompt).toContain('Court the Rhine legions in secret');
    expect(directorPrompt).toContain('npc_thrax');
    expect(directorPrompt).toContain('npc_guard');

    // (b) The adjudicator consumed the Director's intents as an input block
    // carrying the act-in-service demand - only for actual spotlights.
    const adjudicationPrompt = h.promptsByKind.adjudication ?? '';
    expect(adjudicationPrompt).toContain('SPOTLIGHT NPC INTENTS');
    expect(adjudicationPrompt).toContain('act in service of their stated intent');
    expect(adjudicationPrompt).toContain('March the Rhine legions on Rome');
    expect(adjudicationPrompt).not.toContain('A stray non-spotlight intent');

    // (c) The loop's OUTPUT: the durable slice (filtered to spotlights, in
    // emission order) lands on both the result and the history entry.
    expect(result.updatedNpcIntents).toEqual([
      { entity_id: 'npc_thrax', intent: 'March the Rhine legions on Rome', continuity: 'pivot' },
      { entity_id: 'npc_guard', intent: 'Extract the donative before pledging swords', continuity: 'new' },
    ]);
    expect(result.newHistoryEntry.npcIntents).toEqual(result.updatedNpcIntents);

    // (d) The soft consistency contract: exactly one note, for the guard,
    // in gm_private (GM-only surface) - and the turn still succeeded.
    const directorNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Director]'));
    expect(directorNotes).toHaveLength(1);
    expect(directorNotes[0]).toContain('npc_guard');
    expect(directorNotes[0]).toContain('Extract the donative before pledging swords');
  });

  it('an empty Director intent list replaces the persisted slice with [] and omits npcIntents from the history entry', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    h.response.storyRelevance.resolve(storyRelevanceJson); // zero spotlights, zero intents
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);

    const priorIntents = [{ entity_id: 'npc_gone', intent: 'A stale direction', continuity: 'new' as const }];
    const result = await runNewTurn(
      h.ai, 'Hold court', player, 2, [player], worldState, simulationState, [], [], [], priorIntents, '', false, 'Grim political thriller'
    );

    // Replacement semantics: the Director's output IS the durable state.
    expect(result.updatedNpcIntents).toEqual([]);
    expect(result.newHistoryEntry.npcIntents).toBeUndefined();
    // No intents -> no consistency notes.
    expect(result.newHistoryEntry.adjudication.gm_private.some(n => n.startsWith('[Director]'))).toBe(false);
  });
});

// --- Resolution layer (ROADMAP_0_MASTER_PLAN.md Phase 3 item 4) ----------

/**
 * Mocks Math.random so the pipeline's turn seed (generateSeed,
 * ai/core/resolution.ts) becomes one whose seeded generator's FIRST d20
 * draw is exactly `roll`. Searches the (dense) low seed space for such a
 * seed, then pins Math.random to the value generateSeed floors back to it -
 * mirrors tests/investigation.test.ts's identical helper.
 */
function mockRoll(roll: number) {
  let seed = 0;
  while (rollD20(createSeededRng(seed)) !== roll) seed++;
  return vi.spyOn(Math, 'random').mockReturnValue(seed / 2 ** 32);
}

describe('ai/core/turn.ts runNewTurn - resolution layer (assessment + resolveAction)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('consequential action: resolves a hidden roll, injects the PLAYER ACTION OUTCOME block into the adjudication prompt, and records a resolutionTrace', async () => {
    mockRoll(20); // rollD20() -> 20
    const h = createHarness(false);
    const player = makeEntity(); // no personality/skills -> personalityModifier and relevantSkillValue both contribute 0

    const consequentialAssessmentJson = JSON.stringify({
      is_consequential: true,
      action_category: 'oratory persuasion',
      relevant_skill: 'oratory',
      difficulty: 10,
      opposing_entity_id: null,
      rationale: 'A bold public appeal to the Senate.',
    });

    const turnPromise = runNewTurn(
      h.ai, 'Give a rousing speech to the Senate', player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );
    turnPromise.catch(() => {});

    await Promise.all([h.issued.storyRelevance.promise, h.issued.assessment.promise]);
    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(consequentialAssessmentJson);

    await h.issued.adjudication.promise;
    // total = roll(20) + skill(0, none known) + personality(0, none) + opposition(0, no opposing entity) = 20.
    // margin = total(20) - difficulty(10) = 10 -> tier 'critical_success' (margin >= 10).
    const adjudicationPrompt = h.promptsByKind.adjudication ?? '';
    expect(adjudicationPrompt).toContain('PLAYER ACTION OUTCOME');
    expect(adjudicationPrompt).toContain('CRITICAL_SUCCESS');
    expect(adjudicationPrompt).toContain('oratory persuasion');
    // The roll/margin/mechanics themselves are GM-only - fine to appear in
    // this prompt (never player-facing), but the tier name is the only
    // mechanical detail that needs to reach it per this feature's contract.
    h.response.adjudication.resolve(adjudicationJson);

    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);

    await h.issued.relationshipUpdates.promise;
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await turnPromise;

    expect(result.newHistoryEntry.resolutionTrace).toMatchObject({
      roll: 20,
      total: 20,
      margin: 10,
      tier: 'critical_success',
    });
    expect(result.newHistoryEntry.resolutionTrace?.assessment).toMatchObject({
      is_consequential: true,
      action_category: 'oratory persuasion',
      relevant_skill: 'oratory',
      difficulty: 10,
    });
    // A GM-private note records the roll/mechanics for the GM console (D4 -
    // never shown to the player, but ARE recorded for tuning).
    expect(result.newHistoryEntry.adjudication.gm_private.some(note => note.includes('[Resolution]'))).toBe(true);

    // The turn's seed is persisted on the history entry (GM-only, D4), and
    // replaying it reproduces the recorded roll: the action roll is the
    // per-turn generator's first draw.
    const turnSeed = result.newHistoryEntry.turnSeed;
    expect(typeof turnSeed).toBe('number');
    expect(Number.isInteger(turnSeed)).toBe(true);
    expect(rollD20(createSeededRng(turnSeed!))).toBe(20);
  });

  it('non-consequential action: no roll, no PLAYER ACTION OUTCOME block, no resolutionTrace - story_relevance and assessment still run concurrently', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const randomSpy = vi.spyOn(Math, 'random');

    const turnPromise = runNewTurn(
      h.ai, 'What news from the forum?', player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );
    turnPromise.catch(() => {});

    // Both calls are already in flight before either resolves - true
    // concurrency, matching Phase 3 item 3's established pattern.
    await Promise.all([h.issued.storyRelevance.promise, h.issued.assessment.promise]);
    expect(h.order).toEqual(['storyRelevance', 'assessment']);

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);

    await h.issued.adjudication.promise;
    expect(h.promptsByKind.adjudication).not.toContain('PLAYER ACTION OUTCOME');
    h.response.adjudication.resolve(adjudicationJson);

    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);

    await h.issued.relationshipUpdates.promise;
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await turnPromise;

    expect(result.newHistoryEntry.resolutionTrace).toBeUndefined();
    expect(result.newHistoryEntry.adjudication.gm_private.some(note => note.includes('[Resolution]'))).toBe(false);
    // Math.random is touched exactly once - the turn-seed entropy draw at
    // pipeline start (generateSeed, ai/core/resolution.ts). No dice were
    // ever rolled for a non-consequential action.
    expect(randomSpy).toHaveBeenCalledTimes(1);
    // The seed is still recorded even on a roll-free turn - it determines
    // any roll the turn WOULD have made.
    expect(typeof result.newHistoryEntry.turnSeed).toBe('number');
    randomSpy.mockRestore();
  });

  it('records turnSeed on the history entry, and the same seed replays every roll the turn made - action roll first, then the mortality roll', async () => {
    // Pin the seed's entropy draw so turnSeed - and therefore BOTH rolls -
    // are exact known values, not merely self-consistent. A replay-only
    // assertion has a 1-in-20 false pass if the mortality leg stops drawing
    // from the turn's seeded generator (e.g. regresses to Math.random or a
    // fresh generator, whose first draw the pinned entropy also fixes);
    // asserting the generator's exact SECOND draw fails deterministically.
    const SEED_ENTROPY = 0.123456789;
    vi.spyOn(Math, 'random').mockReturnValue(SEED_ENTROPY);
    const expectedSeed = Math.floor(SEED_ENTROPY * 0x100000000) >>> 0; // generateSeed's math
    const expectedRng = createSeededRng(expectedSeed);
    const expectedActionRoll = rollD20(expectedRng); // draw 1
    const expectedMortalityRoll = rollD20(expectedRng); // draw 2
    // Guards on the chosen entropy: the regressions this test exists to
    // catch must not coincidentally produce the expected second draw.
    expect(expectedMortalityRoll).not.toBe(expectedActionRoll); // fresh-generator regression
    expect(expectedMortalityRoll).not.toBe(Math.floor(SEED_ENTROPY * 20) + 1); // raw-Math.random regression

    const h = createHarness(false);
    const player = makeEntity();
    const npc = makeEntity({ entity_id: 'npc_1', name: 'Senator Rufus' });

    const consequentialAssessmentJson = JSON.stringify({
      is_consequential: true,
      action_category: 'intrigue: assassination plot',
      relevant_skill: 'intrigue',
      difficulty: 15,
      opposing_entity_id: null,
      rationale: 'A dagger in the dark.',
    });
    // Carries a death claim so the mortality pipeline actually rolls -
    // making this turn draw TWICE from the per-turn generator.
    const adjudicationWithDeathJson = JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [
        { type: 'resource', key: 'player_1:denarii', delta: -100, reason: 'Bribes for the guards.' },
        { type: 'status', key: 'npc_1', delta: 0, reason: 'Cut down in the Curia.', new_status: 'dead' },
      ],
      headlines: ['Blood in the Curia.'],
      gm_private: [],
    });

    // Pre-resolve every response the pipeline could need. The pinned seed
    // makes the mortality roll's fate band deterministic, but the OUTCOME
    // response stays queued regardless - it simply goes unused when the
    // band needs no content, keeping this block agnostic to the exact
    // entropy value chosen above.
    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(consequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationWithDeathJson);
    h.response.mortalityValidation.resolve(JSON.stringify({
      dispositions: [{ entity_id: 'npc_1', valid: true, reasoning: 'A real assassination attempt occurred this turn.' }],
    }));
    h.response.mortalityOutcome.resolve(JSON.stringify({
      outcomes: [{ entity_id: 'npc_1', deltas: [], narrative_directive: 'Narrate the aftermath.', secret_motive: null }],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);

    const result = await runNewTurn(
      h.ai, 'Send the assassin after Rufus', player, 2, [player, npc], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );

    const entry = result.newHistoryEntry;
    expect(entry.turnSeed).toBe(expectedSeed);

    // Exact values, not just replay consistency: the action roll must be
    // the turn generator's first draw and the mortality roll its second.
    expect(entry.resolutionTrace).toBeDefined();
    expect(entry.resolutionTrace!.roll).toBe(expectedActionRoll);
    expect(entry.mortalityTrace).toHaveLength(1);
    expect(entry.mortalityTrace![0]).toMatchObject({ entity_id: 'npc_1', valid: true });
    expect(entry.mortalityTrace![0].roll).toBe(expectedMortalityRoll);

    // Replay: rebuilding the generator from the persisted seed reproduces
    // the turn's recorded rolls in draw order.
    const replayRng = createSeededRng(entry.turnSeed!);
    expect(rollD20(replayRng)).toBe(entry.resolutionTrace!.roll);
    expect(rollD20(replayRng)).toBe(entry.mortalityTrace![0].roll);
  });
});

// --- Pacing posture threading (ROADMAP_PHASE_4.md 4D item 1, D23) ---------

describe('ai/core/turn.ts runNewTurn - pacing posture threading (4D.1, D23)', () => {
  /** The systemInstruction the fake client saw on its adjudication call. */
  function adjudicationSystemInstruction(h: Harness): string {
    const call = h.generateContent.mock.calls.find(
      c => String((c[0] as { config?: Record<string, unknown> }).config?.systemInstruction).includes('Roman Crisis Adjudicator & Simulation Engine')
    );
    expect(call).toBeDefined();
    return String((call![0] as { config?: Record<string, unknown> }).config?.systemInstruction);
  }

  function resolveWholePipeline(h: Harness): void {
    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologueText);
    h.response.narration.resolve(narrationFullText);
    h.response.relationshipUpdates.resolve(relationshipJson);
  }

  it('threads options.pacingPosture into the adjudication system instruction\'s PACING JUDGMENT principle', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    resolveWholePipeline(h);

    await runNewTurn(
      h.ai, 'Hold court', player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller',
      { pacingPosture: 'dramatic' }
    );

    const sys = adjudicationSystemInstruction(h);
    expect(sys).toContain('PACING JUDGMENT');
    expect(sys).toContain('PACING POSTURE - EAGER');
    expect(sys).not.toContain('PACING POSTURE - MEASURED');
  });

  it('omitted posture falls back to the balanced default contract - the pre-posture call shape', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    resolveWholePipeline(h);

    await runNewTurn(
      h.ai, 'Hold court', player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );

    const sys = adjudicationSystemInstruction(h);
    expect(sys).toContain('PACING JUDGMENT');
    expect(sys).toContain('PACING POSTURE - MEASURED (the default)');
  });
});
