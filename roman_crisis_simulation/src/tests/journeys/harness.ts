/**
 * tests/journeys/harness.ts
 *
 * The journey smoke-test harness: drives the REAL turn pipeline
 * (ai/core/turn.ts::runNewTurn, NOT the mock-mode path) through whole,
 * scripted, multi-turn playthroughs with a scripted fake Gemini client and
 * scripted dice, committing state between turns exactly the way
 * App.tsx::executeTurn does (entities/world/sim/reports + the D11 truth
 * ledger, the 4C.3 Director intents, and the D21 player knowledge store),
 * and enforcing a catalog of cross-cutting invariants on EVERY turn - things
 * unit tests can't see because they only hold (or break) across a whole
 * playthrough:
 *
 *   INV-SHAPE      the pipeline's stage order (TurnStage doc contract),
 *                  incl. the conditional npc_minds / private_conversation /
 *                  mortality stages firing exactly when their triggers exist
 *   INV-SCHEMA     every call the pipeline made was captured (rawCalls count)
 *                  and every scripted response survived real zod validation
 *                  with zero repair retries
 *   INV-LEAK      the HEADLINE end-to-end asymmetry guard: no GM-private datum
 *                  (gm_private notes, rolls/seed, fate bands/tiers,
 *                  secret_truth/actually_alive/motive, rumor is_true/origin_id,
 *                  mind private_reasoning, a NON-player scheme's name/steps,
 *                  the mortality validator's reasoning) reaches ANY
 *                  player-facing surface: the narration/monologue PROMPTS and
 *                  system instructions (the true enforcement seam), the
 *                  narration/monologue/suggestions text, headlines, the
 *                  perceived digest, new report claims, or the player
 *                  knowledge store's committed contents
 *   INV-DIGEST     every perceived change is source-attributed (D5)
 *   INV-ROLL       the dice the journey scripted are EXACTLY the dice the
 *                  pipeline made and recorded (resolutionTrace + validated
 *                  mortality rolls, in draw order) - the seeded-RNG successor
 *                  to the old Math.random roll-queue
 *   INV-SCRIPT     every scripted response was requested (no leftovers) - the
 *                  journey's model of the pipeline matches the pipeline
 *   INV-NO-SILENT  no console.error fired during the turn (applyDeltas
 *                  swallows per-delta errors that way - a journey must never
 *                  silently corrupt state)
 *
 * See testing/SMOKE_HARNESS_DESIGN.md for the full design.
 */

import { vi, expect } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { runNewTurn, TurnStage } from '../../ai/core/turn';
import { endTurnCapture } from '../../ai/core/geminiService';
import { getInvestigationResult } from '../../ai/tools/intelligence';
import { createSeededRng, rollD20 } from '../../ai/core/resolution';
import { buildPerceivedDigest, PerceivedChange } from '../../perception/visibility';
import { computeTurnKnowledge, computeInvestigationKnowledge } from '../../knowledge/commit';
import type { KnowledgeClaim, InvestigationKind } from '../../knowledge/store';
import { saveGame, loadGame, clearSave, SaveGameState } from '../../persistence/saveGame';
import type {
  Entity,
  Message,
  NpcIntent,
  Relationship,
  Report,
  SimulationState,
  TruthLedgerEntry,
  TurnHistoryEntry,
  WorldState,
} from '../../types';
import { baseScenario, ScenarioSeed } from './fixtures';

// --- Call classification --------------------------------------------------
//
// Same seam as tests/turnPipeline.test.ts: every prompt builder in
// ai/prompts/*.ts has distinct, stable systemInstruction wording, so the
// fake client can tell which pipeline step is calling without any test hooks
// inside production code.

export type CallKind =
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
  | 'relationshipUpdates'
  | 'investigation';

const CALL_MARKERS: Array<[string, CallKind]> = [
  ['master storyteller and game master', 'storyRelevance'],
  ['Action Assessor', 'assessment'],
  ["character's own private mind", 'npcMind'],
  ['Roman Crisis Adjudicator & Simulation Engine', 'adjudication'],
  ['secret observer', 'privateConversation'],
  ['Mortality Validator', 'mortalityValidation'],
  ['Mortality Outcome Author', 'mortalityOutcome'],
  ['Roman historian analyzing the state of the Empire', 'simulationState'],
  ['the inner voice of', 'monologue'],
  ['Chronicler of the Empire & Intelligence Briefer', 'narration'],
  ['narrative analyst AI', 'relationshipUpdates'],
  ['head of intelligence for', 'investigation'],
];

