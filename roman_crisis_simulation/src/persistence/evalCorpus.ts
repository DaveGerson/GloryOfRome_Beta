/**
 * Builds the eval/tuning corpus the GM console exports as a JSON download
 * (DESIGN_DECISIONS.md D18). The corpus carries everything the offline
 * eval harness needs to replay and score a session: per-turn prompts and
 * responses (including full prompt text and system instructions), hidden
 * roll seeds and traces, plus the session-wide out-of-band call log from
 * ai/core/geminiService.ts.
 *
 * Constraints:
 *  - GM-console-only surface. The corpus contains prompts, rolls, and
 *    traces that must never reach a player-facing component (D4/D5) - the
 *    export action lives exclusively in components/GameMasterScreen.tsx
 *    (D7).
 *  - Session-side only. The corpus is built from in-memory state at export
 *    time and downloaded as a file; nothing here is ever written into the
 *    persisted save blob (saves stay lean per D18).
 *  - Pure and synchronous: inputs in, serializable object out. No DOM, no
 *    clock, no storage - the Blob/download plumbing stays in the GM screen.
 *  - Legacy tolerance: history entries persisted before `rawCalls`,
 *    `turnSeed`, or the trace fields existed simply lack them; absent
 *    optionals are normalized to `null` (or `[]` for `rawCalls`) so the
 *    exported JSON always has a fixed per-turn shape.
 *  - Per-turn entries deliberately omit `postTurnEntities`: full entity
 *    snapshots would dwarf the prompt/response data the corpus exists to
 *    carry, and the harness replays state from the calls themselves.
 */

import type {
  ActionResolutionEvent,
  Adjudication,
  MortalityEvent,
  RawCallRecord,
  TurnHistoryEntry,
} from '../types';

/** Light provenance for the corpus - enough to tie a file back to the session that produced it. */
export interface EvalCorpusMeta {
  saveVersion: number;
  turnNumber: number;
  playerCharacterId: string | null;
}

/** One turn's slice of the corpus. Fixed shape: absent optionals come through as null (rawCalls: []). */
export interface EvalCorpusTurn {
  turnNumber: number;
  playerIntent: string;
  narration: string | null;
  adjudication: Adjudication;
  /**
   * The calls captured during this turn's bracket, prompt text and system
   * instruction included when recorded. Attribution is by bracket timing
   * (ai/core/geminiService.ts::beginTurnCapture/endTurnCapture), so an
   * out-of-band call that happens to resolve mid-turn can appear here too.
   */
  rawCalls: RawCallRecord[];
  turnSeed: number | null;
  resolutionTrace: ActionResolutionEvent | null;
  mortalityTrace: MortalityEvent[] | null;
}

export interface EvalCorpus {
  meta: EvalCorpusMeta;
  turns: EvalCorpusTurn[];
  /**
   * The bounded session-wide log (ai/core/geminiService.ts::getSessionCallLog)
   * - includes the out-of-band calls no turn bracket captures (ad-hoc
   * investigations, clarifications, deep analysis, ambition inference, the
   * epilogue).
   */
  sessionCallLog: RawCallRecord[];
}

export function buildEvalCorpus(
  turnHistory: TurnHistoryEntry[],
  sessionCallLog: RawCallRecord[],
  meta: EvalCorpusMeta,
): EvalCorpus {
  return {
    meta: { ...meta },
    turns: turnHistory.map((entry): EvalCorpusTurn => ({
      turnNumber: entry.turnNumber,
      playerIntent: entry.playerIntent,
      narration: entry.narration ?? null,
      adjudication: entry.adjudication,
      rawCalls: entry.rawCalls ?? [],
      turnSeed: entry.turnSeed ?? null,
      resolutionTrace: entry.resolutionTrace ?? null,
      mortalityTrace: entry.mortalityTrace ?? null,
    })),
    sessionCallLog: [...sessionCallLog],
  };
}

/** Download filename for a corpus exported with the given current turn number. */
export function evalCorpusFilename(turnNumber: number): string {
  return `gor-eval-corpus-turn${turnNumber}.json`;
}
