// Tests for NPC-side perception (perception/npcPerception.ts) and the
// viewer-agnostic contract of perception/visibility.ts (D5 generalized to
// any viewer, D10): the SAME ground-truth delta must classify differently
// for two different viewers when their vantages differ - the
// information-asymmetry proof - and the per-turn perceiving loop must stay
// bounded, prioritized, and player-free.
//
// Fixtures are hand-built here (not imported from tests/mockData.ts), same
// as tests/perception.test.ts: a pure unit suite with no dependency on the
// mock data graph. The applyAdjudication integration tests at the bottom
// use these same fixtures through ai/core/engine.ts.
import { describe, it, expect } from 'vitest';
import { classifyDelta, buildPerceivedDigest } from '../perception/visibility';
import {
  MAX_PERCEIVING_NPCS,
  MAX_NPC_MEMORY_LINES_PER_TURN,
  selectPerceivingNpcs,
  buildNpcPerceptions,
  selectMemoryChanges,
} from '../perception/npcPerception';
import { applyAdjudication } from '../ai/core/engine';
import { Adjudication, Entity, EventDelta, WorldState } from '../types';
import type { PerceivedChange } from '../perception/visibility';

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

// The player: on the Palatine, no network - a deliberately blind vantage so
// the asymmetry cases below isolate each NPC-side channel.
const player = makeEntity({
  entity_id: 'player',
  name: 'Severus Alexander',
  location: 'Palatine Hill',
});

// An NPC standing in The Suburra - the witness vantage.
const npcWatcher = makeEntity({
  entity_id: 'npc_watcher',
  name: 'Suburran Watcher',
  location: 'The Suburra',
});

// The entity events happen to, located in The Suburra.
const npcLocal = makeEntity({
  entity_id: 'npc_local',
  name: 'Local Fixer',
  location: 'The Suburra',
});

// A distant NPC with no network - the blind vantage.
const npcFar = makeEntity({
  entity_id: 'npc_far',
  name: 'Frontier Legate',
  location: 'Praetorian Camp',
});

// A distant NPC whose network reaches npc_local - the eyes-elsewhere vantage.
const npcNetworked = makeEntity({
  entity_id: 'npc_networked',
  name: 'Camp Spymaster',
  location: 'Praetorian Camp',
  visibility_network: ['npc_local'],
});

const entities: Entity[] = [player, npcWatcher, npcLocal, npcFar, npcNetworked];

