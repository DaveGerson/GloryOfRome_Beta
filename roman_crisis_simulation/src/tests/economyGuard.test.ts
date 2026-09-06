/**
 * tests/economyGuard.test.ts
 *
 * The conservation guard (DESIGN_DECISIONS.md D46; BACKLOG T1's guardrail,
 * ai/core/economyGuard.ts). Pins: every resource delta key folds onto its
 * canonical spelling for every entity; the PLAYER's unsourced windfalls,
 * free intel, reputation leaps and unpaid recruits are clamped - never
 * rejected - with an `[Economy]` GM note; losses, NPC bags and undeclared
 * keys pass untouched; nothing is mutated.
 */
import { describe, it, expect } from 'vitest';
import {
  INTEL_GRANT_CAP,
  RECRUIT_FREE_MEN,
  STANDING_MAX_SWING,
  WINDFALL_FREE_ALLOWANCE,
  guardEconomy,
} from '../ai/core/economyGuard';
import type { Entity, EventDelta } from '../types';
import { makeEntity } from './factories';

const PLAYER = 'severus_alexander';
const NPC = 'gaius_pontius_magnus';

const resource = (root: string, key: string, delta: number, reason = 'because'): EventDelta =>
  ({ type: 'resource', key: `${root}:${key}`, delta, reason });

function roster(playerBag: Entity['resources'] = { denarii: 10000 }): Entity[] {
  return [
    makeEntity({ entity_id: PLAYER, name: 'Severus Alexander', resources: playerBag }),
    makeEntity({ entity_id: NPC, name: 'Gaius Pontius Magnus', resources: { denarii: 250000 } }),
  ];
}

const only = (deltas: EventDelta[], key: string) => deltas.filter(delta => delta.key === key);

describe('economyGuard - one quantity, one name', () => {
  it('folds every resource delta key onto its canonical spelling, for the player and for NPCs alike', () => {
    const deltas = [
      resource(PLAYER, 'gold', -1500),
      resource(NPC, 'spies', 2),
      resource(NPC, 'legion_loyalty', 3),
      resource(PLAYER, 'denarii', 100),
    ];
    const { deltas: out, notes } = guardEconomy(deltas, roster(), PLAYER);

    expect(out.map(delta => delta.key)).toEqual([
      `${PLAYER}:denarii`, `${NPC}:agents`, `${NPC}:legion_support`, `${PLAYER}:denarii`,
    ]);
    expect(notes).toEqual([
      `[Economy] Folded resource key '${PLAYER}:gold' onto '${PLAYER}:denarii' - one quantity, one name.`,
      `[Economy] Folded resource key '${NPC}:spies' onto '${NPC}:agents' - one quantity, one name.`,
      `[Economy] Folded resource key '${NPC}:legion_loyalty' onto '${NPC}:legion_support' - one quantity, one name.`,
    ]);
  });

  it('passes non-resource deltas by reference, malformed keys as they are, and never mutates its inputs', () => {
    const relation: EventDelta = { type: 'relation', key: `${NPC}:${PLAYER}:trust_level`, delta: 2, reason: 'warmth' };
    const malformed = resource('', 'gold', 5);
    const windfall = resource(PLAYER, 'denarii', 50000);
    const deltas = [relation, malformed, windfall];
    const snapshot = structuredClone(deltas);
    const entities = roster();
    const entitiesSnapshot = structuredClone(entities);

    const { deltas: out } = guardEconomy(deltas, entities, PLAYER);

    expect(out[0]).toBe(relation);
    expect(out[1]).toBe(malformed);
    expect(out[2]).not.toBe(windfall);
    expect(deltas).toEqual(snapshot);
    expect(entities).toEqual(entitiesSnapshot);
  });

  it('with no player on the roster it only folds', () => {
    const { deltas: out, notes } = guardEconomy([resource(PLAYER, 'gold', 90000)], [], PLAYER);
    expect(out[0]).toMatchObject({ key: `${PLAYER}:denarii`, delta: 90000 });
    expect(notes).toHaveLength(1);
  });
});

