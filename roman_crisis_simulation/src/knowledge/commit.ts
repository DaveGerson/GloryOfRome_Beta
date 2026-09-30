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
 * D29 keying/edges live entirely in knowledge/store.ts: a Report already
 * carries its `topic`/`stance`, so the store computes the subject+topic key
 * and the structural graph edges off the Reports these helpers forward -
 * this glue needs no change for the graph, only the report-id filtering and
 * turn-stamp rules below.
 *
 * TURN-STAMP PROVENANCE: every update committed through these helpers is
 * stamped with the App's AUTHORITATIVE turn counter (`turnNumber`), never a
 * model-authored turn field. A Report's own `turn` falls back to the
 * model-echoed `adjudication.turn` when applyAdjudication is given no
 * authoritative counter (ai/core/engine.ts), so trusting it could let a
 * model that mislabels its turn skew claim timelines; the
 * Report keeps its own `turn` field internally, only the knowledge stamp
 * uses the authoritative counter.
 */

import type { PerceivedChange } from '../perception/visibility';
import type { Report, TurnHistoryEntry } from '../types';
import { composureSignsOf } from '../ai/core/composure';
import {
  ingestDeepAnalysis,
  ingestInvestigationReveal,
  ingestPerceivedChanges,
  ingestReports,
  ingestSignsSeen,
  type SignSeen,
  InvestigationKind,
  KnowledgeClaim,
  PlayerSafeEvidence,
  RelationshipObservationDraft,
} from './store';
import { ingestRelationshipObservations } from './relationships';

export interface RelationshipObservationsInput {
  evidence: PlayerSafeEvidence[];
  drafts: RelationshipObservationDraft[];
  entities: Array<{ entity_id: string; name: string }>;
  knownEntityIds: string[];
}

export interface TurnKnowledgeInput {
  /** The knowledge store as of the previous commit. */
  prev: KnowledgeClaim[];
  /** This turn's player-only D5 digest (buildPlayerPerceivedDigest output) - never raw deltas. */
  perceivedChanges: PerceivedChange[];
  /** The report log BEFORE this turn ran. */
  reportsBefore: Report[];
  /** The report log the turn returned (prior reports + this turn's new ones). */
  reportsAfter: Report[];
  /** The App's authoritative turn counter for the turn being committed. */
  turnNumber: number;
  relationshipObservations?: RelationshipObservationsInput;
  /** D50: the tells the week's narration let the player catch (`narrationSignsSeen`) - figure and sentence only. */
  signsSeen?: readonly SignSeen[];
}

/**
 * The signs a committed turn's narration let the player catch (D50), as the
 * knowledge store takes them: each one's figure and sentence, read off the
 * entry's GM-private record - never the mark or tie it betrayed.
 */
export function narrationSignsSeen(entry: Pick<TurnHistoryEntry, 'composureSigns'>): SignSeen[] {
  return composureSignsOf(entry).map(({ entityId, sign }) => ({ entityId, sign }));
}

/**
 * Computes the next knowledge store for a committing turn: the perceived
 * digest plus this turn's NEW Reports - and the signs its narration let the
 * player catch (D50) - all stamped with the authoritative `turnNumber`.
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
  turnNumber, relationshipObservations, signsSeen,
}: TurnKnowledgeInput): KnowledgeClaim[] {
  const priorReportIds = new Set(reportsBefore.map(r => r.id));
  const reportsThisTurn = reportsAfter.filter(r => !priorReportIds.has(r.id));
  const reported = ingestReports(
    ingestPerceivedChanges(prev, perceivedChanges, turnNumber),
    reportsThisTurn,
    turnNumber
  );
  const next = signsSeen && signsSeen.length > 0 ? ingestSignsSeen(reported, signsSeen, turnNumber) : reported;
  return relationshipObservations ? ingestRelationshipObservations(next, {
    ...relationshipObservations,
    turn: turnNumber,
    globalEvidenceIds: reportsAfter.map(report => report.id),
  }) : next;
}

export interface InvestigationKnowledgeInput {
  /** The knowledge store as of the previous commit. */
  prev: KnowledgeClaim[];
  targetId: string;
  kind: InvestigationKind;
  /** ONLY the player-facing report text - never the resolution trace or anything GM-private. */
  reportText: string;
  /** The itemised findings the player was shown with the report (beliefs/secrets) - player-facing too. */
  items?: readonly string[];
  /** Scheme buys at the D28 reveal: the agents' reading of the design the clues add up to, or null when none came back (player-facing text; its truth stays in the GM ledger). See ingestInvestigationReveal. */
  natureReading?: string | null;
  /** The App's authoritative turn counter at the moment of the reveal. */
  turnNumber: number;
  relationshipObservations?: RelationshipObservationsInput;
}

/**
 * Computes the next knowledge store for a committing investigation reveal
 * (D14/D21): the bought report text (and its itemised findings) lands as a
 * 'spy'-sourced update, stamped with the authoritative `turnNumber`.
 */
export function computeInvestigationKnowledge({
  prev,
  targetId,
  kind,
  reportText,
  items,
  natureReading,
  turnNumber, relationshipObservations,
}: InvestigationKnowledgeInput): KnowledgeClaim[] {
  const next = ingestInvestigationReveal(prev, {
    targetId,
    kind,
    text: reportText,
    turn: turnNumber,
    items,
    ...(natureReading !== undefined ? { natureReading } : {}),
  });
  return relationshipObservations ? ingestRelationshipObservations(next, {
    ...relationshipObservations,
    turn: turnNumber,
    globalEvidenceIds: [],
  }) : next;
}

/**
 * Computes the next knowledge store for a commissioned Spymaster's
 * Assessment (D14): the analysis text lands as a paid dossier aspect,
 * stamped with the authoritative `turnNumber`, committed in the same pass
 * as its deep_analyses spend.
 */
export function computeDeepAnalysisKnowledge({ prev, targetId, analysis, turnNumber }: {
  prev: KnowledgeClaim[];
  targetId: string;
  analysis: string;
  turnNumber: number;
}): KnowledgeClaim[] {
  return ingestDeepAnalysis(prev, { targetId, text: analysis, turn: turnNumber });
}
