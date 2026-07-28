/**
 * TDD RED SUITE - Task 4 of the actors-attribution refactor: the declaration
 * gate wired through the LIVE turn pipeline (ai/core/turn.ts) and the mock
 * pipeline (ai/mocks.ts), including the narration/monologue structured-output
 * switch. Design record: docs/superpowers/plans/task-4-design.md. Spec:
 * docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md.
 *
 * THE SEAM UNDER TEST (gate-before-strip): today ai/core/turn.ts and
 * ai/tools/intelligence.ts strip the interchange-only `actors` IMMEDIATELY
 * after each zod parse, so the declaration gate (Task 2,
 * ai/core/playerBoundary.ts) never sees a declaration. Task 4 reorders each
 * surface to: parse -> declaration-aware gate on the INTERCHANGE -> strip at
 * the commit boundary. Committed state must still NEVER carry `actors`
 * (tests/actorsAttribution.test.ts's strip pin keeps passing).
 *
 * NARRATION DECISION (task-4-design.md section 1): narration switches to ONE
 * structured-output STREAMING call (NarrationPayloadSchema/zNarrationPayload,
 * both landed-unwired) via a new `generateStructuredStream` in
 * ai/core/geminiService.ts; a new pure `extractPayloadTextPrefix` in
 * ai/core/streamSplit.ts pulls the decoded prefix of the top-level "text"
 * value from the partial JSON per chunk, feeding the EXISTING
 * createNarrationStreamGate -> createPlayerVisibleStreamGate chain unchanged.
 * The monologue switches to plain (non-streaming) structured output
 * (PlayerMonologuePayloadSchema/zPlayerMonologuePayload); getPlayerMonologue
 * returns the parsed `{ text, actors }` payload.
 *
 * REACHABILITY FINDING (pinned here; implementer must preserve it): on every
 * VALIDATED no-attempt submission (question-only / private-intent-only), the
 * pipeline short-circuits narration and monologue to '' before any provider
 * call, and an empty structured submission fails serialization ("Enter at
 * least one turn detail.") - so a no-attempt turn where narration/monologue
 * PROSE actually flows is unreachable through runNewTurn's front door. The
 * declared-actors gate on those two surfaces is therefore DEFENSE-IN-DEPTH
 * (pinned at the seam below); the REACHABLE no-attempt B7 surfaces are the
 * adjudication prose fields and the simulation-state crisis, pinned through
 * the real pipeline entry point.
 *
 * RED SIGNALS: missing exports fail guarded toBeDefined lookups (style:
 * tests/actorsAttribution.test.ts); behavioral tests fail on assertions.
 * Two mock tests marked [PIN] are green today and pin behavior the wiring
 * must not regress.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn } from '../ai/core/turn';
import * as geminiService from '../ai/core/geminiService';
import * as streamSplit from '../ai/core/streamSplit';
import * as intelligence from '../ai/tools/intelligence';
import { GEMINI_PRO, endTurnCapture } from '../ai/core/geminiService';
import { zNarrationPayload } from '../ai/core/zodSchemas';
import { redactInventedPlayerProseFromValue } from '../ai/core/playerBoundary';
import { mockRunNewTurn } from '../ai/mocks';
import { ALL_INITIAL_ENTITIES, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import { getMockInitialState } from './mockData';
import type { Entity, WorldState, SimulationState, TurnSubmission } from '../types';

// --- fixtures ---------------------------------------------------------------

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
const questionOnly = (q: string): TurnSubmission => ({ version: 1, kind: 'structured', questionOrContext: q });

const worldState: WorldState = {
  year: 1, week: 1, economic_stability: 'Stable', political_climate: 'Tense', regions: {},
};
const simulationState: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Content', major_ongoing_crisis: null,
};

const storyRelevanceJson = JSON.stringify({ spotlight_entities: [], spotlight_intents: [] });
const nonConsequentialAssessmentJson = JSON.stringify({
  is_consequential: false, action_category: 'idle conversation', relevant_skill: null,
  difficulty: 10, opposing_entity_id: null, rationale: 'No real risk.',
});

/**
 * Declared-player prose the flat tripwire CANNOT see (no sentence opens on a
 * player alias - 'Gaius Testus'/'player'/'avatar'/'you'/'i') - the exact B7
 * register only the schema declaration closes. Each carries
 * actors: ['player_1'], the pure-data declaration the gate must honor.
 */
