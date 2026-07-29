/**
 * tests/turnPipeline.test.ts
 *
 * Exercises `runNewTurn`'s REAL (non-mock) pipeline (ai/core/turn.ts) with a
 * scripted fake `GoogleGenAI` client, proving the Phase 3 item 3
 * parallelization (ROADMAP_0_MASTER_PLAN.md) actually runs `simulation_state`
 * / `monologue` / `narration` CONCURRENTLY rather than sequentially, while
 * `story_relevance` -> `adjudication` stay sequential.
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
import type { PrivateSceneAdjudicatorProjection } from '../privateScene/model';
import type { Entity, WorldState, SimulationState, Report, TruthLedgerEntry, TurnSubmission } from '../types';

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

const freeform = (text: string): TurnSubmission => ({ version: 1, kind: 'freeform', text });

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

// storyRelevance names ZERO spotlight entities, and the adjudication below
// carries no death-claim delta so the mortality
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
  deltas: [{ type: 'resource', key: 'player_1:denarii', delta: 50, reason: 'Tax income.', actors: [] }],
  headlines: [{ text: 'The treasury grows.', actors: [] }],
  gm_private: [],
});

// simStateResponse stays the committed (post-strip) SimulationState shape -
// it's compared directly against `result.updatedSimulationState` below, which
// never carries `actors` (ai/core/actorsBoundary.ts strips it before
// getUpdatedSimulationState returns). Only simStateJson (the RAW provider
// interchange fed to the fake client) gets the actors-attribution sibling.
const simStateResponse = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Content',
  major_ongoing_crisis: null as string | null,
};
const simStateJson = JSON.stringify({ ...simStateResponse, actors: [] });

const monologueText = 'I must tread carefully among the wolves of the Senate.';

const NARRATION_PROSE = 'The Senate convenes.';
const narrationFullText =
  `${NARRATION_PROSE}\nSUGGESTION: Bribe a senator\nSUGGESTION: Fortify the walls\nSUGGESTION: Consult the augurs`;

// Task 4: narration/monologue are structured-output calls now, so every
// `h.response.monologue.resolve(...)` / `h.response.narration.resolve(...)`
// below must hand the fake client valid JSON ({text, actors}), not bare
// prose - `generateStructured`/`generateStructuredStream` parseModelJson the
// raw text before anything else runs. `actors: []` is faithful: every test
// in this file scripts these two calls only on an observable-attempt turn,
// where the declared-actors gate is inert regardless (see
// tests/turnActorsGate.test.ts's REACHABILITY FINDING).
const monologuePayloadJson = JSON.stringify({ text: monologueText, actors: [] });
const narrationPayloadJson = JSON.stringify({ text: narrationFullText, actors: [] });

/**
 * Reproduces a narration STREAM split at PROSE character offsets as the
 * equivalent split of the JSON-encoded `{"text": ..., "actors": []}`
 * payload, so the mechanics-poisoned streaming tests below exercise the same
 * chunk-boundary positions (mid die-roll number, mid tier token) through the
 * new `extractPayloadTextPrefix` seam that they used to exercise directly on
 * raw prose. None of the three scripted cases contain a quote or backslash,
 * so `JSON.stringify` never re-encodes them and a plain `indexOf` reliably
 * locates the prose within the JSON string.
 */
function narrationJsonChunksAtProseOffsets(proseChunks: string[]): { json: string; chunker: (fullText: string) => string[] } {
  const prose = proseChunks.join('');
  const json = JSON.stringify({ text: prose, actors: [] });
  const textStart = json.indexOf(prose);
  if (textStart === -1) throw new Error('narrationJsonChunksAtProseOffsets: prose not found verbatim in its own JSON encoding');
  const chunker = (fullText: string): string[] => {
    const chunks: string[] = [];
    let cutStart = 0;
    let cumulative = 0;
    for (let i = 0; i < proseChunks.length - 1; i++) {
      cumulative += proseChunks[i].length;
      const cut = textStart + cumulative;
      chunks.push(fullText.slice(cutStart, cut));
      cutStart = cut;
    }
    chunks.push(fullText.slice(cutStart));
    return chunks;
  };
  return { json, chunker };
}

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
  | 'mortalityValidation'
  | 'mortalityOutcome'
  | 'simulationState'
  | 'monologue'
  | 'narration'
  ;

const ALL_KINDS: CallKind[] = [
  'storyRelevance',
  'assessment',
  'npcMind',
  'adjudication',
  'mortalityValidation',
  'mortalityOutcome',
  'simulationState',
  'monologue',
  'narration',
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
  if (s.includes('Mortality Validator')) return 'mortalityValidation';
  if (s.includes('Mortality Outcome Author')) return 'mortalityOutcome';
  if (s.includes('Roman historian analyzing the state of the Empire')) return 'simulationState';
  if (s.includes('the inner voice of')) return 'monologue';
  if (s.includes('Chronicler of the Empire & Intelligence Briefer')) return 'narration';
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
  /** The instruction paired with each prompt, retained for prompt-contract assertions. */
  systemInstructionsByKind: Partial<Record<CallKind, string>>;
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
function createHarness(
  streamNarration = false,
  narrationChunker?: (fullText: string) => string[],
): Harness {
  const order: CallKind[] = [];
  const issued = Object.fromEntries(ALL_KINDS.map(k => [k, createDeferred<void>()])) as Record<CallKind, Deferred<void>>;
  const response = Object.fromEntries(ALL_KINDS.map(k => [k, createDeferred<string>()])) as Record<CallKind, Deferred<string>>;
  const promptsByKind: Partial<Record<CallKind, string>> = {};
  const systemInstructionsByKind: Partial<Record<CallKind, string>> = {};

  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
    promptsByKind[kind] = params.contents;
    systemInstructionsByKind[kind] = String(params.config?.systemInstruction ?? '');
    issued[kind].resolve();
    const text = await response[kind].promise;
    return { text };
  });

  const generateContentStream = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
    promptsByKind[kind] = params.contents;
    systemInstructionsByKind[kind] = String(params.config?.systemInstruction ?? '');
    issued[kind].resolve();
    const fullText = await response[kind].promise;
    async function* gen() {
      if (narrationChunker) {
        const chunks = narrationChunker(fullText);
        if (chunks.join('') !== fullText) {
          throw new Error('turnPipeline test fake: narration chunks must reconstruct the full response.');
        }
        for (const chunk of chunks) yield { text: chunk };
        return;
      }
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

  return { ai, order, issued, response, promptsByKind, systemInstructionsByKind, generateContent, generateContentStream };
}

afterEach(() => {
  // Drain any capture left active by a test that failed before turn.ts's
  // own catch block could call endTurnCapture() itself.
  endTurnCapture();
});