describe('classifyDelta - viewer asymmetry (the same delta, different viewers)', () => {
  it("classifies an event as 'witnessed' for an NPC standing there and invisible for the player elsewhere", () => {
    const delta: EventDelta = {
      type: 'status',
      key: 'npc_local',
      delta: 0,
      reason: 'Dragged off by hired thugs',
      new_status: 'missing',
    };
    expect(classifyDelta(delta, npcWatcher, entities, worldState)).toEqual({
      visible: true,
      source: 'witnessed',
    });
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it("classifies an NPC's own relation delta as 'self' from their vantage, invisible from an uninvolved one", () => {
    const delta: EventDelta = {
      type: 'relation',
      key: 'npc_far:npc_local:trust_level',
      delta: -2,
      reason: 'A debt gone sour',
    };
    // The acting NPC introspects their own shifting feelings...
    expect(classifyDelta(delta, npcFar, entities, worldState)).toEqual({
      visible: true,
      source: 'self',
    });
    // ...while the player (not present, no network reaching either party)
    // has no line into that private ledger.
    expect(classifyDelta(delta, player, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it("classifies via 'network' for an NPC whose contacts reach the event, invisible for one whose don't", () => {
    const delta: EventDelta = {
      type: 'resource',
      key: 'npc_local:denarii',
      delta: 500,
      reason: 'A purse changes hands',
    };
    expect(classifyDelta(delta, npcNetworked, entities, worldState)).toEqual({
      visible: true,
      source: 'network',
    });
    // Same location as npc_networked, but no eyes in The Suburra.
    expect(classifyDelta(delta, npcFar, entities, worldState)).toEqual({
      visible: false,
      source: null,
    });
  });

  it("classifies 'public' identically for every viewer, NPC or player", () => {
    const delta: EventDelta = {
      type: 'rumor',
      key: 'npc_local',
      delta: 0.5,
      reason: 'They say the Fixer sold out his patron',
    };
    for (const viewer of [player, npcWatcher, npcFar, npcNetworked]) {
      expect(classifyDelta(delta, viewer, entities, worldState)).toEqual({
        visible: true,
        source: 'public',
      });
    }
  });
});

describe('buildPerceivedDigest - per-viewer digests over the same ground truth', () => {
  const deltas: EventDelta[] = [
    // Witnessed only from The Suburra; reaches npc_networked via network.
    { type: 'resource', key: 'npc_local:denarii', delta: 500, reason: 'A purse changes hands' },
    // Public to all.
    { type: 'rumor', key: 'npc_local', delta: 0.5, reason: 'They say the Fixer sold out his patron' },
    // npc_far's own private shift - self for npc_far only.
    { type: 'relation', key: 'npc_far:npc_local:trust_level', delta: -2, reason: 'A debt gone sour' },
  ];

  it('gives each viewer only what their own vantage admits', () => {
    const watcherDigest = buildPerceivedDigest(deltas, npcWatcher, entities, worldState);
    const farDigest = buildPerceivedDigest(deltas, npcFar, entities, worldState);
    const playerDigest = buildPerceivedDigest(deltas, player, entities, worldState);

    // The watcher's third entry is the relation delta: npc_local (its B
    // party) shares the watcher's location, so the shift is witnessed
    // there under the crude-v1 binary rules.
    expect(watcherDigest.map(c => c.source)).toEqual(['witnessed', 'public', 'witnessed']);
    expect(farDigest.map(c => c.source)).toEqual(['public', 'self']);
    expect(playerDigest.map(c => c.source)).toEqual(['public']);
  });

  it('phrases lines from the viewer\'s vantage (second person addresses the viewer)', () => {
    const farDigest = buildPerceivedDigest(deltas, npcFar, entities, worldState);
    expect(farDigest.find(c => c.source === 'self')?.text).toBe('Your trust toward Local Fixer shifts.');
  });
});

describe('selectPerceivingNpcs - the bounded, prioritized viewer set', () => {
  function makeRoster(count: number): Entity[] {
    return Array.from({ length: count }, (_, i) =>
      makeEntity({ entity_id: `npc_${i}`, name: `NPC ${i}` })
    );
  }

  it('excludes the player and the dead, and includes every other alive entity under the cap', () => {
    const roster = [
      player,
      makeEntity({ entity_id: 'npc_dead', name: 'Dead NPC', status: 'dead' }),
      npcWatcher,
      npcFar,
    ];
    const picked = selectPerceivingNpcs(roster, 'player', [], []);
    expect(picked.map(e => e.entity_id)).toEqual(['npc_watcher', 'npc_far']);
  });

  it(`caps the set at MAX_PERCEIVING_NPCS (${MAX_PERCEIVING_NPCS}) with spotlight first, then delta-involved, then roster order`, () => {
    const rosterSize = MAX_PERCEIVING_NPCS + 5;
    const roster = [...makeRoster(rosterSize), player];
    // Spotlight and delta-involved ids are both deep in the roster tail -
    // without prioritization the cap would exclude them.
    const spotlightId = `npc_${rosterSize - 1}`;
    const deltaInvolvedId = `npc_${rosterSize - 3}`;
    const deltas: EventDelta[] = [
      { type: 'resource', key: `${deltaInvolvedId}:denarii`, delta: 10, reason: 'A payment' },
    ];

    const picked = selectPerceivingNpcs(roster, 'player', [spotlightId], deltas);

    expect(picked).toHaveLength(MAX_PERCEIVING_NPCS);
    expect(picked[0].entity_id).toBe(spotlightId);
    expect(picked[1].entity_id).toBe(deltaInvolvedId);
    // The remainder fills in roster order...
    expect(picked[2].entity_id).toBe('npc_0');
    // ...and the roster tail past the cap is left out, player never in.
    const pickedIds = new Set(picked.map(e => e.entity_id));
    expect(pickedIds.has(`npc_${rosterSize - 2}`)).toBe(false);
    expect(pickedIds.has('player')).toBe(false);
  });

  it('covers both parties of a relation delta and the subject of a rumor in the involved tier', () => {
    const rosterSize = MAX_PERCEIVING_NPCS + 5;
    const roster = [...makeRoster(rosterSize), player];
    const deltas: EventDelta[] = [
      { type: 'relation', key: `npc_${rosterSize - 1}:npc_${rosterSize - 2}:trust_level`, delta: 1, reason: 'An alliance' },
      { type: 'rumor', key: `npc_${rosterSize - 4}`, delta: 0.5, reason: 'Whispers' },
    ];

    const picked = selectPerceivingNpcs(roster, 'player', [], deltas);

    expect(picked.map(e => e.entity_id).slice(0, 3)).toEqual([
      `npc_${rosterSize - 1}`,
      `npc_${rosterSize - 2}`,
      `npc_${rosterSize - 4}`,
    ]);
  });

  it('skips spotlight ids that resolve to no living roster entity instead of padding around them', () => {
    const picked = selectPerceivingNpcs(
      [player, npcWatcher],
      'player',
      ['npc_gone', 'npc_watcher'],
      []
    );
    expect(picked.map(e => e.entity_id)).toEqual(['npc_watcher']);
  });
});

describe('buildNpcPerceptions', () => {
  it('returns one digest per viewer, each honest to that viewer alone', () => {
    const deltas: EventDelta[] = [
      { type: 'resource', key: 'npc_local:denarii', delta: 500, reason: 'A purse changes hands' },
    ];
    const perceptions = buildNpcPerceptions(deltas, [npcWatcher, npcFar], entities, worldState);

    expect(perceptions).toHaveLength(2);
    expect(perceptions[0]).toMatchObject({ entityId: 'npc_watcher', name: 'Suburran Watcher' });
    expect(perceptions[0].changes.map(c => c.source)).toEqual(['witnessed']);
    expect(perceptions[1].entityId).toBe('npc_far');
    expect(perceptions[1].changes).toEqual([]);
  });
});

describe('selectMemoryChanges - the per-turn memory bound', () => {
  function makeChange(source: PerceivedChange['source'], text: string): PerceivedChange {
    return { text, source, tabs: [], subject: 'npc_local', deltaType: 'status', deltaKey: 'npc_local' };
  }

  it('ranks witnessed > self > network > public, keeping delta order within a source', () => {
    const changes = [
      makeChange('public', 'p1'),
      makeChange('network', 'n1'),
      makeChange('self', 's1'),
      makeChange('witnessed', 'w1'),
      makeChange('public', 'p2'),
    ];
    expect(selectMemoryChanges(changes).map(c => c.text)).toEqual(['w1', 's1', 'n1', 'p1', 'p2']);
  });

  it(`caps a busy turn at MAX_NPC_MEMORY_LINES_PER_TURN (${MAX_NPC_MEMORY_LINES_PER_TURN}), never dropping a witnessed line for hearsay`, () => {
    const changes = [
      ...Array.from({ length: MAX_NPC_MEMORY_LINES_PER_TURN + 2 }, (_, i) => makeChange('public', `p${i}`)),
      makeChange('witnessed', 'w1'),
    ];
    const selected = selectMemoryChanges(changes);
    expect(selected).toHaveLength(MAX_NPC_MEMORY_LINES_PER_TURN);
    expect(selected[0].text).toBe('w1');
    expect(selected.slice(1).map(c => c.text)).toEqual(
      Array.from({ length: MAX_NPC_MEMORY_LINES_PER_TURN - 1 }, (_, i) => `p${i}`)
    );
  });
});

describe('applyAdjudication - perception-grounded memory stamping over the fixture world', () => {
  const deepCopy = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

  function makeAdjudication(deltas: EventDelta[]): Adjudication {
    return { turn: 3, entityActions: [], deltas, headlines: [], gm_private: [] };
  }

  it('gives a witness a memory of the event, the distant-and-unnetworked NPC none, and the player none', () => {
    const adjudication = makeAdjudication([
      { type: 'status', key: 'npc_local', delta: 0, reason: 'Dragged off by hired thugs', new_status: 'missing' },
    ]);

    const { updatedEntities } = applyAdjudication(
      adjudication, deepCopy(entities), deepCopy(worldState), [], [],
      { playerEntityId: 'player' }
    );

    const watcher = updatedEntities.find(e => e.entity_id === 'npc_watcher')!;
    const far = updatedEntities.find(e => e.entity_id === 'npc_far')!;
    const playerAfter = updatedEntities.find(e => e.entity_id === 'player')!;

    expect(watcher.memories).toHaveLength(1);
    expect(watcher.memories[0].event_description).toBe('Local Fixer is now missing.');
    expect(watcher.memories[0].turn).toBe(3);
    expect(watcher.memories[0].involved_entities).toEqual(['npc_local']);
    expect(far.memories).toHaveLength(0);
    expect(playerAfter.memories).toHaveLength(0);
  });

  it('reaches an NPC through their visibility network when a witness vantage is absent', () => {
    const adjudication = makeAdjudication([
      { type: 'resource', key: 'npc_local:denarii', delta: 500, reason: 'A purse changes hands' },
    ]);

    const { updatedEntities } = applyAdjudication(
      adjudication, deepCopy(entities), deepCopy(worldState), [], [],
      { playerEntityId: 'player' }
    );

    const networked = updatedEntities.find(e => e.entity_id === 'npc_networked')!;
    const far = updatedEntities.find(e => e.entity_id === 'npc_far')!;
    expect(networked.memories).toHaveLength(1);
    expect(networked.memories[0].event_description).toBe("Local Fixer's denarii grows.");
    expect(far.memories).toHaveLength(0);
  });

  it('delivers public/world news into every perceiving NPC\'s memories, still excluding the player', () => {
    const adjudication = makeAdjudication([
      { type: 'world', key: 'political_climate', delta: 0, reason: 'Openly Hostile' },
    ]);

    const { updatedEntities, perceivingNpcIds } = applyAdjudication(
      adjudication, deepCopy(entities), deepCopy(worldState), [], [],
      { playerEntityId: 'player' }
    );

    expect(perceivingNpcIds).toEqual(['npc_watcher', 'npc_local', 'npc_far', 'npc_networked']);
    for (const id of perceivingNpcIds) {
      const npc = updatedEntities.find(e => e.entity_id === id)!;
      expect(npc.memories).toHaveLength(1);
      expect(npc.memories[0].event_description).toContain('the political climate is now Openly Hostile');
    }
    expect(updatedEntities.find(e => e.entity_id === 'player')!.memories).toHaveLength(0);
  });

  it(`bounds the perceiving loop at MAX_PERCEIVING_NPCS with the spotlight cast stamped first`, () => {
    const rosterSize = MAX_PERCEIVING_NPCS + 5;
    const bigRoster = [
      ...Array.from({ length: rosterSize }, (_, i) => makeEntity({ entity_id: `npc_${i}`, name: `NPC ${i}` })),
      player,
    ];
    const spotlightId = `npc_${rosterSize - 1}`;
    const adjudication = makeAdjudication([
      { type: 'world', key: 'economic_stability', delta: 0, reason: 'Failing' },
    ]);

    const { updatedEntities, perceivingNpcIds } = applyAdjudication(
      adjudication, bigRoster, deepCopy(worldState), [], [],
      { playerEntityId: 'player', spotlightIds: [spotlightId] }
    );

    expect(perceivingNpcIds).toHaveLength(MAX_PERCEIVING_NPCS);
    expect(perceivingNpcIds[0]).toBe(spotlightId);
    const stamped = updatedEntities.filter(e => e.memories.length > 0);
    expect(stamped).toHaveLength(MAX_PERCEIVING_NPCS);
    expect(new Set(stamped.map(e => e.entity_id))).toEqual(new Set(perceivingNpcIds));
    // The public news never reached the unselected roster tail - bounded
    // means bounded, not deferred.
    expect(updatedEntities.find(e => e.entity_id === `npc_${rosterSize - 2}`)!.memories).toHaveLength(0);
  });

  it('caps one viewer\'s writes from a single busy turn at MAX_NPC_MEMORY_LINES_PER_TURN', () => {
    const manyRumors: EventDelta[] = Array.from({ length: MAX_NPC_MEMORY_LINES_PER_TURN + 4 }, (_, i) => ({
      type: 'rumor',
      key: 'npc_local',
      delta: 0.5,
      reason: `Rumor number ${i}`,
    }));
    const adjudication = makeAdjudication(manyRumors);

    const { updatedEntities } = applyAdjudication(
      adjudication, deepCopy(entities), deepCopy(worldState), [], [],
      { playerEntityId: 'player' }
    );

    const far = updatedEntities.find(e => e.entity_id === 'npc_far')!;
    expect(far.memories).toHaveLength(MAX_NPC_MEMORY_LINES_PER_TURN);
  });
});