const DECLARED_HEADLINE = 'Quiet edicts from the palace strip the frontier legions of pay.';
const WORLD_HEADLINE = 'Grain runs short in the city markets.';
const DECLARED_REASON = 'Coin moves to the Praetorians at a quiet word from above.';
const DECLARED_NOTES = 'The cohorts assemble on quiet instructions from the palace.';
const DECLARED_CRISIS = 'A quiet hand redirects the legions toward the capital.';

/** The Task 2 placeholder a fully-redacted reason/notes commits as. */
const REDACTION_PLACEHOLDER = 'Something shifts, unremarked.';

/** Adjudication whose ONLY player linkage is the schema declaration - every
 * identity slot (entityAction id, delta key root, origin) is npc_guard's, so
 * the structural gates stay silent and the turn must COMMIT (redacted). */
const declaredPlayerAdjudicationJson = JSON.stringify({
  turn: 2,
  entityActions: [
    { id: 'npc_guard', intent: 'fortify', target: null, notes: DECLARED_NOTES, actors: ['player_1'] },
  ],
  deltas: [
    { type: 'resource', key: 'npc_guard:denarii', delta: 25, reason: DECLARED_REASON, actors: ['player_1'] },
  ],
  headlines: [
    { text: DECLARED_HEADLINE, actors: ['player_1'] },
    { text: WORLD_HEADLINE, actors: [] },
  ],
  gm_private: [],
});

const cleanSimStateJson = JSON.stringify({
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Content', major_ongoing_crisis: null, actors: [],
});
const declaredCrisisSimStateJson = JSON.stringify({
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal',
  plebeian_mood: 'Content', major_ongoing_crisis: DECLARED_CRISIS, actors: ['player_1'],
});

// Structured payloads (the Task 1 schemas, landed-unwired). SUGGESTION lines
// live INSIDE the payload's text, so the existing split machinery survives.
const NARRATION_PROSE = 'Rain sweeps the forum. The Senate murmurs beneath the colonnades.';
const NARRATION_SUGGESTIONS = '\nSUGGESTION: Wait\nSUGGESTION: Pray\nSUGGESTION: Write letters';
const narrationPayloadJson = JSON.stringify({ text: NARRATION_PROSE + NARRATION_SUGGESTIONS, actors: [] });
const narrationDeclaredPlayerPayloadJson = JSON.stringify({
  text: NARRATION_PROSE + NARRATION_SUGGESTIONS,
  actors: ['player_1', 'npc_guard'],
});

const MONOLOGUE_TEXT = 'Thrax seeded the whispers himself. The city believes him.';
const monologuePayloadJson = JSON.stringify({ text: MONOLOGUE_TEXT, actors: ['maximinus_thrax'] });
const DECLARED_MONOLOGUE_TEXT = 'My agents fanned out across the city during the night.';
const monologueDeclaredPlayerPayloadJson = JSON.stringify({
  text: DECLARED_MONOLOGUE_TEXT, actors: ['player_1'],
});

/** Splits the narration payload JSON at adversarial boundaries: mid-key,
 * mid-sentence, on the lone backslash of the escaped \nSUGGESTION marker,
 * and mid-marker - so extraction, escape-withholding, and the marker buffer
 * are all exercised in one stream. */
function adversarialNarrationChunks(raw: string): string[] {
  const midKey = 6; // '{"text' - the key's closing quote not yet arrived
  const midSentence = raw.indexOf('The Senate');
  const loneBackslash = raw.indexOf('\\nSUGGESTION') + 1; // ends ON the backslash
  const midMarker = loneBackslash + 8;
  const cuts = [midKey, midSentence, loneBackslash, midMarker];
  const chunks: string[] = [];
  let prev = 0;
  for (const cut of cuts) {
    chunks.push(raw.slice(prev, cut));
    prev = cut;
  }
  chunks.push(raw.slice(prev));
  if (chunks.join('') !== raw) throw new Error('adversarialNarrationChunks must reconstruct the payload');
  return chunks;
}

// --- scripted client (turnPipeline.test.ts harness style, pre-resolved) -----