// --- tests ---------------------------------------------------------------

describe('ai/core/turn.ts runNewTurn - Phase 3 item 3 pipeline parallelization', () => {
  it('treats a pending private-scene projection as context while adjudication deltas remain the sole consequence authority', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const projection: PrivateSceneAdjudicatorProjection = {
      player: { entityId: player.entity_id, name: player.name },
      npc: { entityId: 'npc_claimant', name: 'Lucius Claimant' },
      closureReason: 'npc_ended',
      speechActs: [{ speaker: 'npc', kind: 'claim', text: 'Three cohorts have sworn to me.' }],
      lastWord: 'The standards will rise at dawn.',
      latestNpcInternalIntent: 'Bluff; only one cohort is loyal.',
    };

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const result = await runNewTurn(
      h.ai,
      freeform('Hold court'),
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
      { privateSceneAdjudicatorProjection: projection },
    );

    expect(h.promptsByKind.adjudication).toContain('Three cohorts have sworn to me.');
    expect(h.promptsByKind.adjudication).toContain('Bluff; only one cohort is loyal.');
    expect(result.newHistoryEntry.adjudication.deltas).toEqual([
      { type: 'resource', key: 'player_1:denarii', delta: 50, reason: 'Tax income.' },
    ]);
    expect(result.updatedEntities.find(entity => entity.entity_id === player.entity_id)?.resources.denarii).toBe(1050);
    expect(h.order).toEqual(['storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration']);
  });

  it('keeps mixed-submission Private Intent out of adjudication but in player-owned calls', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const privateIntent = 'PRIVATE_INTENT_MUST_STAY_PLAYER_OWNED';

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    await runNewTurn(
      h.ai,
      {
        version: 1,
        kind: 'structured',
        actions: ['Attend the Senate'],
        privateIntent,
      },
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
    );

    expect(h.promptsByKind.adjudication).not.toContain(privateIntent);
    expect(h.promptsByKind.narration).toContain(privateIntent);
    expect(h.promptsByKind.monologue).toContain(privateIntent);
  });

  it('runs simulation-state/monologue/narration concurrently while keeping story-relevance -> adjudication sequential', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const onStage = vi.fn();

    const turnPromise = runNewTurn(
      h.ai,
      freeform('Address the Senate'),
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

    // Resolve two of the three legs but withhold narration: the turn remains
    // pending until the final concurrent leg resolves.
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    await tick();

    h.response.narration.resolve(narrationPayloadJson);
    expect(h.order).toEqual([
      'storyRelevance', 'assessment', 'adjudication', 'simulationState', 'monologue', 'narration',
    ]);

    // --- (ii) final result matches sequential semantics ------------------
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
    // Mortality correctly skipped this turn (no death claim). The assessment call does NOT get
    // its own stage - it shares 'story_relevance' (see TurnStage's doc
    // comment in ai/core/turn.ts).
    expect(onStage.mock.calls.map(c => c[0])).toEqual([
      'story_relevance', 'adjudication', 'simulation_state', 'monologue', 'narration',
    ]);

    // Capture ordering: every call recorded exactly once, none corrupted by
    // the concurrent interleaving of recordCall pushes (ai/core/geminiService.ts).
    const rawCalls = result.newHistoryEntry.rawCalls ?? [];
    expect(rawCalls.map(r => r.callName).sort()).toEqual(
      ['storyRelevance', 'assessment', 'adjudication', 'updatedSimulationState', 'playerMonologue', 'narration'].sort()
    );
    expect(rawCalls.every(r => r.validated)).toBe(true);
    expect(rawCalls).toHaveLength(6);
  });

  it('streams narration via generateContentStream inside the same parallel block, still concurrent with simulation-state/monologue', async () => {
    const h = createHarness(true);
    const player = makeEntity();
    const onNarrationChunk = vi.fn();

    const turnPromise = runNewTurn(
      h.ai,
      freeform('Address the Senate'),
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

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

  it('rejects a mechanics-poisoned narration stream before any unsafe cumulative chunk reaches the UI callback', async () => {
    const h = createHarness(true);
    const player = makeEntity();
    const onNarrationChunk = vi.fn();
    const poisonedNarration = 'The speech landed as critical_success after the die rolled 20.';

    const turnPromise = runNewTurn(
      h.ai,
      freeform('Address the Senate'),
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
      { onNarrationChunk },
    );
    turnPromise.catch(() => {});

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    await h.issued.adjudication.promise;
    h.response.adjudication.resolve(adjudicationJson);
    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(JSON.stringify({ text: poisonedNarration, actors: [] }));

    await expect(turnPromise).rejects.toThrow('player-visible mechanics boundary');
    expect(onNarrationChunk).not.toHaveBeenCalled();
  });

  it.each([
    ['split die result', ['The die rolled ', '20.'], '20'],
    ['split tier token', ['The outcome was critical_', 'success.'], 'critical_success'],
    ['default-ignorable tier token', ['The outcome was critical\u200d_', 'success.'], 'critical_success'],
  ])('buffers an incomplete %s so no unsafe prefix can reach the streaming callback', async (_label, chunks, forbidden) => {
    const { json: poisonedNarrationJson, chunker } = narrationJsonChunksAtProseOffsets(chunks);
    const h = createHarness(true, chunker);
    const player = makeEntity();
    const onNarrationChunk = vi.fn();

    const turnPromise = runNewTurn(
      h.ai,
      freeform('Address the Senate'),
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
      { onNarrationChunk },
    );
    turnPromise.catch(() => {});

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    await h.issued.adjudication.promise;
    h.response.adjudication.resolve(adjudicationJson);
    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(poisonedNarrationJson);

    let thrown: unknown;
    try {
      await turnPromise;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('player-visible mechanics boundary');
    expect((thrown as Error).message).not.toContain(forbidden);
    expect(onNarrationChunk).not.toHaveBeenCalled();
  });

  it('propagates a rejection in one parallel leg as the turn failure (Promise.all fail-fast) without an unhandled-rejection warning from the surviving legs', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const turnPromise = runNewTurn(
        h.ai, freeform('Address the Senate'), player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
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
        { type: 'rumor', key: 'player_1', delta: 0.6, reason: 'The treasury is whispered to stand empty.', is_true: false, origin_id: 'npc_x', actors: [] },
      ],
      headlines: [{ text: 'Whispers in the forum.', actors: [] }],
      gm_private: [],
    });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationWithRumorJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const result = await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], worldState, simulationState, [], priorReports, priorLedger, [], '', false, 'Grim political thriller'
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

// --- Mortality directives: no validator reasoning on the player surface (D4) ---

describe('ai/core/turn.ts runNewTurn - mortality directives feed narration from VALID events only (D4)', () => {
  it("an invalidated death claim: the validator's GM-only reasoning never reaches the narration prompt, only the diegetic delta rewrite does", async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const npc = makeEntity({ entity_id: 'npc_1', name: 'Senator Rufus' });

    // The validation call marks the mortality.ts-GM-only 'reasoning' with a
    // sentinel: it is recorded in gm_private / the mortalityTrace, and must
    // never ride into the narration prompt via a MORTALITY NARRATION
    // DIRECTIVE (the invalidated event's outcomeSummary is "Death claim
    // invalidated - <this reasoning>").
    const VALIDATION_REASONING = 'No assassin was anywhere near the Curia this turn; the death is pure invention.';

    const adjudicationWithDeathJson = JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [
        { type: 'status', key: 'npc_1', delta: 0, reason: 'Cut down in the Curia.', new_status: 'dead', actors: [] },
      ],
      headlines: [{ text: 'Blood is rumored in the Curia.', actors: [] }],
      gm_private: [],
    });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationWithDeathJson);
    h.response.mortalityValidation.resolve(JSON.stringify({
      dispositions: [{ entity_id: 'npc_1', valid: false, reasoning: VALIDATION_REASONING }],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const result = await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player, npc], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );

    const narrationPrompt = h.promptsByKind.narration ?? '';
    // The invalidated event is filtered out of the narration directives, so
    // neither the validator reasoning nor the GM-only "invalidated" summary
    // reaches the player-facing narration prompt - and with no VALID event
    // this turn, the directives block is absent entirely.
    expect(narrationPrompt).not.toContain(VALIDATION_REASONING);
    expect(narrationPrompt).not.toContain('Death claim invalidated');
    expect(narrationPrompt).not.toContain('MORTALITY NARRATION DIRECTIVES');
    // What the player SHOULD read crosses the existing visibility seam: the
    // invalid claim's authoritative rewrite to alive remains visible without
    // forwarding the raw delta reason.
    expect(narrationPrompt).toContain('Senator Rufus is now alive.');

    // The reasoning is still recorded GM-side for the console (D4): on the
    // mortalityTrace and in gm_private.
    expect(result.newHistoryEntry.mortalityTrace?.[0]).toMatchObject({ entity_id: 'npc_1', valid: false });
    expect(result.newHistoryEntry.mortalityTrace?.[0].outcomeSummary).toContain(VALIDATION_REASONING);
    expect(result.newHistoryEntry.adjudication.gm_private.some(n => n.includes(VALIDATION_REASONING))).toBe(true);
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
        { id: 'npc_thrax', intent: 'march', target: null, notes: 'The legions break camp.', actors: ['npc_thrax'] },
      ],
      deltas: [],
      headlines: [{ text: 'The Rhine stirs.', actors: ['npc_thrax'] }],
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
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const result = await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player, thrax, guard], worldState, simulationState, [], [], [], priorIntents, '', false, 'Grim political thriller'
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const priorIntents = [{ entity_id: 'npc_gone', intent: 'A stale direction', continuity: 'new' as const }];
    const result = await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], worldState, simulationState, [], [], [], priorIntents, '', false, 'Grim political thriller'
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
      h.ai, freeform('Give a rousing speech to the Senate'), player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

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
      h.ai, freeform('What news from the forum?'), player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

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
        { type: 'resource', key: 'player_1:denarii', delta: -100, reason: 'Bribes for the guards.', actors: [] },
        { type: 'status', key: 'npc_1', delta: 0, reason: 'Cut down in the Curia.', new_status: 'dead', actors: [] },
      ],
      headlines: [{ text: 'Blood in the Curia.', actors: [] }],
      gm_private: [
        'GM_PRIVATE_SENTINEL_MUST_NOT_REACH_MORTALITY_6T2',
        'Arbitrary adjudicator-authored private marker.',
      ],
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['OBSERVABLE_ASSASSINATION_ATTEMPT_6T2'],
      privateIntent: 'PRIVATE_INTENT_MUST_NOT_REACH_MORTALITY_6T2',
      questionOrContext: 'QUESTION_MUST_NOT_REACH_MORTALITY_6T2',
    };
    const result = await runNewTurn(
      h.ai, submission, player, 2, [player, npc], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
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

    // The mortality validator receives the adjudication's GM context. The
    // resolution trace may contribute the observable action and mechanics,
    // but it must never interpolate the persisted canonical submission,
    // whose structured private fields are deliberately not observable here.
    const mortalityValidationPrompt = h.promptsByKind.mortalityValidation ?? '';
    expect(mortalityValidationPrompt).toContain('OBSERVABLE_ASSASSINATION_ATTEMPT_6T2');
    expect(mortalityValidationPrompt).toContain('[Resolution]');
    expect(mortalityValidationPrompt).not.toContain('GM_PRIVATE_SENTINEL_MUST_NOT_REACH_MORTALITY_6T2');
    expect(mortalityValidationPrompt).not.toContain('Arbitrary adjudicator-authored private marker.');
    expect(mortalityValidationPrompt).not.toContain('PRIVATE_INTENT_MUST_NOT_REACH_MORTALITY_6T2');
    expect(mortalityValidationPrompt).not.toContain('QUESTION_MUST_NOT_REACH_MORTALITY_6T2');
    expect(mortalityValidationPrompt).not.toContain('GOR_TURN_SUBMISSION/');
    // The untrusted private trace remains available to the GM in the
    // persisted adjudication; only the mortality AI input is projected.
    expect(entry.adjudication.gm_private).toContain('GM_PRIVATE_SENTINEL_MUST_NOT_REACH_MORTALITY_6T2');

    // Replay: rebuilding the generator from the persisted seed reproduces
    // the turn's recorded rolls in draw order.
    const replayRng = createSeededRng(entry.turnSeed!);
    expect(rollD20(replayRng)).toBe(entry.resolutionTrace!.roll);
    expect(rollD20(replayRng)).toBe(entry.mortalityTrace![0].roll);
  });

  it.each([
    ['question-only', {
      version: 1,
      kind: 'structured',
      questionOrContext: 'What do the empty benches suggest about tomorrow\'s vote?',
    } as const],
    ['private-only', {
      version: 1,
      kind: 'structured',
      privateIntent: 'Gain the consul\'s confidence without exposing my source.',
    } as const],
    ['question-plus-private', {
      version: 1,
      kind: 'structured',
      privateIntent: 'Gain the consul\'s confidence without exposing my source.',
      questionOrContext: 'What do the empty benches suggest about tomorrow\'s vote?',
    } as const],
  ])('advances the complete background pipeline for %s while suppressing freeform player prose', async (_label, submission) => {
    const h = createHarness(false);
    const player = makeEntity();
    const aulus = makeEntity({ entity_id: 'npc_aulus', name: 'Aulus' });
    const brutus = makeEntity({ entity_id: 'npc_brutus', name: 'Brutus' });
    const stages: string[] = [];

    h.response.storyRelevance.resolve(JSON.stringify({
      spotlight_entities: [
        { entity_id: 'npc_aulus', reason: 'The cohorts are wavering.' },
        { entity_id: 'npc_brutus', reason: 'The Senate is divided.' },
      ],
      spotlight_intents: [
        { entity_id: 'npc_aulus', intent: 'Secure the cohorts', continuity: 'new' },
        { entity_id: 'npc_brutus', intent: 'Count the undecided votes', continuity: 'new' },
      ],
    }));
    h.response.npcMind.resolve(JSON.stringify({
      entity_id: 'npc_aulus',
      chosen_action: 'Sound out the centurions.',
      method: 'Quiet promises.',
      private_reasoning: 'The army decides the succession.',
    }));
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [{
        id: 'npc_aulus',
        intent: 'recruit',
        target: 'cohorts',
        notes: 'Aulus independently courts the cohorts.',
        actors: ['npc_aulus'],
      }],
      deltas: [
        {
          type: 'resource',
          key: 'npc_aulus:independent_preparations',
          delta: 2,
          reason: 'Aulus acts on his own agenda.',
          actors: ['npc_aulus'],
        },
        {
          type: 'world',
          key: 'political_climate',
          delta: 0,
          reason: 'Legions Maneuver Independently',
          actors: [],
        },
      ],
      headlines: [{ text: 'Aulus moves among the cohorts.', actors: ['npc_aulus'] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(JSON.stringify({
      ...simStateResponse,
      senate_status: 'Ascendant',
      major_ongoing_crisis: 'The Rhine legions are mobilizing.',
      actors: [],
    }));
    h.response.monologue.resolve(JSON.stringify({ text: 'I order an attack after rolling 20. PRIVATE_MONOLOGUE_POISON', actors: [] }));
    h.response.narration.resolve(JSON.stringify({ text: 'You order an attack after rolling 20. PRIVATE_NARRATION_POISON', actors: [] }));

    const result = await runNewTurn(
      h.ai, submission, player, 2, [player, aulus, brutus], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
      { onStage: stage => stages.push(stage) },
    );

    expect(h.order).toEqual([
      'storyRelevance',
      'npcMind',
      'npcMind',
      'adjudication',
      'simulationState',
    ]);
    expect(stages).toEqual([
      'story_relevance',
      'npc_minds',
      'adjudication',
      'simulation_state',
      'monologue',
      'narration',
    ]);
    expect(h.order).not.toContain('assessment');
    expect(h.order).not.toContain('monologue');
    expect(h.order).not.toContain('narration');
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
    expect(result.suggestedActions).toEqual([
      'Consider your next move carefully.',
      'Consolidate your power.',
      'Seek new allies.',
    ]);
    expect(result.updatedEntities.find(entity => entity.entity_id === 'npc_aulus')?.resources.independent_preparations).toBe(2);
    expect(result.updatedWorldState.political_climate).toBe('Legions Maneuver Independently');
    expect(result.updatedSimulationState).toMatchObject({
      senate_status: 'Ascendant',
      major_ongoing_crisis: 'The Rhine legions are mobilizing.',
    });
    expect(result.updatedNpcIntents).toHaveLength(2);
    expect(result.newHistoryEntry.narration).toBe('');
    expect(result.newHistoryEntry.adjudication.entityActions).toEqual([
      expect.objectContaining({ id: 'npc_aulus', intent: 'recruit' }),
    ]);
    expect(typeof result.newHistoryEntry.turnSeed).toBe('number');
    expect(result.newHistoryEntry.resolutionTrace).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MONOLOGUE_POISON');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NARRATION_POISON');
  });

  it('never starts poisoned narration/monologue calls or emits a stream chunk on a no-attempt turn', async () => {
    const h = createHarness(true, fullText => [fullText]);
    const player = makeEntity();
    const onNarrationChunk = vi.fn();
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: 'What does the courier know?',
    };

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [],
      headlines: [{ text: 'The courier waits in the rain.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(
      JSON.stringify({ text: 'I dispatch spies. PRIVATE_INTENT_POISON secret_truth says the roll was 20.', actors: [] }),
    );
    h.response.narration.resolve(
      JSON.stringify({ text: 'You dispatch spies. PRIVATE_INTENT_POISON secret_truth says the roll was 20.\nSUGGESTION: Attack', actors: [] }),
    );

    const result = await runNewTurn(
      h.ai, submission, player, 2, [player], worldState, simulationState, [], [], [], [], '', false,
      'Grim political thriller', { onNarrationChunk },
    );

    expect(h.order).not.toContain('monologue');
    expect(h.order).not.toContain('narration');
    expect(h.generateContentStream).not.toHaveBeenCalled();
    expect(onNarrationChunk).not.toHaveBeenCalled();
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
    expect(result.suggestedActions).toEqual([
      'Consider your next move carefully.',
      'Consolidate your power.',
      'Seek new allies.',
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INTENT_POISON');
    expect(JSON.stringify(result)).not.toContain('secret_truth');
    expect(JSON.stringify(result)).not.toContain('roll was 20');
  });

  it('runs applicable mortality and state continuation on a no-attempt turn without requesting prose', async () => {
    mockRoll(20);
    const h = createHarness(false);
    const player = makeEntity();
    const npc = makeEntity({ entity_id: 'npc_1', name: 'Senator Rufus' });
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: 'What follows from the attack on Rufus?',
    };

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [{ type: 'status', key: 'npc_1', delta: 0, reason: 'An assassin strikes Rufus.', new_status: 'dead', actors: [] }],
      headlines: [{ text: 'Rufus is attacked near the Curia.', actors: [] }],
      gm_private: [],
    }));
    h.response.mortalityValidation.resolve(JSON.stringify({
      dispositions: [{ entity_id: 'npc_1', valid: true, reasoning: 'The attack is supported.' }],
    }));
    h.response.mortalityOutcome.resolve(JSON.stringify({
      outcomes: [{
        entity_id: 'npc_1',
        deltas: [],
        narrative_directive: 'Rufus escapes into the rain.',
      }],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(JSON.stringify({ text: 'I sign the death warrant. PRIVATE_MONOLOGUE_POISON', actors: [] }));
    h.response.narration.resolve(JSON.stringify({ text: 'You sign the death warrant. PRIVATE_NARRATION_POISON', actors: [] }));

    const result = await runNewTurn(
      h.ai, submission, player, 2, [player, npc], worldState, simulationState, [], [], [], [], '', false,
      'Grim political thriller',
    );

    expect(h.order).toContain('storyRelevance');
    expect(h.order).toContain('adjudication');
    expect(h.order).toContain('mortalityValidation');
    expect(h.order).toContain('mortalityOutcome');
    expect(h.order).toContain('simulationState');
    expect(h.order).not.toContain('assessment');
    expect(h.order).not.toContain('monologue');
    expect(h.order).not.toContain('narration');
    expect(result.narration).toBe('');
    expect(result.playerMonologue).toBe('');
    expect(result.suggestedActions).toEqual([
      'Consider your next move carefully.',
      'Consolidate your power.',
      'Seek new allies.',
    ]);
    expect(result.newHistoryEntry.mortalityTrace).toHaveLength(1);
    expect(typeof result.newHistoryEntry.turnSeed).toBe('number');
    expect(result.newHistoryEntry.narration).toBe('');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MONOLOGUE_POISON');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NARRATION_POISON');
  });

  it('never requests a poisoned first-person monologue on a no-attempt turn', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      privateIntent: 'Remain publicly inactive.',
    };

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [],
      headlines: [{ text: 'The city watches the palace.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(JSON.stringify({ text: 'I sign the decree and summon the legions.', actors: [] }));
    h.response.narration.resolve(JSON.stringify({ text: 'You see petitioners gathering outside the palace.', actors: [] }));

    const result = await runNewTurn(
      h.ai, submission, player, 2, [player], worldState, simulationState, [], [], [], [], '', false,
      'Grim political thriller',
    );

    expect(h.order).not.toContain('monologue');
    expect(h.order).not.toContain('narration');
    expect(result.playerMonologue).toBe('');
    expect(JSON.stringify(result)).not.toContain('I sign the decree and summon the legions.');
  });

  it.each([
    ['visible', 'Rome', true],
    ['off-screen', 'Antioch', false],
  ] as const)(
    'a valid %s NPC mortality event reaches narration only through the player-perceived digest',
    async (_label, npcLocation, shouldBeVisible) => {
      const randomSpy = mockRoll(14); // gravely wounded: outcome call authors a unique directive
      const h = createHarness(false);
      const player = makeEntity();
      const npc = makeEntity({
        entity_id: 'npc_mortality',
        name: 'MORTALITY_NPC_NAME',
        location: npcLocation,
      });
      const RAW_OUTCOME_DIRECTIVE = 'RAW_MORTALITY_OUTCOME_DIRECTIVE_MUST_NOT_BYPASS_VISIBILITY';

      h.response.storyRelevance.resolve(storyRelevanceJson);
      h.response.assessment.resolve(nonConsequentialAssessmentJson);
      h.response.adjudication.resolve(JSON.stringify({
        turn: 2,
        entityActions: [],
        deltas: [{
          type: 'status', key: 'npc_mortality', delta: 0,
          reason: 'An assassin strikes.', new_status: 'dead', actors: [],
        }],
        headlines: [{ text: 'A hidden blade falls.', actors: [] }],
        gm_private: [],
      }));
      h.response.mortalityValidation.resolve(JSON.stringify({
        dispositions: [{ entity_id: 'npc_mortality', valid: true, reasoning: 'The attack was earned.' }],
      }));
      h.response.mortalityOutcome.resolve(JSON.stringify({
        outcomes: [{
          entity_id: 'npc_mortality', deltas: [],
          narrative_directive: RAW_OUTCOME_DIRECTIVE, secret_motive: null,
        }],
      }));
      h.response.simulationState.resolve(simStateJson);
      h.response.monologue.resolve(monologuePayloadJson);
      h.response.narration.resolve(narrationPayloadJson);

      const result = await runNewTurn(
        h.ai, freeform('Hold court'), player, 2, [player, npc],
        worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller',
      );
      randomSpy.mockRestore();

      const narrationPrompt = h.promptsByKind.narration ?? '';
      expect(narrationPrompt).not.toContain(RAW_OUTCOME_DIRECTIVE);
      expect(narrationPrompt).not.toContain('MORTALITY NARRATION DIRECTIVES');
      if (shouldBeVisible) {
        expect(narrationPrompt).toContain('MORTALITY_NPC_NAME is now alive.');
      } else {
        expect(narrationPrompt).not.toContain('MORTALITY_NPC_NAME');
        expect(narrationPrompt).not.toContain('npc_mortality');
      }
      expect(result.newHistoryEntry.mortalityTrace?.[0].outcomeSummary).toBe(RAW_OUTCOME_DIRECTIVE);
      expect(result.updatedEntities.find(e => e.entity_id === 'npc_mortality')?.status).toBe('alive');
    },
  );
});

