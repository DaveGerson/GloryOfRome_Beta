import type { Entity } from '../types';
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

/** Copies only the safe evidence fields, and derives quote attribution locally. */
export function buildPlayerSafeEvidence(
  input: { id: string; source: PlayerSafeEvidence['source']; text: string },
  entities: Entity[]
): PlayerSafeEvidence {
  const result: PlayerSafeEvidence = { id: input.id, source: input.source, text: input.text };
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
    if (participantIds.some(id => !knownIds.has(id) && !evidence.text.includes(entityById.get(id)!.name))) continue;
    accepted.push({ evidenceId: raw.evidenceId, participantIds, excerpt: raw.excerpt });
  }
  return accepted;
}

export function ingestRelationshipObservations(
  store: KnowledgeClaim[],
  input: ValidationInput & { turn: number }
): KnowledgeClaim[] {
  const drafts = validateRelationshipObservationDrafts(input);
  if (drafts.length === 0) return store;
  const existingEvidenceIds = new Set(store.flatMap(claim => claim.relationshipObservation ? [claim.relationshipObservation.evidenceId] : []));
  const evidenceById = new Map(input.evidence.map(item => [item.id, item]));
  const next = store.slice();
  for (const draft of drafts) {
    if (existingEvidenceIds.has(draft.evidenceId)) continue;
    const evidence = evidenceById.get(draft.evidenceId)!;
    const quote = evidence.trustedQuote
      && draft.participantIds.includes(evidence.trustedQuote.speakerId)
      && draft.excerpt.includes(evidence.trustedQuote.text)
      ? { speakerId: evidence.trustedQuote.speakerId, text: evidence.trustedQuote.text }
      : undefined;
    const marker = { evidenceId: draft.evidenceId, participantIds: [...draft.participantIds], ...(quote ? { quote } : {}) };
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
    existingEvidenceIds.add(draft.evidenceId);
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
