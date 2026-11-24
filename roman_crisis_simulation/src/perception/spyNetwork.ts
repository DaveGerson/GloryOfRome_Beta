/**
 * perception/spyNetwork.ts
 *
 * G4 Turned Spy Contacts & Counter-Intel Risk: derives which living contacts on
 * the roster operate as active informants or coerced assets for a player
 * (via held blackmail, high devotion, or strong dependency), what expanded
 * visibility reach they confer, and what counter-intel blowout risk they carry.
 */
import type { Entity } from '../types';

export type TurnedReason = 'blackmail' | 'devotion' | 'dependency';

export interface TurnedContact {
  entityId: string;
  name: string;
  reason: TurnedReason;
  visibilityReach: string[];
  /** 0..1 estimated reliability before counter-intel strain. */
  reliability: number;
  /** 0..1 risk of feeding compromised or exposed word back to rivals. */
  doubleAgentRisk: number;
}

export interface CounterIntelAssessment {
  riskLevel: 'low' | 'guarded' | 'high';
  score: number;
  notes: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function computeRiskAndReliability(
  contact: Entity,
  reason: TurnedReason,
): { reliability: number; doubleAgentRisk: number } {
  const personality = contact.personality;
  const cunning = personality?.cunning ?? 5;
  const paranoia = personality?.paranoia ?? 5;
  const loyalty = personality?.loyalty ?? 5;

  let baseReliability = reason === 'devotion' ? 0.85 : reason === 'dependency' ? 0.72 : 0.62;
  let baseRisk = reason === 'blackmail' ? 0.35 : reason === 'dependency' ? 0.2 : 0.08;

  baseRisk += (cunning - 5) * 0.03 + (paranoia - 5) * 0.03 - (loyalty - 5) * 0.04;
  baseReliability += (loyalty - 5) * 0.03 - (paranoia - 5) * 0.02;

  return {
    reliability: clamp01(baseReliability),
    doubleAgentRisk: clamp01(baseRisk),
  };
}

/**
 * Lists living non-player figures turned into active player informants through
 * blackmail (`blackmail_on_<id>`), devotion (`trust_level >= 6`), or strong
 * dependency (`dependency_level >= 5`).
 */
export function turnedContactsOf(entities: readonly Entity[], playerEntity: Entity): TurnedContact[] {
  const out: TurnedContact[] = [];
  for (const entity of entities) {
    if (entity.entity_id === playerEntity.entity_id || entity.status !== 'alive') continue;
    const blackmailKey = `blackmail_on_${entity.entity_id}`;
    const blackmailList = playerEntity.resources[blackmailKey];
    const hasBlackmail = Array.isArray(blackmailList) && blackmailList.length > 0;
    const rel = entity.relationships[playerEntity.entity_id];
    const hasDevotion = (rel?.trust_level ?? 0) >= 6;
    const hasDependency = (rel?.dependency_level ?? 0) >= 5;

    let reason: TurnedReason | null = null;
    if (hasBlackmail) reason = 'blackmail';
    else if (hasDevotion) reason = 'devotion';
    else if (hasDependency) reason = 'dependency';
    if (!reason) continue;

    const { reliability, doubleAgentRisk } = computeRiskAndReliability(entity, reason);
    out.push({
      entityId: entity.entity_id,
      name: entity.name,
      reason,
      visibilityReach: entity.visibility_network.filter(id => id !== playerEntity.entity_id),
      reliability,
      doubleAgentRisk,
    });
  }
  return out;
}

/**
 * Deduplicated entity ids observable via the player's turned contacts (their
 * own ids plus their immediate `visibility_network`), suitable for opt-in
 * `extraNetworkIds` expansion in `buildPlayerPerceivedDigest`.
 */
export function spyNetworkReachIds(entities: readonly Entity[], playerEntity: Entity): string[] {
  const reached = new Set<string>();
  for (const contact of turnedContactsOf(entities, playerEntity)) {
    reached.add(contact.entityId);
    for (const peerId of contact.visibilityReach) {
      reached.add(peerId);
    }
  }
  return [...reached];
}

/**
 * Evaluates counter-intelligence exposure when using a turned contact against
 * a target entity.
 */
export function evaluateCounterIntelRisk(contact: TurnedContact, target: Entity): CounterIntelAssessment {
  const targetParanoia = target.personality?.paranoia ?? 5;
  const targetCunning = target.personality?.cunning ?? 5;
  const score = clamp01(contact.doubleAgentRisk + Math.max(0, targetParanoia - 5) * 0.04 + Math.max(0, targetCunning - 5) * 0.03);
  const notes: string[] = [];

  if (contact.reason === 'blackmail') {
    notes.push(`${contact.name} serves under leverage and may turn at an opening.`);
  } else if (contact.reason === 'devotion') {
    notes.push(`${contact.name} reports out of steady personal trust.`);
  } else {
    notes.push(`${contact.name} cooperates through pressing obligation.`);
  }
  if (targetParanoia >= 7 || targetCunning >= 7) {
    notes.push(`${target.name} keeps an unusually watchful household.`);
  }

  const riskLevel = score >= 0.55 ? 'high' : score >= 0.3 ? 'guarded' : 'low';
  return { riskLevel, score, notes };
}