type CallKind =
  | 'storyRelevance' | 'assessment' | 'npcMind' | 'adjudication'
  | 'mortalityValidation' | 'mortalityOutcome'
  | 'simulationState' | 'monologue' | 'narration';

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
  throw new Error(`turnActorsGate test fake: unrecognized call. systemInstruction: ${s.slice(0, 200)}`);
}

interface ScriptedClient {
  ai: GoogleGenAI;
  countsByKind: Partial<Record<CallKind, number>>;
  generateContent: ReturnType<typeof vi.fn>;
  generateContentStream: ReturnType<typeof vi.fn>;
}

function createScriptedClient(
  responses: Partial<Record<CallKind, string>>,
  options: { streamNarration?: boolean; narrationChunker?: (fullText: string) => string[] } = {},
): ScriptedClient {
  const countsByKind: Partial<Record<CallKind, number>> = {};
  const scripted = (kind: CallKind): string => {
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;
    const text = responses[kind];
    if (text === undefined) throw new Error(`turnActorsGate test fake: no scripted response for '${kind}'`);
    return text;
  };
  const generateContent = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => ({
    text: scripted(classify(params.config?.systemInstruction)),
  }));
  const generateContentStream = vi.fn(async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
    const fullText = scripted(classify(params.config?.systemInstruction));
    const chunks = options.narrationChunker ? options.narrationChunker(fullText) : [fullText];
    async function* gen() {
      for (const chunk of chunks) yield { text: chunk };
    }
    return gen();
  });
  const ai = {
    models: options.streamNarration ? { generateContent, generateContentStream } : { generateContent },
  } as unknown as GoogleGenAI;
  return { ai, countsByKind, generateContent, generateContentStream };
}

function runTurn(
  client: ScriptedClient,
  submission: TurnSubmission,
  player: Entity,
  entities: Entity[],
  options?: Parameters<typeof runNewTurn>[15],
) {
  return runNewTurn(
    client.ai, submission, player, 2, entities, worldState, simulationState,
    [], [], [], [], '', false, 'Grim political thriller', options,
  );
}

/**
 * The COMMITTED projection of a turn result: everything except the GM-only
 * raw-call capture, which by design records the provider's INTERCHANGE
 * responses verbatim (prompts + raw JSON, ai/core/geminiService.ts) and is
 * therefore allowed to contain the literal '"actors"'. Every OTHER byte of
 * the result is committed/player-adjacent state and must never carry it.
 */
function committedProjection(result: Awaited<ReturnType<typeof runNewTurn>>): unknown {
  const { rawCalls: _gmOnly, ...historySansRawCalls } = result.newHistoryEntry;
  return { ...result, newHistoryEntry: historySansRawCalls };
}

afterEach(() => {
  endTurnCapture(); // drain any capture left open by a failing pipeline test
});

// --- 1. Missing seam exports (guarded - the intended red signal) ------------

type AnyFn = (...args: never[]) => unknown;

function requireExport(module: object, name: string, seam: string): AnyFn {
  const fn = (module as Record<string, unknown>)[name];
  expect(fn, `${seam} must export ${name} (Task 4, task-4-design.md)`).toBeDefined();
  return fn as AnyFn;
}

