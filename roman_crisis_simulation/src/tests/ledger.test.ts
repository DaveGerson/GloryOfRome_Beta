/**
 * tests/ledger.test.ts
 *
 * The weekly ledger (DESIGN_DECISIONS.md D46, ai/core/ledger.ts): the one
 * place the engine does arithmetic on the player's holdings between turns.
 * Pins the order of the week (levies, yields, wages, interest, back pay,
 * regeneration, drift), the arithmetic of each step, the teeth (arrears
 * erode standing and then men desert; interest capitalises when the
 * treasury cannot service it; creditors press once), the player-only rule
 * (D5/D6), purity, and the two things a healthy week must NOT do: raise a
 * Report or write a line that names a GM-private marker.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENTS_FOR_WEEKLY_REGEN,
  ARREARS_SUPPORT_EROSION,
  ARREARS_SUPPORT_EROSION_DEEP,
  CREDITORS_PRESS_THRESHOLD,
  DEBT_INTEREST_MINIMUM,
  INVESTIGATION_CAP_BASE,
  INVESTIGATION_CAP_MAX,
  INVESTIGATION_TRICKLE_WEEKS,
  applyWeeklyLedger,
  creditorsPress,
  investigationCap,
  projectWeeklyCoinFlow,
  runwayWeeks,
  weeklyInterest,
} from '../ai/core/ledger';
import { ESTATE_YIELD_PER_WEEK, GUARD_PAY_PER_WEEK, AGENT_PAY_PER_WEEK, ResourceBag } from '../ai/core/resourceRegistry';
import type { Entity, SimulationState } from '../types';
import { makeEntity, makeSimulationState } from './factories';

const PLAYER = 'severus_alexander';
const NPC = 'maximinus_thrax';

function roster(bag: ResourceBag): Entity[] {
  return [
    makeEntity({ entity_id: NPC, name: 'Maximinus Thrax', resources: { denarii: 15000, legion_support: 85 } }),
    makeEntity({ entity_id: PLAYER, name: 'Severus Alexander', resources: structuredClone(bag) }),
  ];
}

/** Closes one week for a player holding `bag`; a Loyal/Stable/Functional/Uneasy week unless told otherwise. */
function close(bag: ResourceBag, options: { turnNumber?: number; sim?: Partial<SimulationState> } = {}) {
  const entities = roster(bag);
  const result = applyWeeklyLedger({
    entities,
    playerId: PLAYER,
    turnNumber: options.turnNumber ?? 1,
    simulationState: makeSimulationState(options.sim),
  });
  const player = result.entities.find(entity => entity.entity_id === PLAYER)!;
  return { ...result, player, bag: player.resources as ResourceBag, input: entities };
}

describe('ledger - the order of the week and its arithmetic', () => {
  it('books yields before wages so the estates pay the guards (income, then upkeep)', () => {
    const week = close({ denarii: 50000, estates: 2, guards: 150 });

    expect(week.lines.map(line => line.kind)).toEqual(['income', 'upkeep']);
    expect(week.lines[0]).toMatchObject({ key: 'denarii', amount: 2 * ESTATE_YIELD_PER_WEEK });
    expect(week.lines[0].text).toBe('Your 2 estates return 1,200 denarii.');
    expect(week.lines[1]).toMatchObject({ key: 'denarii', amount: -150 * GUARD_PAY_PER_WEEK });
    expect(week.lines[1].text).toBe('Your treasury pays out 1,800 denarii - the week\'s wages for 150 guards.');
    expect(week.bag.denarii).toBe(50000 + 1200 - 1800);
    expect(week.bag.pay_arrears).toBeUndefined();
  });

  it('a healthy week raises no Report and writes exactly one [Ledger] GM note that no line echoes', () => {
    const week = close({ denarii: 50000, estates: 2, guards: 150, agents: 3 });

    expect(week.reports).toEqual([]);
    expect(week.gmNotes).toEqual([
      '[Ledger] Week closed: net -645 denarii across 3 lines; treasury 49,355, debt 0, wages owed 0.',
    ]);
    for (const line of week.lines) {
      expect(line.text).not.toContain('[Ledger]');
      expect(line.detail ?? '').not.toContain('[Ledger]');
    }
  });

  it('agrees with projectWeeklyCoinFlow to the denarius when the treasury can pay', () => {
    const bag: ResourceBag = { denarii: 20000, estates: 1, ships: 2, workshops: 3, troops: 40, guards: 10, agents: 3, debt_denarii: 4000 };
    const flow = projectWeeklyCoinFlow(bag);
    const week = close(bag);
    const booked = week.lines.filter(line => line.key === 'denarii').reduce((sum, line) => sum + line.amount, 0);

    expect(booked).toBe(flow.net);
    expect(week.bag.denarii).toBe(20000 + flow.net);
  });

  it('lands levies raised at the exchequer as troops and retires the mustering key', () => {
    const week = close({ denarii: 10000, troops: 5, levy_pending: 20 });

    expect(week.lines[0]).toMatchObject({ kind: 'levy', key: 'troops', amount: 20 });
    expect(week.bag.troops).toBe(25);
    expect('levy_pending' in week.bag).toBe(false);
    // The arrived men draw this week's wages already.
    expect(week.bag.denarii).toBe(10000 - 25 * 8);
  });

  it('rounds every written figure to a whole unit', () => {
    const week = close({ denarii: 100.4, estates: 1 });
    expect(Number.isInteger(week.bag.denarii)).toBe(true);
  });
});

