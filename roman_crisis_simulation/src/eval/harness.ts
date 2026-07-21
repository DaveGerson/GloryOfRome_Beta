/**
 * eval/harness.ts
 *
 * Deterministic, offline checks over an exported eval corpus
 * (persistence/evalCorpus.ts::buildEvalCorpus, DESIGN_DECISIONS.md D18).
 *
 * Constraints:
 *  - Pure module: no file I/O, no env vars, no clock, no network. The
 *    runner (eval/runEval.eval.ts) owns loading the corpus file and
 *    printing the report; every function here is data-in/data-out so the
 *    normal test suite can exercise it against in-memory fixtures.
 *  - No model calls. The LLM judge lives separately (eval/judge.ts) and is
 *    invoked by the runner only when an API key is present.
 *  - Never imported from app code. Eval tooling consumes the app's shared
 *    seams (zod schemas, parseModelJson, the seeded RNG) - never the other
 *    way around - so the app bundle never carries this module.
 *  - Report, don't gate: checks surface findings (schema violations, roll
 *    mismatches, capture gaps) as data for a human to read. Nothing here
 *    throws on a "bad" turn - only on a structurally-not-a-corpus input
 *    (`assertEvalCorpusShape`).
 */

import type { ZodType } from 'zod';
import type { EvalCorpus, EvalCorpusMeta, EvalCorpusTurn } from '../persistence/evalCorpus';
import type { RawCallRecord } from '../types';
import { parseModelJson } from '../ai/core/json';
import { createSeededRng, rollD20 } from '../ai/core/resolution';
import {
  zActionAssessment,
  zAdjudication,
  zConversationSimulation,
  zEntity,
  zEntityBatch,
  zInvestigationResult,
  zMortalityOutcome,
  zMortalityValidation,
  zRelationshipDeltas,
  zScenarioStructure,
  zSimulationState,
  zStoryRelevance,
} from '../ai/core/zodSchemas';
import { zAmbitionInference } from '../ai/tools/ambition';

// --- Schema validity ------------------------------------------------------

/**
 * Explicit callName -> zod schema map for every STRUCTURED call family in
 * ai/prompts/README.md's inventory. Kept as a literal map (not derived)
 * so a renamed call or schema fails loudly here instead of silently
 * downgrading its checks to 'skipped_unknown'. `entityBatch` is absent on
 * purpose - its runtime callName is suffixed per batch (e.g.
 * `entityBatch:NPCs_1`), handled by `schemaForCallName` below.
 */
export const STRUCTURED_CALL_SCHEMAS: Record<string, ZodType<any, any, any>> = {
  assessment: zActionAssessment,
  adjudication: zAdjudication,
  storyRelevance: zStoryRelevance,
  updatedSimulationState: zSimulationState,
  relationshipUpdates: zRelationshipDeltas,
  privateConversation: zConversationSimulation,
  mortalityValidation: zMortalityValidation,
  mortalityOutcome: zMortalityOutcome,
  investigation: zInvestigationResult,
  scenarioStructure: zScenarioStructure,
  characterCreation: zEntity,
  ambitionInference: zAmbitionInference,
};

/** Prose call families (per ai/prompts/README.md) - no JSON to validate, skipped by the schema check. */
export const PROSE_CALL_NAMES: ReadonlySet<string> = new Set([
  'narration',
  'playerMonologue',
  'clarification',
  'rawThoughts',
  'deepAnalysis',
  'epilogue',
]);

/** Resolves a captured callName to its zod schema, or null when no mapping exists. */
export function schemaForCallName(callName: string): ZodType<any, any, any> | null {
  if (callName === 'entityBatch' || callName.startsWith('entityBatch:')) return zEntityBatch;
  return STRUCTURED_CALL_SCHEMAS[callName] ?? null;
}

export type SchemaCheckStatus =
  | 'valid'
  | 'schema_violation'
  | 'unparseable_json'
  | 'skipped_prose'
  | 'skipped_unknown';

export interface RawCallSchemaCheck {
  callName: string;
  status: SchemaCheckStatus;
  /** Violated issue paths on 'schema_violation'; the parse error on 'unparseable_json'; null otherwise. */
  detail: string | null;
}

