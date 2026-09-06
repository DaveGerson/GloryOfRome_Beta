/**
 * @vitest-environment jsdom
 *
 * The Assets tab as a LEDGER (DESIGN_DECISIONS.md D46; D44's rules, D45's
 * zero states): five registers, hero figures Arabic and tabular, week
 * counts Roman, this week's engine lines beside the player's OWN dealings
 * (never another entity's, D5), next week's projection with a runway, the
 * inventory with provenance, and the exchequer (BACKLOG B1) committing one
 * bargain through the App's handler.
 *
 * House style: React 19 act() + react-dom/client only, no testing-library;
 * fixture vocabulary from tests/factories.ts.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import ResourcesTab, { runwayLine } from '../components/tabs/ResourcesTab';
import type { RunDomainMutation } from '../state/domainMutation';
import type { Entity, LedgerLine, TurnHistoryEntry } from '../types';
import { makeAdjudication, makeEntity, makeTurnHistoryEntry } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAYER = 'severus_alexander';

const WEEK_LINES: LedgerLine[] = [
  { kind: 'income', key: 'denarii', amount: 1200, text: 'Your 2 estates return 1,200 denarii.', detail: 'estates 2 x 600' },
  { kind: 'upkeep', key: 'denarii', amount: -1845, text: "Your treasury pays out 1,845 denarii - the week's wages for 150 guards and 3 agents.", detail: 'guards 150 x 12, agents 3 x 15' },
  { kind: 'regen', key: 'investigations', amount: 1, text: 'Your agents open a fresh line of inquiry; you may pursue one more investigation.' },
];

function severus(overrides: Entity['resources'] = {}): Entity {
  return makeEntity({
    entity_id: PLAYER,
    name: 'Severus Alexander',
    resources: {
      denarii: 49355, investigations: 1, deep_analyses: 4, guards: 150, agents: 3, estates: 2,
      legion_support: 34, legitimacy: 62, favors: 2,
      blackmail_on_maximinus_thrax: ['He forged the will.'],
      holding_villa_at_baiae: 1,
      ...overrides,
    },
  });
}

const history: TurnHistoryEntry[] = [
  makeTurnHistoryEntry({ turnNumber: 1, adjudication: makeAdjudication({ turn: 1 }) }),
  makeTurnHistoryEntry({
    turnNumber: 2,
    adjudication: makeAdjudication({
      turn: 2,
      deltas: [{ type: 'resource', key: `${PLAYER}:holding_villa_at_baiae`, delta: 1, reason: 'A grateful senator signs over his villa at Baiae.' }],
    }),
    ledger: [WEEK_LINES[0], WEEK_LINES[1]],
  }),
  makeTurnHistoryEntry({
    turnNumber: 3,
    adjudication: makeAdjudication({
      turn: 3,
      deltas: [
        { type: 'resource', key: `${PLAYER}:denarii`, delta: -2000, reason: 'Coin to the prefects.' },
        { type: 'resource', key: 'maximinus_thrax:denarii', delta: 5000, reason: 'Thrax loots a town.' },
      ],
    }),
    ledger: WEEK_LINES,
  }),
];

/** A domain-mutation runner that always acquires and reports the handler's own result. */
const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

async function setValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function railButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Assets register"] button'))
    .find(candidate => candidate.textContent?.startsWith(label));
  expect(button, `register button "${label}"`).toBeDefined();
  return button!;
}

function byAriaLabel<T extends Element>(container: HTMLElement, label: string): T {
  const element = container.querySelector(`[aria-label="${label}"]`);
  expect(element, `element with aria-label="${label}"`).not.toBeNull();
  return element as T;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  localStorage.clear();
});