describe('ledger - unpaid wages have teeth', () => {
  it('pays what it can, books the shortfall as back pay, and reports it through your own paymaster', () => {
    const week = close({ denarii: 1000, guards: 150 });

    expect(week.lines.map(line => line.kind)).toEqual(['upkeep', 'arrears']);
    expect(week.lines[0]).toMatchObject({ key: 'denarii', amount: -1000 });
    expect(week.lines[1]).toMatchObject({ key: 'pay_arrears', amount: 800 });
    expect(week.bag.denarii).toBe(0);
    expect(week.bag.pay_arrears).toBe(800);
    expect(week.reports).toHaveLength(1);
    expect(week.reports[0]).toMatchObject({ source: 'messenger', about: PLAYER, turn: 1, credibility: 1.0 });
    expect(week.reports[0].claim).toContain('800 denarii of wages unpaid this week');
    expect(week.reports[0].claim).toContain('owed 800 in all');
  });

  it('erodes legion support a little while any back pay stands, and more once it exceeds a week\'s wages', () => {
    // Shallow: 500 owed against 1,800 due a week.
    const shallow = close({ denarii: 5000, guards: 150, pay_arrears: 500, legion_support: 50 });
    const shallowDrift = shallow.lines.find(line => line.kind === 'drift' && line.key === 'legion_support');
    expect(shallowDrift?.amount).toBe(-ARREARS_SUPPORT_EROSION);
    expect(shallow.bag.legion_support).toBe(50 - ARREARS_SUPPORT_EROSION);
    expect(shallow.lines.some(line => line.kind === 'desertion')).toBe(false);

    // Deep: 1,900 owed against 1,800 due - but still short of two weeks' pay.
    const deep = close({ denarii: 5000, guards: 150, pay_arrears: 1900, legion_support: 50 });
    const deepDrift = deep.lines.find(line => line.kind === 'drift' && line.key === 'legion_support');
    expect(deepDrift?.amount).toBe(-ARREARS_SUPPORT_EROSION_DEEP);
    expect(deep.lines.some(line => line.kind === 'desertion')).toBe(false);
  });

  it('does not invent a legion standing for a player who never held one', () => {
    const week = close({ denarii: 0, guards: 150, pay_arrears: 900 });
    expect('legion_support' in week.bag).toBe(false);
    expect(week.lines.some(line => line.key === 'legion_support')).toBe(false);
  });

  it('once back pay reaches two weeks\' wages a twentieth of the men slip away, with a report from the morning count', () => {
    // Wages due: 100 troops x 8 + 20 guards x 12 = 1,040 a week; 5,000 owed is nearly five weeks.
    const week = close({ denarii: 0, troops: 100, guards: 20, pay_arrears: 5000, legion_support: 50 });

    expect(week.lines.map(line => line.kind)).toEqual(['arrears', 'drift', 'desertion', 'desertion']);
    expect(week.bag.pay_arrears).toBe(5000 + 1040);
    expect(week.bag.legion_support).toBe(50 - ARREARS_SUPPORT_EROSION_DEEP);
    expect(week.lines[2]).toMatchObject({ key: 'troops', amount: -5 });
    expect(week.lines[3]).toMatchObject({ key: 'guards', amount: -1 });
    expect(week.bag.troops).toBe(95);
    expect(week.bag.guards).toBe(19);
    expect(week.reports.map(report => report.source)).toEqual(['messenger', 'messenger']);
    expect(week.reports[1].claim).toContain('men missing at the morning count');
  });
});

