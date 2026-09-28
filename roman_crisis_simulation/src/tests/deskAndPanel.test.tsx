/**
 * @vitest-environment jsdom
 *
 * tests/deskAndPanel.test.tsx
 *
 * The game screen giving the chronicle its room back:
 *
 *  - SidePanel: a pulsing tab carries HOW MUCH is new ("what changed since
 *    you last looked", ROADMAP_UPLEVEL P6) - in its coin and in its name -
 *    and looking at it clears the coin;
 *  - PlayerStatus: the dossier folds to its name line, and stays folded;
 *  - Header: the compact game-screen masthead, the Commands affordance, the
 *    economy's five grades as pips, and the "changed this week" mark;
 *  - useChatFollow: the log follows the newest line only while the reader
 *    is at it; a send always returns them; the way back says when
 *    something landed unseen;
 *  - TurnComposer: the desk's tools ride the mode bar;
 *  - the App: "Whole" keeps the loom up instead of streaming the pen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import SidePanel, { tabAriaLabel } from '../components/SidePanel';
import PlayerStatus, { PLAYER_STATUS_COPY } from '../components/PlayerStatus';
import Header, { HEADER_COPY } from '../components/Header';
import { TurnComposer, SUGGESTION_INDEX_ATTRIBUTE, TURN_COMPOSER_COPY } from '../components/TurnComposer';
import { CHAT_FOLLOW_COPY, FOLLOW_THRESHOLD_PX, isNearFoot, useChatFollow } from '../hooks/useChatFollow';
import { getDossierFolded, setDossierFolded } from '../persistence/readingPrefs';
import * as turnModule from '../ai/core/turn';
import App from '../App';
import { whenLazyScreensReady } from '../app/lazyScreens';
import { GameProvider } from '../state/GameContext';
import { saveGame } from '../persistence/saveGame';
import { GameState } from '../types';
import type { Entity, SimulationState, WorldState } from '../types';
import type { RunDomainMutation } from '../state/domainMutation';
import type { TabId } from '../perception/visibility';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { makeAppSave } from './factories';
import { renderHook } from './renderHook';

vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn() };
});
vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.documentElement.removeAttribute('data-gor-motion');
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(element: React.ReactElement): Promise<{ container: HTMLElement; render: (next: React.ReactElement) => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return { container, render: async next => { await act(async () => root.render(next)); } };
}

const worldState: WorldState = { year: 235, week: 3, economic_stability: 'Stable', political_climate: 'Tense', regions: {} };
const simulationState: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal', plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
};

function makePlayer(): Entity {
  return {
    entity_id: 'severus_alexander', name: 'Severus Alexander', entity_type: 'individual', status: 'alive',
    position: 'Emperor', location: 'Palatine Hill', relationships: {}, memories: [], resources: { denarii: 120 },
    visibility_network: [], current_state_narrative: 'Young and embattled. He holds a fraying court. More follows.',
    short_term_goals: ['Maintain Senate support'], long_term_ambitions: [],
  };
}

// --- SidePanel -------------------------------------------------------------

describe('SidePanel: what changed since you last looked', () => {
  const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
  const panel = (pulsingTabs: Set<TabId>, tabChangeCounts?: Map<TabId, number>) => {
    const player = makePlayer();
    return (
      <SidePanel
        gameState={GameState.AWAITING_PLAYER_INPUT} playerEntity={player} entities={[player]} currentEvents={[]}
        worldState={worldState} simulationState={simulationState} reports={[]} knowledge={[]} turnNumber={3}
        onSpendDeepAnalysis={vi.fn()} onInvestigationOutcome={vi.fn(async () => {})} runDomainMutation={runDomainMutation}
        ai={{} as GoogleGenAI} isMockMode eventHistory={[]} turnHistory={[]} onOccurrenceFinding={vi.fn()}
        pulsingTabs={pulsingTabs} tabChangeCounts={tabChangeCounts}
      />
    );
  };
  const tab = (host: HTMLElement, id: TabId) => host.querySelector<HTMLButtonElement>(`#sidepanel-tab-${id}`)!;

  it('names the count on a pulsing tab and strikes it on the coin, capping the coin at 9+', async () => {
    const { container } = await mount(panel(
      new Set<TabId>(['reports', 'resources', 'locations']),
      new Map<TabId, number>([['reports', 2], ['resources', 14]]),
    ));
    expect(tab(container, 'reports').getAttribute('aria-label')).toBe('Reports (2 new)');
    expect(tab(container, 'reports').querySelector('.gor-tab-count')?.textContent).toBe('2');
    expect(tab(container, 'reports').querySelector('.gor-tab-count')?.getAttribute('aria-hidden')).toBe('true');
    expect(tab(container, 'resources').querySelector('.gor-tab-count')?.textContent).toBe('9+');
    expect(tab(container, 'resources').getAttribute('aria-label')).toBe('Assets (14 new)');
    // A pulsing tab with no count keeps the older dot and wording.
    expect(tab(container, 'locations').querySelector('.gor-tab-dot')).not.toBeNull();
    expect(tab(container, 'locations').getAttribute('aria-label')).toBe('Empire (new intelligence)');
    // A quiet tab carries nothing.
    expect(tab(container, 'events').querySelector('.gor-tab-count, .gor-tab-dot')).toBeNull();
    expect(tab(container, 'events').getAttribute('aria-label')).toBe('Events');
  });

  it('looking at a tab clears its coin until the next week brings something new', async () => {
    const counts = new Map<TabId, number>([['reports', 2]]);
    const { container, render } = await mount(panel(new Set<TabId>(['reports']), counts));
    await act(async () => tab(container, 'reports').click());
    expect(tab(container, 'reports').querySelector('.gor-tab-count')).toBeNull();
    expect(tab(container, 'reports').getAttribute('aria-label')).toBe('Reports');
    await render(panel(new Set<TabId>(['reports', 'events']), new Map<TabId, number>([['reports', 1], ['events', 3]])));
    expect(tab(container, 'reports').querySelector('.gor-tab-count')?.textContent).toBe('1');
  });

  it('tabAriaLabel', () => {
    expect(tabAriaLabel('Reports', false, 3)).toBe('Reports');
    expect(tabAriaLabel('Reports', true, 3)).toBe('Reports (3 new)');
    expect(tabAriaLabel('Reports', true, undefined)).toBe('Reports (new intelligence)');
    expect(tabAriaLabel('Reports', true, 0)).toBe('Reports (new intelligence)');
  });

  it('draws the Imperial Dispatch from classes the night skin can reach, with its note tied to its button', async () => {
    const { container } = await mount(panel(new Set()));
    const bar = container.querySelector('.gor-dispatch-bar')!;
    expect(bar.getAttribute('style')).toBeNull();
    expect(bar.querySelector('.gor-dispatch-title')?.textContent).toBe('Imperial Dispatch');
    const button = bar.querySelector('button')!;
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.className).toBe('gor-dispatch-note');
  });
});

// --- PlayerStatus ------------------------------------------------------------

describe('PlayerStatus: the dossier folds', () => {
  const fold = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.gor-dossier-fold')!;

  it('folds to its name line and back, and remembers it on this device', async () => {
    const { container } = await mount(<PlayerStatus playerEntity={makePlayer()} />);
    const details = document.getElementById(fold(container).getAttribute('aria-controls')!)!;
    expect(fold(container).getAttribute('aria-label')).toBe(PLAYER_STATUS_COPY.fold);
    expect(fold(container).getAttribute('title')).toBe(PLAYER_STATUS_COPY.fold);
    expect(fold(container).getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    expect(container.textContent).toContain('Maintain Senate support');

    await act(async () => fold(container).click());
    expect(fold(container).getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect(container.querySelector('.gor-dossier-head-folded')).not.toBeNull();
    // The name and post stay; only goal and state fold away.
    expect(container.querySelector('.gor-dossier-name')?.textContent).toBe('Severus Alexander');
    expect(container.querySelector('.gor-dossier-post')?.textContent).toContain('Emperor');
    expect(getDossierFolded()).toBe(true);

    await act(async () => fold(container).click());
    expect(details.hidden).toBe(false);
    expect(getDossierFolded()).toBe(false);
  });

  it('opens folded when this device left it folded', async () => {
    setDossierFolded(true);
    const { container } = await mount(<PlayerStatus playerEntity={makePlayer()} />);
    expect(fold(container).getAttribute('aria-expanded')).toBe('false');
  });
});

// --- Header ---------------------------------------------------------------

describe('Header', () => {
  const header = (props: Partial<React.ComponentProps<typeof Header>> = {}) =>
    <Header worldState={worldState} onOpenSettings={vi.fn()} {...props} />;
  const lit = (host: HTMLElement) => host.querySelectorAll('.gor-masthead-pip-lit').length;

  it('keeps the full ceremony by default, with no Commands affordance', async () => {
    const { container } = await mount(header());
    expect(container.querySelector('.gor-masthead-compact')).toBeNull();
    expect(container.querySelector('.gor-masthead-commands')).toBeNull();
  });

  it('on the game screen: compact, and Commands opens the palette', async () => {
    const onOpenCommands = vi.fn();
    const { container } = await mount(header({ compact: true, onOpenCommands }));
    expect(container.querySelector('.gor-masthead-compact')).not.toBeNull();
    const commands = container.querySelector<HTMLButtonElement>(`button[aria-label="${HEADER_COPY.commandsLabel}"]`)!;
    expect(commands.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    // A magnifier the phone can show alone - not a fallback ornament.
    expect(commands.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(commands.textContent).not.toContain('❖');
    await act(async () => commands.click());
    expect(onOpenCommands).toHaveBeenCalled();
  });

  it('lights the economy from Prosperous down, burns crimson from Failing, and draws nothing for an unknown word', async () => {
    const { container, render } = await mount(header());
    expect(lit(container)).toBe(4);
    expect(container.querySelector('.gor-masthead-pips')?.getAttribute('aria-hidden')).toBe('true');
    await render(header({ worldState: { ...worldState, economic_stability: 'Prosperous' } }));
    expect(lit(container)).toBe(5);
    await render(header({ worldState: { ...worldState, economic_stability: 'Severely strained' } }));
    expect(lit(container)).toBe(3);
    expect(container.querySelector('.gor-masthead-pips-dire')).toBeNull();
    await render(header({ worldState: { ...worldState, economic_stability: 'Failing' } }));
    expect(lit(container)).toBe(2);
    expect(container.querySelector('.gor-masthead-pips-dire')).not.toBeNull();
    await render(header({ worldState: { ...worldState, economic_stability: 'Mysterious' } }));
    expect(container.querySelector('.gor-masthead-pips')).toBeNull();
    // The word itself is always there.
    expect(container.textContent).toContain('Mysterious');
  });

  it('marks a stat a public world change moved last week, in words for a screen reader', async () => {
    const { container } = await mount(header({ worldShifts: { political_climate: true } }));
    const marks = container.querySelectorAll('.gor-masthead-shift');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('title')).toBe(HEADER_COPY.shifted);
    expect(marks[0].textContent).toContain(HEADER_COPY.shifted);
    expect(marks[0].closest('.gor-masthead-stat')?.textContent).toContain('Political Climate');
  });
});

// --- useChatFollow ---------------------------------------------------------

describe('useChatFollow', () => {
  it('isNearFoot', () => {
    expect(isNearFoot({ scrollTop: 900, scrollHeight: 1500, clientHeight: 600 })).toBe(true);
    expect(isNearFoot({ scrollTop: 900 - FOLLOW_THRESHOLD_PX, scrollHeight: 1500, clientHeight: 600 })).toBe(true);
    expect(isNearFoot({ scrollTop: 899 - FOLLOW_THRESHOLD_PX, scrollHeight: 1500, clientHeight: 600 })).toBe(false);
  });

  type Props = { messageCount: number; gameState: GameState; streamingText: string };
  function setup(initial: Props) {
    const log = document.createElement('div');
    const end = document.createElement('div');
    const metrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };
    Object.defineProperties(log, {
      scrollTop: { get: () => metrics.scrollTop, configurable: true },
      scrollHeight: { get: () => metrics.scrollHeight, configurable: true },
      clientHeight: { get: () => metrics.clientHeight, configurable: true },
    });
    const hook = renderHook((props: Props) => {
      const follow = useChatFollow(props);
      follow.logRef.current = log;
      follow.endRef.current = end;
      return follow;
    }, initial);
    // Leave the renderHook's own mount-time scroll out of the counts below.
    const scrollTo = (top: number) => act(() => { metrics.scrollTop = top; hook.current.onLogScroll(); });
    return { hook, metrics, scrollTo };
  }

  it('follows the foot while the reader is there', () => {
    const { hook } = setup({ messageCount: 3, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    scrollIntoView.mockClear();
    hook.rerender({ messageCount: 4, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
    expect(hook.current.awayFromFoot).toBe(false);
    hook.unmount();
  });

  it('leaves a reader who scrolled back where they are, then says something landed', async () => {
    const { hook, scrollTo } = setup({ messageCount: 3, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    // Past the programmatic-scroll grace window.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    scrollTo(100);
    expect(hook.current.awayFromFoot).toBe(true);
    expect(hook.current.hasUnseen).toBe(false);
    scrollIntoView.mockClear();
    hook.rerender({ messageCount: 5, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(hook.current.hasUnseen).toBe(true);
    // Streamed chunks do not pull them down either.
    hook.rerender({ messageCount: 5, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: 'The pen moves' });
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => hook.current.jumpToLatest());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(hook.current.awayFromFoot).toBe(false);
    expect(hook.current.hasUnseen).toBe(false);
    hook.unmount();
  });

  it('a send always returns the reader to the foot', () => {
    const { hook, scrollTo } = setup({ messageCount: 3, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    scrollTo(0);
    scrollIntoView.mockClear();
    hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: '' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('follows the pen instantly while at the foot, and never glides under reduced motion', () => {
    const { hook } = setup({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: '' });
    scrollIntoView.mockClear();
    hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: 'The pen' });
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' });
    document.documentElement.setAttribute('data-gor-motion', 'reduced');
    hook.rerender({ messageCount: 4, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' });
    hook.unmount();
  });

  it('ignores the scroll events of its own glide down', () => {
    const { hook, scrollTo } = setup({ messageCount: 3, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    hook.rerender({ messageCount: 4, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    scrollTo(300); // mid-glide, inside the grace window
    expect(hook.current.awayFromFoot).toBe(false);
    hook.unmount();
  });
});

// --- TurnComposer ----------------------------------------------------------

describe('TurnComposer: the desk', () => {
  it('rides the desk tools on the mode bar and numbers the counsel for the palette', async () => {
    const { container } = await mount(
      <TurnComposer
        chatDraft="" structuredDraft={emptyStructuredDraft()} recipientOptions={[]}
        suggestedActions={['Bribe the Guard', 'Write to the Senate']} disabled={false} isProcessing={false}
        onChatDraftChange={vi.fn()} onStructuredDraftChange={vi.fn()} onSubmit={vi.fn()}
        tools={<button type="button">Narration log</button>}
      />,
    );
    const bar = container.querySelector('.gor-composer-bar')!;
    expect(bar.querySelector('[aria-label="Composer mode"]')).not.toBeNull();
    expect(bar.querySelector('.gor-composer-tools')?.textContent).toBe('Narration log');
    const pills = container.querySelectorAll(`[${SUGGESTION_INDEX_ATTRIBUTE}]`);
    expect([...pills].map(p => p.getAttribute(SUGGESTION_INDEX_ATTRIBUTE))).toEqual(['0', '1']);
    expect(container.querySelector('.gor-composer-pills-label')?.textContent).toBe(TURN_COMPOSER_COPY.counsel);
    // The counsel is one labelled group, not a run of loose buttons.
    const group = container.querySelector('.gor-composer-pills')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(TURN_COMPOSER_COPY.counsel);
  });

  it('draws no tool row when given none', async () => {
    const { container } = await mount(
      <TurnComposer
        chatDraft="" structuredDraft={emptyStructuredDraft()} recipientOptions={[]} suggestedActions={[]}
        disabled={false} isProcessing={false} onChatDraftChange={vi.fn()} onStructuredDraftChange={vi.fn()} onSubmit={vi.fn()}
      />,
    );
    expect(container.querySelector('.gor-composer-tools')).toBeNull();
  });
});

// --- The App: how the narration arrives --------------------------------------

describe('the App: narration "As written" or "Whole"', () => {
  const mockRunNewTurn = vi.mocked(turnModule.runNewTurn);

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  async function waitFor(assertion: () => void, attempts = 40): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try { assertion(); return; } catch (error) { lastError = error; await flush(); }
    }
    throw lastError;
  }
  const buttonNamed = (root: ParentNode, name: string) => [...root.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;

  async function sendAWeekThatStreams(): Promise<{ container: HTMLElement; finish: () => Promise<void> }> {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    mockRunNewTurn.mockImplementation(async (...args: unknown[]) => {
      const options = args[args.length - 1] as { onNarrationChunk?: (text: string) => void; onStage?: (stage: turnModule.TurnStage) => void };
      options.onStage?.('narration');
      options.onNarrationChunk?.('The pen moves across the vellum');
      await held;
      throw new Error('the test ends the week here');
    });
    saveGame(makeAppSave());
    const { container } = await mount(React.createElement(GameProvider, null, React.createElement(App)));
    await act(() => whenLazyScreensReady());
    await waitFor(() => expect(buttonNamed(container, 'Continue Your Reign')).toBeDefined());
    await act(async () => buttonNamed(container, 'Continue Your Reign')!.click());
    await waitFor(() => expect(container.querySelector('#chat-input')).not.toBeNull());
    const input = container.querySelector<HTMLTextAreaElement>('#chat-input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'I hold court.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonNamed(container, 'Send message')!.click());
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalled());
    await flush();
    return {
      container,
      finish: async () => { vi.spyOn(console, 'error').mockImplementation(() => {}); release(); await flush(); await flush(); },
    };
  }

  it('As written (the default) streams the pen into the chronicle', async () => {
    const { container, finish } = await sendAWeekThatStreams();
    expect(container.textContent).toContain('The pen moves across the vellum');
    expect(container.querySelector('.gor-loom')).toBeNull();
    await finish();
  });

  it('a reader scrolled back through the chronicle is offered the way to the latest', async () => {
    saveGame(makeAppSave());
    const { container } = await mount(React.createElement(GameProvider, null, React.createElement(App)));
    await act(() => whenLazyScreensReady());
    await waitFor(() => expect(buttonNamed(container, 'Continue Your Reign')).toBeDefined());
    await act(async () => buttonNamed(container, 'Continue Your Reign')!.click());
    await waitFor(() => expect(container.querySelector('#chat-input')).not.toBeNull());
    expect(buttonNamed(container, CHAT_FOLLOW_COPY.toLatest)).toBeUndefined();

    const log = container.querySelector<HTMLElement>('[role="log"][aria-label="Chat log"]')!;
    Object.defineProperties(log, {
      scrollTop: { value: 0, configurable: true },
      scrollHeight: { value: 3000, configurable: true },
      clientHeight: { value: 600, configurable: true },
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    await act(async () => log.dispatchEvent(new Event('scroll')));
    const toLatest = [...container.querySelectorAll<HTMLButtonElement>('button.gor-follow')]
      .find(b => b.textContent?.includes(CHAT_FOLLOW_COPY.toLatest));
    expect(toLatest).toBeDefined();
    scrollIntoView.mockClear();
    await act(async () => toLatest!.click());
    expect(scrollIntoView).toHaveBeenCalled();
    expect(container.querySelector('button.gor-follow')).toBeNull();
  });

  it('Whole keeps the loom up until the week commits', async () => {
    localStorage.setItem('gloryOfRome:narrationReveal', 'whole');
    const { container, finish } = await sendAWeekThatStreams();
    expect(container.textContent).not.toContain('The pen moves across the vellum');
    expect(container.querySelector('.gor-loom')).not.toBeNull();
    await finish();
  });
});
