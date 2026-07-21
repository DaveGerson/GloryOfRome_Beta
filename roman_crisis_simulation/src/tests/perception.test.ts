// Tests for the Phase 2 perception layer (perception/visibility.ts).
// D5 in roadmaps/DESIGN_DECISIONS.md: the player is never omniscient -
// classifyDelta is the code-side visibility filter that enforces it.
//
// Fixtures are hand-built here (not imported from tests/mockData.ts) so this
// suite stays a pure unit test of perception/visibility.ts with no
// dependency on ai/** or the rest of the mock data graph.
import { describe, it, expect } from 'vitest';
import { classifyDelta, buildPerceivedDigest } from '../perception/visibility';
import { Entity, EventDelta, WorldState } from '../types';

function makeEntity(overrides: Partial<Entity> & { entity_id: string; name: string }): Entity {
  return {
    entity_type: 'individual',
    status: 'alive',
    location: 'Palatine Hill',
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

const worldState: WorldState = {
  year: 235,
  week: 1,
  economic_stability: 'Stable',
  political_climate: 'Volatile',
  regions: {
    'Palatine Hill': { stability: 'Tense', controlling_faction: 'player', current_events: [] },
    'The Suburra': { stability: 'Stable', controlling_faction: null, current_events: [] },
    'Praetorian Camp': { stability: 'Wavering', controlling_faction: null, current_events: [] },
  },
};

const player = makeEntity({
  entity_id: 'player',
  name: 'Severus Alexander',
  location: 'Palatine Hill',
  visibility_network: ['ally_npc'],
});

const npcAtPlayerLocation = makeEntity({
  entity_id: 'npc_local',
  name: 'Local Courtier',
  location: 'Palatine Hill',
});

const distantNpcA = makeEntity({
  entity_id: 'npc_a',
  name: 'Maximinus Thrax',
  location: 'Praetorian Camp',
});

const distantNpcB = makeEntity({
  entity_id: 'npc_b',
  name: 'Julia Mamaea',
  location: 'The Suburra',
});

const networkAlly = makeEntity({
  entity_id: 'ally_npc',
  name: 'Trusted Spy',
  location: 'The Suburra',
});

const entities: Entity[] = [player, npcAtPlayerLocation, distantNpcA, distantNpcB, networkAlly];

describe('classifyDelta', () => {
  it('marks a player-keyed relation delta as self-visible (the player is A)', () => {
    const delta: EventDelta = {
      type: 'relation',
      key: 'player:npc_a:trust_level',
      delta: -1,
      reason: 'A tense exchange',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'self',
    });
  });

  it('does NOT make an NPC-to-player relation delta visible just because the player is B (directional semantics)', () => {
    const delta: EventDelta = {
      type: 'relation',
      key: 'npc_a:player:trust_level',
      delta: -2,
      reason: "Maximinus's contempt grows, unspoken",
    };
    // npc_a is at Praetorian Camp, the player is at Palatine Hill, and npc_a
    // is not in the player's visibility_network - so this should be fully
    // invisible, not 'self' (the player can't introspect another mind) and
    // not witnessed/network either.
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it('marks a status delta on an entity in the player\'s current location as witnessed', () => {
    const delta: EventDelta = {
      type: 'status',
      key: 'npc_local',
      delta: 0,
      reason: 'Collapses in the atrium',
      new_status: 'missing',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'witnessed',
    });
  });

  it('marks a relation delta visible via the player\'s visibility_network', () => {
    // ally_npc (in player's network) is entity A here - their own
    // perception of npc_a shifting is something the network can report back.
    const delta: EventDelta = {
      type: 'relation',
      key: 'ally_npc:npc_a:respect_level',
      delta: 1,
      reason: 'A grudging nod exchanged at camp',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'network',
    });
  });

  it('leaves distant NPC-to-NPC intrigue invisible when neither party is local or networked', () => {
    const delta: EventDelta = {
      type: 'relation',
      key: 'npc_a:npc_b:perceived_threat',
      delta: 3,
      reason: 'A private threat assessment, unspoken',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it('always marks rumor deltas as public (they arrive as reports by design)', () => {
    const delta: EventDelta = {
      type: 'rumor',
      key: 'npc_a',
      delta: 0.5,
      reason: 'Some say Maximinus plots against the throne',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'public',
    });
  });

  it('marks a region delta targeting the player\'s current region as witnessed', () => {
    const delta: EventDelta = {
      type: 'region',
      key: 'Palatine Hill:stability',
      delta: 0,
      reason: 'Guards double the watch after a scare',
    };
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'witnessed',
    });
  });

  it('leaves a region delta for a distant, unnetworked region invisible', () => {
    const delta: EventDelta = {
      type: 'region',
      key: 'Praetorian Camp:stability',
      delta: 0,
      reason: 'Grumbling in the ranks over pay',
    };
    // Praetorian Camp is not the player's location, and no member of the
    // player's visibility_network (only ally_npc, who is in The Suburra) is
    // stationed there.
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it('marks a region delta visible via a network contact stationed there', () => {
    const delta: EventDelta = {
      type: 'region',
      key: 'The Suburra:stability',
      delta: 0,
      reason: 'Riots grip the streets',
    };
    // ally_npc is in the player's visibility_network and is located in The
    // Suburra, so this counts as 'network' even though the player isn't
    // there themselves.
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: true,
      source: 'network',
    });
  });

  it('always marks add_region/remove_region as public', () => {
    const add: EventDelta = { type: 'add_region', key: 'Ostia', delta: 0, reason: '{"stability":"Stable","controlling_faction":null,"current_events":[]}' };
    const remove: EventDelta = { type: 'remove_region', key: 'The Suburra', delta: 0, reason: 'Razed' };
    expect(classifyDelta(add, player, entities, worldState).source).toBe('public');
    expect(classifyDelta(remove, player, entities, worldState).source).toBe('public');
  });
});

describe('buildPerceivedDigest', () => {
  it('produces a labeled, sourced entry only for visible deltas', () => {
    const deltas: EventDelta[] = [
      { type: 'relation', key: 'player:npc_a:trust_level', delta: -1, reason: 'tense' },
      { type: 'relation', key: 'npc_a:npc_b:perceived_threat', delta: 3, reason: 'private assessment' },
      { type: 'rumor', key: 'npc_a', delta: 0.5, reason: 'Some say Maximinus plots' },
    ];
    const digest = buildPerceivedDigest(deltas, player, entities, worldState);

    expect(digest).toHaveLength(2);
    expect(digest[0].source).toBe('self');
    expect(digest[0].text).toContain('Your trust');
    expect(digest[1].source).toBe('public');
    expect(digest[1].text).toContain('Rumor reaches you');
  });

  it('returns an empty digest when nothing in the turn was perceptible', () => {
    const deltas: EventDelta[] = [
      { type: 'relation', key: 'npc_a:npc_b:perceived_threat', delta: 3, reason: 'private assessment' },
    ];
    expect(buildPerceivedDigest(deltas, player, entities, worldState)).toEqual([]);
  });
});