export function classifyCall(systemInstruction: unknown): CallKind {
  const s = typeof systemInstruction === 'string' ? systemInstruction : '';
  for (const [marker, kind] of CALL_MARKERS) {
    if (s.includes(marker)) return kind;
  }
  throw new Error(
    `journey harness: unrecognized AI call - no marker matched. systemInstruction starts: "${s.slice(0, 200)}"`
  );
}

// --- Scripted client ------------------------------------------------------

/** A canned response: a plain object (stringified for the client) or raw text (narration/monologue). */
export type ScriptValue = string | object;

/** Per-call-kind queues of canned responses for one turn (or one side call). */
export type TurnScript = Partial<Record<CallKind, ScriptValue | ScriptValue[]>>;

export interface RecordedCall {
  kind: CallKind;
  systemInstruction: string;
  prompt: string;
}

/**
 * A fake GoogleGenAI-shaped client that resolves each classified call from a
 * per-kind queue of canned responses, recording every prompt/systemInstruction
 * it was sent so journeys can assert on what the pipeline actually asked each
 * "model". Requesting a kind with an empty queue throws - an unscripted call
 * means the journey's model of the pipeline is wrong, which is itself a
 * finding. Only `generateContent` is implemented: journeys never opt into
 * `onNarrationChunk`, so narration takes the plain (non-streaming) path.
 */
export class ScriptedClient {
  readonly calls: RecordedCall[] = [];
  readonly ai: GoogleGenAI;
  private readonly queues = new Map<CallKind, string[]>();

  constructor(script: TurnScript, private readonly label: string) {
    for (const [kind, value] of Object.entries(script) as Array<[CallKind, ScriptValue | ScriptValue[]]>) {
      const values = Array.isArray(value) ? value : [value];
      this.queues.set(
        kind,
        values.map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
      );
    }

    const generateContent = async (params: { model: string; contents: string; config?: Record<string, unknown> }) => {
      const kind = classifyCall(params.config?.systemInstruction);
      this.calls.push({
        kind,
        systemInstruction: String(params.config?.systemInstruction ?? ''),
        prompt: params.contents,
      });
      const queue = this.queues.get(kind);
      if (!queue || queue.length === 0) {
        throw new Error(
          `[${this.label}] the pipeline requested an UNSCRIPTED '${kind}' response - ` +
            `either script one for this turn or the pipeline made a call this journey did not anticipate.`
        );
      }
      return { text: queue.shift()! };
    };

    this.ai = { models: { generateContent } } as unknown as GoogleGenAI;
  }

  promptsFor(kind: CallKind): string[] {
    return this.calls.filter(c => c.kind === kind).map(c => c.prompt);
  }

  systemInstructionsFor(kind: CallKind): string[] {
    return this.calls.filter(c => c.kind === kind).map(c => c.systemInstruction);
  }

  /** Kinds still holding un-consumed canned responses (INV-SCRIPT). */
  unconsumed(): string[] {
    const leftovers: string[] = [];
    for (const [kind, queue] of this.queues) {
      if (queue.length > 0) leftovers.push(`${kind} (${queue.length} unused)`);
    }
    return leftovers;
  }
}

// --- Scripted dice (seeded-RNG era) ---------------------------------------
//
// The pipeline no longer draws each roll straight from Math.random: it draws
// ONE 32-bit seed per turn (ai/core/resolution.ts::generateSeed - the turn's
// only Math.random call in a successful run), builds a mulberry32 generator
// from it, and every hidden d20 the turn makes draws from THAT generator, in
// a fixed order - the resolution-layer action roll first (only when the
// assessment is consequential), then one mortality roll per VALIDATED death
// claim in delta order. So to script a turn's dice we search seed space for a
// seed whose generator's first draws are exactly the sequence we want, and
// pin generateSeed's entropy draw to reproduce it. INV-ROLL then asserts the
// committed traces carry exactly the scripted rolls.

const SEED_SEARCH_LIMIT = 20_000_000;

/** Finds a 32-bit seed whose seeded d20 generator's first draws equal `rolls`. */
export function findSeedForRolls(rolls: number[]): number {
  for (let seed = 0; seed < SEED_SEARCH_LIMIT; seed++) {
    const rng = createSeededRng(seed);
    let ok = true;
    for (const r of rolls) {
      if (rollD20(rng) !== r) {
        ok = false;
        break;
      }
    }
    if (ok) return seed;
  }
  throw new Error(`findSeedForRolls: no seed produced the roll sequence ${JSON.stringify(rolls)} within ${SEED_SEARCH_LIMIT} tries`);
}

