/**
 * knowledge/store.ts - the player knowledge GRAPH: information as a living
 * entity (roadmaps/ROADMAP_PHASE_4.md 4B item 2; DESIGN_DECISIONS.md D21,
 * D29).
 *
 * Each NODE here is a CLAIM entity: something the player has come to
 * believe, stamped with when it was first learned and accreting time-dated
 * updates as the same information is re-reported or re-acquired (D21 - the
 * player sees a claim's evolution, not just its first arrival; D14 - each
 * update stays frozen at its stamp while the claim keeps living). Claims
 * carry deterministic EDGES to other claims (D29), turning the flat list
 * into a graph the later intelligence surfaces can traverse.
 *
 * HARD INVARIANT (D5/D21): this store records what the PLAYER perceives -
 * it must NEVER contain ground truth the player couldn't know. It is built
 * EXCLUSIVELY from perception-filtered channels:
 *   (a) the perceived digest (perception/visibility.ts::buildPerceivedDigest
 *       output - already D5-filtered, provenance-tagged);
 *   (b) Reports (types.ts::Report - the player-visible rumor/report channel,
 *       which carries source + credibility + topic and no truth data);
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
 * Keys are channel-prefixed so the three channels can never cross-match, and
 * carry the artifact's TOPIC so distinct matters about one subject stay on
 * distinct claims (D29 - the fix for the flat-list over-merge):
 *   - digest:  `digest:{deltaType}:{deltaKey}`  (same kind of change about
 *     the same delta key - e.g. the same relationship attribute, the same
 *     entity's fate, the same resource - reads as continuing content; the
 *     deltaType already is the topic of the change)
 *   - reports: `report:{about}:{topic}:{source}` (the same source family
 *     re-reporting on the same TOPIC about the same subject is the rumor
 *     mill re-reporting; a rumor about a DIFFERENT topic of the same subject
 *     opens its own claim - the over-merge fix)
 *   - investigation: `investigation:{targetId}:{kind}` (the kind is the
 *     topic; re-buying the same aspect refreshes the same dossier claim, D14)
 *   - scheme: `scheme:{schemerId}` (D28 - ONE discovery claim per schemer; a
 *     witnessed sighting records AWARENESS on it, a paid 'scheme'
 *     investigation accretes a NATURE clue - only the paid clue advances the
 *     count toward the reveal, see ingestSchemeClue)
 * A rumor Report with `stance: 'contradicts'` (a counterplay refutation)
 * always FORKS a distinct claim node even when its base key matches, so the
 * refutation is a separate node linked by a 'contradicts' edge rather than
 * silently swallowed into the timeline it disputes.
 *
 * EDGES (D29, structural + deterministic only - no AI inference here): when a
 * claim OPENS, one edge is recorded from it to each pre-existing claim about
 * the SAME subject (bounded by MAX_EDGES_PER_CLAIM), typed by structure:
 *   - 'corroborates' - two report-channel claims on the same subject+topic
 *     from DIFFERENT sources (independent word on the same matter; the D25
 *     "corroborating sources are the signal" relation)
 *   - 'contradicts'  - the incoming rumor explicitly carried
 *     stance:'contradicts' and the prior claim shares its subject+topic
 *   - 'derives-from' - an investigation reveal opening about a subject the
 *     player already held rumor/observation claims on (the bought dossier
 *     follows from that prior trail)
 *   - 'about'        - the fallback: two claims about the same entity by a
 *     different topic or a different channel (same subject, different facet)
 * Edges are stored outgoing on the newer claim (the older node is reachable
 * from the newer); the symmetric relations read the same in either
 * direction, 'derives-from' points newer->older. Edges whose target is
 * evicted are pruned so the graph never dangles.
 */

import type { PerceivedChange, PerceptionSource } from '../perception/visibility';
import type { Report, ReportSource, RumorStance } from '../types';

