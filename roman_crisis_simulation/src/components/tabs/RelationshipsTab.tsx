import React from 'react';
import type { Entity } from '../../types';
import type { KnowledgeClaim } from '../../knowledge/store';
import { certaintyClause, knowledgeSourceLead } from '../../knowledge/credibilityFraming';
import { toRoman } from '../ui/Brand';
import { AxesSilhouette, EmptyRegister } from './EmptyRegister';

/**
 * The relationship map (B2, D13; spec:
 * docs/superpowers/specs/2026-08-06-b2-intelligence-surfaces-design.md).
 *
 * A rendering of exactly two things: what the player INTERPRETED with their
 * own eyes and what they were TOLD — the claims carrying a D42
 * relationship-observation marker, grouped by the unordered pair of named
 * participants. Every edge carries its provenance (the source's own voice,
 * never a figure — D25) and its age (the week it was learned). A
 * rumor-sourced edge is only as good as the rumor: the map inherits the lie
 * WITH its provenance attached and never knows better (D11 — the system
 * knows; this surface deliberately does not). Ground truth
 * (`entity.relationships`) is never read here, and no score, meter, or
 * synthesis ever renders (B8's proposed ratification).
 */

type Props = {
  knowledge: KnowledgeClaim[];
  entities: Entity[];
  currentTurn: number;
};

type Edge = {
  claim: KnowledgeClaim;
  /** The newest update's turn — the edge's age. */
  turn: number;
};

type Pair = {
  key: string;
  participantIds: string[];
  edges: Edge[];
  /** The pair's most recent word, for ordering pairs newest first. */
  latestTurn: number;
};

function latestTurnOf(claim: KnowledgeClaim): number {
  return Math.max(claim.firstLearnedTurn, ...claim.updates.map(update => update.turn));
}

/** Unordered-pair key, so "Aulus with Livia" and "Livia with Aulus" are one bond. */
function pairKey(participantIds: string[]): string {
  return [...participantIds].sort().join('::');
}

function groupByPair(observations: KnowledgeClaim[]): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const claim of observations) {
    const marker = claim.relationshipObservation;
    if (!marker || marker.participantIds.length < 2) continue;
    const key = pairKey(marker.participantIds);
    const edge: Edge = { claim, turn: latestTurnOf(claim) };
    const existing = pairs.get(key);
    if (existing) {
      existing.edges.push(edge);
      existing.latestTurn = Math.max(existing.latestTurn, edge.turn);
    } else {
      pairs.set(key, { key, participantIds: marker.participantIds, edges: [edge], latestTurn: edge.turn });
    }
  }
  const grouped = [...pairs.values()];
  for (const pair of grouped) pair.edges.sort((a, b) => b.turn - a.turn);
  return grouped.sort((a, b) => b.latestTurn - a.latestTurn);
}

const EdgeRow: React.FC<{ edge: Edge }> = ({ edge }) => {
  const latest = edge.claim.updates[edge.claim.updates.length - 1];
  const quote = edge.claim.relationshipObservation?.quote;
  if (!latest) return null;
  return (
    <li className="gor-relationship-edge" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="gor-report-source">{knowledgeSourceLead(latest.source)}</span>
        <span className="gor-report-week">{toRoman(edge.turn)}</span>
      </span>
      <span style={{ fontSize: 15 }}>{latest.text}</span>
      {quote && <q style={{ fontSize: 14, color: 'var(--text-muted)' }}>{quote.text}</q>}
      {typeof latest.credibility === 'number' && (
        <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
          {certaintyClause(latest.credibility)}
        </span>
      )}
    </li>
  );
};

const RelationshipsTab: React.FC<Props> = ({ knowledge, entities, currentTurn }) => {
  const observations = knowledge.filter(claim => claim.relationshipObservation);
  const pairs = groupByPair(observations);
  const nameOf = (id: string): string => entities.find(entity => entity.entity_id === id)?.name ?? id;

  if (pairs.length === 0) {
    return (
      <EmptyRegister
        silhouette={<AxesSilhouette />}
        line="You have seen no one together, and no one has told you of any bond."
        hint="Commit what you observe — or what your sources claim — and the web draws itself."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
        What you have seen and what you have been told — no more. A bond drawn
        from a lying tongue is drawn wrong, and this ledger cannot tell.
      </span>
      {pairs.map(pair => (
        <section key={pair.key} className="gor-relationship-pair">
          <header className="gor-report-group-head">
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, letterSpacing: '.06em' }}>
              {pair.participantIds.map(nameOf).join(' — ')}
            </span>
            <span className="gor-report-week">as of {toRoman(Math.max(0, pair.latestTurn))}</span>
          </header>
          <ul style={{ margin: 0, padding: '0 0 0 2px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pair.edges.map(edge => <EdgeRow key={edge.claim.id} edge={edge} />)}
          </ul>
        </section>
      ))}
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        As of Week {toRoman(Math.max(1, currentTurn))}. Older word may no longer hold.
      </span>
    </div>
  );
};

export default RelationshipsTab;