/**
 * Pins Math.random so the turn's (or investigation's) single seed-entropy
 * draw yields a seed whose generator reproduces `rolls`. generateSeed is the
 * only Math.random consumer in a successful pipeline pass, so a constant
 * return is safe. Restored by the caller's finally.
 */
function installSeededRolls(rolls: number[]) {
  const seed = findSeedForRolls(rolls);
  const spy = vi.spyOn(Math, 'random').mockReturnValue(seed / 0x100000000);
  return { spy, seed };
}

// --- Game thread (the committed campaign state between turns) -------------

export interface GameThread {
  entities: Entity[];
  worldState: WorldState;
  simulationState: SimulationState;
  reports: Report[];
  truthLedger: TruthLedgerEntry[];
  knowledge: KnowledgeClaim[];
  npcIntents: NpcIntent[];
  turnHistory: TurnHistoryEntry[];
  messages: Message[];
  suggestedActions: string[];
  currentEvents: string[];
  turnNumber: number;
  playerId: string;
  metaNarrative: string;
}

function threadFromSeed(seed: ScenarioSeed): GameThread {
  return {
    entities: seed.entities,
    worldState: seed.worldState,
    simulationState: seed.simulationState,
    reports: seed.reports,
    truthLedger: seed.truthLedger,
    knowledge: seed.knowledge,
    npcIntents: seed.npcIntents,
    turnHistory: seed.turnHistory,
    messages: seed.messages,
    suggestedActions: [],
    currentEvents: [],
    turnNumber: seed.turnNumber,
    playerId: seed.playerId,
    metaNarrative: seed.metaNarrative,
  };
}

/** Rebuilds a runnable thread from a loaded SaveGameState (the reload half of the save round-trip journey). */
export function threadFromSave(state: SaveGameState): GameThread {
  if (!state.playerCharacterId) throw new Error('threadFromSave: save has no playerCharacterId');
  return {
    entities: structuredClone(state.entities),
    worldState: structuredClone(state.worldState),
    simulationState: structuredClone(state.simulationState),
    reports: structuredClone(state.reports),
    // Same fall-backs GAME_LOADED (state/gameReducer.ts) applies for the
    // optional D11/D21/4C.3 slices when reading a legacy save.
    truthLedger: structuredClone(state.truthLedger ?? []),
    knowledge: structuredClone(state.knowledge ?? []),
    npcIntents: structuredClone(state.npcIntents ?? []),
    turnHistory: structuredClone(state.turnHistory),
    messages: structuredClone(state.messages),
    suggestedActions: [...state.suggestedActions],
    currentEvents: [...state.currentEvents],
    turnNumber: state.turnNumber,
    playerId: state.playerCharacterId,
    metaNarrative: state.metaNarrative,
  };
}

/** Builds the full persistable bundle from a thread - mirrors App.tsx's buildSaveState field-for-field. */
export function buildSaveStateFromThread(thread: GameThread): SaveGameState {
  return {
    entities: thread.entities,
    worldState: thread.worldState,
    simulationState: thread.simulationState,
    reports: thread.reports,
    truthLedger: thread.truthLedger,
    knowledge: thread.knowledge,
    npcIntents: thread.npcIntents,
    turnNumber: thread.turnNumber,
    playerCharacterId: thread.playerId,
    turnHistory: thread.turnHistory,
    eventHistory: [],
    metaNarrative: thread.metaNarrative,
    messages: thread.messages,
    triggeredEventIds: [],
    eventFirings: [],
    suggestedActions: thread.suggestedActions,
    currentEvents: thread.currentEvents,
    gmInterventionText: '',
    inferredAmbition: null,
    pendingIntelligenceFallout: [],
  };
}

/**
 * A normalized, comparison-safe snapshot of a thread's mechanically
 * meaningful state. Report/ledger ids embed Date.now() (ai/core/engine.ts /
 * resources.ts) and turnHistory rawCalls embed latencies, so those are
 * normalized/omitted - everything else in here must be IDENTICAL between a
 * straight-through run and a save/reload run of the same scripted journey.
 */