/**
 * Where a knowledge update came from. Reuses the two provenance
 * vocabularies the player-visible artifacts already carry (D5's perception
 * sources; the Report source enum) rather than inventing a parallel one.
 * Investigation reveals ingest as 'spy' - the player's own paid agent, the
 * closest existing word - with the channel itself preserved losslessly in
 * the claim's `claimKey` prefix.
 */
export type KnowledgeSource = PerceptionSource | ReportSource;

/**
 * The provenance channels; also the claimKey prefix. 'digest'/'report'/
 * 'investigation' each have one ingestion function. 'scheme' is the D28
 * scheme-discovery channel: a schemer's ONE unified discovery claim, fed by
 * a proximity sighting (awareness only) and a paid investigation (which alone
 * advances the nature clue count) - see ingestSchemeClue.
 */
export type KnowledgeChannel = 'digest' | 'report' | 'investigation' | 'scheme';

/** The deterministic edge relations between claims (D29). */
export type KnowledgeEdgeType = 'about' | 'corroborates' | 'contradicts' | 'derives-from';

/** One directed structural edge from a claim to another claim (by id). */
export interface KnowledgeEdge {
  /** The id of the claim this edge points to. */
  to: string;
  type: KnowledgeEdgeType;
}

/**
 * D28 scheme-nature discovery, carried on a scheme-channel claim. Perceiving
 * a scheme reveals only AWARENESS - 'something is afoot' - which is simply the
 * existence of this claim. The NATURE is earned SEPARATELY, through PAID
 * investigation only: `clues` counts nature-clues gathered by active
 * investigation ALONE (D28/D30 - proximity/perception opens and restates the
 * claim but NEVER advances this count, so a scheme a mind re-evolves every
 * turn can never passively auto-reveal). `revealed` flips once `clues` reaches
 * SCHEME_CLUES_TO_REVEAL; `nature` is populated ONLY once revealed - while
 * unrevealed the player knows only that someone is plotting.
 */
export interface SchemeDiscovery {
  clues: number;
  revealed: boolean;
  /** The scheme's nature - set ONLY once revealed (D28). Undefined while unrevealed. */
  nature?: string;
}

/** One time-dated arrival of information on a claim (D21). Frozen at its stamp once recorded (D14). */
export interface KnowledgeUpdate {
  turn: number;
  source: KnowledgeSource;
  text: string;
  /** Only present when the channel carries one (Reports do; digest entries are binary-fidelity per D5 v1). 0.0-1.0. */
  credibility?: number;
}

/**
 * A claim entity - one node of living information the player holds.
 * `claim`, `firstLearnedTurn`, `subject` and `topic` are frozen at first
 * arrival; `updates` accretes every arrival INCLUDING the first (so
 * `updates[0]` is the original learning and the array is the claim's full
 * visible timeline).
 */
export interface KnowledgeClaim {
  id: string;
  /** The entity id, region id, or 'world' the claim is about. */
  subject: string;
  /**
   * The claim's text as first learned - frozen; restatements land in `updates`.
   */
  claim: string;
  /**
   * D29 topic slug: WHAT about the subject this claim concerns. Frozen at
   * open. Optional in the type (new persisted field - legacy saves predate
   * it) but always populated by the ingestion functions below.
   */
  topic?: string;
  /** The deterministic matching key (see the MATCHING RULE above). */
  claimKey: string;
  firstLearnedTurn: number;
  updates: KnowledgeUpdate[];
  /**
   * D29 structural edges to other claims, computed deterministically when
   * this claim opened. Optional (new persisted field; legacy saves and
   * edge-less claims omit it) and bounded by MAX_EDGES_PER_CLAIM.
   */
  edges?: KnowledgeEdge[];
  /**
   * D28 scheme-nature discovery. Present ONLY on scheme-channel claims
   * (claimKey prefix 'scheme', topic 'scheme'); every other claim omits it.
   * Optional (new persisted field; legacy saves predate it). See
   * SchemeDiscovery and ingestSchemeClue.
   */
  schemeDiscovery?: SchemeDiscovery;
  /** A sourced, perception-safe observation of named participants. Optional for save-v1 compatibility. */
  relationshipObservation?: RelationshipObservationMarker;
}

