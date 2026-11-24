/**
 * knowledge/schemeDeduction.ts
 *
 * D28 / B3 Clue-Driven Scheme Deduction Board (read model strictly over the
 * player's knowledge store and public roster identities).
 *
 * PRIVACY INVARIANT (D4/D5/D28):
 *   - Entity parameters accept ONLY public identity fields (`entity_id`,
 *     `name`, `position`, `faction_id`). Active schemes, secrets, hidden truth,
 *     and engine relationships are unreadable at compile time and runtime.
 *   - `SchemeLead.nature` is ONLY populated when `schemeDiscovery.revealed` is
 *     true; unrevealed plots expose clue progress and trail evidence only.
 *   - Evidence timeline items never expose numeric credibility (D25).
 */
import type { Entity } from '../types';
import { knowledgeSourceLead } from './credibilityFraming';
import { SCHEME_CLUES_TO_REVEAL, type KnowledgeClaim } from './store';

export type PublicRosterFigure = Pick<Entity, 'entity_id' | 'name' | 'position' | 'faction_id'>;
type SchemeLeadStage = 'whisper' | 'trail' | 'unmasked';

interface SchemeEvidenceItem {
  turn: number;
  sourceLead: string;
  text: string;
  channel: 'scheme' | 'report' | 'investigation' | 'sign' | 'digest';
}

interface SchemeLinkedFigure {
  entityId: string;
  name: string;
  lastSeenTurn: number;
  turns: number[];
}

interface SchemeLead {
  leadId: string;
  subjectId: string;
  subjectName: string;
  subjectPosition?: string;
  stage: SchemeLeadStage;
  clueCount: number;
  cluesNeeded: number;
  revealed: boolean;
  nature?: string;
  evidenceTimeline: SchemeEvidenceItem[];
  linkedFigures: SchemeLinkedFigure[];
  corroborationCount: number;
  contradictionCount: number;
  lastUpdatedTurn: number;
}

export interface SchemeBoard {
  leads: SchemeLead[];
  totalClues: number;
  unmaskedCount: number;
}

export interface DeductionCheckResult {
  connected: boolean;
  stage: SchemeLeadStage | null;
  summary: string;
  supportingTurns: number[];
}

function claimChannel(claim: KnowledgeClaim): SchemeEvidenceItem['channel'] {
  const prefix = claim.claimKey.split(':')[0];
  if (prefix === 'scheme' || prefix === 'report' || prefix === 'investigation' || prefix === 'sign') {
    return prefix;
  }
  return 'digest';
}

function latestTurnOf(claim: KnowledgeClaim): number {
  const last = claim.updates[claim.updates.length - 1];
  return last ? last.turn : claim.firstLearnedTurn;
}

/**
 * Derives the player's Scheme Deduction Board strictly from player-visible
 * `KnowledgeClaim` entries and public roster identities.
 */