describe('ledger - debt', () => {
  it('services interest from the treasury when it can, after the men are paid', () => {
    const week = close({ denarii: 1000, debt_denarii: 4000 });

    expect(week.lines).toEqual([expect.objectContaining({ kind: 'interest', key: 'denarii', amount: -200 })]);
    expect(week.bag.denarii).toBe(800);
    expect(week.bag.debt_denarii).toBe(4000);
    expect(week.reports).toEqual([]);
  });

  it('capitalises interest the treasury cannot pay, and reports once when the debt crosses the creditors\' threshold', () => {
    const first = close({ denarii: 100, debt_denarii: 9900 });

    expect(first.lines).toEqual([expect.objectContaining({ kind: 'interest', key: 'debt_denarii', amount: 495 })]);
    expect(first.bag.denarii).toBe(100);
    expect(first.bag.debt_denarii).toBe(9900 + 495);
    expect(first.reports).toHaveLength(1);
    expect(first.reports[0]).toMatchObject({ source: 'merchant', about: PLAYER });
    expect(first.reports[0].claim).toContain(`passed ${CREDITORS_PRESS_THRESHOLD.toLocaleString('en-US')} denarii`);
    expect(creditorsPress(first.bag)).toBe(true);

    // Already past the threshold: the debt keeps compounding, the report does not repeat.
    const second = close(first.bag, { turnNumber: 2 });
    expect(second.bag.debt_denarii).toBe(10395 + Math.round(10395 * 0.05));
    expect(second.reports).toEqual([]);
  });

  it('charges the minimum on a small debt so it never rounds to nothing', () => {
    const week = close({ denarii: 1000, debt_denarii: 200 });
    expect(week.lines[0]).toMatchObject({ kind: 'interest', amount: -DEBT_INTEREST_MINIMUM });
    expect(week.bag.denarii).toBe(1000 - DEBT_INTEREST_MINIMUM);
  });

  it('weeklyInterest, runwayWeeks and creditorsPress read as the Assets tab reads them', () => {
    expect(weeklyInterest(0)).toBe(0);
    expect(weeklyInterest(200)).toBe(DEBT_INTEREST_MINIMUM);
    expect(weeklyInterest(4000)).toBe(200);
    expect(runwayWeeks(50000, -645)).toBe(77);
    expect(runwayWeeks(1000, 0)).toBe(Infinity);
    expect(runwayWeeks(1000, 250)).toBe(Infinity);
    expect(runwayWeeks(0, -10)).toBe(0);
    expect(creditorsPress({ debt_denarii: CREDITORS_PRESS_THRESHOLD - 1 })).toBe(false);
    expect(creditorsPress({ debt_denarii: CREDITORS_PRESS_THRESHOLD })).toBe(true);
  });
});

describe('ledger - investigations regenerate toward the agents-driven ceiling', () => {
  it('investigationCap grows by one per three agents from a base of two, to a ceiling of eight', () => {
    expect(investigationCap({})).toBe(INVESTIGATION_CAP_BASE);
    expect(investigationCap({ agents: 2 })).toBe(INVESTIGATION_CAP_BASE);
    expect(investigationCap({ agents: 3 })).toBe(INVESTIGATION_CAP_BASE + 1);
    expect(investigationCap({ agents: 12 })).toBe(INVESTIGATION_CAP_BASE + 4);
    expect(investigationCap({ agents: 100 })).toBe(INVESTIGATION_CAP_MAX);
  });

  it('with three agents in your pay an investigation returns every week', () => {
    const week = close({ denarii: 1000, agents: AGENTS_FOR_WEEKLY_REGEN, investigations: 0 }, { turnNumber: 1 });
    const regen = week.lines.find(line => line.kind === 'regen');
    expect(regen).toMatchObject({ key: 'investigations', amount: 1 });
    expect(regen?.text).toContain('Your agents open a fresh line of inquiry');
    expect(week.bag.investigations).toBe(1);
  });

  it('without agents an investigation returns only on the trickle, every third week', () => {
    expect(close({ investigations: 0 }, { turnNumber: 2 }).lines.some(line => line.kind === 'regen')).toBe(false);
    const trickle = close({ investigations: 0 }, { turnNumber: INVESTIGATION_TRICKLE_WEEKS });
    expect(trickle.lines.find(line => line.kind === 'regen')?.text).toContain('A quiet contact resurfaces');
    expect(trickle.bag.investigations).toBe(1);
  });

  it('never regenerates past the ceiling, and never creates the key for a player with neither agents nor investigations', () => {
    const atCap = close({ agents: 3, investigations: 3, denarii: 1000 }, { turnNumber: 3 });
    expect(atCap.lines.some(line => line.kind === 'regen')).toBe(false);
    expect(atCap.bag.investigations).toBe(3);

    const none = close({ denarii: 1000 }, { turnNumber: 3 });
    expect('investigations' in none.bag).toBe(false);
  });
});