/** Player-safe evidence that may be offered to the relationship selector. */
export interface PlayerSafeEvidence {
  id: string;
  source: KnowledgeSource;
  text: string;
  /** Set only by deterministic local parsing of explicit quotation syntax. */
  trustedQuote?: { speakerId: string; text: string };
}

/** The strictly limited, untrusted model selection shape. */
export interface RelationshipObservationDraft {
  evidenceId: string;
  participantIds: string[];
  excerpt: string;
}

/** The persisted, validated relationship-observation marker. */
export interface RelationshipObservationMarker {
  evidenceId: string;
  participantIds: string[];
  quote?: { speakerId: string; text: string };
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

/**
 * Upper bound on structural edges recorded on any one claim (D29). A subject
 * with a very busy graph (many topics, many sources) would otherwise let one
 * new claim link to unboundedly many priors; the newest-updated same-subject
 * claims are linked first and the rest are dropped. Save-bounding rationale
 * again - edges persist with the claim.
 */
export const MAX_EDGES_PER_CLAIM = 8;

/** Longest topic slug kept; longer input is truncated (see normalizeTopic). */
export const MAX_TOPIC_LEN = 40;

/**
 * PAID nature-clues that must accrete before a scheme's NATURE is revealed
 * (D28). Set to 3: proximity awareness never counts here (D30), and one bought
 * report is only a thread, so a nature worth naming requires corroboration
 * across several PAID investigations; 3 stays reachable within a normal
 * campaign while keeping a single investigation insufficient on its own. Tune
 * here; the full clue-to-nature synthesis is a later mini-game.
 */
export const SCHEME_CLUES_TO_REVEAL = 3;

/**
 * The player-facing line one bought scheme clue records in its timeline:
 * what was gathered, never the scheme's name or nature (D28 - the nature is
 * earned, not dumped; a single investigation must not disclose it). The
 * bought reading rides separately as a natureHint and surfaces only once the
 * clue threshold is met.
 */
export const SCHEME_CLUE_LINE = 'Your agents piece together another thread of the design.';

/**
 * The player-facing nature line used as a defensive fallback if the clue
 * threshold is reached with no bought reading to draw on: the shape is clear,
 * the particulars are not. Honest and non-leaking - naming the exact plot is
 * the deferred mini-game's job.
 */
export const SCHEME_NATURE_UNSYNTHESIZED = 'The shape of the design is plain now, though your agents are still naming its particulars.';

/**
 * Reduces a raw topic string to a stable, key-safe slug: lowercase, spaces
 * and punctuation collapsed to single hyphens, bounded length. An empty or
 * missing topic defaults to 'general' so a rumor whose topic the model
 * omitted still keys deterministically (it merges under 'general' - the old
 * subject-wide behavior, only for un-topiced input). Pure and total.
 */
export function normalizeTopic(raw?: string): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TOPIC_LEN)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'general';
}

/** The channel a stored claim belongs to, read from its claimKey prefix. */
function channelOf(claim: KnowledgeClaim): KnowledgeChannel {
  const prefix = claim.claimKey.split(':', 1)[0];
  return prefix === 'digest' || prefix === 'investigation' || prefix === 'scheme'
    ? prefix
    : 'report';
}

/** The turn a claim last gained an update - the eviction ordering key. */
function lastUpdatedTurn(claim: KnowledgeClaim): number {
  return claim.updates.length > 0
    ? claim.updates[claim.updates.length - 1].turn
    : claim.firstLearnedTurn;
}

/**
 * Drops the oldest-updated claims past MAX_KNOWLEDGE_CLAIMS, preserving the
 * survivors' order, then prunes any edge whose target was evicted so the
 * graph never dangles (D29). Returns the input reference when nothing needs
 * evicting.
 */