describe('Task 4 seams [EXPORTS DO NOT EXIST YET]: generateStructuredStream + extractPayloadTextPrefix', () => {
  it('ai/core/geminiService.ts exports generateStructuredStream', () => {
    requireExport(geminiService, 'generateStructuredStream', 'ai/core/geminiService.ts');
  });

  it('generateStructuredStream streams CUMULATIVE raw JSON to onChunk and returns the zod-parsed payload from ONE stream call', async () => {
    const generateStructuredStream = requireExport(
      geminiService, 'generateStructuredStream', 'ai/core/geminiService.ts',
    ) as <T>(
      ai: unknown,
      req: { callName: string; model: string; prompt: string; zodSchema?: unknown },
      onChunk: (rawJsonSoFar: string) => void,
    ) => Promise<T>;

    const chunks = adversarialNarrationChunks(narrationPayloadJson);
    const generateContentStream = vi.fn(async () => (async function* () {
      for (const chunk of chunks) yield { text: chunk };
    })());
    const ai = { models: { generateContent: vi.fn(), generateContentStream } };

    const seen: string[] = [];
    const payload = await generateStructuredStream<{ text: string; actors: string[] }>(
      ai,
      { callName: 'narration', model: GEMINI_PRO, prompt: 'narrate', zodSchema: zNarrationPayload },
      raw => seen.push(raw),
    );

    expect(payload.text).toBe(NARRATION_PROSE + NARRATION_SUGGESTIONS);
    expect(payload.actors).toEqual([]);
    // Cumulative contract, mirroring generateTextStream: the last onChunk
    // call carries the full raw response.
    expect(seen.at(-1)).toBe(narrationPayloadJson);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('ai/core/streamSplit.ts exports extractPayloadTextPrefix', () => {
    requireExport(streamSplit, 'extractPayloadTextPrefix', 'ai/core/streamSplit.ts');
  });

  it('extractPayloadTextPrefix grows monotonically across adversarial chunk boundaries (prototyped: task-4-design.md section 1)', () => {
    const extract = requireExport(
      streamSplit, 'extractPayloadTextPrefix', 'ai/core/streamSplit.ts',
    ) as (cumulativeRawJson: string) => string;

    const chunks = ['{"te', 'xt": "The Sen', 'ate convenes. Rain', ' sweeps the forum.", "actors": []}'];
    let cumulative = '';
    const seen: string[] = [];
    for (const chunk of chunks) {
      cumulative += chunk;
      seen.push(extract(cumulative));
    }
    expect(seen[0]).toBe('');
    expect(seen[1]).toBe('The Sen');
    expect(seen[3]).toBe('The Senate convenes. Rain sweeps the forum.');
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].startsWith(seen[i - 1]), 'extraction must never regress').toBe(true);
    }
  });

  it('extractPayloadTextPrefix is key-order independent, withholds split escapes, and decodes the \\nSUGGESTION marker', () => {
    const extract = requireExport(
      streamSplit, 'extractPayloadTextPrefix', 'ai/core/streamSplit.ts',
    ) as (cumulativeRawJson: string) => string;

    // actors may arrive BEFORE text - property order is the provider's call.
    expect(extract('{"actors": ["npc_a"], "text": "Quiet week."}')).toBe('Quiet week.');
    // An incomplete \uXXXX escape is withheld until it completes.
    const full = '{"text": "A d\\u00e9tente holds.", "actors": []}';
    expect(extract(full.slice(0, full.indexOf('u00e9') + 3))).toBe('A d');
    expect(extract(full)).toBe('A détente holds.');
    // \n escapes decode to a REAL newline so createNarrationStreamGate's
    // '\nSUGGESTION:' marker check keeps working over extracted prose.
    expect(extract('{"text": "Prose.\\nSUGGESTION: Wait", "actors": []}')).toBe('Prose.\nSUGGESTION: Wait');
    // Only the TOP-LEVEL "text" key is the payload - values and nested keys
    // spelling "text" are decoys.
    expect(extract('{"title": "text", "text": "Real prose."}')).toBe('Real prose.');
    expect(extract('{"meta": {"text": "decoy"}, "text": "Real prose."}')).toBe('Real prose.');
  });
});

// --- 2. Real pipeline: no-attempt declared-player redaction (gate before strip) --

