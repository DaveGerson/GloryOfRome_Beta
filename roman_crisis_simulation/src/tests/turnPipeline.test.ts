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
import type { Entity, WorldState, SimulationState } from '../types';

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
const storyRelevanceJson = JSON.stringify({ spotlight_entities: [] });

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
  | 'adjudication'
  | 'simulationState'
  | 'monologue'
  | 'narration'
  | 'relationshipUpdates';

const ALL_KINDS: CallKind[] = [
  'storyRelevance',
  'adjudication',
  'simulationState',
  'monologue',
  'narration',
  'relationshipUpdates',
];

/**
 * Classifies a call by its (stable, distinct-per-callsite) systemInstruction
 * text - see ai/prompts/adjudication.ts, ai/prompts/intelligence.ts,
 * ai/prompts/narration.ts for the exact wording each marker is drawn from.
 */
function classify(systemInstruction: unknown): CallKind {
  const s = typeof systemInstruction === 'string' ? systemInstruction : '';
  if (s.includes('master storyteller and game master')) return 'storyRelevance';
  if (s.includes('Roman Crisis Adjudicator & Simulation Engine')) return 'adjudication';
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

  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
    issued[kind].resolve();
    const text = await response[kind].promise;
    return { text };
  });

  const generateContentStream = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const kind = classify(params.config?.systemInstruction);
    order.push(kind);
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

  return { ai, order, issued, response, generateContent, generateContentStream };
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
      '',
      false,
      'Grim political thriller',
      { onStage }
    );
    turnPromise.catch(() => {}); // consumed properly below; just guards intermediate awaits in this test

    // --- story_relevance -> adjudication must be SEQUENTIAL -------------
    await h.issued.storyRelevance.promise;
    expect(h.order).toEqual(['storyRelevance']);

    let adjudicationIssuedEarly = false;
    h.issued.adjudication.promise.then(() => { adjudicationIssuedEarly = true; });
    await tick();
    expect(adjudicationIssuedEarly).toBe(false); // adjudication must NOT start before story-relevance resolves

    h.response.storyRelevance.resolve(storyRelevanceJson);
    await h.issued.adjudication.promise;
    expect(h.order).toEqual(['storyRelevance', 'adjudication']);

    h.response.adjudication.resolve(adjudicationJson);

    // --- (i) simulation_state / monologue / narration are ALL issued
    // before ANY of them resolves - true concurrency, not sequential. If
    // the pipeline regressed to sequential legs, this await would hang
    // (never observe all three issued) since none of their responses have
    // been provided yet.
    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    expect(h.order).toEqual(['storyRelevance', 'adjudication', 'simulationState', 'monologue', 'narration']);

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
      'storyRelevance', 'adjudication', 'simulationState', 'monologue', 'narration', 'relationshipUpdates',
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

    // onStage fired once per real stage, in the exact documented order -
    // private_conversation/mortality correctly skipped this turn (no
    // spotlight entities, no death claim).
    expect(onStage.mock.calls.map(c => c[0])).toEqual([
      'story_relevance', 'adjudication', 'simulation_state', 'monologue', 'narration', 'relationship_updates',
    ]);

    // Capture ordering: every call recorded exactly once, none corrupted by
    // the concurrent interleaving of recordCall pushes (ai/core/geminiService.ts).
    const rawCalls = result.newHistoryEntry.rawCalls ?? [];
    expect(rawCalls.map(r => r.callName).sort()).toEqual(
      ['storyRelevance', 'adjudication', 'updatedSimulationState', 'playerMonologue', 'narration', 'relationshipUpdates'].sort()
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
      'Address the Senate',
      player,
      2,
      [player],
      worldState,
      simulationState,
      [],
      [],
      '',
      false,
      'Grim political thriller',
      { onNarrationChunk }
    );
    turnPromise.catch(() => {});

    h.response.storyRelevance.resolve(storyRelevanceJson);
    await h.issued.adjudication.promise;
    h.response.adjudication.resolve(adjudicationJson);

    await Promise.all([h.issued.simulationState.promise, h.issued.monologue.promise, h.issued.narration.promise]);
    expect(h.order).toEqual(['storyRelevance', 'adjudication', 'simulationState', 'monologue', 'narration']);
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
        h.ai, 'Address the Senate', player, 2, [player], worldState, simulationState, [], [], '', false, 'Grim political thriller'
      );
      turnPromise.catch(() => {}); // the turn's own rejection is handled deliberately - not what we're testing here

      h.response.storyRelevance.resolve(storyRelevanceJson);
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