describe('ledger - standing drifts under the crisis, only where a standing is held', () => {
  it('applies each drift rule that the week\'s crisis triggers, clamped at the floor, with no line for a no-op', () => {
    const week = close(
      { legion_support: 10, popular_support: 1, legitimacy: 0, senatorial_support: 50 },
      { sim: { military_status: 'Divided', plebeian_mood: 'Rioting', imperial_status: 'Contested', senate_status: 'Deposed' } },
    );
    const drift = week.lines.filter(line => line.kind === 'drift');

    expect(drift.map(line => [line.key, line.amount])).toEqual([
      ['legion_support', -1],
      ['popular_support', -1], // 1 -> 0: the clamp trims the -2 rule to what actually applied
      ['senatorial_support', -2],
    ]);
    expect(week.bag.legitimacy).toBe(0); // already at the floor: no line, no negative
    expect('military_might' in week.bag).toBe(false);
  });

  it('is quiet while the crisis is quiet', () => {
    const week = close({ legion_support: 40, legitimacy: 60 }, { sim: { military_status: 'Loyal', imperial_status: 'Stable' } });
    expect(week.lines).toEqual([]);
    expect(week.gmNotes).toEqual([]);
  });
});

describe('ledger - the player only, and pure', () => {
  it('folds legacy aliases in the player\'s bag lazily and says so GM-side', () => {
    const week = close({ gold: 500, denarii: 100 });
    expect(week.bag).toEqual({ denarii: 600 });
    expect(week.gmNotes[0]).toBe("[Ledger] Folded 'gold' -> 'denarii' in the player's holdings.");
  });

  it('never touches another entity\'s bag and never mutates its input (D5/D6)', () => {
    const bag: ResourceBag = { denarii: 50000, estates: 2, guards: 150 };
    const week = close(bag);
    const inputPlayer = week.input.find(entity => entity.entity_id === PLAYER)!;
    const inputNpc = week.input.find(entity => entity.entity_id === NPC)!;

    expect(inputPlayer.resources).toEqual(bag);
    expect(week.player).not.toBe(inputPlayer);
    expect(week.entities.find(entity => entity.entity_id === NPC)).toBe(inputNpc);
    expect(inputNpc.resources).toEqual({ denarii: 15000, legion_support: 85 });
  });

  it('passes a roster without the player straight through', () => {
    const entities = roster({ denarii: 1 }).slice(0, 1);
    const result = applyWeeklyLedger({ entities, playerId: PLAYER, turnNumber: 1, simulationState: makeSimulationState() });
    expect(result.entities).toBe(entities);
    expect(result.lines).toEqual([]);
    expect(result.reports).toEqual([]);
    expect(result.gmNotes).toEqual([]);
  });
});

describe('ledger - projectWeeklyCoinFlow', () => {
  it('itemises yields and wages per canonical kind, charges interest, and nets them', () => {
    const flow = projectWeeklyCoinFlow({ estates: 2, guards: 150, agents: 3, debt_denarii: 4000, grain_reserve: 900 });

    expect(flow.income).toEqual([{ key: 'estates', label: 'Estates', count: 2, perUnit: ESTATE_YIELD_PER_WEEK, total: 1200 }]);
    expect(flow.upkeep).toEqual([
      { key: 'guards', label: 'Guards', count: 150, perUnit: GUARD_PAY_PER_WEEK, total: 1800 },
      { key: 'agents', label: 'Agents', count: 3, perUnit: AGENT_PAY_PER_WEEK, total: 45 },
    ]);
    expect(flow.interest).toBe(200);
    expect(flow.net).toBe(1200 - 1845 - 200);
  });

  it('is empty for a bag with nothing that yields or draws', () => {
    expect(projectWeeklyCoinFlow({ denarii: 500, legion_support: 40 })).toEqual({
      income: [], upkeep: [], interest: 0, incomeTotal: 0, upkeepTotal: 0, net: 0,
    });
  });
});