describe('economyGuard - gains must cite a source', () => {
  it('clamps an unsourced treasury gain to the larger of the free allowance and half the standing treasury', () => {
    const { deltas: out, notes } = guardEconomy([resource(PLAYER, 'denarii', 12000, 'A gift.')], roster({ denarii: 10000 }), PLAYER);

    expect(only(out, `${PLAYER}:denarii`)[0].delta).toBe(5000);
    expect(notes).toEqual([expect.stringMatching(/^\[Economy\] Clamped an unsourced treasury gain of 12,000 denarii to 5,000 /)]);

    const poor = guardEconomy([resource(PLAYER, 'denarii', 12000)], roster({ denarii: 0 }), PLAYER);
    expect(only(poor.deltas, `${PLAYER}:denarii`)[0].delta).toBe(WINDFALL_FREE_ALLOWANCE);
  });

  it('lets a gain within the allowance through untouched', () => {
    const { deltas: out, notes } = guardEconomy([resource(PLAYER, 'denarii', 4000)], roster({ denarii: 10000 }), PLAYER);
    expect(only(out, `${PLAYER}:denarii`)[0].delta).toBe(4000);
    expect(notes).toEqual([]);
  });

  it('accepts a gain that a payer lost, a creditor lent, or a standing paid for', () => {
    const paid = guardEconomy([resource(PLAYER, 'denarii', 20000), resource(NPC, 'denarii', -10000, 'Extorted.')], roster(), PLAYER);
    expect(only(paid.deltas, `${PLAYER}:denarii`)[0].delta).toBe(20000);

    const lent = guardEconomy([resource(PLAYER, 'denarii', 20000), resource(PLAYER, 'debt_denarii', 20000, 'A loan.')], roster(), PLAYER);
    expect(only(lent.deltas, `${PLAYER}:denarii`)[0].delta).toBe(20000);

    const taxed = guardEconomy([resource(PLAYER, 'denarii', 20000), resource(PLAYER, 'popular_support', -5, 'A forced levy.')], roster(), PLAYER);
    expect(only(taxed.deltas, `${PLAYER}:denarii`)[0].delta).toBe(20000);
    expect([...paid.notes, ...lent.notes, ...taxed.notes]).toEqual([]);
  });

  it('a fig-leaf source explains less than half the gain and does not count', () => {
    const { deltas: out } = guardEconomy([resource(PLAYER, 'denarii', 20000), resource(NPC, 'denarii', -1000)], roster(), PLAYER);
    expect(only(out, `${PLAYER}:denarii`)[0].delta).toBe(5000);
  });

  it('scales several unsourced gains in proportion so their sum is the allowance', () => {
    const { deltas: out } = guardEconomy([
      resource(PLAYER, 'denarii', 9000, 'Tribute.'),
      resource(PLAYER, 'gold', 3000, 'A purse.'),
    ], roster({ denarii: 10000 }), PLAYER);
    const gains = only(out, `${PLAYER}:denarii`).map(delta => delta.delta);
    expect(gains).toEqual([3750, 1250]);
  });
});

describe('economyGuard - intel is regenerated and priced, never narrated into being', () => {
  it('caps a week\'s granted investigations and deep analyses at one each', () => {
    const { deltas: out, notes } = guardEconomy([
      resource(PLAYER, 'investigations', 3),
      resource(PLAYER, 'deep_analyses', 2),
    ], roster(), PLAYER);

    expect(only(out, `${PLAYER}:investigations`)[0].delta).toBe(INTEL_GRANT_CAP);
    expect(only(out, `${PLAYER}:deep_analyses`)[0].delta).toBe(INTEL_GRANT_CAP);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^\[Economy\] Clamped a grant of 3 investigations to 1/);
  });

  it('lets a single investigation through and never touches a spend', () => {
    const { deltas: out, notes } = guardEconomy([
      resource(PLAYER, 'investigations', 1),
      resource(PLAYER, 'deep_analyses', -2),
    ], roster(), PLAYER);
    expect(out.map(delta => delta.delta)).toEqual([1, -2]);
    expect(notes).toEqual([]);
  });
});

