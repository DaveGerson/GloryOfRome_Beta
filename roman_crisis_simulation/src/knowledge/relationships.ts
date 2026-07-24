import type { PerceivedChange } from '../perception/visibility';
import type { Entity, Report } from '../types';
import {
  enforceKnowledgeClaimCap,
  type KnowledgeClaim,
  type PlayerSafeEvidence,
  type RelationshipObservationDraft,
} from './store';

export interface KnownRecipientOption {
  entityId: string;
  displayName: string;
}

/**
 * The complete public input surface for turn relationship evidence. Keeping
 * this separate from App's turn result makes narration, headlines, private
 * intent, adjudication, deltas, traces, and simulation state impossible to
 * pass through this boundary accidentally.
 */
export interface TurnRelationshipEvidenceInput {
  submission: string | null;
  perceivedChanges: readonly PerceivedChange[];
  reports: readonly Report[];
}

export interface InvestigationRelationshipEvidenceInput {
  reportText: string;
  targetId: string;
  kind: 'beliefs' | 'scheme' | 'secrets';
  turnNumber: number;
  entities: Array<Pick<Entity, 'entity_id' | 'name'>>;
}

/**
 * Builds the selector's evidence from player-observable projections only.
 * Fields are copied one by one; the source objects themselves never cross
 * the boundary. Report ids remain intact so observation ingestion can
 * deduplicate the same evidence across retries.
 */
export function buildTurnRelationshipEvidence(input: TurnRelationshipEvidenceInput): PlayerSafeEvidence[] {
  const evidence: PlayerSafeEvidence[] = [];
  const reservedIds = new Set(input.reports.map(report => report.id));
  const localIds = new Set<string>();
  const localId = (base: string): string => {
    let candidate = base;
    let suffix = 1;
    while (reservedIds.has(candidate) || localIds.has(candidate)) {
      candidate = `${base}:${suffix}`;
      suffix += 1;
    }
    localIds.add(candidate);
    return candidate;
  };

  if (input.submission !== null) {
    evidence.push({
      id: localId('player-submission'),
      source: 'self',
      text: input.submission,
    });
  }
  input.perceivedChanges.forEach((change, index) => {
    evidence.push({
      id: localId(`player-digest:${index}`),
      source: change.source,
      text: change.text,
    });
  });
  input.reports.forEach(report => {
    evidence.push({
      id: report.id,
      source: report.source,
      text: report.claim,
    });
  });
  return evidence;
}

function evidenceTextFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Builds one investigation evidence item from the player-facing report only. */
export function buildInvestigationRelationshipEvidence(
  input: InvestigationRelationshipEvidenceInput
): PlayerSafeEvidence {
  return buildPlayerSafeEvidence({
    id: `investigation:${input.turnNumber}:${input.targetId}:${input.kind}:${evidenceTextFingerprint(input.reportText)}`,
    source: 'spy',
    text: input.reportText,
  }, input.entities);
}

interface ValidationInput {
  drafts: RelationshipObservationDraft[];
  evidence: PlayerSafeEvidence[];
  entities: Array<Pick<Entity, 'entity_id' | 'name'>>;
  knownEntityIds: string[];
}

export function hasDuplicateEvidenceIds(evidence: PlayerSafeEvidence[]): boolean {
  return new Set(evidence.map(item => item.id)).size !== evidence.length;
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches one exact, case-sensitive display-name literal, never a substring of a longer word. */
export function evidenceContainsExactEntityName(text: string, name: string): boolean {
  if (name.length === 0) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}_])`,
    'u'
  ).test(text);
}

/** Copies only the safe evidence fields, and derives quote attribution locally. */
export function buildPlayerSafeEvidence(
  input: { id: string; source: PlayerSafeEvidence['source']; text: string },
  entities: Array<Pick<Entity, 'entity_id' | 'name'>>
): PlayerSafeEvidence {
  const result: PlayerSafeEvidence = { id: input.id, source: input.source, text: input.text };
  const quotedSpans = input.text.match(/"[^"]*"|\u201c[^\u201d]*\u201d/g) ?? [];
  if (quotedSpans.length !== 1) return result;
  const quoteMatches = [...input.text.matchAll(/([^.!?]+?)\s+(said|replied|asked|answered),\s*["“]([^"”]+)["”]/gi)];
  if (quoteMatches.length !== 1) return result;
  const [, , , quoteText] = quoteMatches[0];
  const speakerMatches = entities.filter(entity => new RegExp(
    `(?:^|[.!?]\\s+|\\bas\\s+)${escapeRegex(entity.name)}\\s+(?:said|replied|asked|answered),\\s*["\\u201c]`,
    'i'
  ).test(input.text));
  if (speakerMatches.length !== 1 || !input.text.includes(quoteText)) return result;
  result.trustedQuote = { speakerId: speakerMatches[0].entity_id, text: quoteText };
  return result;
}