export function equivalenceSnapshot(thread: GameThread) {
  return JSON.parse(
    JSON.stringify({
      // Entities/world/sim are compared whole - every derived field
      // (memories, recent_interactions, secret_truth, active_scheme) is
      // deterministic under the harness's pinned seeds.
      entities: thread.entities,
      worldState: thread.worldState,
      simulationState: thread.simulationState,
      truthLedger: thread.truthLedger.map((t, i) => ({ ...t, id: `norm_${t.turn}_${i}`, reportId: `normr_${t.turn}_${i}` })),
      knowledge: thread.knowledge.map(normalizeClaimIds),
      npcIntents: thread.npcIntents,
      turnNumber: thread.turnNumber,
      reports: thread.reports.map((r, i) => ({ ...r, id: `normalized_${r.turn}_${i}` })),
      narrations: thread.turnHistory.map(h => h.narration ?? ''),
      headlines: thread.turnHistory.map(h => h.adjudication.headlines),
      suggestedActions: thread.suggestedActions,
    })
  );
}

/** Report/turn-derived ids inside knowledge claims embed Date.now(); normalize them for equivalence. */
function normalizeClaimIds(claim: KnowledgeClaim, i: number): unknown {
  return {
    ...claim,
    id: `normk_${claim.firstLearnedTurn}_${i}`,
    // claimKey stays (deterministic); edge targets normalized alongside by index is overkill for our short journeys.
  };
}

// --- Turn definition & outcome --------------------------------------------

export interface JourneyTurnDef {
  /** The player's typed action for this turn. */
  intent: string;
  /** Canned responses by call kind. Anything omitted gets a safe default (see withDefaults). */
  script?: TurnScript;
  /** Pre-decided d20 results, in draw order (resolution roll first, then validated mortality rolls in delta order). */
  rolls?: number[];
  /** GM-intervention text for this turn (the must-honor world-fact channel). */
  gmIntervention?: string;
  /** Set true only for a turn that deliberately exercises a swallowed-error path. */
  allowConsoleErrors?: boolean;
}

export interface TurnOutcome {
  /** The turn number this turn RAN as (the thread has already advanced past it). */
  turnNumber: number;
  result: Awaited<ReturnType<typeof runNewTurn>>;
  /** The committed history entry (post-turn entities attached, mirroring App.tsx). */
  entry: TurnHistoryEntry;
  /** What the player would actually perceive of this turn's ground-truth deltas (D5). */
  digest: PerceivedChange[];
  digestTexts: string[];
  /** The player knowledge store as committed after this turn (D21). */
  knowledge: KnowledgeClaim[];
  stages: TurnStage[];
  client: ScriptedClient;
  playerAfter: Entity;
  /** D1: true when the player's own death committed this turn (App.tsx would enter GAME_OVER). */
  gameOver: boolean;
}

// --- Invariants -----------------------------------------------------------

const CANONICAL_STAGE_ORDER: TurnStage[] = [
  'story_relevance',
  'npc_minds',
  'adjudication',
  'private_conversation',
  'mortality',
  'simulation_state',
  'monologue',
  'narration',
  'relationship_updates',
];

const OPTIONAL_STAGES = new Set<TurnStage>(['npc_minds', 'private_conversation', 'mortality']);

function assertStageOrder(stages: TurnStage[], label: string): void {
  // Each stage fires at most once...
  expect(new Set(stages).size, `[${label}] a TurnStage notification fired more than once: ${stages.join(', ')}`).toBe(
    stages.length
  );
  // ...in canonical relative order...
  let cursor = 0;
  for (const stage of stages) {
    const idx = CANONICAL_STAGE_ORDER.indexOf(stage, cursor);
    expect(idx, `[${label}] stage '${stage}' fired out of order: ${stages.join(', ')}`).toBeGreaterThanOrEqual(0);
    cursor = idx + 1;
  }
  // ...and every non-optional stage fired.
  for (const stage of CANONICAL_STAGE_ORDER) {
    if (OPTIONAL_STAGES.has(stage)) continue;
    expect(stages, `[${label}] mandatory stage '${stage}' never fired`).toContain(stage);
  }
}

interface ForbiddenDatum {
  label: string;
  /** Literal substring that must not appear on a player-facing surface. */
  value?: string;
  /** Regex alternative for pattern-shaped mechanics (e.g. "roll 13"). */
  pattern?: RegExp;
}

/** Band/tier tokens are only scanned when they carry an underscore - plain
 * words like 'dies'/'survive'/'failure'/'success' are legitimate prose. */
function isScannableMechanicToken(token: string): boolean {
  return token.includes('_');
}

/**
 * INV-LEAK: collects this turn's GM-private data and asserts none of it
 * appears on any player-facing surface. The narration/monologue PROMPTS are
 * scanned too - they are the actual enforcement seam
 * (ai/prompts/narration.ts's sanitizers): anything in them reaches a
 * player-facing model call's context. The committed knowledge store is
 * scanned as a surface too (D21 - player-facing intelligence reads only it).
 */