/**
 * Re-parses one captured call's rawResponse (through the same
 * parseModelJson cleaning the live service uses) and re-validates it
 * against the call family's zod schema. A capture that was truncated at
 * record time (geminiService.ts caps rawResponse at ~20k chars) surfaces
 * as 'unparseable_json' - the corpus no longer carries enough text to
 * re-validate it.
 */
export function checkRawCallSchema(record: RawCallRecord): RawCallSchemaCheck {
  if (PROSE_CALL_NAMES.has(record.callName)) {
    return { callName: record.callName, status: 'skipped_prose', detail: null };
  }
  const schema = schemaForCallName(record.callName);
  if (!schema) {
    return { callName: record.callName, status: 'skipped_unknown', detail: null };
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(record.rawResponse);
  } catch (e) {
    return {
      callName: record.callName,
      status: 'unparseable_json',
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { callName: record.callName, status: 'valid', detail: null };
  }
  const paths = result.error.issues.map(issue => issue.path.join('.') || '(root)');
  return { callName: record.callName, status: 'schema_violation', detail: paths.join(', ') };
}

// --- Consequence-density proxies ------------------------------------------

/** Cheap code-side proxies for how consequence-dense a turn's output was. */
export interface TurnDensity {
  deltaCount: number;
  headlineCount: number;
}

export function measureTurnDensity(turn: EvalCorpusTurn): TurnDensity {
  return {
    deltaCount: turn.adjudication.deltas.length,
    headlineCount: turn.adjudication.headlines.length,
  };
}

// --- Capture completeness -------------------------------------------------

export interface TurnCompleteness {
  rawCallCount: number;
  /** Calls whose full prompt text was captured (records from older saves lack it). */
  callsWithPromptText: number;
  callsWithSystemInstruction: number;
  turnSeedPresent: boolean;
}

export function measureTurnCompleteness(turn: EvalCorpusTurn): TurnCompleteness {
  return {
    rawCallCount: turn.rawCalls.length,
    callsWithPromptText: turn.rawCalls.filter(c => c.promptText !== undefined && c.promptText !== null).length,
    callsWithSystemInstruction: turn.rawCalls.filter(c => c.systemInstruction !== undefined && c.systemInstruction !== null).length,
    turnSeedPresent: turn.turnSeed !== null && turn.turnSeed !== undefined,
  };
}

// --- Roll reproducibility -------------------------------------------------

export interface RollCheck {
  source: 'action' | 'mortality';
  /** The mortality claim's entity, null for the action roll. */
  entityId: string | null;
  recorded: number;
  /** Null when the turn has no seed to replay from. */
  rederived: number | null;
  match: boolean;
}

export type RollReplayStatus = 'match' | 'mismatch' | 'no_rolls' | 'no_seed';

export interface TurnRollReplay {
  status: RollReplayStatus;
  rolls: RollCheck[];
}

/**
 * Re-derives the turn's recorded rolls from its recorded seed and checks
 * them draw-for-draw. Draw order mirrors ai/core/turn.ts exactly: the
 * player action's resolution roll first (present only when the turn's
 * action was assessed consequential, i.e. `resolutionTrace` exists), then
 * each mortality roll in claim order (ai/core/mortality.ts draws only for
 * VALIDATED claims - an invalidated claim never reaches the dice and must
 * not consume a draw here either). If that order ever changes in turn.ts,
 * this replay must change with it.
 */
export function replayTurnRolls(turn: EvalCorpusTurn): TurnRollReplay {
  const recorded: { source: 'action' | 'mortality'; entityId: string | null; roll: number }[] = [];
  if (turn.resolutionTrace) {
    recorded.push({ source: 'action', entityId: null, roll: turn.resolutionTrace.roll });
  }
  for (const event of turn.mortalityTrace ?? []) {
    if (event.valid && typeof event.roll === 'number') {
      recorded.push({ source: 'mortality', entityId: event.entity_id, roll: event.roll });
    }
  }

  if (recorded.length === 0) {
    return { status: 'no_rolls', rolls: [] };
  }
  if (turn.turnSeed === null || turn.turnSeed === undefined) {
    return {
      status: 'no_seed',
      rolls: recorded.map(r => ({ source: r.source, entityId: r.entityId, recorded: r.roll, rederived: null, match: false })),
    };
  }

  const rng = createSeededRng(turn.turnSeed);
  const rolls: RollCheck[] = recorded.map(r => {
    const rederived = rollD20(rng);
    return { source: r.source, entityId: r.entityId, recorded: r.roll, rederived, match: rederived === r.roll };
  });
  return { status: rolls.every(r => r.match) ? 'match' : 'mismatch', rolls };
}

// --- Whole-corpus evaluation ----------------------------------------------

export interface TurnEvalReport {
  turnNumber: number;
  schemaChecks: RawCallSchemaCheck[];
  density: TurnDensity;
  completeness: TurnCompleteness;
  rollReplay: TurnRollReplay;
}

export interface CorpusEvalSummary {
  turnCount: number;
  /** Aggregated over TURN-BRACKETED calls only (see `sessionCallChecks` for the session-wide log). */
  schemaCheckCounts: Record<SchemaCheckStatus, number>;
  totalDeltas: number;
  totalHeadlines: number;
  turnsWithSeed: number;
  /** Turns where every captured call carries its full prompt text. */
  turnsWithFullPromptCapture: number;
  rollReplayCounts: Record<RollReplayStatus, number>;
}

export interface CorpusEvalReport {
  meta: EvalCorpusMeta;
  turns: TurnEvalReport[];
  /**
   * Schema checks over the session-wide call log - the only channel that
   * carries out-of-band calls (ad-hoc investigations, clarifications, deep
   * analysis, ambition inference, the epilogue). Turn-bracketed calls are
   * recorded into BOTH channels by geminiService.ts, so these counts
   * overlap the per-turn checks; they are reported separately, never
   * summed together.
   */
  sessionCallChecks: RawCallSchemaCheck[];
  summary: CorpusEvalSummary;
}

export function evaluateTurn(turn: EvalCorpusTurn): TurnEvalReport {
  return {
    turnNumber: turn.turnNumber,
    schemaChecks: turn.rawCalls.map(checkRawCallSchema),
    density: measureTurnDensity(turn),
    completeness: measureTurnCompleteness(turn),
    rollReplay: replayTurnRolls(turn),
  };
}

export function evaluateCorpus(corpus: EvalCorpus): CorpusEvalReport {
  const turns = corpus.turns.map(evaluateTurn);

  const schemaCheckCounts: Record<SchemaCheckStatus, number> = {
    valid: 0,
    schema_violation: 0,
    unparseable_json: 0,
    skipped_prose: 0,
    skipped_unknown: 0,
  };
  const rollReplayCounts: Record<RollReplayStatus, number> = {
    match: 0,
    mismatch: 0,
    no_rolls: 0,
    no_seed: 0,
  };
  let totalDeltas = 0;
  let totalHeadlines = 0;
  let turnsWithSeed = 0;
  let turnsWithFullPromptCapture = 0;

  for (const turn of turns) {
    for (const check of turn.schemaChecks) schemaCheckCounts[check.status]++;
    rollReplayCounts[turn.rollReplay.status]++;
    totalDeltas += turn.density.deltaCount;
    totalHeadlines += turn.density.headlineCount;
    if (turn.completeness.turnSeedPresent) turnsWithSeed++;
    if (turn.completeness.rawCallCount > 0 && turn.completeness.callsWithPromptText === turn.completeness.rawCallCount) {
      turnsWithFullPromptCapture++;
    }
  }

  return {
    meta: { ...corpus.meta },
    turns,
    sessionCallChecks: corpus.sessionCallLog.map(checkRawCallSchema),
    summary: {
      turnCount: turns.length,
      schemaCheckCounts,
      totalDeltas,
      totalHeadlines,
      turnsWithSeed,
      turnsWithFullPromptCapture,
      rollReplayCounts,
    },
  };
}

// --- Corpus-shape guard ---------------------------------------------------

/**
 * Light structural guard for a freshly-loaded corpus JSON. Deliberately
 * shallow: per-turn fields are already normalized to a fixed shape by
 * buildEvalCorpus at export time, and every check above tolerates legacy
 * nulls - this only rejects files that are not a corpus export at all.
 */
export function assertEvalCorpusShape(value: unknown): asserts value is EvalCorpus {
  const candidate = value as Partial<EvalCorpus> | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !candidate.meta ||
    typeof candidate.meta !== 'object' ||
    !Array.isArray(candidate.turns) ||
    !Array.isArray(candidate.sessionCallLog)
  ) {
    throw new Error(
      'Not an eval corpus export: expected { meta, turns[], sessionCallLog[] } as produced by the GM console (persistence/evalCorpus.ts).'
    );
  }
}

