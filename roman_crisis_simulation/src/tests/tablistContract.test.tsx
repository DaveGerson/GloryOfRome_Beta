/**
 * @vitest-environment jsdom
 *
 * The tablist contract (spec: docs/superpowers/specs/2026-08-05-b7a-
 * hardening-and-tablist-design.md, work item 2), covering BOTH bars that
 * genuinely control panels: SidePanel's dashboard (7 tabs) and
 * GameMasterScreen's ledger views (11 tabs). Both declare role="tablist"/
 * role="tab" with aria-selected only — the ruling of record says complete
 * the contract, not drop the roles (unlike the sub-rails, which are filters
 * and were converted to aria-pressed toggle groups).
 *
 * What "complete" means, pinned here:
 *  - roving tabindex: exactly one tab with tabIndex=0 per bar, the selected
 *    one — today every native <button> tab is its own tab stop;
 *  - automatic activation: ArrowRight/ArrowLeft move focus AND selection
 *    (both asserted), Home/End jump to the extremes, and the ends WRAP —
 *    pinned to what ui/rovingRadio.ts already does for the radiogroups
 *    ("a ring, not a list"), because the helper is to be generalized, not
 *    forked into a second behavior;
 *  - aria-controls: every tab names the bar's ONE tabpanel (one panel whose
 *    content swaps is the ruling), which exists, carries role="tabpanel",
 *    no tabindex (both panels hold focusable content), and is labelled by
 *    the ACTIVE tab via aria-labelledby;
 *  - the sub-rails are untouched: aria-pressed toggle buttons that never
 *    gained role="tab".
 *
 * Contracts these tests set (the spec leaves the node shapes open):
 *  - the two tablists keep their existing accessible names, "Intelligence
 *    dashboard" and "Ledger views" — they are the locators here;
 *  - each tab button carries a stable, unique, non-empty `id` (the panel's
 *    aria-labelledby has to point at something);
 *  - the keyboard handler is bound on the tablist container (the
 *    rovingRadio idiom: the handler reads its options out of
 *    event.currentTarget), so a keydown dispatched on the tablist reaches it.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom only, no testing-library; keys are dispatched on the group
 * element exactly as the radiogroup tests do.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import SidePanel from '../components/SidePanel';
import GameMasterScreen from '../components/GameMasterScreen';
import { GameState } from '../types';
import type { Entity, SimulationState, WorldState } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';
import type { GoogleGenAI } from '@google/genai';
import type { TabId } from '../perception/visibility';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

beforeEach(() => {
  // getTabRegister/setTabRegister persist sub-register choices; each test
  // starts from the default registers.
  localStorage.clear();
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  localStorage.clear();
});

const worldState: WorldState = {
  year: 235,
  week: 3,
  economic_stability: 'stable',
  political_climate: 'tense',
  regions: {},
};

const simulationState: SimulationState = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Loyal',
  plebeian_mood: 'Uneasy',
  major_ongoing_crisis: null,
};

function makePlayer(): Entity {
  return {
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    // Real resources, so the Assets tab renders its SubRail — the untouched
    // aria-pressed surface the guard below must not find vacuously absent.
    resources: { denarii: 120, investigations: 2, legion_support: 60 },
    visibility_network: [],
    current_state_narrative: 'The young emperor holds a fraying court.',
    short_term_goals: [],
    long_term_ambitions: [],
  };
}

const runDomainMutation: RunDomainMutation = async work =>
  ({ acquired: true, value: await work({ isCurrent: () => true }) });

async function mountSidePanel(): Promise<HTMLElement> {
  const player = makePlayer();
  return mount(
    <SidePanel
      gameState={GameState.AWAITING_PLAYER_INPUT}
      playerEntity={player}
      entities={[player]}
      currentEvents={[]}
      worldState={worldState}
      simulationState={simulationState}
      reports={[]}
      knowledge={[]}
      turnNumber={3}
      onSpendDeepAnalysis={vi.fn()}
      onInvestigationOutcome={vi.fn(async () => {})}
      onExchange={vi.fn()}
      runDomainMutation={runDomainMutation}
      ai={{} as GoogleGenAI}
      isMockMode
      eventHistory={[]}
      turnHistory={[]}
      pulsingTabs={new Set<TabId>()}
      onOccurrenceFinding={vi.fn()}
    />,
  );
}

async function mountGmScreen(): Promise<HTMLElement> {
  return mount(
    <GameMasterScreen
      history={[]}
      onClose={() => {}}
      interventionText=""
      onSetIntervention={() => {}}
      playerCharacterId={null}
      worldState={worldState}
      turnNumber={1}
    />,
  );
}

interface Bar {
  name: string;
  label: string;
  tabCount: number;
  mount: () => Promise<HTMLElement>;
}

const BARS: Bar[] = [
  { name: 'the dashboard bar (SidePanel)', label: 'Intelligence dashboard', tabCount: 7, mount: mountSidePanel },
  { name: "the GM console bar (GameMasterScreen)", label: 'Ledger views', tabCount: 11, mount: mountGmScreen },
];

function tablistOf(container: HTMLElement, label: string): HTMLElement {
  const tablist = container.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`);
  expect(tablist, `the "${label}" tablist`).not.toBeNull();
  return tablist!;
}

function tabsOf(tablist: HTMLElement): HTMLElement[] {
  return Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function tabAt(tablist: HTMLElement, index: number): HTMLElement {
  const tabs = tabsOf(tablist);
  const tab = index < 0 ? tabs[tabs.length + index] : tabs[index];
  expect(tab, `tab at index ${index}`).toBeDefined();
  return tab;
}

function selectedTab(tablist: HTMLElement): HTMLElement {
  const selected = tabsOf(tablist).filter(tab => tab.getAttribute('aria-selected') === 'true');
  expect(selected, 'exactly one selected tab').toHaveLength(1);
  return selected[0];
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

/** Keys land on the tablist itself — the rovingRadio idiom these bars adopt. */
async function press(tablist: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

for (const bar of BARS) {
  describe(`the tablist contract — ${bar.name}`, () => {
    it('keeps exactly one tab in the tab order: the selected one, and the stop follows the selection', async () => {
      const container = await bar.mount();
      const tablist = tablistOf(container, bar.label);
      const tabs = tabsOf(tablist);
      expect(tabs).toHaveLength(bar.tabCount);

      // Roving tabindex: one stop, on the selected tab — not one per tab,
      // which is what a bar of native buttons degrades to.
      const stops = tabs.filter(tab => tab.tabIndex === 0);
      expect(stops, 'exactly one tabIndex=0 in the tablist').toHaveLength(1);
      expect(stops[0]).toBe(selectedTab(tablist));

      await click(tabAt(tablist, 2));
      const after = tabsOf(tablist).filter(tab => tab.tabIndex === 0);
      expect(after, 'the single tab stop follows the selection').toHaveLength(1);
      expect(after[0]).toBe(tabAt(tablist, 2));
      expect(after[0]).toBe(selectedTab(tablist));
    });

    it('moves selection AND focus with the arrows, wrapping at the ends like the radios', async () => {
      const container = await bar.mount();
      const tablist = tablistOf(container, bar.label);
      expect(selectedTab(tablist)).toBe(tabAt(tablist, 0));

      // Automatic activation: the arrow both selects and focuses.
      await press(tablist, 'ArrowRight');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, 1));
      expect(document.activeElement).toBe(tabAt(tablist, 1));

      await press(tablist, 'ArrowLeft');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, 0));
      expect(document.activeElement).toBe(tabAt(tablist, 0));

      // Wrap pinned to the radio behavior the generalized helper carries
      // over: a ring, not a list (ui/rovingRadio.ts, one behavior kept).
      await press(tablist, 'ArrowLeft');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, -1));
      expect(document.activeElement).toBe(tabAt(tablist, -1));

      await press(tablist, 'ArrowRight');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, 0));
      expect(document.activeElement).toBe(tabAt(tablist, 0));
    });

    it('jumps to the extremes with Home and End, selecting as it goes', async () => {
      const container = await bar.mount();
      const tablist = tablistOf(container, bar.label);

      await press(tablist, 'End');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, -1));
      expect(document.activeElement).toBe(tabAt(tablist, -1));

      await press(tablist, 'Home');
      expect(selectedTab(tablist)).toBe(tabAt(tablist, 0));
      expect(document.activeElement).toBe(tabAt(tablist, 0));
    });

    it('gives every tab an aria-controls that names the one tabpanel, labelled by the active tab', async () => {
      const container = await bar.mount();
      const tablist = tablistOf(container, bar.label);

      // One panel element per bar whose content swaps — the ruling of
      // record — and panels take no tabindex (both have focusable content).
      const panels = container.querySelectorAll('[role="tabpanel"]');
      expect(panels, 'exactly one tabpanel per bar').toHaveLength(1);
      const panel = panels[0];
      expect(panel.hasAttribute('tabindex'), 'the tabpanel takes no tabindex').toBe(false);

      for (const tab of tabsOf(tablist)) {
        await click(tab);
        const label = tab.textContent?.trim() || tab.getAttribute('aria-label');
        const controls = tab.getAttribute('aria-controls');
        expect(controls, `aria-controls on the "${label}" tab`).toBeTruthy();
        expect(document.getElementById(controls!), `the element "${label}" claims to control`).toBe(panel);
        // The id/labelledby pair tracks the ACTIVE tab across the swap.
        expect(tab.id, `a stable id on the "${label}" tab`).toBeTruthy();
        expect(panel.getAttribute('aria-labelledby'), `the panel is labelled by "${label}" while it is active`).toBe(tab.id);
      }
    });
  });
}

describe('the sub-rails are untouched (the conversion of record stands)', () => {
  it('keeps the register switches aria-pressed toggle buttons — none gained role="tab"', async () => {
    const container = await mountSidePanel();
    const tablist = tablistOf(container, 'Intelligence dashboard');

    // Open Assets, whose SubRail is a register switch the tablist ruling
    // explicitly does NOT cover (filters, not panels — see ui/SubRail.tsx).
    const assets = tabsOf(tablist).find(tab => tab.getAttribute('aria-label') === 'Assets');
    expect(assets, 'the Assets tab').toBeDefined();
    await click(assets!);

    const pressed = Array.from(container.querySelectorAll('[aria-pressed]'));
    expect(pressed.length, 'the sub-rail is on screen (the guard is not vacuous)').toBeGreaterThan(0);
    expect(pressed.filter(el => el.getAttribute('role') === 'tab')).toHaveLength(0);

    // And the tab census is exactly the bar's own: no second tablist crept
    // back inside a panel, which is what made every button[role="tab"]
    // sweep ambiguous before the conversion.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(7);
  });
});