function assertNoLeaks(outcome: {
  entry: TurnHistoryEntry;
  result: TurnOutcome['result'];
  digestTexts: string[];
  knowledge: KnowledgeClaim[];
  client: ScriptedClient;
  newReports: Report[];
  playerId: string;
  label: string;
}): void {
  const { entry, result, digestTexts, knowledge, client, newReports, playerId, label } = outcome;

  const forbidden: ForbiddenDatum[] = [
    // Static GM-console/GM-prompt markers that must never surface.
    { label: 'mortality GM marker', value: '[Mortality]' },
    { label: 'resolution GM marker', value: '[Resolution]' },
    { label: 'secret-meeting GM marker', value: '[Secret Meeting]' },
    { label: 'narrative-analyst GM marker', value: '[Narrative Analyst]' },
    { label: 'director GM marker', value: '[Director]' },
    { label: 'mind GM marker', value: '[Mind]' },
    { label: 'pacing GM marker', value: '[Pacing]' },
    { label: 'GM-secret survivors block', value: 'GM-SECRET' },
    { label: 'secret_truth field', value: 'secret_truth' },
    { label: 'secret_truth payload', value: 'actually_alive' },
    { label: 'rumor truth-disposition field', value: 'is_true' },
    { label: 'rumor origin field', value: 'origin_id' },
    { label: 'mind private-reasoning field', value: 'private_reasoning' },
    { label: 'gm_private field serialized', value: '"gm_private"' },
    // Roll mechanics as prose ("roll 13", "rolled 4").
    { label: 'roll mechanics', pattern: /\broll(?:ed)?\s+\d+\b/i },
  ];

  for (const note of entry.adjudication.gm_private) {
    forbidden.push({ label: 'gm_private note', value: note });
  }
  for (const ev of entry.mortalityTrace ?? []) {
    if (ev.band && isScannableMechanicToken(ev.band)) {
      forbidden.push({ label: `mortality band '${ev.band}'`, value: ev.band });
    }
    if (!ev.valid) {
      // An invalidated claim's outcomeSummary carries the GM-only validation
      // reasoning - it must never reach a player-facing surface.
      forbidden.push({ label: 'mortality validation reasoning', value: ev.outcomeSummary });
    }
  }
  const trace = entry.resolutionTrace;
  if (trace && isScannableMechanicToken(trace.tier)) {
    forbidden.push({ label: `resolution tier '${trace.tier}'`, value: trace.tier });
  }
  // Each mind decision's private_reasoning (GM-only; the adjudicator gets it
  // minus this field, and no player surface ever should).
  for (const decision of entry.npcMindResults ?? []) {
    if (decision.private_reasoning) {
      forbidden.push({ label: `mind private_reasoning of ${decision.entity_id}`, value: decision.private_reasoning });
    }
  }
  // Every entity's hidden secret_truth motive, and every NON-player entity's
  // scheme name/goal/steps (D28 - a rival's scheme nature is earned via clues,
  // never dumped onto a player surface). The player's OWN scheme is
  // self-knowledge and legitimately rides in the player-profile of the
  // narration prompt, so it is not forbidden.
  for (const entity of result.updatedEntities) {
    if (entity.secret_truth) {
      forbidden.push({ label: `secret motive of ${entity.entity_id}`, value: entity.secret_truth.motive });
    }
    if (entity.entity_id !== playerId && entity.active_scheme) {
      const s = entity.active_scheme;
      forbidden.push({ label: `scheme name of ${entity.entity_id}`, value: s.name });
      forbidden.push({ label: `scheme goal of ${entity.entity_id}`, value: s.overall_goal });
      for (const step of s.steps) {
        forbidden.push({ label: `scheme step of ${entity.entity_id}`, value: step.objective });
      }
    }
  }
  // NOTE: a rumor's originId is a bare entity id (often the player's own),
  // which legitimately appears all over a player-facing surface - it is not a
  // reliable leak token. The GM-only fact is the ASSOCIATION (this id
  // ORIGINATED this rumor), carried by the `origin_id`/`is_true` FIELDS - the
  // static field-name guards above are the enforcement point, and the
  // narration sanitizer strips those fields (ai/prompts/narration.ts).

  const surfaces: Array<{ surface: string; text: string }> = [
    ...client.promptsFor('narration').map((text, i) => ({ surface: `narration prompt #${i}`, text })),
    ...client.systemInstructionsFor('narration').map((text, i) => ({ surface: `narration systemInstruction #${i}`, text })),
    ...client.promptsFor('monologue').map((text, i) => ({ surface: `monologue prompt #${i}`, text })),
    ...client.systemInstructionsFor('monologue').map((text, i) => ({ surface: `monologue systemInstruction #${i}`, text })),
    { surface: 'narration text', text: result.narration },
    { surface: 'player monologue', text: result.playerMonologue },
    { surface: 'suggested actions', text: result.suggestedActions.join('\n') },
    { surface: 'headlines', text: result.headlines.join('\n') },
    { surface: 'perceived digest', text: digestTexts.join('\n') },
    { surface: 'new report claims', text: newReports.map(r => r.claim).join('\n') },
    { surface: 'knowledge store', text: JSON.stringify(knowledge) },
  ];

  const violations: string[] = [];
  for (const { surface, text } of surfaces) {
    for (const item of forbidden) {
      if (item.value !== undefined && item.value.length > 0 && text.includes(item.value)) {
        violations.push(`${item.label} leaked into ${surface}: "${item.value.slice(0, 120)}"`);
      }
      if (item.pattern && item.pattern.test(text)) {
        violations.push(`${item.label} (pattern ${item.pattern}) leaked into ${surface}`);
      }
    }
  }

  expect(violations, `[${label}] INV-LEAK violations:\n${violations.join('\n')}`).toEqual([]);
}