// --- Human-readable report ------------------------------------------------

function summarizeChecks(checks: RawCallSchemaCheck[]): string {
  const checked = checks.filter(c => c.status !== 'skipped_prose' && c.status !== 'skipped_unknown');
  const valid = checked.filter(c => c.status === 'valid').length;
  const problems = checked
    .filter(c => c.status !== 'valid')
    .map(c => `${c.callName}: ${c.status}${c.detail ? ` [${c.detail}]` : ''}`);
  const base = `${valid}/${checked.length} structured calls valid (${checks.length - checked.length} skipped)`;
  return problems.length > 0 ? `${base}; ${problems.join('; ')}` : base;
}

function describeRollReplay(replay: TurnRollReplay): string {
  switch (replay.status) {
    case 'no_rolls':
      return 'rolls: none recorded';
    case 'no_seed':
      return `rolls: ${replay.rolls.length} recorded but no seed to replay from`;
    case 'match':
      return `rolls: ${replay.rolls.length}/${replay.rolls.length} replay to a match`;
    case 'mismatch': {
      const bad = replay.rolls
        .filter(r => !r.match)
        .map(r => `${r.source}${r.entityId ? `(${r.entityId})` : ''} recorded ${r.recorded} != rederived ${r.rederived}`);
      return `rolls: MISMATCH - ${bad.join('; ')}`;
    }
  }
}