describe('runNewTurn (real pipeline): no-attempt declared-player redaction reaches the committed result', () => {
  it('adjudication headline/delta-reason/entityAction-notes declaring the player are redacted BEFORE the commit-boundary strip', async () => {
    const player = makeEntity();
    const guard = makeEntity({ entity_id: 'npc_guard', name: 'Praetorian Cohort' });
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      adjudication: declaredPlayerAdjudicationJson,
      simulationState: cleanSimStateJson,
    });

    const result = await runTurn(client, questionOnly('What is whispered in the camps?'), player, [player, guard]);

    // The declared-player headline is DROPPED whole (declaration-granular);
    // the world headline survives untouched.
    expect(result.headlines).not.toContain(DECLARED_HEADLINE);
    expect(result.headlines).toContain(WORLD_HEADLINE);
    expect(result.newHistoryEntry.adjudication.headlines).not.toContain(DECLARED_HEADLINE);

    // The delta and entityAction are KEPT (their mechanics were never the
    // violation) with the Task 2 placeholder standing in for the prose.
    const gatedDelta = result.newHistoryEntry.adjudication.deltas.find(d => d.key === 'npc_guard:denarii');
    expect(gatedDelta, 'the npc_guard delta itself must survive').toBeDefined();
    expect(gatedDelta?.reason).toBe(REDACTION_PLACEHOLDER);
    const gatedAction = result.newHistoryEntry.adjudication.entityActions.find(a => a.id === 'npc_guard');
    expect(gatedAction, 'the npc_guard entityAction itself must survive').toBeDefined();
    expect(gatedAction?.notes).toBe(REDACTION_PLACEHOLDER);

    // Every redaction is auditable on the GM-only channel, [Boundary]-tagged
    // with the original text (playerProseRedactionNotes format).
    const boundaryNotes = result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Boundary]'));
    for (const original of [DECLARED_HEADLINE, DECLARED_REASON, DECLARED_NOTES]) {
      expect(
        boundaryNotes.some(note => note.includes(original)),
        `a [Boundary] note must record the redacted original: "${original}"`,
      ).toBe(true);
    }

    // Strip completeness at the commit boundary: no interchange 'actors' key
    // anywhere in the committed result (rawCalls excluded - GM-only raw
    // capture carries the interchange verbatim by design).
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });

  it('simulation-state crisis prose declaring the player is redacted through the value shell, then stripped', async () => {
    const player = makeEntity();
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      adjudication: JSON.stringify({
        turn: 2, entityActions: [], deltas: [],
        headlines: [{ text: WORLD_HEADLINE, actors: [] }], gm_private: [],
      }),
      simulationState: declaredCrisisSimStateJson,
    });

    const result = await runTurn(client, questionOnly('What do the couriers say?'), player, [player]);

    // Declared-player -> the WHOLE field redacts. '' is the pinned committed
    // value (the same value the legacy traversal produced - see
    // tests/mockParity.test.ts's crisis case and task-4-design.md section 3).
    expect(result.updatedSimulationState.major_ongoing_crisis).toBe('');
    expect(
      result.newHistoryEntry.adjudication.gm_private.some(
        n => n.startsWith('[Boundary]') && n.includes(DECLARED_CRISIS),
      ),
      'the crisis redaction must be recorded as a [Boundary] gm_private note',
    ).toBe(true);
    // The committed SimulationState never carries the interchange key.
    expect('actors' in (result.updatedSimulationState as unknown as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });
});

// --- 3. Real pipeline: structured monologue + narration payloads ------------

describe('runNewTurn (real pipeline): monologue switches to structured output ({text, actors})', () => {
  it('commits the PARSED payload text (not the raw JSON), with declared actors threaded to the (inert, observable-attempt) gate', async () => {
    const player = makeEntity();
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      assessment: nonConsequentialAssessmentJson,
      adjudication: JSON.stringify({
        turn: 2, entityActions: [], deltas: [],
        headlines: [{ text: WORLD_HEADLINE, actors: [] }], gm_private: [],
      }),
      simulationState: cleanSimStateJson,
      monologue: monologuePayloadJson,
      narration: narrationPayloadJson,
    });

    const result = await runTurn(client, freeform('Address the Senate'), player, [player]);

    expect(result.playerMonologue).toBe(MONOLOGUE_TEXT);
    expect(result.playerMonologue).not.toContain('"actors"');
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });

  it('DEFENSE-IN-DEPTH seam: getPlayerMonologue returns the parsed payload, whose declared actors drive the no-attempt gate', async () => {
    // The validated pipeline short-circuits monologue on every no-attempt
    // submission (see the file header), so the no-attempt declared gate is
    // pinned at the exact composition turn.ts uses: the REAL tool entry
    // point (ai/tools/intelligence.ts) + the REAL Task 2 value shell.
    const player = makeEntity();
    const ai = {
      models: {
        generateContent: vi.fn(async () => ({ text: monologueDeclaredPlayerPayloadJson })),
      },
    } as unknown as GoogleGenAI;

    const payload = await intelligence.getPlayerMonologue(
      ai, player, [WORLD_HEADLINE], [], false, false,
    ) as unknown as { text: string; actors: string[] };

    // RED today: getPlayerMonologue returns the raw string, not a payload.
    expect(typeof payload, 'getPlayerMonologue must return the parsed { text, actors } payload').toBe('object');
    expect(payload.text).toBe(DECLARED_MONOLOGUE_TEXT);
    expect(payload.actors).toEqual(['player_1']);

    // The composition turn.ts runs on a no-attempt turn: declared-player ->
    // the whole field redacts (pure data - the tripwire cannot see this
    // register, which is exactly the B7 gap the declaration closes).
    const gated = redactInventedPlayerProseFromValue(
      payload.text, player, false, 'monologue', payload.actors,
    );
    expect(gated.value).toBe('');
    expect(gated.redactions.map(r => r.original)).toContain(DECLARED_MONOLOGUE_TEXT);
  });
});

