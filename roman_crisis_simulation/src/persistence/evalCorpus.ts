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
  NpcIntent,
  NpcMindDecision,
  RawCallRecord,
  TruthLedgerEntry,
  TurnHistoryEntry,
} from '../types';
import type { KnowledgeClaim } from '../knowledge/store';

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
  /**
   * The Director's per-spotlight intents committed this turn, verbatim from
   * the history entry (absent -> null, fixed shape). GM-side data the judge
   * needs: axis 4 (information-asymmetry) checks whether an intent references
   * knowledge its character could not have - that text is fed to the
   * character's mind as its own thought - and axis 5 (character richness)
   * checks whether the turn's NPC moves follow from those stated intents.
   */
  npcIntents: NpcIntent[] | null;
  /**
   * This turn's per-spotlight mind decisions, verbatim from the history entry
   * (absent -> null, fixed shape) - `private_reasoning` included. The corpus
   * and the judge are both GM-console-only artifacts (D18/D4/D5), so the
   * full mind decision (the character's own first-person thinking, method,
   * and scheme adjustment) may live here: it is exactly the input axes 4 and
   * 5 score against and it never touches a player-facing surface.
   */
  npcMindResults: NpcMindDecision[] | null;
}

/**
 * Campaign-wide GM-side slices the exporter can attach so the offline judge
 * can score true-vs-believed and the assumed-disposition rate across the
 * whole campaign, not just per-turn calls. Both are GM-only artifacts
 * already (the D11 ledger renders nowhere but the GM console; the D21
 * knowledge store is the believed side of the same instrument), and the
 * corpus itself is a GM-console-only export (D18) - so including them adds
 * no player-facing leak surface. Both stay OPTIONAL: corpora exported
 * before these slices existed simply lack the fields, and every consumer
 * must tolerate their absence.
 */
export interface EvalCorpusCampaignSlices {
  truthLedger?: TruthLedgerEntry[];
  knowledge?: KnowledgeClaim[];
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
  /** GM-private truth ledger (D11), when the exporter provided it - see EvalCorpusCampaignSlices. */
  truthLedger?: TruthLedgerEntry[];
  /** Player knowledge store (D21), when the exporter provided it - see EvalCorpusCampaignSlices. */
  knowledge?: KnowledgeClaim[];
}

export function buildEvalCorpus(
  turnHistory: TurnHistoryEntry[],
  sessionCallLog: RawCallRecord[],
  meta: EvalCorpusMeta,
  slices?: EvalCorpusCampaignSlices,
): EvalCorpus {
  const corpus: EvalCorpus = {
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
      npcIntents: entry.npcIntents ?? null,
      npcMindResults: entry.npcMindResults ?? null,
    })),
    sessionCallLog: [...sessionCallLog],
  };
  // Only attach a slice when it was actually provided: an absent slice must
  // stay absent (not become an empty array), so a consumer can distinguish
  // "exporter predates the slice" from "campaign genuinely has none yet".
  if (slices?.truthLedger) {
    corpus.truthLedger = [...slices.truthLedger];
  }
  if (slices?.knowledge) {
    corpus.knowledge = [...slices.knowledge];
  }
  return corpus;
}

/** Download filename for a corpus exported with the given current turn number. */
export function evalCorpusFilename(turnNumber: number): string {
  return `gor-eval-corpus-turn${turnNumber}.json`;
}