describe('ResourcesTab - the ledger register', () => {
  it('opens on the ledger with the hero figures Arabic and tabular, investigations against their ceiling', async () => {
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    const text = container.textContent ?? '';

    expect(railButton(container, 'Ledger').getAttribute('aria-pressed')).toBe('true');
    expect(text).toContain('Denarii');
    expect(text).toContain('49,355');
    expect(text).toContain('Deep analyses');
    expect(text).toContain('1 of 3'); // three agents raise the ceiling from two to three
  });

  it("books this week: the engine's lines with signed amounts, the player's OWN dealings, and the net", async () => {
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Week III — the books');
    expect(text).toContain('Your 2 estates return 1,200 denarii.');
    expect(text).toContain('+1,200');
    expect(text).toContain('−1,845');
    expect(text).toContain('Your dealings');
    expect(text).toContain('“Coin to the prefects.”');
    expect(text).toContain('−2,000');
    // Net across lines and dealings: 1,200 - 1,845 - 2,000.
    expect(text).toContain('−2,645');
    // Another man's purse is never on this page (D5).
    expect(text).not.toContain('Thrax loots a town.');
    expect(text).not.toContain('5,000');
  });

  it('projects next week from the bag as it stands and states the runway in Roman weeks', async () => {
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    const projection = byAriaLabel<HTMLElement>(container, "Next week's projection").textContent ?? '';

    expect(projection).toContain('Next week, at this rate');
    expect(projection).toContain('Estates');
    expect(projection).toContain('2 × 600');
    expect(projection).toContain('Guards');
    expect(projection).toContain('150 × 12');
    expect(projection).toContain('−1,800');
    expect(projection).toContain('Agents');
    expect(projection).toContain('−45');
    expect(projection).toContain('−645');
    expect(projection).toContain('Projected treasury');
    expect(projection).toContain('48,710');
    // floor(49,355 / 645) = 76 weeks - ceremony Roman, arithmetic Arabic (D44).
    expect(projection).toContain('At this rate your treasury lasts LXXVI weeks.');
  });

  it('names the cause in both zero states (D45): a fresh reign, and a week in which nothing was booked', async () => {
    const fresh = await mount(<ResourcesTab playerEntity={severus()} turnHistory={[]} turnNumber={1} />);
    expect(fresh.textContent).toContain('The steward opens the books at Week I.');

    const quiet = await mount(<ResourcesTab playerEntity={severus()} turnHistory={[history[0]]} turnNumber={2} />);
    expect(quiet.textContent).toContain('Nothing was booked this week.');
    expect(quiet.textContent).not.toContain('Your dealings');
  });

  it('raises the debt and back-pay notices as status, never as alerts, with the figures the ledger will charge', async () => {
    const container = await mount(
      <ResourcesTab playerEntity={severus({ denarii: 100, debt_denarii: 12000, pay_arrears: 645 })} turnHistory={history} turnNumber={4} />,
    );
    const statuses = Array.from(container.querySelectorAll('[role="status"]')).map(node => node.textContent ?? '');

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(statuses.some(status => status.includes('Your creditors press'))).toBe(true);
    expect(statuses.some(status => status.includes('You owe 12,000 denarii. Next week takes 600 in interest'))).toBe(true);
    expect(statuses.some(status => status.includes('the treasury cannot pay it'))).toBe(true);
    expect(statuses.some(status => status.includes('Your men are owed'))).toBe(true);
    expect(statuses.some(status => status.includes('645 denarii of wages stand unpaid'))).toBe(true);
    expect(statuses.some(status => status.includes('at II weeks’ pay they begin to desert'))).toBe(true);
    // Debt and back pay join the hero well, in crimson, only when they exist.
    expect(container.textContent).toContain('Debt');
    expect(container.textContent).toContain('Wages owed');
  });
});

describe('ResourcesTab - runwayLine (D44: ceremony Roman, arithmetic Arabic)', () => {
  it('counts weeks in Roman numerals and never in digits', () => {
    expect(runwayLine(4, -100, 400)).toBe('At this rate your treasury lasts IV weeks.');
    expect(runwayLine(1, -100, 100)).toBe('At this rate your treasury lasts I week.');
    expect(runwayLine(4, -100, 400)).not.toMatch(/\d/);
  });

  it('says level, growing, exhausted, or beyond any reign rather than a meaningless figure', () => {
    expect(runwayLine(Infinity, 0, 100)).toBe('Your treasury holds level from week to week.');
    expect(runwayLine(Infinity, 50, 100)).toBe('Your treasury grows week on week.');
    expect(runwayLine(0, -100, 0)).toBe('Next week’s wages exceed what you hold; the shortfall becomes debt.');
    expect(runwayLine(300, -1, 100000)).toBe('At this rate your treasury outlasts any reign.');
  });
});

describe('ResourcesTab - holdings, standing and leverage registers', () => {
  it('lists men in your pay, property and things held, each with its wage or yield and its provenance', async () => {
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    expect(railButton(container, 'Holdings').textContent).toBe('Holdings4');
    await click(railButton(container, 'Holdings'));
    const text = container.textContent ?? '';

    expect(text).toContain('Men in your pay');
    expect(text).toContain('Guards');
    expect(text).toContain('−12 a week each');
    expect(text).toContain('Agents');
    expect(text).toContain('−15 a week each');
    expect(text).toContain('Property');
    expect(text).toContain('Estates');
    expect(text).toContain('+600 a week each');
    expect(text).toContain('held from the first');
    expect(text).toContain('Things held');
    expect(text).toContain('Villa At Baiae');
    expect(text).toContain('since Week II');
    expect(text).toContain('“A grateful senator signs over his villa at Baiae.”');
    // The chosen register is remembered per device.
    expect(localStorage.getItem('gloryOfRome:tabRegister:resources')).toBe('holdings');
  });

  it('names the empty inventory as a fact about the world', async () => {
    localStorage.setItem('gloryOfRome:tabRegister:resources', 'holdings');
    const container = await mount(<ResourcesTab playerEntity={makeEntity({ entity_id: PLAYER, resources: { denarii: 5 } })} />);
    expect(container.textContent).toContain('You hold no estates, ships or men of your own.');
  });

  it('draws each standing as a meter with the counted value, and names the absence of any', async () => {
    localStorage.setItem('gloryOfRome:tabRegister:resources', 'standing');
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    const meter = byAriaLabel<HTMLElement>(container, 'Legion support');

    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('34');
    expect(byAriaLabel<HTMLElement>(container, 'Legitimacy').getAttribute('aria-valuenow')).toBe('62');

    const none = await mount(<ResourcesTab playerEntity={makeEntity({ entity_id: PLAYER, resources: { denarii: 5 } })} />);
    expect(none.textContent).toContain('No one has measured your standing yet.');
  });

  it('shelves leverage as sealed letters beside the favours owed', async () => {
    localStorage.setItem('gloryOfRome:tabRegister:resources', 'leverage');
    const container = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Favours owed');
    expect(text).toContain('Maximinus Thrax');
    expect(text).toContain('“He forged the will.”');

    const none = await mount(<ResourcesTab playerEntity={makeEntity({ entity_id: PLAYER, resources: { denarii: 5 } })} />);
    expect(none.textContent).toContain('You hold nothing over anyone.');
  });
});

