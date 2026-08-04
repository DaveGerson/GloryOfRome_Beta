import React from 'react';
import type { KnowledgeClaim } from '../../knowledge/store';
import { AxesSilhouette, EmptyRegister } from './EmptyRegister';

type Props = {
  observations: KnowledgeClaim[];
  currentTurn: number;
  /** Named so the zero state can say who you have never been in a room with. */
  subjectName?: string;
};

function learnedTurn(claim: KnowledgeClaim): number {
  return Math.max(claim.firstLearnedTurn, ...claim.updates.map(update => update.turn));
}

function provenance(claim: KnowledgeClaim, currentTurn: number): string {
  const update = claim.updates.at(-1);
  const turn = learnedTurn(claim);
  const age = Math.max(0, currentTurn - turn);
  const when = age === 0 ? 'this turn' : `${age} turn${age === 1 ? '' : 's'} ago`;
  return `${update?.source ?? 'unknown'} · Turn ${turn} · ${when}`;
}

const ObservationLine: React.FC<{ claim: KnowledgeClaim; currentTurn: number }> = ({ claim, currentTurn }) => {
  const quote = claim.relationshipObservation?.quote;
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span>{claim.claim}</span>
      {quote && <q>{quote.text}</q>}
      <small style={{ color: 'var(--text-muted)' }}>{provenance(claim, currentTurn)}</small>
    </li>
  );
};

/** Player-held, sourced observations only. It intentionally has no
 * relationship score, synthesis, or sentiment interpretation. */
const RelationshipObservations: React.FC<Props> = ({ observations, currentTurn, subjectName }) => {
  const newestFirst = [...observations].sort((a, b) => learnedTurn(b) - learnedTurn(a));
  if (newestFirst.length === 0) {
    return (
      <EmptyRegister
        silhouette={<AxesSilhouette />}
        line={`You have never been in a room with ${subjectName ?? 'them'}.`}
        hint="What you observe yourself is the only account nobody can colour."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="gor-label">Recent observations</span>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {newestFirst.slice(0, 3).map(claim => <ObservationLine key={claim.id} claim={claim} currentTurn={currentTurn} />)}
      </ul>
      <details>
        <summary>Observation timeline</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[...newestFirst].reverse().map(claim => <ObservationLine key={claim.id} claim={claim} currentTurn={currentTurn} />)}
        </ul>
      </details>
    </div>
  );
};

export default RelationshipObservations;
