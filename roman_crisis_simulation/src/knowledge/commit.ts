/**
 * knowledge/commit.ts - the pure commit-time glue over knowledge/store.ts's
 * ingestion functions: exactly the knowledge computation App.tsx performs
 * when a turn commits (executeTurn) and when a bought investigation reveal
 * commits (handleInvestigationOutcome). Extracted here so the report-id
 * filtering and turn-stamping rules are tested directly rather than
 * re-derived in tests, and so App.tsx stays a thin composition root.
 *
 * Same discipline as knowledge/store.ts: pure (no React, no AI imports),
 * inputs in, next store out, nothing mutated.
 *
 * TURN-STAMP PROVENANCE: every update committed through these helpers is
 * stamped with the App's AUTHORITATIVE turn counter (`turnNumber`), never a
 * model-authored turn field. A Report's own `turn` descends from the
 * model-echoed `adjudication.turn` (ai/core/engine.ts), so trusting it
 * would let a model that mislabels its turn skew claim timelines; the
 * Report keeps its own `turn` field internally, only the knowledge stamp
 * uses the authoritative counter.
 */

import type { PerceivedChange } from '../perception/visibility';
import type { Report } from '../types';
import {
  ingestInvestigationReveal,
  ingestPerceivedChanges,
  ingestReports,
  InvestigationKind,
  KnowledgeClaim,
} from './store';

export interface TurnKnowledgeInput {
  /** The knowledge store as of the previous commit. */
  prev: KnowledgeClaim[];
  /** This turn's D5-filtered digest (buildPerceivedDigest output) - never raw deltas. */
  perceivedChanges: PerceivedChange[];
  /** The report log BEFORE this turn ran. */
  reportsBefore: Report[];
  /** The report log the turn returned (prior reports + this turn's new ones). */
  reportsAfter: Report[];
  /** The App's authoritative turn counter for the turn being committed. */
  turnNumber: number;
}

/**
 * Computes the next knowledge store for a committing turn: the perceived
 * digest plus this turn's NEW Reports, both stamped with the authoritative
 * `turnNumber`.
 *
 * New reports are identified by id (not array position), so a future
 * bounding of the reports slice can never silently re-ingest old ones.
 *
 * Returns the `prev` reference when nothing ingests.
 */
export function computeTurnKnowledge({
  prev,
  perceivedChanges,
  reportsBefore,
  reportsAfter,
  turnNumber,
}: TurnKnowledgeInput): KnowledgeClaim[] {
  const priorReportIds = new Set(reportsBefore.map(r => r.id));
  const reportsThisTurn = reportsAfter.filter(r => !priorReportIds.has(r.id));
  return ingestReports(
    ingestPerceivedChanges(prev, perceivedChanges, turnNumber),
    reportsThisTurn,
    turnNumber
  );
}

export interface InvestigationKnowledgeInput {
  /** The knowledge store as of the previous commit. */
  prev: KnowledgeClaim[];
  targetId: string;
  kind: InvestigationKind;
  /** ONLY the player-facing report text - never the resolution trace or anything GM-private. */
  reportText: string;
  /** The App's authoritative turn counter at the moment of the reveal. */
  turnNumber: number;
}

/**
 * Computes the next knowledge store for a committing investigation reveal
 * (D14/D21): the bought report text lands as a 'spy'-sourced update,
 * stamped with the authoritative `turnNumber`.
 */
export function computeInvestigationKnowledge({
  prev,
  targetId,
  kind,
  reportText,
  turnNumber,
}: InvestigationKnowledgeInput): KnowledgeClaim[] {
  return ingestInvestigationReveal(prev, {
    targetId,
    kind,
    text: reportText,
    turn: turnNumber,
  });
}