describe('ResourcesTab - the exchequer (B1)', () => {
  beforeEach(() => {
    localStorage.setItem('gloryOfRome:tabRegister:resources', 'exchequer');
  });

  it('offers only the bargains the bag makes sensible, priced from the bag, and says why one is out of reach', async () => {
    const container = await mount(
      <ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} onExchange={vi.fn(() => true)} runDomainMutation={runDomainMutation} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Coin: 49,355 · investigations 1 of 3.');
    for (const offered of ['Hire informants', 'Call in a favour', 'Commission a deep analysis', 'Raise a levy', 'Hire guards', 'Place an agent', 'Sell an estate']) {
      expect(text).toContain(offered);
    }
    for (const withheld of ['Repay your creditors', 'Settle back pay', 'Sell a ship']) {
      expect(text).not.toContain(withheld);
    }
    expect(text).toContain('1,500 denarii → 1 investigations');
    expect(text).toContain('Needs 3 investigations.');
    expect(byAriaLabel<HTMLButtonElement>(container, 'Commission a deep analysis: strike the bargain').disabled).toBe(true);
    expect(byAriaLabel<HTMLButtonElement>(container, 'Hire informants: strike the bargain').disabled).toBe(false);
  });

  it('strikes a bargain through the App handler with the chosen lots and shows the receipt as status', async () => {
    const onExchange = vi.fn(() => true);
    const container = await mount(
      <ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} onExchange={onExchange} runDomainMutation={runDomainMutation} />,
    );

    await setValue(byAriaLabel<HTMLInputElement>(container, 'Hire informants lots'), '2');
    await click(byAriaLabel<HTMLButtonElement>(container, 'Hire informants: strike the bargain'));

    expect(onExchange).toHaveBeenCalledTimes(1);
    expect(onExchange).toHaveBeenCalledWith('hire_informants', 2, expect.objectContaining({ isCurrent: expect.any(Function) }));
    const receipt = Array.from(container.querySelectorAll('[role="status"]')).map(node => node.textContent ?? '');
    expect(receipt).toContain('Struck: 2 investigations for 3,000 denarii.');
  });

  it('clamps the lots field to what the bag and the ceiling allow', async () => {
    const onExchange = vi.fn(() => true);
    const container = await mount(
      <ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} onExchange={onExchange} runDomainMutation={runDomainMutation} />,
    );

    await setValue(byAriaLabel<HTMLInputElement>(container, 'Hire informants lots'), '40');
    await click(byAriaLabel<HTMLButtonElement>(container, 'Hire informants: strike the bargain'));

    // Coin would buy 32; the ceiling (3 with three agents, 1 already held) allows 2.
    expect(onExchange).toHaveBeenCalledWith('hire_informants', 2, expect.anything());
  });

  it('reports a refused commit without pretending the holdings moved', async () => {
    const container = await mount(
      <ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} onExchange={vi.fn(() => false)} runDomainMutation={runDomainMutation} />,
    );

    await click(byAriaLabel<HTMLButtonElement>(container, 'Sell an estate: strike the bargain'));

    expect(container.textContent).toContain('The bargain could not be struck; your holdings are untouched.');
  });

  it('is read-only without a handler, and holds every bargain while the turn is in flight', async () => {
    const closed = await mount(<ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} />);
    expect(closed.textContent).toContain('The exchequer is not open from this view.');
    expect(byAriaLabel<HTMLButtonElement>(closed, 'Hire informants: strike the bargain').disabled).toBe(true);

    const locked = await mount(
      <ResourcesTab playerEntity={severus()} turnHistory={history} turnNumber={4} onExchange={vi.fn(() => true)} runDomainMutation={runDomainMutation} interactionLocked />,
    );
    expect(byAriaLabel<HTMLButtonElement>(locked, 'Hire informants: strike the bargain').disabled).toBe(true);
    expect(byAriaLabel<HTMLInputElement>(locked, 'Hire informants lots').disabled).toBe(true);
  });
});