/** Validates model selections without retaining any model-authored extra fields. */
export function validateRelationshipObservationDrafts(input: ValidationInput): RelationshipObservationDraft[] {
  if (hasDuplicateEvidenceIds(input.evidence)) return [];
  const evidenceById = new Map(input.evidence.map(item => [item.id, item]));
  const entityById = new Map(input.entities.map(entity => [entity.entity_id, entity]));
  const knownIds = new Set(input.knownEntityIds);
  const accepted: RelationshipObservationDraft[] = [];
  for (const raw of input.drafts) {
    const evidence = evidenceById.get(raw.evidenceId);
    if (!evidence || !Array.isArray(raw.participantIds) || typeof raw.excerpt !== 'string' || raw.excerpt.trim().length === 0 || !evidence.text.includes(raw.excerpt)) continue;
    const participantIds = [...new Set(raw.participantIds)];
    if (participantIds.length < 2 || participantIds.some(id => !entityById.has(id))) continue;
    if (participantIds.some(id => !knownIds.has(id)
      && !evidenceContainsExactEntityName(evidence.text, entityById.get(id)!.name))) continue;
    accepted.push({ evidenceId: raw.evidenceId, participantIds, excerpt: raw.excerpt });
  }
  return accepted;
}

export function ingestRelationshipObservations(
  store: KnowledgeClaim[],
  input: ValidationInput & { turn: number; globalEvidenceIds?: string[] }
): KnowledgeClaim[] {
  const drafts = validateRelationshipObservationDrafts(input);
  if (drafts.length === 0) return store;
  const existingEvidenceIds = new Set(store.flatMap(claim => claim.relationshipObservation ? [claim.relationshipObservation.evidenceId] : []));
  const evidenceById = new Map(input.evidence.map(item => [item.id, item]));
  const globalEvidenceIds = input.globalEvidenceIds === undefined ? undefined : new Set(input.globalEvidenceIds);
  const next = store.slice();
  for (const draft of drafts) {
    const canonicalEvidenceId = globalEvidenceIds === undefined || globalEvidenceIds.has(draft.evidenceId)
      ? draft.evidenceId
      : `turn:${input.turn}:${draft.evidenceId}`;
    if (existingEvidenceIds.has(canonicalEvidenceId)) continue;
    const evidence = evidenceById.get(draft.evidenceId)!;
    const quote = evidence.trustedQuote
      && draft.participantIds.includes(evidence.trustedQuote.speakerId)
      && draft.excerpt.includes(evidence.trustedQuote.text)
      ? { speakerId: evidence.trustedQuote.speakerId, text: evidence.trustedQuote.text }
      : undefined;
    const marker = { evidenceId: canonicalEvidenceId, participantIds: [...draft.participantIds], ...(quote ? { quote } : {}) };
    const prefix = `relationship-observation:${input.turn}:`;
    const ordinal = next.reduce((maximum, claim) => {
      if (!claim.claimKey.startsWith(prefix)) return maximum;
      const parsed = Number(claim.claimKey.slice(prefix.length));
      return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.max(maximum, parsed + 1) : maximum;
    }, 0);
    next.push({
      id: `claim_${input.turn}_relationship-observation:${input.turn}:${ordinal}`,
      subject: draft.participantIds[0],
      claim: draft.excerpt,
      topic: 'relationship-observation',
      claimKey: `relationship-observation:${input.turn}:${ordinal}`,
      firstLearnedTurn: input.turn,
      updates: [{ turn: input.turn, source: evidence.source, text: draft.excerpt }],
      relationshipObservation: marker,
    });
    existingEvidenceIds.add(canonicalEvidenceId);
  }
  return next.length === store.length ? store : enforceKnowledgeClaimCap(next);
}

export function isEntityKnownToPlayer(player: Entity, candidate: Entity, knowledge: KnowledgeClaim[]): boolean {
  if (candidate.entity_id === player.entity_id) return true;
  if (player.visibility_network.includes(candidate.entity_id) || player.faction_id === candidate.entity_id) return true;
  return knowledge.some(claim => claim.subject === candidate.entity_id || claim.relationshipObservation?.participantIds.includes(candidate.entity_id));
}

export function relationshipTimelineFor(knowledge: KnowledgeClaim[], entityId: string): KnowledgeClaim[] {
  return knowledge.filter(claim => claim.relationshipObservation?.participantIds.includes(entityId));
}

export function knownRecipientOptionsForPlayer(player: Entity, entities: Entity[], knowledge: KnowledgeClaim[]): KnownRecipientOption[] {
  return entities
    .filter(entity => entity.entity_id !== player.entity_id && isEntityKnownToPlayer(player, entity, knowledge))
    .map(entity => ({ entityId: entity.entity_id, displayName: entity.name }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