export function enforceKnowledgeClaimCap(store: KnowledgeClaim[]): KnowledgeClaim[] {
  if (store.length <= MAX_KNOWLEDGE_CLAIMS) return store;
  const excess = store.length - MAX_KNOWLEDGE_CLAIMS;
  const evictIndices = new Set(
    store
      .map((claim, index) => [lastUpdatedTurn(claim), index] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, excess)
      .map(([, index]) => index)
  );
  const survivors = store.filter((_, index) => !evictIndices.has(index));
  const survivorIds = new Set(survivors.map(c => c.id));
  return survivors.map(claim => {
    if (!claim.edges || claim.edges.every(e => survivorIds.has(e.to))) return claim;
    const kept = claim.edges.filter(e => survivorIds.has(e.to));
    const { edges: _dropped, ...rest } = claim;
    return kept.length > 0 ? { ...rest, edges: kept } : rest;
  });
}

/** The one artifact shape upsertClaim ingests - already reduced to exactly the fields the store may hold. */
interface IngestArtifact {
  claimKey: string;
  subject: string;
  topic: string;
  channel: KnowledgeChannel;
  text: string;
  turn: number;
  source: KnowledgeSource;
  credibility?: number;
  /** 'contradicts' forces a distinct claim node and a 'contradicts' edge (D29). */
  stance?: RumorStance;
}

/**
 * Computes the structural edges (D29) for a claim OPENING with the given
 * subject/topic/channel/stance, against the claims already in `store`. Pure,
 * deterministic, bounded by MAX_EDGES_PER_CLAIM (newest-updated priors
 * linked first). See the EDGES section of the module doc for the typing
 * rules.
 */
function computeEdges(
  store: KnowledgeClaim[],
  opening: { subject: string; topic: string; channel: KnowledgeChannel; stance?: RumorStance }
): KnowledgeEdge[] {
  const { subject, topic, channel, stance } = opening;
  const priors = store
    .filter(c => c.subject === subject)
    .slice()
    .sort((a, b) => lastUpdatedTurn(b) - lastUpdatedTurn(a))
    .slice(0, MAX_EDGES_PER_CLAIM);

  const edges: KnowledgeEdge[] = [];
  for (const prior of priors) {
    const priorChannel = channelOf(prior);
    const sameTopic = typeof prior.topic === 'string' && prior.topic === topic;
    let type: KnowledgeEdgeType;
    if (channel === 'report' && priorChannel === 'report' && sameTopic) {
      type = stance === 'contradicts' ? 'contradicts' : 'corroborates';
    } else if (channel === 'investigation' && priorChannel !== 'investigation') {
      type = 'derives-from';
    } else {
      type = 'about';
    }
    edges.push({ to: prior.id, type });
  }
  return edges;
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

  // A counterplay contradiction is a distinct node, never a continuation of
  // the timeline it disputes - so it never matches an existing key (D29).
  const forceNew = artifact.stance === 'contradicts';
  const existingIndex = forceNew ? -1 : store.findIndex(claim => claim.claimKey === artifact.claimKey);
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

  // A forced fork gets a disambiguated key so it is its own node and a later
  // restatement of the ORIGINAL still continues the original, not the fork.
  let claimKey = artifact.claimKey;
  if (forceNew) {
    // Count only prior forks of this base key (the base-keyed original keeps
    // its plain key), so forks number #c0, #c1, ... and never collide.
    const forkCount = store.filter(c => c.claimKey.startsWith(`${artifact.claimKey}#c`)).length;
    claimKey = `${artifact.claimKey}#c${forkCount}`;
  }

  const edges = computeEdges(store, {
    subject: artifact.subject,
    topic: artifact.topic,
    channel: artifact.channel,
    stance: artifact.stance,
  });

  const newClaim: KnowledgeClaim = {
    // claimKey is unique within the store at any moment (the findIndex above
    // / the fork disambiguator), and a re-created key after eviction lands on
    // a later turn - so turn+claimKey is a sufficient, deterministic id.
    id: `claim_${artifact.turn}_${claimKey}`,
    subject: artifact.subject,
    claim: artifact.text,
    topic: artifact.topic,
    claimKey,
    firstLearnedTurn: artifact.turn,
    updates: [update],
  };
  if (edges.length > 0) {
    newClaim.edges = edges;
  }
  return enforceKnowledgeClaimCap([...store, newClaim]);
}