/** INV-ROLL: the dice the journey scripted must equal the dice the pipeline recorded, in draw order. */
function assertRolls(entry: TurnHistoryEntry, scripted: number[], label: string): void {
  const actual: number[] = [];
  if (entry.resolutionTrace) actual.push(entry.resolutionTrace.roll);
  for (const ev of entry.mortalityTrace ?? []) {
    if (ev.valid && typeof ev.roll === 'number') actual.push(ev.roll);
  }
  expect(actual, `[${label}] INV-ROLL: scripted rolls != recorded rolls`).toEqual(scripted);
}

// --- The runner -----------------------------------------------------------

export interface JourneyRunnerOptions {
  scenario?: ScenarioSeed;
  /** Continue an existing campaign thread (e.g. one rebuilt from a loaded save) instead of seeding a fresh one. */
  thread?: GameThread;
  name?: string;
}

export class JourneyRunner {
  readonly thread: GameThread;
  readonly name: string;
  readonly outcomes: TurnOutcome[] = [];

  constructor(options: JourneyRunnerOptions = {}) {
    this.thread = options.thread ?? threadFromSeed(options.scenario ?? baseScenario());
    this.name = options.name ?? 'journey';
  }

  entity(id: string): Entity {
    const found = this.thread.entities.find(e => e.entity_id === id);
    if (!found) throw new Error(`[${this.name}] no entity '${id}' in the thread`);
    return found;
  }

  entityOrNull(id: string): Entity | undefined {
    return this.thread.entities.find(e => e.entity_id === id);
  }

  player(): Entity {
    return this.entity(this.thread.playerId);
  }

  /** A's directional relationship record toward B (A's perception of B only). */
  rel(aId: string, bId: string): Relationship | undefined {
    return this.entity(aId).relationships[bId];
  }

  /** Fills in safe defaults for every unconditional pipeline call the turn's script doesn't cover. */
  private withDefaults(script: TurnScript): TurnScript {
    const defaults: TurnScript = {
      storyRelevance: { spotlight_entities: [], spotlight_intents: [] },
      assessment: {
        is_consequential: false,
        action_category: 'routine governance',
        relevant_skill: null,
        difficulty: 10,
        opposing_entity_id: null,
        rationale: 'Administrative business with no real opposition or risk of failure.',
      },
      adjudication: {
        turn: this.thread.turnNumber,
        entityActions: [],
        deltas: [],
        headlines: ['The week passes without great incident in the city of Rome.'],
        gm_private: [],
      },
      simulationState: structuredClone(this.thread.simulationState),
      monologue:
        'The city holds its breath, and so must I. Every ally I buy today is a debt some rival will try to collect tomorrow.',
      narration:
        'The week unfolds in the ordinary rhythm of the capital; nothing reaches your ears that demands the sword.' +
        '\nSUGGESTION: Court the goodwill of the Senate' +
        '\nSUGGESTION: Sound out the Praetorian prefects' +
        '\nSUGGESTION: Review the treasury accounts',
      relationshipUpdates: { deltas: [] },
    };
    return { ...defaults, ...script };
  }