describe('ai/core/turn.ts runNewTurn - player-perceived narration input', () => {
  it('excludes invisible adjudication poison from the real narration request while retaining the submitted action and visible digest', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const hiddenNpc = makeEntity({
      entity_id: 'npc_hidden',
      name: 'INVISIBLE_NPC_NAME_POISON',
      location: 'Antioch',
      resources: { denarii: 1000 },
      voice: 'INVISIBLE_VOICE_POISON',
      epithet: 'INVISIBLE_EPITHET_POISON',
    });
    const poisonedAdjudication = JSON.stringify({
      turn: 2,
      entityActions: [{
        id: 'npc_hidden',
        intent: 'intrigue',
        target: 'player_1',
        notes: 'INVISIBLE_ACTION_NOTES_POISON',
        actors: ['npc_hidden'],
      }],
      deltas: [
        {
          type: 'resource', key: 'npc_hidden:denarii', delta: 50,
          reason: 'INVISIBLE_RESOURCE_REASON_POISON', actors: ['npc_hidden'],
        },
        {
          type: 'resource', key: 'player_1:denarii', delta: 25,
          reason: 'VISIBLE_RAW_REASON_MUST_NOT_APPEAR', actors: [],
        },
      ],
      headlines: [{ text: 'INVISIBLE_HEADLINE_POISON', actors: ['npc_hidden'] }],
      gm_private: ['INVISIBLE_GM_SECRET_POISON'],
    });

    const turnPromise = runNewTurn(
      h.ai, freeform('Address the Senate'), player, 2, [player, hiddenNpc],
      worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller',
    );
    turnPromise.catch(() => {});

    await Promise.all([h.issued.storyRelevance.promise, h.issued.assessment.promise]);
    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    await h.issued.adjudication.promise;
    h.response.adjudication.resolve(poisonedAdjudication);
    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);

    const narrationPrompt = h.promptsByKind.narration ?? '';
    expect(narrationPrompt).toContain('Address the Senate');
    expect(narrationPrompt).toContain('Your denarii grows.');
    for (const poison of [
      'INVISIBLE_NPC_NAME_POISON',
      'INVISIBLE_VOICE_POISON',
      'INVISIBLE_EPITHET_POISON',
      'INVISIBLE_ACTION_NOTES_POISON',
      'INVISIBLE_RESOURCE_REASON_POISON',
      'VISIBLE_RAW_REASON_MUST_NOT_APPEAR',
      'INVISIBLE_HEADLINE_POISON',
      'INVISIBLE_GM_SECRET_POISON',
      'npc_hidden:denarii',
    ]) {
      expect(narrationPrompt).not.toContain(poison);
    }
    expect(narrationPrompt).not.toContain('"entityActions"');
    expect(narrationPrompt).not.toContain('"intent"');
    expect(narrationPrompt).not.toContain('"deltas"');
    expect(narrationPrompt).not.toContain('"headlines"');

    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);
    const result = await turnPromise;
    expect(result.updatedEntities.find(e => e.entity_id === 'player_1')?.resources.denarii).toBe(1025);
    expect(result.updatedEntities.find(e => e.entity_id === 'npc_hidden')?.resources.denarii).toBe(1050);
  });

  it('never derives voice identity from a public rumor subject, but keeps voice for an entity named in visible event text', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const hiddenRumorSubject = makeEntity({
      entity_id: 'npc_hidden_rumor_subject',
      name: 'HIDDEN_RUMOR_NAME_POISON',
      location: 'Antioch',
      voice: 'HIDDEN_RUMOR_VOICE_POISON',
      epithet: 'HIDDEN_RUMOR_EPITHET_POISON',
    });
    const visibleNpc = makeEntity({
      entity_id: 'npc_visible',
      name: 'VISIBLE_NPC_NAME',
      location: 'Rome',
      resources: { denarii: 10 },
      voice: 'VISIBLE_NPC_VOICE',
      epithet: 'VISIBLE_NPC_EPITHET',
    });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [
        {
          type: 'rumor', key: 'npc_hidden_rumor_subject', delta: 0.5,
          reason: 'A nameless panic spreads through the grain markets.',
          is_true: false, origin_id: 'npc_visible', actors: [],
        },
        {
          type: 'resource', key: 'npc_visible:denarii', delta: 5,
          reason: 'A public collection.', actors: ['npc_visible'],
        },
      ],
      headlines: [{ text: 'Market whispers spread.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    await runNewTurn(
      h.ai, freeform('Address the Senate'), player, 2,
      [player, hiddenRumorSubject, visibleNpc], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    const narrationPrompt = h.promptsByKind.narration ?? '';
    expect(narrationPrompt).toContain('A nameless panic spreads through the grain markets.');
    expect(narrationPrompt).toContain('VISIBLE_NPC_NAME');
    expect(narrationPrompt).toContain('VISIBLE_NPC_VOICE');
    expect(narrationPrompt).toContain('VISIBLE_NPC_EPITHET');
    expect(narrationPrompt).not.toContain('HIDDEN_RUMOR_NAME_POISON');
    expect(narrationPrompt).not.toContain('HIDDEN_RUMOR_VOICE_POISON');
    expect(narrationPrompt).not.toContain('HIDDEN_RUMOR_EPITHET_POISON');
    expect(narrationPrompt).not.toContain('npc_hidden_rumor_subject');
  });

  it('matches a voice identity only as a Unicode-aware whole display name, never as the Cato prefix of Catonian', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const hiddenCato = makeEntity({
      entity_id: 'npc_hidden_cato',
      name: 'Cato',
      location: 'Antioch',
      voice: 'HIDDEN_CATO_VOICE_POISON',
      epithet: 'HIDDEN_CATO_EPITHET_POISON',
    });
    const visibleCatonian = makeEntity({
      entity_id: 'npc_visible_catonian',
      name: 'Catonian Tribune',
      location: 'Rome',
      resources: { denarii: 10 },
      voice: 'VISIBLE_CATONIAN_VOICE',
      epithet: 'VISIBLE_CATONIAN_EPITHET',
    });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [{
        type: 'resource', key: 'npc_visible_catonian:denarii', delta: 5,
        reason: 'A collection in the Forum.', actors: ['npc_visible_catonian'],
      }],
      headlines: [{ text: 'The Forum watches.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    await runNewTurn(
      h.ai, freeform('Address the Senate'), player, 2,
      [player, hiddenCato, visibleCatonian], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    const narrationPrompt = h.promptsByKind.narration ?? '';
    expect(narrationPrompt).toContain("Catonian Tribune's denarii grows.");
    expect(narrationPrompt).toContain('VISIBLE_CATONIAN_VOICE');
    expect(narrationPrompt).toContain('VISIBLE_CATONIAN_EPITHET');
    expect(narrationPrompt).not.toContain('HIDDEN_CATO_VOICE_POISON');
    expect(narrationPrompt).not.toContain('HIDDEN_CATO_EPITHET_POISON');
    expect(narrationPrompt).not.toContain('npc_hidden_cato');
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
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);
  }

  it('threads options.pacingPosture into the adjudication system instruction\'s PACING JUDGMENT principle', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    resolveWholePipeline(h);

    await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller',
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
      h.ai, freeform('Hold court'), player, 2, [player], worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );

    const sys = adjudicationSystemInstruction(h);
    expect(sys).toContain('PACING JUDGMENT');
    expect(sys).toContain('PACING POSTURE - MEASURED (the default)');
  });

  // --- HISTORICAL MATERIAL threading (ROADMAP_PHASE_4.md 4D item 2, D24) --

  it('threads options.eventFirings into a GM-private HISTORICAL MATERIAL block when an authored trigger is ripe', async () => {
    const h = createHarness(false);
    const player = makeEntity(); // NOT an Emperor - triggers are role-agnostic (4D.2)
    resolveWholePipeline(h);

    // A failing economy makes grain_shortage's trigger fire for any player;
    // empty bookkeeping means it has never fired, so it is RIPE.
    await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], { ...worldState, economic_stability: 'Failing' },
      simulationState, [], [], [], [], '', false, 'Grim political thriller',
      { eventFirings: [] }
    );

    const adjudicationPrompt = h.promptsByKind.adjudication!;
    expect(adjudicationPrompt).toContain('HISTORICAL MATERIAL');
    expect(adjudicationPrompt).toContain('[RIPE] Grain Shortage in the Capital (grain_shortage)');
    // The D24 preference contract rides with the material.
    expect(adjudicationPrompt).toContain('PREFER weaving its premise');
  });

  it('omitted eventFirings produces no HISTORICAL MATERIAL block - the pre-4D.2 prompt shape', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    resolveWholePipeline(h);

    await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], { ...worldState, economic_stability: 'Failing' },
      simulationState, [], [], [], [], '', false, 'Grim political thriller'
    );

    expect(h.promptsByKind.adjudication!).not.toContain('HISTORICAL MATERIAL');
  });
});