describe('runNewTurn (real pipeline): narration switches to structured-output streaming (task-4-design.md decision)', () => {
  it('non-streaming path: ONE structured call; prose committed, SUGGESTION lines split, actors stripped from every committed byte', async () => {
    const player = makeEntity();
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      assessment: nonConsequentialAssessmentJson,
      adjudication: JSON.stringify({
        turn: 2, entityActions: [], deltas: [],
        headlines: [{ text: WORLD_HEADLINE, actors: [] }], gm_private: [],
      }),
      simulationState: cleanSimStateJson,
      monologue: monologuePayloadJson,
      narration: narrationPayloadJson,
    });

    const result = await runTurn(client, freeform('Address the Senate'), player, [player]);

    expect(result.narration).toBe(NARRATION_PROSE);
    expect(result.suggestedActions).toEqual(['Wait', 'Pray', 'Write letters']);
    expect(client.countsByKind.narration ?? 0).toBe(1);
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });

  it('streaming path: the bubble receives incremental PROSE (never JSON syntax or SUGGESTION tails) from ONE provider call, and the final gate sees the declared actors', async () => {
    const player = makeEntity();
    const guard = makeEntity({ entity_id: 'npc_guard', name: 'Praetorian Cohort' });
    const onNarrationChunk = vi.fn();
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      assessment: nonConsequentialAssessmentJson,
      adjudication: JSON.stringify({
        turn: 2, entityActions: [], deltas: [],
        headlines: [{ text: WORLD_HEADLINE, actors: [] }], gm_private: [],
      }),
      simulationState: cleanSimStateJson,
      monologue: monologuePayloadJson,
      // Declared actors on the payload: on this observable-attempt turn the
      // gate is INERT, so the prose must commit verbatim - proving the
      // declaration rides the SAME single call as the streamed prose
      // (constraints (b) and (c)).
      narration: narrationDeclaredPlayerPayloadJson,
    }, { streamNarration: true, narrationChunker: adversarialNarrationChunks });

    const result = await runTurn(client, freeform('Address the Senate'), player, [player, guard], { onNarrationChunk });

    // (a) Streaming UX preserved: incremental prose releases, then the final
    // full prose - at least two distinct releases, each a prefix of the prose.
    expect(onNarrationChunk.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of onNarrationChunk.mock.calls) {
      const text = call[0] as string;
      expect(NARRATION_PROSE.startsWith(text), `bubble text must be a prose prefix, got: ${JSON.stringify(text)}`).toBe(true);
      expect(text).not.toContain('{');
      expect(text).not.toContain('"text"');
      expect(text).not.toContain('SUGGESTION');
    }
    expect(onNarrationChunk.mock.calls.at(-1)?.[0]).toBe(NARRATION_PROSE);

    // (b) Exactly one narration provider call, on the streaming transport.
    expect(client.generateContentStream).toHaveBeenCalledTimes(1);
    expect(client.countsByKind.narration ?? 0).toBe(1);

    // (c)/(d) The committed narration is the gated payload text; the
    // interchange declaration never reaches a committed byte.
    expect(result.narration).toBe(NARRATION_PROSE);
    expect(result.suggestedActions).toEqual(['Wait', 'Pray', 'Write letters']);
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });
});

// --- 4. Real pipeline: observable-attempt inertness --------------------------