/**
 * Ingests a committed turn's perceived digest (buildPerceivedDigest output -
 * already D5-filtered; this function must never be handed raw deltas) as of
 * `turn`, the turn that produced it.
 *
 * Rumor-type digest entries are SKIPPED here deliberately: every rumor
 * delta also becomes a Report (ai/core/engine.ts), and Reports are the
 * canonical rumor channel for this store (they carry source + credibility +
 * topic; the digest line is presentation). Ingesting both would double every
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
    if (change.deltaType === 'scheme') {
      // D28/D30: a witnessed scheme is a proximity SIGHTING - it records
      // AWARENESS on the schemer's unified discovery claim (the digest line
      // already withholds the nature) but does NOT advance the nature clue
      // count. Only a PAID investigation earns the nature, so a scheme a mind
      // re-evolves every turn cannot passively auto-reveal from proximity.
      next = ingestSchemeClue(next, {
        schemerId: change.subject,
        turn,
        source: change.source,
        text: change.text,
      });
      continue;
    }
    next = upsertClaim(next, {
      // The digest key keeps its established shape (the deltaType already is
      // the topic of the change); topic is set for edge/graph uniformity.
      claimKey: `digest:${change.deltaType}:${change.deltaKey}`,
      subject: change.subject,
      topic: normalizeTopic(change.deltaType),
      channel: 'digest',
      text: change.text,
      turn,
      source: change.source,
    });
  }
  return next;
}

/**
 * Ingests a turn's NEW Reports (the player-visible rumor/report channel).
 * By default each report's own `turn` stamp is used - a Report is dated at
 * emission.
 *
 * `atTurn`, when provided, stamps the knowledge UPDATES with that turn
 * instead (the Report object itself keeps its own `turn` field). A Report's
 * `turn` descends from the model-echoed `adjudication.turn`
 * (ai/core/engine.ts's rumor case), so turn-commit callers pass the App's
 * authoritative turn counter here - a model that mislabels its turn must
 * not skew the claim timeline (see knowledge/commit.ts).
 *
 * Leak guard (D5/D11): only the whitelisted fields below are read off each
 * Report. A Report never legitimately carries truth-ledger data
 * (`is_true`/`origin_id` live on rumor DELTAS and the GM ledger, not on
 * Reports), but even a polluted object cannot leak extra keys through this
 * field-by-field copy. `topic`/`stance` are player-safe D29 categorization.
 *
 * Returns the input store reference when handed no reports.
 */
