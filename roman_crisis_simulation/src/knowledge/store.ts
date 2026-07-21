/**
 * knowledge/store.ts - the player knowledge store: information as a living
 * entity (roadmaps/ROADMAP_PHASE_4.md 4B item 2; DESIGN_DECISIONS.md D21).
 *
 * Each unit here is a CLAIM entity: something the player has come to
 * believe, stamped with when it was first learned and accreting time-dated
 * updates as the same information is re-reported or re-acquired (D21 - the
 * player sees a claim's evolution, not just its first arrival; D14 - each
 * update stays frozen at its stamp while the claim keeps living).
 *
 * HARD INVARIANT (D5/D21): this store records what the PLAYER perceives -
 * it must NEVER contain ground truth the player couldn't know. It is built
 * EXCLUSIVELY from perception-filtered channels:
 *   (a) the perceived digest (perception/visibility.ts::buildPerceivedDigest
 *       output - already D5-filtered, provenance-tagged);
 *   (b) Reports (types.ts::Report - the player-visible rumor/report channel,
 *       which carries source + credibility and no truth data);
 *   (c) investigation reveals (the report text the player paid for).
 * Nothing here may ever read the truth ledger, `is_true`/`origin_id` rumor
 * fields, or `secret_truth` - those are GM-private (D11), and the ingestion
 * functions below copy artifact fields ONE BY ONE (never object-spread) so
 * even a polluted input object cannot smuggle extra keys into the store.
 * Later player-facing intelligence surfaces (rumor feed, dossiers, map,
 * Chronicle) read ONLY this store, never live entity ground truth
 * (ROADMAP_PHASE_4.md invariant 9).
 *
 * Intentionally pure (no React, no AI imports), same discipline as
 * perception/visibility.ts: every function takes the current store and
 * returns the next one without mutating either.
 *
 * MATCHING RULE (deliberately simple and deterministic - no AI calls, no
 * fuzzy text matching): every ingested artifact computes a `claimKey`, and
 * a new artifact CONTINUES an existing claim (appends an update) iff its
 * claimKey exactly equals that claim's; otherwise it OPENS a new claim.
 * Keys are channel-prefixed so the three channels can never cross-match:
 *   - digest:  `digest:{deltaType}:{deltaKey}`  (same kind of change about
 *     the same delta key - e.g. the same relationship attribute, the same
 *     entity's fate, the same resource - reads as continuing content)
 *   - reports: `report:{about}:{source}`        (the same source family
 *     re-reporting about the same subject is the rumor mill re-reporting)
 *   - investigation: `investigation:{targetId}:{kind}` (re-buying the same
 *     aspect of the same target refreshes the same dossier claim, D14)
 * This is a v1 constraint, not a limitation to engineer around here: a
 * differently-worded rumor about the same subject from a different source
 * intentionally opens a separate claim.
 */

import type { PerceivedChange, PerceptionSource } from '../perception/visibility';
import type { Report, ReportSource } from '../types';

/**
 * Where a knowledge update came from. Reuses the two provenance
 * vocabularies the player-visible artifacts already carry (D5's perception
 * sources; the Report source enum) rather than inventing a parallel one.
 * Investigation reveals ingest as 'spy' - the player's own paid agent, the
 * closest existing word - with the channel itself preserved losslessly in
 * the claim's `claimKey` prefix.
 */
export type KnowledgeSource = PerceptionSource | ReportSource;

/** One time-dated arrival of information on a claim (D21). Frozen at its stamp once recorded (D14). */
export interface KnowledgeUpdate {
  turn: number;
  source: KnowledgeSource;
  text: string;
  /** Only present when the channel carries one (Reports do; digest entries are binary-fidelity per D5 v1). 0.0-1.0. */
  credibility?: number;
}

/**
 * A claim entity - one piece of living information the player holds.
 * `claim` and `firstLearnedTurn` are frozen at first arrival; `updates`
 * accretes every arrival INCLUDING the first (so `updates[0]` is the
 * original learning and the array is the claim's full visible timeline).
 */
export interface KnowledgeClaim {
  id: string;
  /** The entity id, region id, or 'world' the claim is about. */
  subject: string;
  /** The claim's text as first learned - frozen; restatements land in `updates`. */
  claim: string;
  /** The deterministic matching key (see the MATCHING RULE above). */
  claimKey: string;
  firstLearnedTurn: number;
  updates: KnowledgeUpdate[];
}

/**
 * Upper bound on stored claims - the store persists in the save, so like
 * every accreting slice (truth ledger, memories, snapshots) it must stay
 * bounded. Generous: the claim entity is the substrate for all later
 * intelligence surfaces, so eviction should be rare in practice. When the
 * cap is exceeded, the OLDEST-UPDATED claims are dropped first (ties break
 * toward the earlier-created claim).
 */
export const MAX_KNOWLEDGE_CLAIMS = 300;

/**
 * Upper bound on updates per claim, same save-bounding rationale. A very
 * long-lived claim keeps its NEWEST updates; its `claim` text and
 * `firstLearnedTurn` still preserve the origin even after the earliest
 * update objects roll off.
 */
export const MAX_UPDATES_PER_CLAIM = 30;

/** The turn a claim last gained an update - the eviction ordering key. */
function lastUpdatedTurn(claim: KnowledgeClaim): number {
  return claim.updates.length > 0
    ? claim.updates[claim.updates.length - 1].turn
    : claim.firstLearnedTurn;
}

