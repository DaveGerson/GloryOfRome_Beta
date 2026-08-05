/**
 * @vitest-environment jsdom
 *
 * The three design-pass surfaces a Mock-Mode playthrough cannot show, pinned
 * here instead of eyeballed:
 *
 *  - the Fates' loom (WP-1) only exists while a turn is IN FLIGHT, and Mock
 *    Mode resolves synchronously, so a visual pass never sees it;
 *  - the crisis banner's three volumes (WP-3) need a crisis the simulation
 *    happened not to raise;
 *  - the briefing's crisis alert (WP-15) needs the same.
 *
 * Plus the sub-register persistence contract (WP-14), which is easy to test
 * wrongly by hand: the panel's ACTIVE TAB was never persisted and is out of
 * scope; what persists is each tab's chosen sub-REGISTER.
 *
 * Same house style as turnComposer.test.tsx: React 19 act() + react-dom only,
 * no testing-library.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { TypingIndicator } from '../components/Chat';
import CrisisBanner from '../components/CrisisBanner';
import WorldStateTab from '../components/tabs/WorldStateTab';
import { PrivateScene } from '../components/PrivateScene';
import { Alert } from '../components/ui/Alert';
import { SaveFailureNotice, TurnFailureNotice } from '../components/ui/FailureNotices';
import { getTabRegister, setTabRegister } from '../persistence/uiPrefs';
import { INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import type { SimulationState } from '../types';

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

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("the Fates' loom (WP-1 — invisible to a Mock-Mode playthrough)", () => {
  it('draws seven threads, one per pipeline stage', async () => {
    const container = await mount(<TypingIndicator stage="story_relevance" />);
    expect(container.querySelectorAll('.gor-loom-thread')).toHaveLength(7);
  });

  it('runs the mortality thread — and only that one — in crimson', async () => {
    const container = await mount(<TypingIndicator stage="narration" />);
    const threads = Array.from(container.querySelectorAll('.gor-loom-thread'));
    const fated = threads
      .map((thread, index) => (thread.classList.contains('gor-loom-thread-fated') ? index : -1))
      .filter(index => index >= 0);
    // 'mortality' is the fourth of the seven stages.
    expect(fated).toEqual([3]);
  });

  it('lights exactly as many threads as the pipeline has reached, dimming the woven ones', async () => {
    const container = await mount(<TypingIndicator stage="adjudication" />);
    // story_relevance, npc_minds, adjudication.
    expect(container.querySelectorAll('.gor-loom-fill')).toHaveLength(3);
    expect(container.querySelectorAll('.gor-loom-fill-woven')).toHaveLength(2);
    expect(container.querySelector('.gor-loom-count')?.textContent).toBe('3 of 7');
  });

  it('reads as the first thread before any stage has been reported', async () => {
    const container = await mount(<TypingIndicator />);
    expect(container.querySelectorAll('.gor-loom-fill')).toHaveLength(1);
    expect(container.querySelector('.gor-loom-count')?.textContent).toBe('1 of 7');
  });

  it('keeps the live-region contract the three dots had', async () => {
    const container = await mount(<TypingIndicator stage="monologue" />);
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Your own thoughts gather');
  });
});

describe('the crisis banner in all three volumes (WP-3)', () => {
  it('wears no metal and no glyph as a murmur', async () => {
    const container = await mount(<CrisisBanner crisis="The granaries run low." grade="murmur" />);
    const banner = container.querySelector('.gor-crisis');
    expect(banner?.classList.contains('gor-crisis-murmur')).toBe(true);
    expect(container.querySelectorAll('.gor-crisis-glyph')).toHaveLength(0);
    expect(container.textContent).toContain('A murmur');
  });

  it('keeps the shipped banner exactly as it was at crisis', async () => {
    const container = await mount(<CrisisBanner crisis="Civil war." grade="crisis" />);
    const banner = container.querySelector('.gor-crisis');
    expect(banner?.className).toBe('gor-crisis');
    expect(container.querySelectorAll('.gor-crisis-glyph')).toHaveLength(2);
    expect(container.textContent).toContain('Ongoing Crisis');
  });

  it('doubles its cornice and renames itself at the door', async () => {
    const container = await mount(<CrisisBanner crisis="The Praetorians are at the gate." grade="at_the_door" />);
    expect(container.querySelector('.gor-crisis-atdoor')).not.toBeNull();
    expect(container.querySelectorAll('.gor-crisis-dentil')).toHaveLength(1);
    expect(container.textContent).toContain('At the door');
  });

  it('stays one alert in every volume, so the counts other tests pin cannot drift', async () => {
    for (const grade of ['murmur', 'crisis', 'at_the_door'] as const) {
      const container = await mount(<CrisisBanner crisis="A crisis." grade={grade} />);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    }
  });

  it('renders nothing at all when there is no crisis', async () => {
    const container = await mount(<CrisisBanner crisis={null} />);
    expect(container.textContent).toBe('');
  });
});

const briefingProps = {
  week: 6,
  pointers: [],
  onNavigate: () => {},
};

describe("the week's briefing (WP-15)", () => {
  it('lifts the crisis out of the row list into its own alert', async () => {
    const state: SimulationState = { ...INITIAL_SIMULATION_STATE, major_ongoing_crisis: 'The Praetorians demand a donative.' };
    const container = await mount(<WorldStateTab simulationState={state} {...briefingProps} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The crisis at hand');
    expect(alert?.textContent).toContain('The Praetorians demand a donative.');
  });

  it('shows no alert when Rome is quiet', async () => {
    const state: SimulationState = { ...INITIAL_SIMULATION_STATE, major_ongoing_crisis: null };
    const container = await mount(<WorldStateTab simulationState={state} {...briefingProps} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('owns the four macro cells and nothing else — no regions, no headline list', async () => {
    const container = await mount(<WorldStateTab simulationState={INITIAL_SIMULATION_STATE} {...briefingProps} />);
    expect(container.querySelectorAll('.gor-macro-cell')).toHaveLength(4);
    expect(container.textContent).toContain('The Throne');
    expect(container.textContent).toContain("The week's briefing");
    // The two sections WP-15 deleted, by their own headings.
    expect(container.textContent).not.toContain('Recent Headlines');
    expect(container.textContent).not.toContain('Your Intelligence Picture');
  });

  it('marks a standing that fell this week, and captions why', async () => {
    const container = await mount(
      <WorldStateTab simulationState={INITIAL_SIMULATION_STATE} {...briefingProps} fellThisWeek={new Set(['military_status'])} />,
    );
    expect(container.querySelectorAll('.gor-macro-fell')).toHaveLength(1);
    expect(container.textContent).toContain('marks a standing that fell this week');
  });
});

/**
 * WP-16 and WP-18 each replaced a native control with a grid of cards. The
 * originals were ONE tab stop with arrows to change the selection; these pin
 * that the replacements kept the contract `role="radiogroup"` announces,
 * rather than degrading to "every card is a tab stop".
 */