// --- No-attempt player ownership boundary (P0: DEBT HAS TEETH reject loop) --
//
// The pure assert functions in tests/playerBoundary.test.ts are necessary but
// not sufficient: mock mode skips runNewTurn's boundary gates entirely, so a
// gate that deterministically rejects legitimate world-driven output only
// surfaces on the REAL pipeline. These tests exercise that path with the
// scripted fake client: the adjudicator obeying its own DEBT HAS TEETH rule
// on a question-only turn must COMMIT, while genuinely invented player
// actions must still reject the whole turn.

describe('ai/core/turn.ts runNewTurn - no-attempt player ownership boundary (DEBT HAS TEETH)', () => {
  const questionOnly: TurnSubmission = {
    version: 1,
    kind: 'structured',
    questionOrContext: 'Can the treasury still service the debt to Crassus?',
  };

  // adjudicationJson above deliberately carries a player-keyed resource
  // delta (player agency - rejected on no-attempt turns), so question-only
  // tests that are not themselves about deltas use this neutral response.
  const neutralAdjudicationJson = JSON.stringify({
    turn: 2,
    entityActions: [],
    deltas: [],
    headlines: [{ text: 'The week advances.', actors: [] }],
    gm_private: [],
  });

  it('commits a question-only turn whose adjudication raises the indebted player\'s dependency_level toward a creditor', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const crassus = makeEntity({ entity_id: 'npc_crassus', name: 'Crassus' });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [{
        type: 'relation',
        key: 'player_1:npc_crassus:dependency_level',
        delta: 2,
        reason: 'Mounting arrears leave the palace beholden to Crassus.',
        origin_id: 'npc_crassus',
        actors: ['npc_crassus'],
      }],
      headlines: [{ text: 'Creditors circle the Palatine.', actors: ['npc_crassus'] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player, crassus], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(h.order).toEqual(['storyRelevance', 'adjudication', 'simulationState']);
    expect(
      result.updatedEntities.find(e => e.entity_id === 'player_1')?.relationships['npc_crassus']?.dependency_level,
    ).toBe(2);
    expect(result.headlines).toEqual(['Creditors circle the Palatine.']);
    expect(result.narration).toBe('');
  });

  it('steers the adjudicator on a no-attempt turn: the world may act ON the player, never author an act BY the player', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(neutralAdjudicationJson);
    h.response.simulationState.resolve(simStateJson);

    await runNewTurn(
      h.ai, { version: 1, kind: 'structured', questionOrContext: 'What news?' }, player, 2, [player],
      worldState, simulationState, [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(h.systemInstructionsByKind.adjudication).toContain('NO-ATTEMPT TURNS');
    expect(h.promptsByKind.adjudication).toContain('NO OBSERVABLE ATTEMPT THIS TURN');
  });

  it('does not inject the no-attempt steering line when an observable attempt exists', async () => {
    const h = createHarness(false);
    const player = makeEntity();

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.assessment.resolve(nonConsequentialAssessmentJson);
    h.response.adjudication.resolve(adjudicationJson);
    h.response.simulationState.resolve(simStateJson);
    h.response.monologue.resolve(monologuePayloadJson);
    h.response.narration.resolve(narrationPayloadJson);

    await runNewTurn(
      h.ai, freeform('Hold court'), player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(h.promptsByKind.adjudication).not.toContain('NO OBSERVABLE ATTEMPT THIS TURN');
  });

  it.each([
    ['a player entityAction', {
      entityActions: [{ id: 'player_1', intent: 'negotiate', target: 'npc_crassus', notes: 'A quiet accommodation is sought.', actors: ['player_1'] }],
      deltas: [],
    }],
    ['a player-originated dependency_level delta', {
      entityActions: [],
      deltas: [{
        type: 'relation', key: 'player_1:npc_crassus:dependency_level', delta: -2,
        reason: 'The debt is quietly restructured.', origin_id: 'player_1', actors: ['player_1'],
      }],
    }],
    ['a trust_level delta keyed under the player', {
      entityActions: [],
      deltas: [{ type: 'relation', key: 'player_1:npc_crassus:trust_level', delta: 2, reason: 'A new opinion forms.', actors: [] }],
    }],
  ])('still rejects %s on a question-only turn', async (_label, shape) => {
    const h = createHarness(false);
    const player = makeEntity();
    const crassus = makeEntity({ entity_id: 'npc_crassus', name: 'Crassus' });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      ...shape,
      headlines: [{ text: 'The week advances.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);

    const turnPromise = runNewTurn(
      h.ai, questionOnly, player, 2, [player, crassus], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    await expect(turnPromise).rejects.toThrow('player action boundary');
  });

  it('commits a question-only turn whose headline styles a third party by the player\'s shared title', async () => {
    const h = createHarness(false);
    const player = makeEntity({ position: 'Senator' });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [],
      headlines: [{ text: 'The Senator Gaius Pontius withdraws to his estate.', actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(result.headlines).toEqual(['The Senator Gaius Pontius withdraws to his estate.']);
  });

  it('commits a question-only turn whose crisis text describes the player\'s slipping condition possessively', async () => {
    const h = createHarness(false);
    const player = makeEntity({ position: 'Emperor' });
    const crisis = 'The Emperor\'s grip weakens.';

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(neutralAdjudicationJson);
    h.response.simulationState.resolve(JSON.stringify({ ...simStateResponse, major_ongoing_crisis: crisis, actors: [] }));

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(result.updatedSimulationState.major_ongoing_crisis).toBe(crisis);
  });

  // CHANGED (prose/structural split): a headline naming the player acting is a
  // NARRATIVE blemish, not a mechanical violation - it carries no state change.
  // Failing the turn on it cost the player 4-8 provider calls and an
  // unrecoverable "The turn could not be resolved."; a retry re-rolls the same
  // nondeterministic model against the same prompt. The headline is now dropped
  // from the committed player-visible surface and recorded GM-side instead.
  it('redacts - never rejects - a question-only turn whose headline has the player acting by name', async () => {
    const h = createHarness(false);
    const player = makeEntity({ position: 'Senator' });
    const invented = 'Gaius Testus withdraws to his estate.';

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [],
      deltas: [],
      headlines: [{ text: invented, actors: [] }],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(result.headlines).toEqual([]);
    expect(result.newHistoryEntry.adjudication.headlines).toEqual([]);
    expect(result.newHistoryEntry.adjudication.gm_private.some(note =>
      note.startsWith('[Boundary]') && note.includes(invented))).toBe(true);
  });
});

// --- Prose redaction vs. structural rejection (shipping blocker) ------------
//
// The PROSE classifier is a heuristic; the STRUCTURAL gates are exact identity
// checks. They must not share a failure mode: prose is redacted from the
// player-visible surface and recorded GM-side while the turn commits, and only
// a mechanical violation (player-owned delta, player-id entityAction,
// remove_entities naming the player) still fails the turn closed.

describe('ai/core/turn.ts runNewTurn - no-attempt prose redaction vs. structural rejection', () => {
  const questionOnly: TurnSubmission = {
    version: 1,
    kind: 'structured',
    questionOrContext: 'Can the treasury still service the debt to Crassus?',
  };

  /**
   * The canonical DEBT HAS TEETH prose ai/prompts/adjudication.ts itself
   * solicits on a no-attempt turn. Every earlier revision of the prose gate
   * REJECTED it, turning an indebted player's question-only turns into a
   * deterministic reject-retry loop.
   */
  const debtProse = 'Mounting arrears leave Gaius Testus increasingly beholden to Titus Vinius.';

  function boundaryNotes(gmPrivate: readonly string[]): string[] {
    return gmPrivate.filter(note => note.startsWith('[Boundary]'));
  }

  it('commits a no-attempt turn of legitimate prose with ZERO redactions', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const crassus = makeEntity({ entity_id: 'npc_crassus', name: 'Crassus' });

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [
        { id: 'npc_crassus', intent: 'intrigue', target: null, notes: 'Your creditors grow restless.', actors: ['npc_crassus'] },
      ],
      deltas: [{
        type: 'relation',
        key: 'player_1:npc_crassus:dependency_level',
        delta: 2,
        reason: debtProse,
        origin_id: 'npc_crassus',
        actors: ['npc_crassus'],
      }],
      headlines: [
        { text: 'You wait.', actors: [] },
        { text: 'The Senate debates the grain dole without you.', actors: [] },
        { text: 'You receive a letter from Titus.', actors: [] },
      ],
      gm_private: [],
    }));
    h.response.simulationState.resolve(simStateJson);

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player, crassus], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    expect(result.headlines).toEqual([
      'You wait.', 'The Senate debates the grain dole without you.', 'You receive a letter from Titus.',
    ]);
    expect(result.newHistoryEntry.adjudication.deltas[0].reason).toBe(debtProse);
    expect(result.newHistoryEntry.adjudication.entityActions[0].notes).toBe('Your creditors grow restless.');
    expect(boundaryNotes(result.newHistoryEntry.adjudication.gm_private)).toEqual([]);
    expect(
      result.updatedEntities.find(e => e.entity_id === 'player_1')?.relationships['npc_crassus']?.dependency_level,
    ).toBe(2);
  });

  it('commits a no-attempt turn carrying an invented player action, with that content gone from every player-visible surface', async () => {
    const h = createHarness(false);
    const player = makeEntity();
    const invented = 'You seize the treasury and execute the tribune.';

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({
      turn: 2,
      entityActions: [{ id: 'npc_crassus', intent: 'intrigue', target: null, notes: invented, actors: ['player_1'] }],
      deltas: [{ type: 'resource', key: 'npc_crassus:denarii', delta: -5, reason: invented, actors: ['player_1'] }],
      headlines: [
        { text: 'Creditors circle the Palatine.', actors: [] },
        { text: invented, actors: ['player_1'] },
      ],
      gm_private: [],
    }));
    h.response.simulationState.resolve(JSON.stringify({ ...simStateResponse, major_ongoing_crisis: invented, actors: [] }));

    const result = await runNewTurn(
      h.ai, questionOnly, player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    );

    // Committed, not failed.
    expect(result.headlines).toEqual(['Creditors circle the Palatine.']);
    // And absent from EVERY player-visible surface of the committed result.
    const committed = {
      headlines: result.headlines,
      narration: result.narration,
      suggestedActions: result.suggestedActions,
      playerMonologue: result.playerMonologue,
      updatedSimulationState: result.updatedSimulationState,
      deltas: result.newHistoryEntry.adjudication.deltas,
      entityActions: result.newHistoryEntry.adjudication.entityActions,
      committedHeadlines: result.newHistoryEntry.adjudication.headlines,
    };
    expect(JSON.stringify(committed)).not.toContain('seize the treasury');
    expect(result.updatedSimulationState.major_ongoing_crisis).not.toContain('seize');
    // The delta itself survives - only its prose was replaced.
    expect(result.newHistoryEntry.adjudication.deltas).toHaveLength(1);
    expect(result.newHistoryEntry.adjudication.deltas[0].delta).toBe(-5);
    // Recorded GM-side so the outage is not silent. gm_private is rendered
    // ONLY by components/GameMasterScreen.tsx and is stripped before every
    // player-facing prompt, so it may carry the original text verbatim.
    const notes = boundaryNotes(result.newHistoryEntry.adjudication.gm_private);
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes.every(note => note.includes(invented))).toBe(true);
  });

  it.each([
    ['a player-owned delta', {
      entityActions: [],
      deltas: [{ type: 'resource', key: 'player_1:denarii', delta: -200, reason: 'Gold changes hands.', actors: ['player_1'] }],
      headlines: [{ text: 'The week advances.', actors: [] }],
    }],
    ['a player-id entityAction', {
      entityActions: [{ id: 'player_1', intent: 'negotiate', target: 'npc_crassus', notes: 'A quiet accommodation is sought.', actors: ['player_1'] }],
      deltas: [],
      headlines: [{ text: 'The week advances.', actors: [] }],
    }],
    ['a remove_entities entry naming the player', {
      entityActions: [],
      deltas: [],
      headlines: [{ text: 'The week advances.', actors: [] }],
      remove_entities: ['player_1'],
    }],
  ])('still fails the whole turn closed on %s', async (_label, shape) => {
    const h = createHarness(false);
    const player = makeEntity();

    h.response.storyRelevance.resolve(storyRelevanceJson);
    h.response.adjudication.resolve(JSON.stringify({ turn: 2, ...shape, gm_private: [] }));
    h.response.simulationState.resolve(simStateJson);

    await expect(runNewTurn(
      h.ai, questionOnly, player, 2, [player], worldState, simulationState,
      [], [], [], [], '', false, 'Grim political thriller',
    )).rejects.toThrow('player action boundary');
  });
});