/** Drops the oldest-updated claims past MAX_KNOWLEDGE_CLAIMS, preserving the survivors' order. Returns the input reference when nothing needs evicting. */
function evictOverCap(store: KnowledgeClaim[]): KnowledgeClaim[] {
  if (store.length <= MAX_KNOWLEDGE_CLAIMS) return store;
  const excess = store.length - MAX_KNOWLEDGE_CLAIMS;
  const evictIndices = new Set(
    store
      .map((claim, index) => [lastUpdatedTurn(claim), index] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, excess)
      .map(([, index]) => index)
  );
  return store.filter((_, index) => !evictIndices.has(index));
}

/** The one artifact shape upsertClaim ingests - already reduced to exactly the fields the store may hold. */
interface IngestArtifact {
  claimKey: string;
  subject: string;
  text: string;
  turn: number;
  source: KnowledgeSource;
  credibility?: number;
}

/**
 * The single write path: appends an update to the claim whose claimKey
 * matches, or opens a new claim (see the MATCHING RULE in the module doc).
 * Builds the stored objects field by field from the artifact - the
 * leak-guard discipline every public ingestion function relies on.
 */
function upsertClaim(store: KnowledgeClaim[], artifact: IngestArtifact): KnowledgeClaim[] {
  const update: KnowledgeUpdate = {
    turn: artifact.turn,
    source: artifact.source,
    text: artifact.text,
  };
  if (typeof artifact.credibility === 'number') {
    update.credibility = artifact.credibility;
  }

  const existingIndex = store.findIndex(claim => claim.claimKey === artifact.claimKey);
  if (existingIndex >= 0) {
    const existing = store[existingIndex];
    const next = [...store];
    next[existingIndex] = {
      ...existing,
      // The newest MAX_UPDATES_PER_CLAIM survive; `claim`/`firstLearnedTurn`
      // stay frozen at first arrival regardless (D21/D14).
      updates: [...existing.updates, update].slice(-MAX_UPDATES_PER_CLAIM),
    };
    return next;
  }

  const newClaim: KnowledgeClaim = {
    // claimKey is unique within the store at any moment (the findIndex
    // above), and a re-created key after eviction lands on a later turn -
    // so turn+claimKey is a sufficient, deterministic id.
    id: `claim_${artifact.turn}_${artifact.claimKey}`,
    subject: artifact.subject,
    claim: artifact.text,
    claimKey: artifact.claimKey,
    firstLearnedTurn: artifact.turn,
    updates: [update],
  };
  return evictOverCap([...store, newClaim]);
}

/**
 * Ingests a committed turn's perceived digest (buildPerceivedDigest output -
 * already D5-filtered; this function must never be handed raw deltas) as of
 * `turn`, the turn that produced it.
 *
 * Rumor-type digest entries are SKIPPED here deliberately: every rumor
 * delta also becomes a Report (ai/core/engine.ts), and Reports are the
 * canonical rumor channel for this store (they carry source + credibility;
 * the digest line is presentation). Ingesting both would double every
 * rumor.
 *
 * Returns the input store reference when nothing was ingested.
 */
export function ingestPerceivedChanges(
  store: KnowledgeClaim[],
  changes: PerceivedChange[],
  turn: number
): KnowledgeClaim[] {
  let next = store;
  for (const change of changes) {
    if (change.deltaType === 'rumor') continue;
    next = upsertClaim(next, {
      claimKey: `digest:${change.deltaType}:${change.deltaKey}`,
      subject: change.subject,
      text: change.text,
      turn,
      source: change.source,
    });
  }
  return next;
}

/**
 * Ingests a turn's NEW Reports (the player-visible rumor/report channel).
 * Each report's own `turn` stamp is used - a Report is dated at emission.
 *
 * Leak guard (D5/D11): only the five whitelisted fields below are read off
 * each Report. A Report never legitimately carries truth-ledger data
 * (`is_true`/`origin_id` live on rumor DELTAS and the GM ledger, not on
 * Reports), but even a polluted object cannot leak extra keys through this
 * field-by-field copy.
 *
 * Returns the input store reference when handed no reports.
 */
export function ingestReports(store: KnowledgeClaim[], newReports: Report[]): KnowledgeClaim[] {
  let next = store;
  for (const report of newReports) {
    next = upsertClaim(next, {
      claimKey: `report:${report.about}:${report.source}`,
      subject: report.about,
      text: report.claim,
      turn: report.turn,
      source: report.source,
      credibility: report.credibility,
    });
  }
  return next;
}

/** The investigation aspects the UI can buy - mirrors DramatisPersonaeTab's reveal kinds. */
export type InvestigationKind = 'beliefs' | 'scheme' | 'secrets';

/**
 * Ingests a paid investigation reveal - the report text the player just
 * bought, about `targetId`, on `turn`. This is what finally makes bought
 * intel persistent instead of evaporating with the component that showed
 * it (D14's direction; the dossier VIEW over these claims is a later
 * stage). Re-investigating the same target's same aspect appends a freshly
 * stamped update to the same claim - the earlier reveal stays frozen at
 * its own stamp (D14).
 */
export function ingestInvestigationReveal(
  store: KnowledgeClaim[],
  reveal: { targetId: string; kind: InvestigationKind; text: string; turn: number }
): KnowledgeClaim[] {
  return upsertClaim(store, {
    claimKey: `investigation:${reveal.targetId}:${reveal.kind}`,
    subject: reveal.targetId,
    text: reveal.text,
    turn: reveal.turn,
    source: 'spy',
  });
}