describe('the doorway keeps its keyboard (WP-16)', () => {
  const targets = [
    { entityId: 'a', displayName: 'Aulus' },
    { entityId: 'b', displayName: 'Balbus' },
    { entityId: 'c', displayName: 'Cato' },
  ];

  async function openDoorway(): Promise<HTMLElement> {
    const container = await mount(
      <PrivateScene
        scenes={[]} currentMacroTurn={3} canStartScene eligibleTargets={targets}
        openingDraft="Come." replyDraft="" lastWordDraft="" loading={false} error={null}
        onOpeningDraftChange={() => {}} onReplyDraftChange={() => {}} onLastWordDraftChange={() => {}}
        onInvite={() => {}} onReply={() => {}} onEnd={() => {}} onLastWord={() => {}} onSkipLastWord={() => {}}
      />,
    );
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Private scene')!.click();
    });
    return container;
  }

  const group = (container: HTMLElement) => container.querySelector<HTMLElement>('[aria-label="Private-scene target"]')!;
  const chosen = (container: HTMLElement) => group(container).querySelector<HTMLElement>('[aria-checked="true"]')?.dataset.entityId;
  const press = async (container: HTMLElement, key: string) => {
    await act(async () => {
      group(container).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  };

  it('keeps exactly one card in the tab order, not one per contact', async () => {
    const container = await openDoorway();
    const cards = Array.from(group(container).querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(cards).toHaveLength(3);
    expect(cards.filter(card => card.tabIndex === 0)).toHaveLength(1);
    expect(cards.find(card => card.tabIndex === 0)?.dataset.entityId).toBe('a');
  });

  it('moves the selection with the arrows, and takes focus with it', async () => {
    const container = await openDoorway();
    await press(container, 'ArrowRight');
    expect(chosen(container)).toBe('b');
    expect((document.activeElement as HTMLElement)?.dataset.entityId).toBe('b');
    await press(container, 'ArrowDown');
    expect(chosen(container)).toBe('c');
  });

  it('wraps at both ends — a radiogroup is a ring, not a list', async () => {
    const container = await openDoorway();
    await press(container, 'ArrowLeft');
    expect(chosen(container)).toBe('c');
    await press(container, 'ArrowRight');
    expect(chosen(container)).toBe('a');
  });

  it('jumps to the extremes with Home and End', async () => {
    const container = await openDoorway();
    await press(container, 'End');
    expect(chosen(container)).toBe('c');
    await press(container, 'Home');
    expect(chosen(container)).toBe('a');
  });

  it('leaves an unrelated key alone', async () => {
    const container = await openDoorway();
    await press(container, 'Tab');
    expect(chosen(container)).toBe('a');
  });
});

describe('the three alert tones (WP-21)', () => {
  it('announces crimson and bronze as alerts, because something failed', async () => {
    for (const tone of ['crimson', 'bronze'] as const) {
      const container = await mount(<Alert tone={tone} title="A title">A message.</Alert>);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    }
  });

  // The defect this fixes: a screen reader announced a SAVED turn as an error.
  it('never announces laurel as an alert, because nothing failed', async () => {
    const container = await mount(<Alert tone="laurel" title="The week is written">Saved.</Alert>);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('keeps crimson the default, so every call site that predates tones is unchanged', async () => {
    const container = await mount(<Alert title="A title">A message.</Alert>);
    const alert = container.querySelector('.gor-alert')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.classList.contains('gor-alert-crimson')).toBe(true);
  });
});

describe('the four turn failures (WP-21)', () => {
  const handlers = {
    onEditTheWeek: () => {},
    onOpenSettings: () => {},
    onEnableMockMode: () => {},
  };

  it('names what happened, what is kept, and what to press — for every kind', async () => {
    const expected = [
      ['transient', 'The couriers were turned back'],
      ['fatal', 'The Fates could not read the omens'],
      ['no_key', 'No token on this device'],
      ['offline', 'No word can leave the city'],
    ] as const;
    for (const [kind, title] of expected) {
      const container = await mount(<TurnFailureNotice failure={{ kind }} {...handlers} />);
      expect(container.textContent).toContain(title);
      // "what is kept" — the clause today's single sentence had, and the
      // only one the player actually needs under a failure.
      expect(container.textContent).toMatch(/kept|untouched|safe/i);
    }
  });

  it('draws the spent attempts rather than describing them', async () => {
    const container = await mount(<TurnFailureNotice failure={{ kind: 'transient' }} {...handlers} />);
    expect(container.querySelectorAll('.gor-pip')).toHaveLength(3);
    expect(container.querySelectorAll('.gor-pip-spent')).toHaveLength(3);
  });

  it("offers the Fates' ledger only where the console is already open", async () => {
    const withoutConsole = await mount(<TurnFailureNotice failure={{ kind: 'fatal' }} {...handlers} />);
    expect(withoutConsole.textContent).not.toContain("Open the Fates' ledger");
    const withConsole = await mount(<TurnFailureNotice failure={{ kind: 'fatal' }} {...handlers} onOpenLedger={() => {}} />);
    expect(withConsole.textContent).toContain("Open the Fates' ledger");
  });
});

describe('the save notice and the half-commit (WP-21)', () => {
  it('names the last safe week in ceremonial numerals and keeps the site’s own sentence', async () => {
    const container = await mount(<SaveFailureNotice lead="Your investigation could not be saved." lastSafeTurn={11} />);
    expect(container.textContent).toContain('Your investigation could not be saved.');
    expect(container.textContent).toContain('Week XI');
    expect(container.querySelector('.gor-alert-title')?.textContent).toBe('The record refuses');
  });

  // The notice deliberately offers no "take a copy" escape hatch. One was
  // built and removed: it handed the player the raw save blob — gm_private,
  // truth ledger, NPC intents, hidden rolls — and the app has no import
  // path, so it could not be loaded back either. Pinned so it cannot return
  // without someone first building a player-safe projection.
  it('never offers the player a copy of the raw reign', async () => {
    const container = await mount(<SaveFailureNotice lead="Lost." lastSafeTurn={2} onRetry={() => {}} />);
    expect(container.textContent).not.toMatch(/take a copy/i);
    expect(container.textContent).toContain('Write it down again');
  });
});

describe('sub-register persistence (WP-14)', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a chosen register', () => {
    setTabRegister('resources', 'standing');
    expect(getTabRegister('resources', ['coin', 'standing', 'leverage'] as const, 'coin')).toBe('standing');
  });

  it('keeps every tab on its own register', () => {
    setTabRegister('resources', 'leverage');
    setTabRegister('chronicle', 'fates');
    expect(getTabRegister('resources', ['coin', 'standing', 'leverage'] as const, 'coin')).toBe('leverage');
    expect(getTabRegister('chronicle', ['reign', 'fates'] as const, 'reign')).toBe('fates');
  });

  it('falls back to the default rather than trusting a value a previous build wrote', () => {
    setTabRegister('resources', 'a_register_that_no_longer_exists');
    expect(getTabRegister('resources', ['coin', 'standing', 'leverage'] as const, 'coin')).toBe('coin');
  });

  it('returns the default when nothing was ever stored', () => {
    expect(getTabRegister('reports', ['subject', 'week'] as const, 'subject')).toBe('subject');
  });
});