  /**
   * Runs one full REAL runNewTurn against the thread, commits the result
   * exactly the way App.tsx's executeTurn does, enforces the invariant
   * catalog, and returns everything a journey needs to assert on.
   */
  async runTurn(def: JourneyTurnDef): Promise<TurnOutcome> {
    const label = `${this.name} :: turn ${this.thread.turnNumber} ("${def.intent.slice(0, 48)}")`;
    const script = this.withDefaults(def.script ?? {});
    const client = new ScriptedClient(script, label);
    const stages: TurnStage[] = [];
    const rolls = def.rolls ?? [];
    const seeded = installSeededRolls(rolls);
    const consoleErrors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(a => String(a)).join(' '));
    });
    // runNewTurn console.logs nothing today, but silence log defensively so
    // journey output stays readable.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const playerBefore = this.player();
    const reportsBefore = this.thread.reports;
    const reportCountBefore = reportsBefore.length;
    this.thread.messages.push({ sender: 'player', text: def.intent });

    let result: TurnOutcome['result'];
    try {
      result = await runNewTurn(
        client.ai,
        def.intent,
        playerBefore,
        this.thread.turnNumber,
        this.thread.entities,
        this.thread.worldState,
        this.thread.simulationState,
        this.thread.turnHistory,
        this.thread.reports,
        this.thread.truthLedger,
        this.thread.npcIntents,
        def.gmIntervention ?? '',
        false, // the REAL pipeline - never mock mode
        this.thread.metaNarrative,
        { onStage: stage => stages.push(stage) }
      );
    } finally {
      seeded.spy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
      // Drain any capture a failed turn left active (same hygiene as
      // tests/turnPipeline.test.ts's afterEach).
      endTurnCapture();
    }

    // --- COMMIT (mirrors App.tsx executeTurn's commit block) --------------
    const newWorldState: WorldState = (() => {
      let newWeek = this.thread.worldState.week + 1;
      let newYear = this.thread.worldState.year;
      if (newWeek > 52) {
        newWeek = 1;
        newYear += 1;
      }
      return { ...result.updatedWorldState, year: newYear, week: newWeek };
    })();
    const entry: TurnHistoryEntry = { ...result.newHistoryEntry, postTurnEntities: result.updatedEntities };
    const ranAsTurn = this.thread.turnNumber;

    const playerAfter = result.updatedEntities.find(e => e.entity_id === this.thread.playerId) ?? playerBefore;

    // The player's perceived digest, computed exactly as App.tsx does
    // (committed entry's deltas + post-turn entities + new world state).
    const digest = buildPerceivedDigest(entry.adjudication.deltas, playerAfter, result.updatedEntities, newWorldState);
    const digestTexts = digest.map(d => d.text);

    // D21 knowledge ingestion - the SAME digest + this turn's new Reports,
    // stamped with the authoritative turn number (knowledge/commit.ts).
    const newKnowledge = computeTurnKnowledge({
      prev: this.thread.knowledge,
      perceivedChanges: digest,
      reportsBefore,
      reportsAfter: result.updatedReports,
      turnNumber: ranAsTurn,
    });

    this.thread.entities = result.updatedEntities;
    this.thread.reports = result.updatedReports;
    this.thread.simulationState = result.updatedSimulationState;
    this.thread.worldState = newWorldState;
    this.thread.truthLedger = result.updatedTruthLedger;
    this.thread.knowledge = newKnowledge;
    this.thread.npcIntents = result.updatedNpcIntents;
    this.thread.turnHistory = [...this.thread.turnHistory, entry];
    this.thread.turnNumber = ranAsTurn + 1;
    this.thread.suggestedActions = result.suggestedActions;
    this.thread.currentEvents = result.headlines;
    this.thread.messages.push({ sender: 'gm', text: result.narration });
    this.thread.messages.push({ sender: 'player_monologue', text: result.playerMonologue });
    this.thread.messages.push({ sender: 'ribbon', text: `Week ${newWorldState.week} - the chronicler sets down the day` });

    const gameOver = playerAfter.status === 'dead';
    const newReports = this.thread.reports.slice(reportCountBefore);

    // --- INVARIANTS -------------------------------------------------------
    // INV-SHAPE
    assertStageOrder(stages, label);
    // INV-SCHEMA: every call the pipeline made was captured, and every one of
    // them parsed + validated (a scripted response that failed zod would have
    // triggered a repair-retry -> a validated:false record).
    const rawCalls = entry.rawCalls ?? [];
    expect(rawCalls.length, `[${label}] rawCalls count != calls actually made`).toBe(client.calls.length);
    expect(
      rawCalls.filter(r => !r.validated).map(r => r.callName),
      `[${label}] INV-SCHEMA: some scripted responses failed real schema validation`
    ).toEqual([]);
    // INV-SCRIPT
    expect(client.unconsumed(), `[${label}] INV-SCRIPT: scripted responses never requested by the pipeline`).toEqual([]);
    // INV-ROLL
    assertRolls(entry, rolls, label);
    // INV-DIGEST: every perceived change is source-attributed (D5).
    for (const change of digest) {
      expect(
        ['self', 'witnessed', 'network', 'public'],
        `[${label}] INV-DIGEST: unattributed perceived change "${change.text}"`
      ).toContain(change.source);
    }
    // INV-LEAK
    assertNoLeaks({ entry, result, digestTexts, knowledge: newKnowledge, client, newReports, playerId: this.thread.playerId, label });
    // INV-NO-SILENT
    if (!def.allowConsoleErrors) {
      expect(consoleErrors, `[${label}] INV-NO-SILENT: console.error fired during the turn`).toEqual([]);
    }

    const outcome: TurnOutcome = {
      turnNumber: ranAsTurn,
      result,
      entry,
      digest,
      digestTexts,
      knowledge: newKnowledge,
      stages,
      client,
      playerAfter,
      gameOver,
    };
    this.outcomes.push(outcome);
    return outcome;
  }
}