describe('runNewTurn (real pipeline): observable-attempt turns leave declared-player content untouched (gates inert, strip still complete)', () => {
  it('declared-player headline/reason/notes/crisis/monologue/narration ALL commit verbatim on an attempt turn', async () => {
    const player = makeEntity();
    const guard = makeEntity({ entity_id: 'npc_guard', name: 'Praetorian Cohort' });
    const client = createScriptedClient({
      storyRelevance: storyRelevanceJson,
      assessment: nonConsequentialAssessmentJson,
      adjudication: declaredPlayerAdjudicationJson,
      simulationState: declaredCrisisSimStateJson,
      monologue: monologueDeclaredPlayerPayloadJson,
      narration: narrationDeclaredPlayerPayloadJson,
    });

    const result = await runTurn(client, freeform('Address the Senate'), player, [player, guard]);

    expect(result.headlines).toContain(DECLARED_HEADLINE);
    expect(result.newHistoryEntry.adjudication.deltas.find(d => d.key === 'npc_guard:denarii')?.reason)
      .toBe(DECLARED_REASON);
    expect(result.newHistoryEntry.adjudication.entityActions.find(a => a.id === 'npc_guard')?.notes)
      .toBe(DECLARED_NOTES);
    expect(result.updatedSimulationState.major_ongoing_crisis).toBe(DECLARED_CRISIS);
    expect(result.playerMonologue).toBe(DECLARED_MONOLOGUE_TEXT);
    expect(result.narration).toBe(NARRATION_PROSE);
    expect(result.newHistoryEntry.adjudication.gm_private.filter(n => n.startsWith('[Boundary]'))).toEqual([]);

    // Inert gates never weaken the strip: committed bytes carry no actors.
    expect(JSON.stringify(committedProjection(result))).not.toContain('"actors"');
  });
});

// --- 5. Mock parity (ai/mocks.ts) --------------------------------------------

describe('mockRunNewTurn: the mirror gates become declaration-aware (same semantics as the real pipeline)', () => {
  /**
   * A severus_alexander player whose ALIASES cannot match 'Emperor': the
   * shipped preset's position IS 'Emperor', so today the canned headline
   * "Emperor promises bonus to Praetorian Guard." is only ever dropped by an
   * alias coincidence in the tripwire, not by attribution. With the position
   * changed, ONLY a hand-attributed declaration (actors:
   * ['severus_alexander'] on that headline - see task-4-design.md's
   * hand-attribution table; fixture defaults are NOT semantically reliable)
   * can drop it. This is the mock-mode B7 gap.
   */
  function severusWithoutTheTitle(): { player: Entity; entities: Entity[] } {
    const entities = structuredClone(ALL_INITIAL_ENTITIES).map(e =>
      e.entity_id === 'severus_alexander' ? { ...e, position: 'Restorer of the Res Publica' } : e,
    );
    const player = entities.find(e => e.entity_id === 'severus_alexander');
    if (!player) throw new Error('fixture missing severus_alexander');
    return { player, entities };
  }

  const runMock = (submission: TurnSubmission, player: Entity, entities: Entity[]) =>
    mockRunNewTurn(
      submission, player, 1, entities, getMockInitialState().worldState, [], '',
      'A crisis.', structuredClone(INITIAL_SIMULATION_STATE), [], [],
    );

  it('a no-attempt mock turn drops the headline DECLARED as the player\'s act, on declaration alone (tripwire-invisible register)', async () => {
    const { player, entities } = severusWithoutTheTitle();

    const result = await runMock(questionOnly('What is whispered in the Curia?'), player, entities);

    expect(result.headlines).not.toContain('Emperor promises bonus to Praetorian Guard.');
    expect(
      result.newHistoryEntry.adjudication.gm_private.some(
        n => n.startsWith('[Boundary]') && n.includes('Emperor promises bonus'),
      ),
      'the mock must record the declared-player redaction as a [Boundary] note',
    ).toBe(true);
  });

  it('[PIN - green today] an observable-attempt mock turn keeps that same headline (gate inert)', async () => {
    const { player, entities } = severusWithoutTheTitle();

    const result = await runMock(freeform('Hold court'), player, entities);

    expect(result.headlines).toContain('Emperor promises bonus to Praetorian Guard.');
    expect(result.narration).not.toBe('');
  });

  it('[PIN - green today] mock committed results never carry the interchange actors key, on either submission kind', async () => {
    const { player, entities } = severusWithoutTheTitle();

    const noAttempt = await runMock(questionOnly('What is whispered in the Curia?'), player, entities);
    const attempt = await runMock(freeform('Hold court'), player, entities);

    for (const result of [noAttempt, attempt]) {
      expect(JSON.stringify(committedProjection(result as Awaited<ReturnType<typeof runNewTurn>>)))
        .not.toContain('"actors"');
    }
  });
});