export function ingestReports(store: KnowledgeClaim[], newReports: Report[], atTurn?: number): KnowledgeClaim[] {
  let next = store;
  for (const report of newReports) {
    const topic = normalizeTopic(report.topic);
    const stance = report.stance === 'corroborates' || report.stance === 'contradicts' ? report.stance : undefined;
    next = upsertClaim(next, {
      claimKey: `report:${report.about}:${topic}:${report.source}`,
      subject: report.about,
      topic,
      channel: 'report',
      text: report.claim,
      turn: typeof atTurn === 'number' ? atTurn : report.turn,
      source: report.source,
      credibility: report.credibility,
      stance,
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
 * stage). For 'beliefs'/'secrets' the reveal opens/continues a full-dossier
 * claim: re-investigating the same aspect appends a freshly stamped update
 * to the same claim, the earlier reveal frozen at its own stamp (D14), the
 * reveal kind the claim's topic (D29). The 'scheme' aspect instead takes the
 * D28 clue path (ingestSchemeClue): it adds a clue toward earning the
 * scheme's nature rather than dumping the whole scheme.
 */
export function ingestInvestigationReveal(
  store: KnowledgeClaim[],
  reveal: { targetId: string; kind: InvestigationKind; text: string; turn: number }
): KnowledgeClaim[] {
  // D28: buying intel on a plotting target earns a NATURE clue toward the
  // reveal (advancesNature) - it does not dump the whole scheme. The bought
  // reading rides as a natureHint (surfaced only once the clue threshold is
  // met), and the stored timeline line stays nature-free; the beliefs/secrets
  // aspects keep their full-dossier behavior.
  if (reveal.kind === 'scheme') {
    return ingestSchemeClue(store, {
      schemerId: reveal.targetId,
      turn: reveal.turn,
      source: 'spy',
      text: SCHEME_CLUE_LINE,
      natureHint: reveal.text,
      advancesNature: true,
    });
  }
  return upsertClaim(store, {
    claimKey: `investigation:${reveal.targetId}:${reveal.kind}`,
    subject: reveal.targetId,
    topic: normalizeTopic(reveal.kind),
    channel: 'investigation',
    text: reveal.text,
    turn: reveal.turn,
    source: 'spy',
  });
}

/**
 * The three questions the player may put to an occurrence (audit item 40).
 * The old surface hardcoded one — "What were the motives?" — and each is
 * asked at most once per occurrence, so the slug is part of the claim key.
 */
export const OCCURRENCE_QUESTIONS = ['who_gains', 'who_is_behind_it', 'what_follows'] as const;
export type OccurrenceQuestion = typeof OCCURRENCE_QUESTIONS[number];

/** A stable, bounded key for an occurrence's free-prose headline. */
function occurrenceSlug(occurrence: string): string {
  return occurrence.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

/**
 * Ingests what your agents came back with about a public occurrence (audit
 * item 40).
 *
 * The clarification used to live in CurrentEventsTab's component-local
 * `useState`, so an AI call the player WAITED ON was discarded the moment
 * they switched tabs. It is intelligence the player paid attention for; it
 * belongs in the store, where it persists for the reign and survives reload.
 *
 * Subject is 'world' — an occurrence is a public event, not a person — and
 * the channel is `investigation`, because that is what it is: something
 * learned by asking rather than by being told.
 */
export function ingestOccurrenceFinding(
  store: KnowledgeClaim[],
  finding: { occurrence: string; question: OccurrenceQuestion; text: string; turn: number }
): KnowledgeClaim[] {
  return upsertClaim(store, {
    claimKey: `investigation:occurrence:${occurrenceSlug(finding.occurrence)}:${finding.question}`,
    subject: 'world',
    topic: normalizeTopic('occurrence'),
    channel: 'investigation',
    text: finding.text,
    turn: finding.turn,
    source: 'spy',
  });
}

/** One answered question about one occurrence, as held by the player. */
export interface OccurrenceFinding {
  question: OccurrenceQuestion;
  text: string;
  turn: number;
}

/**
 * Every finding the player holds about `occurrence`, oldest question first.
 * A read model over the store — nothing separate is persisted.
 */
export function occurrenceFindings(store: KnowledgeClaim[], occurrence: string): OccurrenceFinding[] {
  const prefix = `investigation:occurrence:${occurrenceSlug(occurrence)}:`;
  const findings: OccurrenceFinding[] = [];
  for (const claim of store) {
    if (!claim.claimKey.startsWith(prefix)) continue;
    const question = claim.claimKey.slice(prefix.length) as OccurrenceQuestion;
    if (!OCCURRENCE_QUESTIONS.includes(question)) continue;
    const latest = claim.updates[claim.updates.length - 1];
    if (!latest) continue;
    findings.push({ question, text: latest.text, turn: claim.firstLearnedTurn });
  }
  return findings.sort((a, b) => OCCURRENCE_QUESTIONS.indexOf(a.question) - OCCURRENCE_QUESTIONS.indexOf(b.question));
}

/**
 * Resolves the scheme-discovery bookkeeping for a claim now holding `clues`
 * PAID nature-clues (D28). Below SCHEME_CLUES_TO_REVEAL the nature stays
 * hidden; at or beyond it the nature is earned and drawn from the freshest
 * reading available: a bought clue's natureHint, else a nature already
 * synthesized on an earlier crossing, else the honest 'shape is clear,
 * particulars pending' defensive fallback line. Pure and total.
 */
function resolveSchemeDiscovery(
  clues: number,
  natureHint: string | undefined,
  priorNature: string | undefined
): SchemeDiscovery {
  if (clues < SCHEME_CLUES_TO_REVEAL) {
    return { clues, revealed: false };
  }
  return { clues, revealed: true, nature: natureHint ?? priorNature ?? SCHEME_NATURE_UNSYNTHESIZED };
}

/**
 * One held DOSSIER aspect on a target (D14/D27): the frozen snapshot the
 * player holds for a single investigation aspect of one entity, stamped with
 * WHEN it was first learned and when it was last refreshed, plus the source
 * of the latest reading. Derived from the store, never stored separately -
 * this is a read model over the investigation/scheme claims about a subject.
 */
export interface DossierEntry {
  /** The aspect held - an investigation kind (D14 dossier) or 'scheme' (D28 clue trail). */
  kind: InvestigationKind;
  /** D29 topic slug of the underlying claim (the reveal kind for investigations, 'scheme' for schemes). */
  topic: string;
  /** The freshest frozen reading held for this aspect - the snapshot as last refreshed (D14). */
  latestText: string;
  /** The turn this aspect was FIRST acquired - frozen origin (D14/D21). */
  firstLearnedTurn: number;
  /**
   * The turn this aspect was last refreshed (the newest update's stamp). This
   * is the staleness clock D27 prices against: turnsSinceLastRefresh =
   * currentTurn - lastRefreshedTurn.
   */
  lastRefreshedTurn: number;
  /** The source of the latest reading (D5/D25 provenance the player judges trust by). */
  source: KnowledgeSource;
  /** D28 scheme-discovery bookkeeping - present ONLY on the 'scheme' aspect. */
  schemeDiscovery?: SchemeDiscovery;
}

/**
 * The per-target dossier: everything the player HOLDS on one entity through
 * paid investigation, as of when (D14). A pure read model - the frozen
 * snapshots stay in the underlying claims, this just gathers them per target.
 */
export interface Dossier {
  subject: string;
  entries: DossierEntry[];
  /**
   * The most recent refresh across all held aspects, or undefined when the
   * dossier is empty (the player holds nothing on this target yet). The
   * "as of when" of the freshest thing on file.
   */
  lastRefreshedTurn?: number;
}

/**
 * The investigation/scheme aspect a claim represents, read from its claimKey,
 * or undefined for a non-dossier claim (digest/report). Deterministic, no AI:
 *   - `investigation:{subject}:{kind}` -> that kind (beliefs | secrets)
 *   - `scheme:{subject}`               -> 'scheme'
 */
function dossierKindOf(claim: KnowledgeClaim): InvestigationKind | undefined {
  const parts = claim.claimKey.split(':');
  if (parts[0] === 'scheme') return 'scheme';
  if (parts[0] === 'investigation') {
    const kind = parts[2];
    if (kind === 'beliefs' || kind === 'secrets' || kind === 'scheme') return kind;
  }
  return undefined;
}

/**
 * Derives the DOSSIER the player holds on `subject` (D14/D27): the frozen
 * per-aspect snapshots gathered from the investigation and scheme claims
 * about that subject, each stamped with its first-learned and last-refreshed
 * turns and the source of the latest reading. Pure - it reads the store and
 * builds a view, mutating nothing; digest and report claims are ignored (a
 * dossier is what you PAID to hold, per D14). This is the "what do I hold on
 * entity X, as of when" accessor D27's refresh pricing keys off - a caller
 * finds the entry for the aspect it is about to re-buy, reads its
 * lastRefreshedTurn, and prices the refresh with
 * dossierCost.ts::computeRefreshCost. A subject with no held dossier returns
 * an empty entries list (the caller then charges first-acquisition price).
 */
export function deriveDossier(store: KnowledgeClaim[], subject: string): Dossier {
  const entries: DossierEntry[] = [];
  for (const claim of store) {
    if (claim.subject !== subject) continue;
    const kind = dossierKindOf(claim);
    if (!kind) continue;
    const latest = claim.updates[claim.updates.length - 1];
    // A claim always carries at least its opening update; guard anyway so the
    // accessor stays total against a malformed (e.g. hand-edited save) claim.
    if (!latest) continue;
    const entry: DossierEntry = {
      kind,
      topic: claim.topic ?? kind,
      latestText: latest.text,
      firstLearnedTurn: claim.firstLearnedTurn,
      lastRefreshedTurn: latest.turn,
      source: latest.source,
    };
    if (claim.schemeDiscovery) entry.schemeDiscovery = claim.schemeDiscovery;
    entries.push(entry);
  }
  const lastRefreshedTurn = entries.length > 0
    ? Math.max(...entries.map(e => e.lastRefreshedTurn))
    : undefined;
  const dossier: Dossier = { subject, entries };
  if (typeof lastRefreshedTurn === 'number') dossier.lastRefreshedTurn = lastRefreshedTurn;
  return dossier;
}

/**
 * Records one observation on a schemer's unified scheme-discovery claim (D28),
 * opening it on the first. Both a proximity SIGHTING and a paid INVESTIGATION
 * feed this one claim - keyed `scheme:{schemerId}`, topic 'scheme' - and each
 * appends a nature-free timeline line. They differ in the ONE way that matters
 * (D28/D30): only a PAID investigation (`advancesNature: true`) advances the
 * nature clue count toward the reveal; a proximity sighting records AWARENESS
 * (the claim exists) but leaves the count untouched, so a scheme a mind
 * re-evolves every turn can never passively auto-reveal from proximity alone.
 *
 * `natureHint` (a bought reading) is honored only on the advancing path, and
 * even then is NEVER stored while unrevealed - it is consulted only at the
 * crossing, so no single clue can dump the scheme early. `clues` is
 * authoritative (PAID nature-clues only) and keeps counting even after the
 * oldest timeline entries roll off the MAX_UPDATES_PER_CLAIM window.
 */
export function ingestSchemeClue(
  store: KnowledgeClaim[],
  clue: { schemerId: string; turn: number; source: KnowledgeSource; text: string; natureHint?: string; advancesNature?: boolean }
): KnowledgeClaim[] {
  const advancesNature = clue.advancesNature === true;
  const claimKey = `scheme:${clue.schemerId}`;
  const update: KnowledgeUpdate = { turn: clue.turn, source: clue.source, text: clue.text };
  const existingIndex = store.findIndex(c => c.claimKey === claimKey);

  if (existingIndex >= 0) {
    const existing = store[existingIndex];
    const priorClues = existing.schemeDiscovery?.clues ?? 0;
    const clues = advancesNature ? priorClues + 1 : priorClues;
    const next = [...store];
    next[existingIndex] = {
      ...existing,
      updates: [...existing.updates, update].slice(-MAX_UPDATES_PER_CLAIM),
      schemeDiscovery: resolveSchemeDiscovery(clues, advancesNature ? clue.natureHint : undefined, existing.schemeDiscovery?.nature),
    };
    return next;
  }

  const edges = computeEdges(store, { subject: clue.schemerId, topic: 'scheme', channel: 'scheme' });
  const clues = advancesNature ? 1 : 0;
  const newClaim: KnowledgeClaim = {
    id: `claim_${clue.turn}_${claimKey}`,
    subject: clue.schemerId,
    claim: clue.text,
    topic: 'scheme',
    claimKey,
    firstLearnedTurn: clue.turn,
    updates: [update],
    schemeDiscovery: resolveSchemeDiscovery(clues, advancesNature ? clue.natureHint : undefined, undefined),
  };
  if (edges.length > 0) {
    newClaim.edges = edges;
  }
  return enforceKnowledgeClaimCap([...store, newClaim]);
}