// --- Player-triggered investigation side call (outside the turn loop) -----

export interface InvestigationRunResult {
  report: string;
  consequences: string | null;
  reportData: string[];
  tier: string;
  roll: number;
  client: ScriptedClient;
  /** The player knowledge store after ingesting this reveal (mirrors App.tsx's handleInvestigationOutcome). */
  knowledge: KnowledgeClaim[];
}

/**
 * Runs the REAL getInvestigationResult (ai/tools/intelligence.ts) - the
 * player-triggered intelligence action that lives OUTSIDE runNewTurn - with a
 * scripted client and a scripted roll, then ingests the reveal into the
 * runner's knowledge store exactly as App.tsx's handleInvestigationOutcome
 * does (computeInvestigationKnowledge). The investigation always rolls once
 * from its own seed.
 */
export async function runScriptedInvestigation(
  runner: JourneyRunner,
  opts: {
    targetId: string;
    subject: 'secrets' | 'beliefs' | 'scheme';
    isRisky?: boolean;
    roll: number;
    response: ScriptValue;
  }
): Promise<InvestigationRunResult> {
  const label = `${runner.name} :: investigation of ${opts.targetId} (${opts.subject})`;
  const client = new ScriptedClient({ investigation: opts.response }, label);
  const seeded = installSeededRolls([opts.roll]);
  try {
    const result = await getInvestigationResult(
      client.ai,
      runner.entity(opts.targetId),
      runner.player(),
      opts.isRisky ?? true,
      false,
      opts.subject
    );
    expect(client.unconsumed(), `[${label}] scripted investigation response never consumed`).toEqual([]);
    expect(result.resolutionTrace?.roll, `[${label}] investigation roll != scripted roll`).toBe(opts.roll);

    // Ingest the bought report text as a knowledge reveal (the ONLY
    // player-facing text - never the resolution trace). For a 'scheme'
    // subject this takes the D28 clue path (advances the nature clue count).
    const nextKnowledge = computeInvestigationKnowledge({
      prev: runner.thread.knowledge,
      targetId: opts.targetId,
      kind: opts.subject as InvestigationKind,
      reportText: result.report,
      turnNumber: runner.thread.turnNumber,
    });
    runner.thread.knowledge = nextKnowledge;

    return {
      report: result.report,
      consequences: result.consequences,
      reportData: result.reportData,
      tier: result.resolutionTrace?.tier ?? 'unknown',
      roll: result.resolutionTrace?.roll ?? -1,
      client,
      knowledge: nextKnowledge,
    };
  } finally {
    seeded.spy.mockRestore();
  }
}

// --- Save/reload helpers --------------------------------------------------

/** Persists the thread through the REAL saveGame seam (jsdom localStorage). */
export function saveThread(thread: GameThread): void {
  saveGame(buildSaveStateFromThread(thread));
}

/** Loads the autosave envelope through the REAL loadGame seam, or throws. */
export function loadThreadState(): SaveGameState {
  const envelope = loadGame();
  if (!envelope) throw new Error('loadThreadState: loadGame returned null (no valid save)');
  return envelope.state;
}

export { clearSave };