describe('economyGuard - a reputation moves by points, not by tens', () => {
  it('clamps a swing past fifteen in either direction and keeps a mixed group\'s proportion', () => {
    const up = guardEconomy([resource(PLAYER, 'legion_support', 40)], roster(), PLAYER);
    expect(only(up.deltas, `${PLAYER}:legion_support`)[0].delta).toBe(STANDING_MAX_SWING);
    expect(up.notes[0]).toMatch(/^\[Economy\] Clamped a \+40 swing in legion_support to \+15/);

    const down = guardEconomy([resource(PLAYER, 'legitimacy', -40)], roster(), PLAYER);
    expect(only(down.deltas, `${PLAYER}:legitimacy`)[0].delta).toBe(-STANDING_MAX_SWING);

    const mixed = guardEconomy([
      resource(PLAYER, 'senatorial_support', 30),
      resource(PLAYER, 'senatorial_support', -10),
      resource(PLAYER, 'senatorial_support', 10),
    ], roster(), PLAYER);
    const swings = only(mixed.deltas, `${PLAYER}:senatorial_support`).map(delta => delta.delta);
    expect(swings.reduce((sum, delta) => sum + delta, 0)).toBe(STANDING_MAX_SWING);
    expect(swings[1]).toBeLessThan(0);
  });

  it('leaves a swing of fifteen or less alone, including an undeclared standing', () => {
    const { deltas: out, notes } = guardEconomy([
      resource(PLAYER, 'legion_support', 15),
      resource(PLAYER, 'senate_goodwill', -12),
    ], roster(), PLAYER);
    expect(out.map(delta => delta.delta)).toEqual([15, -12]);
    expect(notes).toEqual([]);
  });
});

describe('economyGuard - men are paid for, or they are volunteers', () => {
  it('clamps unpaid recruits to a good week\'s volunteers when no coin was spent and nothing borrowed', () => {
    const few = guardEconomy([resource(PLAYER, 'troops', 100)], roster({ denarii: 10000, troops: 50 }), PLAYER);
    expect(only(few.deltas, `${PLAYER}:troops`)[0].delta).toBe(RECRUIT_FREE_MEN);
    expect(few.notes[0]).toMatch(/^\[Economy\] Clamped 100 unpaid troops to 20 volunteers/);

    const many = guardEconomy([resource(PLAYER, 'guards', 100)], roster({ denarii: 10000, guards: 500 }), PLAYER);
    expect(only(many.deltas, `${PLAYER}:guards`)[0].delta).toBe(50);
  });

  it('lets a levy through when coin was spent or borrowed for it', () => {
    const bought = guardEconomy([resource(PLAYER, 'troops', 200), resource(PLAYER, 'denarii', -12000)], roster(), PLAYER);
    expect(only(bought.deltas, `${PLAYER}:troops`)[0].delta).toBe(200);

    const borrowed = guardEconomy([resource(PLAYER, 'troops', 200), resource(PLAYER, 'debt_denarii', 12000)], roster(), PLAYER);
    expect(only(borrowed.deltas, `${PLAYER}:troops`)[0].delta).toBe(200);
    expect([...bought.notes, ...borrowed.notes]).toEqual([]);
  });
});

describe('economyGuard - what it never touches', () => {
  it('losses of any size, NPC gains of any size, and undeclared keys pass through', () => {
    const { deltas: out, notes } = guardEconomy([
      resource(PLAYER, 'denarii', -50000, 'A ruinous donative.'),
      resource(PLAYER, 'troops', -300, 'Mutiny.'),
      resource(NPC, 'denarii', 1_000_000, 'Magnus inherits.'),
      resource(NPC, 'troops', 5000, 'Magnus raises a private army.'),
      resource(PLAYER, 'grain_modii', 5000, 'A granary seized.'),
    ], roster(), PLAYER);

    expect(out.map(delta => delta.delta)).toEqual([-50000, -300, 1_000_000, 5000, 5000]);
    expect(notes).toEqual([]);
  });
});
