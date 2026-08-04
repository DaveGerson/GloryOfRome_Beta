/**
 * @vitest-environment jsdom
 *
 * Player-safety contract for the real Empire tab. The visible location's
 * roster is deliberately poisoned with an alive, colocated identity absent
 * from the player's knowledge graph; raw entity data must not reach the DOM.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import EmpireTab from '../components/tabs/EmpireTab';
import type { KnowledgeClaim } from '../knowledge/store';
import type { Entity, WorldState } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'entity_id' | 'name'>): Entity {
  return {
    entity_type: 'individual',
    status: 'alive',
    location: 'The Curia',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

const player = makeEntity({
  entity_id: 'player',
  name: 'Severus Alexander',
});

const knownColocatedActor = makeEntity({
  entity_id: 'known_colocated_actor',
  name: 'KNOWN_COLOCATED_ACTOR_NAME',
  position: 'KNOWN_COLOCATED_ACTOR_POSITION',
});

const unknownColocatedActor = makeEntity({
  entity_id: 'unknown_colocated_actor',
  name: 'UNKNOWN_COLOCATED_NAME_SENTINEL',
  position: 'UNKNOWN_POSITION_METADATA_SENTINEL',
  epithet: 'UNKNOWN_EPITHET_METADATA_SENTINEL',
  current_state_narrative: 'UNKNOWN_LIVE_STATE_METADATA_SENTINEL',
});

const worldState: WorldState = {
  year: 235,
  week: 1,
  economic_stability: 'Stable',
  political_climate: 'Tense',
  regions: {
    'The Curia': {
      stability: 'Tense',
      controlling_faction: null,
      current_events: [],
    },
  },
};

const knowledge: KnowledgeClaim[] = [{
  id: 'claim_known_colocated_actor',
  subject: knownColocatedActor.entity_id,
  claim: 'A named official was observed at court.',
  topic: 'status',
  claimKey: 'digest:status:known_colocated_actor',
  firstLearnedTurn: 1,
  updates: [{ turn: 1, source: 'witnessed', text: 'A named official was observed at court.' }],
}];

describe('components/tabs/EmpireTab - player-safe location roster', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a known colocated actor but never exposes an unknown colocated identity or metadata', async () => {
    await act(async () => {
      root.render(
        <EmpireTab
          worldState={worldState}
          entities={[player, knownColocatedActor, unknownColocatedActor]}
          playerEntity={player}
          knowledge={knowledge}
        />
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('The Curia');
    // A known region must never render the unknown-region copy (WP-20
    // reworded it from "Beyond your sight - no word has reached you from
    // here."; this tracks the live string so the check stays load-bearing).
    expect(text).not.toContain('No word has reached you from here.');
    expect(text).toContain('Present:');
    expect(text).toContain('KNOWN_COLOCATED_ACTOR_NAME');
    expect(text).not.toContain('UNKNOWN_COLOCATED_NAME_SENTINEL');
    expect(text).not.toContain('unknown_colocated_actor');
    expect(text).not.toContain('UNKNOWN_POSITION_METADATA_SENTINEL');
    expect(text).not.toContain('UNKNOWN_EPITHET_METADATA_SENTINEL');
    expect(text).not.toContain('UNKNOWN_LIVE_STATE_METADATA_SENTINEL');
  });
});