export function deriveSchemeBoard(
  knowledge: readonly KnowledgeClaim[],
  entities: readonly PublicRosterFigure[],
  playerEntityId?: string | null,
): SchemeBoard {
  const byId = new Map(entities.map(e => [e.entity_id, e]));
  const schemeClaims = knowledge.filter(c => c.claimKey.startsWith('scheme:') && c.subject !== playerEntityId);

  const leads: SchemeLead[] = schemeClaims.map(schemeClaim => {
    const subjectId = schemeClaim.subject;
    const figure = byId.get(subjectId);
    const subjectName = figure?.name ?? subjectId;

    const clueCount = schemeClaim.schemeDiscovery?.clues ?? 0;
    const revealed = Boolean(schemeClaim.schemeDiscovery?.revealed);
    const nature = revealed ? schemeClaim.schemeDiscovery?.nature : undefined;
    const stage: SchemeLeadStage = revealed ? 'unmasked' : clueCount > 0 ? 'trail' : 'whisper';

    const relatedClaims = knowledge.filter(claim =>
      claim.subject === subjectId
      && (claim.claimKey === `scheme:${subjectId}`
        || claim.claimKey === `sign:${subjectId}`
        || claim.claimKey.startsWith(`sign:${subjectId}:`)
        || claim.topic === 'scheme'
        || claim.topic === 'conspiracy'
        || claim.topic === 'plot'
        || (claim.edges?.some(e => e.to === schemeClaim.id && (e.type === 'corroborates' || e.type === 'contradicts')) ?? false))
    );

    const claimIds = new Set(relatedClaims.map(c => c.id));
    let corroborationCount = 0;
    let contradictionCount = 0;
    for (const c of knowledge) {
      if (!c.edges) continue;
      for (const edge of c.edges) {
        if (!claimIds.has(c.id) && !claimIds.has(edge.to)) continue;
        if (edge.type === 'corroborates') corroborationCount++;
        else if (edge.type === 'contradicts') contradictionCount++;
      }
    }

    const evidenceTimeline: SchemeEvidenceItem[] = [];
    for (const claim of relatedClaims) {
      const ch = claimChannel(claim);
      for (const update of claim.updates) {
        evidenceTimeline.push({
          turn: update.turn,
          sourceLead: knowledgeSourceLead(update.source),
          text: update.text,
          channel: ch,
        });
      }
    }
    evidenceTimeline.sort((a, b) => a.turn - b.turn);

    const linkedMap = new Map<string, SchemeLinkedFigure>();
    for (const claim of knowledge) {
      const obs = claim.relationshipObservation;
      if (!obs || !obs.participantIds.includes(subjectId)) continue;
      const turn = latestTurnOf(claim);
      for (const pid of obs.participantIds) {
        if (pid === subjectId || pid === playerEntityId) continue;
        const other = byId.get(pid);
        if (!other) continue;
        const existing = linkedMap.get(pid);
        if (!existing) {
          linkedMap.set(pid, { entityId: pid, name: other.name, lastSeenTurn: turn, turns: [turn] });
        } else {
          const turns = existing.turns.includes(turn)
            ? existing.turns
            : [...existing.turns, turn].sort((a, b) => a - b);
          linkedMap.set(pid, {
            ...existing,
            lastSeenTurn: Math.max(existing.lastSeenTurn, turn),
            turns,
          });
        }
      }
    }

    const lastUpdatedTurn = evidenceTimeline.length > 0
      ? evidenceTimeline[evidenceTimeline.length - 1].turn
      : schemeClaim.firstLearnedTurn;

    return {
      leadId: schemeClaim.id,
      subjectId,
      subjectName,
      ...(figure?.position ? { subjectPosition: figure.position } : {}),
      stage,
      clueCount,
      cluesNeeded: SCHEME_CLUES_TO_REVEAL,
      revealed,
      ...(nature !== undefined ? { nature } : {}),
      evidenceTimeline,
      linkedFigures: [...linkedMap.values()].sort((a, b) => b.lastSeenTurn - a.lastSeenTurn || a.name.localeCompare(b.name)),
      corroborationCount,
      contradictionCount,
      lastUpdatedTurn,
    };
  });

  leads.sort((a, b) => b.lastUpdatedTurn - a.lastUpdatedTurn || b.clueCount - a.clueCount || a.subjectName.localeCompare(b.subjectName));

  return {
    leads,
    totalClues: leads.reduce((sum, lead) => sum + lead.clueCount, 0),
    unmaskedCount: leads.filter(lead => lead.revealed).length,
  };
}

/**
 * Evaluates whether the player's collected intelligence links `candidateFigureId`
 * (or generally corroborates a lead) to `subjectId`, using ONLY player-visible
 * board state.
 */
export function evaluateDeductionHypothesis(
  board: SchemeBoard,
  subjectId: string,
  candidateFigureId?: string,
): DeductionCheckResult {
  const lead = board.leads.find(l => l.subjectId === subjectId);
  if (!lead) {
    return {
      connected: false,
      stage: null,
      summary: 'No scheme lead has been opened on this figure yet.',
      supportingTurns: [],
    };
  }
  const shownClues = Math.min(lead.clueCount, lead.cluesNeeded);
  if (!candidateFigureId) {
    return {
      connected: lead.clueCount > 0,
      stage: lead.stage,
      summary: lead.revealed
        ? `Agent files attribute a design (${shownClues}/${lead.cluesNeeded} clues).`
        : `${shownClues} of ${lead.cluesNeeded} clues gathered toward unmasking the design.`,
      supportingTurns: [...new Set(lead.evidenceTimeline.map(item => item.turn))],
    };
  }
  const linked = lead.linkedFigures.find(f => f.entityId === candidateFigureId);
  if (!linked) {
    return {
      connected: false,
      stage: lead.stage,
      summary: 'Your observations do not yet place that figure alongside this plot.',
      supportingTurns: [],
    };
  }
  return {
    connected: true,
    stage: lead.stage,
    summary: `Observed alongside ${linked.name}.`,
    supportingTurns: linked.turns,
  };
}