/** Formats a full corpus report for terminal output. */
export function formatCorpusReport(report: CorpusEvalReport): string {
  const lines: string[] = [];
  lines.push('=== Eval corpus report ===');
  lines.push(
    `Session: save v${report.meta.saveVersion}, exported at turn ${report.meta.turnNumber}, player ${report.meta.playerCharacterId ?? '(none)'}`
  );
  lines.push(`Turns in corpus: ${report.turns.length}`);
  lines.push('');

  for (const turn of report.turns) {
    lines.push(`Turn ${turn.turnNumber}:`);
    lines.push(`  schema: ${summarizeChecks(turn.schemaChecks)}`);
    lines.push(`  density: ${turn.density.deltaCount} delta(s), ${turn.density.headlineCount} headline(s)`);
    lines.push(
      `  capture: ${turn.completeness.callsWithPromptText}/${turn.completeness.rawCallCount} calls with prompt text, seed ${turn.completeness.turnSeedPresent ? 'present' : 'MISSING'}`
    );
    lines.push(`  ${describeRollReplay(turn.rollReplay)}`);
  }

  lines.push('');
  lines.push(`Session call log (${report.sessionCallChecks.length} calls, overlaps turn-bracketed calls): ${summarizeChecks(report.sessionCallChecks)}`);

  const s = report.summary;
  lines.push('');
  lines.push('Summary:');
  lines.push(
    `  turn-bracketed schema checks: ${s.schemaCheckCounts.valid} valid, ${s.schemaCheckCounts.schema_violation} violation(s), ${s.schemaCheckCounts.unparseable_json} unparseable, ${s.schemaCheckCounts.skipped_prose} prose, ${s.schemaCheckCounts.skipped_unknown} unknown`
  );
  lines.push(`  density: ${s.totalDeltas} delta(s), ${s.totalHeadlines} headline(s) across ${s.turnCount} turn(s)`);
  lines.push(`  capture: ${s.turnsWithSeed}/${s.turnCount} turns with seed, ${s.turnsWithFullPromptCapture}/${s.turnCount} with full prompt text`);
  lines.push(
    `  roll replay: ${s.rollReplayCounts.match} match, ${s.rollReplayCounts.mismatch} MISMATCH, ${s.rollReplayCounts.no_rolls} without rolls, ${s.rollReplayCounts.no_seed} without seed`
  );

  return lines.join('\n');
}
