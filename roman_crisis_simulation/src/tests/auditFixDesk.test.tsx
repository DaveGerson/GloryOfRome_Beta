/**
 * @vitest-environment jsdom
 *
 * tests/auditFixDesk.test.tsx - the desk and the side panel, as the
 * September audit left them:
 *
 *  - a counsel adds to the week, never replaces what the player wrote;
 *  - a half-written letter is not an alert until the player leaves it;
 *  - an open private scene names itself as what holds the tablet, and holds
 *    Retry too;
 *  - "N new" belongs to the committed week and to what was looked at - the
 *    tab rail and the palette say the same, a reload does not repeat it, and
 *    an investigation bought in the interlude is not counted again;
 *  - a streamed chunk never pulls down a reader who scrolled back;
 *  - the log speaks the player's words once, and says who speaks;
 *  - focus lands on the tablet, never on <body>, after the controls that
 *    remove themselves;
 *  - each control's name starts with the words it shows (WCAG 2.5.3);
 *  - the Imperial Dispatch says why it is silent;
 *  - Choose Your Destiny has the screen to itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GoogleGenAI } from '@google/genai';
import App from '../App';
import { whenLazyScreensReady } from '../app/lazyScreens';
import { draftSuggestion } from '../app/domCommands';
import { TurnComposer, TURN_COMPOSER_COPY, type TurnComposerProps } from '../components/TurnComposer';
import { STRUCTURED_ADD_ROW_LABELS, STRUCTURED_REGISTER_TITLES } from '../components/StructuredTurnComposer';
import SidePanel, { DISPATCH_BUTTON_LABEL, dispatchNote } from '../components/SidePanel';
import { CHAT_LEAF_COPY, NARRATION_VOICE_COPY } from '../components/Chat';
import { useChatFollow } from '../hooks/useChatFollow';
import { tabChangeCountsFor } from '../hooks/usePlayerPerception';
import { useSeenRegisters, weekKeyOf } from '../hooks/useSeenRegisters';
import * as turnCore from '../ai/core/turn';
import { GameProvider, useGame } from '../state/GameContext';
import type { GameAction } from '../state/gameReducer';
import { loadGame, saveGame } from '../persistence/saveGame';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { GameState } from '../types';
import type { Entity, SimulationState, WorldState } from '../types';
import type { TabId } from '../perception/visibility';
import type { RunDomainMutation } from '../state/domainMutation';
import type { PrivateSceneRecord } from '../privateScene/model';
import { makeAppSave, makeKnowledgeClaim, makePrivateScene, makeTurnHistoryEntry } from './factories';
import { renderHook } from './renderHook';

vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn(actual.runNewTurn) };
});
vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(turnCore.runNewTurn);
const passThroughRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
let scrollIntoView: ReturnType<typeof vi.fn>;
let dispatchGame: React.Dispatch<GameAction> | null = null;
// tests/vitest.setup.ts gives every test a fake device key; the no-key
// paths take it away for their own test.
const DEVICE_KEY = process.env.GEMINI_API_KEY;
const withoutDeviceKey = () => { delete process.env.GEMINI_API_KEY; };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gloryOfRome:onboardingSeen', '1');
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  mockRunNewTurn.mockImplementation(passThroughRunNewTurn);
});

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  process.env.GEMINI_API_KEY = DEVICE_KEY;
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(element: React.ReactElement): Promise<{ container: HTMLElement; root: Root; render: (next: React.ReactElement) => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return { container, root, render: async next => { await act(async () => root.render(next)); } };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void, attempts = 60): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try { assertion(); return; } catch (error) { lastError = error; await flush(); }
  }
  throw lastError;
}

const buttonNamed = (root: ParentNode, name: string) => [...root.querySelectorAll('button')]
  .find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => element.focus());
}

const RECIPIENTS = [{ entityId: 'julia_domna', displayName: 'Julia Domna' }];

function composerProps(overrides: Partial<TurnComposerProps> = {}): TurnComposerProps {
  return {
    chatDraft: '', structuredDraft: emptyStructuredDraft(), recipientOptions: RECIPIENTS, suggestedActions: [],
    disabled: false, isProcessing: false,
    onChatDraftChange: () => {}, onStructuredDraftChange: () => {}, onSubmit: () => {},
    ...overrides,
  };
}

/** A TurnComposer that owns its drafts, as App does. */
function ComposerHarness(props: Partial<TurnComposerProps> & { initialChat?: string }) {
  const { initialChat = '', ...rest } = props;
  const [chatDraft, setChatDraft] = useState(initialChat);
  const [structuredDraft, setStructuredDraft] = useState(emptyStructuredDraft());
  return (
    <TurnComposer
      {...composerProps(rest)}
      chatDraft={chatDraft} onChatDraftChange={setChatDraft}
      structuredDraft={structuredDraft} onStructuredDraftChange={setStructuredDraft}
    />
  );
}

const worldState: WorldState = { year: 235, week: 3, economic_stability: 'Stable', political_climate: 'Tense', regions: {} };
const simulationState: SimulationState = {
  imperial_status: 'Stable', senate_status: 'Functional', military_status: 'Loyal', plebeian_mood: 'Uneasy', major_ongoing_crisis: null,
};

function makePlayer(): Entity {
  return {
    entity_id: 'severus_alexander', name: 'Severus Alexander', entity_type: 'individual', status: 'alive',
    position: 'Emperor', location: 'Palatine Hill', relationships: {}, memories: [], resources: { denarii: 120 },
    visibility_network: [], current_state_narrative: 'Young and embattled.', short_term_goals: [], long_term_ambitions: [],
  };
}

function panel(overrides: Partial<React.ComponentProps<typeof SidePanel>> = {}): React.ReactElement {
  const player = makePlayer();
  const runDomainMutation: RunDomainMutation = async work => ({ acquired: true, value: await work({ isCurrent: () => true }) });
  return (
    <SidePanel
      gameState={GameState.AWAITING_PLAYER_INPUT} playerEntity={player} entities={[player]} currentEvents={[]}
      worldState={worldState} simulationState={simulationState} reports={[]} knowledge={[]} turnNumber={3}
      onSpendDeepAnalysis={vi.fn()} onInvestigationOutcome={vi.fn(async () => {})} runDomainMutation={runDomainMutation}
      ai={{} as GoogleGenAI} isMockMode eventHistory={[]} turnHistory={[]} onOccurrenceFinding={vi.fn()}
      pulsingTabs={new Set<TabId>()}
      {...overrides}
    />
  );
}

const DispatchCaptor: React.FC = () => {
  const { dispatch } = useGame();
  useLayoutEffect(() => {
    dispatchGame = dispatch;
    return () => { dispatchGame = null; };
  }, [dispatch]);
  return null;
};

/** The App, continued from a save; with no key the pre-flight notice offers the canned responses. */
async function mountGame(save = makeAppSave()): Promise<{ container: HTMLElement; root: Root }> {
  saveGame(save);
  const { container, root } = await mount(<GameProvider><DispatchCaptor /><App /></GameProvider>);
  await act(() => whenLazyScreensReady());
  await waitFor(() => expect(buttonNamed(container, 'Continue Your Reign')).toBeDefined());
  await act(async () => buttonNamed(container, 'Continue Your Reign')!.click());
  await waitFor(() => expect(container.querySelector('#chat-input')).not.toBeNull());
  return { container, root };
}

async function playCannedWeek(container: HTMLElement, words: string): Promise<void> {
  const turnBefore = loadGame()!.state.turnNumber;
  await setValue(container.querySelector<HTMLTextAreaElement>('#chat-input')!, words);
  await act(async () => buttonNamed(container, 'Speak')!.click());
  await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(turnBefore + 1));
  await waitFor(() => expect(container.querySelector<HTMLTextAreaElement>('#chat-input')!.disabled).toBe(false));
}

function activeScene(): PrivateSceneRecord {
  return makePrivateScene({ macroTurn: 2, status: 'active', closureReason: undefined });
}

// --- Counsel ----------------------------------------------------------------

describe('a counsel adds to the week', () => {
  it('in chat mode it follows what the player wrote on a new line, and fills an empty tablet', async () => {
    const { container } = await mount(<ComposerHarness initialChat="I hold court at dawn.  " suggestedActions={['Summon the Praetorian prefect']} />);
    const input = container.querySelector<HTMLTextAreaElement>('#chat-input')!;
    await act(async () => container.querySelector<HTMLButtonElement>('[data-gor-suggestion="0"]')!.click());
    expect(input.value).toBe('I hold court at dawn.\nSummon the Praetorian prefect');

    await setValue(input, '   ');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-gor-suggestion="0"]')!.click());
    expect(input.value).toBe('Summon the Praetorian prefect');
  });

  it("the palette's Draft row presses the same pill, so it adds too", async () => {
    const { container } = await mount(<ComposerHarness initialChat="Write to the Senate." suggestedActions={['Bribe the Guard']} />);
    await act(async () => { draftSuggestion(0); });
    expect(container.querySelector<HTMLTextAreaElement>('#chat-input')!.value).toBe('Write to the Senate.\nBribe the Guard');
  });
});

// --- The structured tablet ------------------------------------------------------

describe('a half-written letter is not yet an error', () => {
  async function structured() {
    const onSubmit = vi.fn();
    const view = await mount(<ComposerHarness onSubmit={onSubmit} />);
    await act(async () => buttonNamed(view.container, 'Structured')!.click());
    const recipient = view.container.querySelector<HTMLSelectElement>('[aria-label="Recipient 1"]')!;
    const command = view.container.querySelector<HTMLTextAreaElement>('[aria-label="Message or order 1"]')!;
    const action = view.container.querySelector<HTMLTextAreaElement>('#structured-input')!;
    return { ...view, recipient, command, action, onSubmit };
  }

  it('waits while the player writes the letter, and speaks once they leave it unfinished', async () => {
    const { container, recipient, command, action } = await structured();
    await focus(recipient);
    await setValue(recipient, recipient.options[1].value);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(command.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('#composer-submission-status')?.textContent).toMatch(/characters remaining/);
    expect(buttonNamed(container, 'Seal & send')!.disabled).toBe(true);

    // Step two, in the same letter: still no interruption.
    await focus(command);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Leaving the letter unfinished: now it is an issue, and says so.
    await focus(action);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/recipient and command are both required/i);
    expect(command.getAttribute('aria-invalid')).toBe('true');
  });

  it('speaks when the player tries to send the unfinished letter, and sends nothing', async () => {
    const { container, recipient, command, onSubmit } = await structured();
    await focus(recipient);
    await setValue(recipient, recipient.options[1].value);
    await focus(command);
    await act(async () => command.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/recipient and command are both required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the tablet\'s first field is described by the remaining count, as the chat tablet is', async () => {
    const { container, action } = await structured();
    const status = container.querySelector('#composer-submission-status')!;
    expect(action.getAttribute('aria-describedby')).toBe(status.id);
    expect(status.textContent).toMatch(/20,000 characters remaining/);
  });
});

// --- An open private scene -------------------------------------------------------

describe('an open private scene holds the desk, and says so', () => {
  it('names the scene and the way back to it, in either state', async () => {
    const { container, render } = await mount(
      <TurnComposer {...composerProps({ disabled: true, openScene: { npcName: 'Maximinus Thrax', awaitingLastWord: false } })} />,
    );
    const input = container.querySelector<HTMLTextAreaElement>('#chat-input')!;
    expect(input.placeholder).toBe(TURN_COMPOSER_COPY.scenePlaceholder('Maximinus Thrax'));
    const line = container.querySelector('#composer-scene-hold')!;
    expect(line.textContent).toBe(TURN_COMPOSER_COPY.sceneOpen('Maximinus Thrax'));
    expect(line.textContent).toContain('Private scene');
    expect(input.getAttribute('aria-describedby')).toContain('composer-scene-hold');

    await render(<TurnComposer {...composerProps({ disabled: true, openScene: { npcName: 'Maximinus Thrax', awaitingLastWord: true } })} />);
    expect(container.querySelector('#composer-scene-hold')!.textContent).toBe(TURN_COMPOSER_COPY.sceneLastWord('Maximinus Thrax'));
  });

  it('after a reload into an open scene the tablet names it, not the Senate', async () => {
    const { container } = await mountGame(makeAppSave({ privateScenes: [activeScene()] }));
    const input = container.querySelector<HTMLTextAreaElement>('#chat-input')!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).not.toContain('Senate');
    expect(container.querySelector('#composer-scene-hold')?.textContent).toContain('Maximinus Thrax');
  });

  it('holds Retry as it holds the tablet', async () => {
    localStorage.setItem('gloryOfRome:apiKey', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(new Error('turn provider offline'));
    const { container } = await mountGame();
    await setValue(container.querySelector<HTMLTextAreaElement>('#chat-input')!, 'Hold the Forum.');
    await act(async () => buttonNamed(container, 'Speak')!.click());
    await waitFor(() => expect(buttonNamed(container, 'Retry the last action')?.disabled).toBe(false));

    await act(async () => dispatchGame!({ type: 'PRIVATE_SCENES_COMMITTED', privateScenes: [activeScene()] }));
    expect(buttonNamed(container, 'Retry the last action')!.disabled).toBe(true);
  });
});

// --- What changed since you last looked ---------------------------------------------

describe('"N new" belongs to the committed week and to what was looked at', () => {
  const counts = new Map<TabId, number>([['reports', 2], ['events', 1], ['world_state', 1]]);

  it('a new week re-arms the tabs it touches, even the same tabs as last week', () => {
    const hook = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:a' });
    act(() => hook.current.selectTab('reports'));
    act(() => hook.current.selectTab('world_state'));
    expect(hook.current.unseenCounts.has('reports')).toBe(false);
    hook.rerender({ weekKey: '5:b' });
    expect(hook.current.unseenCounts.get('reports')).toBe(2);
    expect(hook.current.unseenTabs.has('reports')).toBe(true);
    hook.unmount();
  });

  it('the tab open as the week lands is looked at already', () => {
    const hook = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:a' });
    expect(hook.current.activeTab).toBe('world_state');
    expect(hook.current.unseenCounts.has('world_state')).toBe(false);
    act(() => hook.current.selectTab('events'));
    hook.rerender({ weekKey: '5:b' });
    expect(hook.current.unseenCounts.has('events')).toBe(false);
    expect(hook.current.unseenCounts.get('world_state')).toBe(1);
    hook.unmount();
  });

  it('what was looked at outlives a reload of the same week, and only that week', () => {
    const first = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:a' });
    act(() => first.current.selectTab('reports'));
    first.unmount();
    const again = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:a' });
    expect(again.current.unseenCounts.has('reports')).toBe(false);
    expect(again.current.unseenCounts.get('events')).toBe(1);
    again.unmount();
    const another = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:other-reign' });
    expect(another.current.unseenCounts.get('reports')).toBe(2);
    another.unmount();
  });

  it('a device that keeps nothing still counts, and loses only the memory', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const hook = renderHook((props: { weekKey: string }) => useSeenRegisters({ weekKey: props.weekKey, tabChangeCounts: counts }), { weekKey: '4:a' });
    expect(hook.current.unseenCounts.get('reports')).toBe(2);
    act(() => hook.current.selectTab('reports'));
    expect(hook.current.unseenCounts.has('reports')).toBe(false);
    hook.unmount();
  });

  it("a week's identity is its number and what the player read of it", () => {
    expect(weekKeyOf(null)).toBeNull();
    const week = makeTurnHistoryEntry({ turnNumber: 4, narration: 'The Senate stirs.' });
    expect(weekKeyOf(week)).toBe(weekKeyOf({ ...week }));
    expect(weekKeyOf(week)).not.toBe(weekKeyOf({ ...week, narration: 'The legions stir.' }));
    expect(weekKeyOf(week)).not.toBe(weekKeyOf({ ...week, turnNumber: 5 }));
  });

  it('the tab rail and the palette say the same count, and neither repeats it after a reload', async () => {
    withoutDeviceKey();
    const { container, root } = await mountGame();
    await act(async () => buttonNamed(container, 'Play against canned responses')!.click());
    await playCannedWeek(container, 'I hold court at dawn.');

    const coinOf = (id: TabId) => document.getElementById(`sidepanel-tab-${id}`)!.querySelector('.gor-tab-count');
    // World State was open as the week landed.
    expect(coinOf('world_state')).toBeNull();
    const counted = (['events', 'reports', 'chronicle', 'dramatis_personae', 'locations', 'resources'] as TabId[])
      .filter(id => coinOf(id) !== null);
    expect(counted.length).toBeGreaterThan(0);
    const looked = counted[0];
    const label = document.getElementById(`sidepanel-tab-${looked}`)!.getAttribute('aria-label')!.replace(/ \(.*\)$/, '');

    const paletteRow = async () => {
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
      });
      const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find(option => option.querySelector('.gor-palette-label')?.textContent === label)!;
      const name = row.getAttribute('aria-label');
      await act(async () => {
        document.querySelector('[role="dialog"][aria-label="Commands"]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      return name;
    };
    expect(await paletteRow()).toBe(`${label}, ${coinOf(looked)!.textContent} new`);

    await act(async () => document.getElementById(`sidepanel-tab-${looked}`)!.click());
    expect(coinOf(looked)).toBeNull();
    expect(await paletteRow()).toBe(label);

    // Reload the same week: what was looked at stays looked at.
    await act(async () => root.unmount());
    mounted.splice(mounted.findIndex(entry => entry.root === root), 1);
    container.remove();
    const reloaded = await mountGame(loadGame()!.state);
    expect(reloaded.container.querySelector(`#sidepanel-tab-${looked} .gor-tab-count`)).toBeNull();
    expect(reloaded.container.querySelector('#sidepanel-tab-world_state .gor-tab-count')).toBeNull();
  });

  it('counts only the observations the committed week brought, not one bought in the interlude', () => {
    const lastTurn = makeTurnHistoryEntry({ turnNumber: 5 });
    const fromTheWeek = makeKnowledgeClaim({
      firstLearnedTurn: 5, relationshipObservation: { evidenceId: 'turn:5:player-digest:0', participantIds: ['a', 'b'] },
    });
    const fromAReport = makeKnowledgeClaim({
      firstLearnedTurn: 5, relationshipObservation: { evidenceId: 'report_5_lucius', participantIds: ['a', 'b'] },
    });
    const bought = makeKnowledgeClaim({
      firstLearnedTurn: 5, relationshipObservation: { evidenceId: 'turn:5:investigation:5:maximinus_thrax:beliefs:1x2y', participantIds: ['a', 'b'] },
    });
    expect(tabChangeCountsFor([], [fromTheWeek, fromAReport, bought], lastTurn).get('dramatis_personae')).toBe(2);
    expect(tabChangeCountsFor([], [bought], lastTurn).has('dramatis_personae')).toBe(false);
  });
});

// --- The chronicle follows only a reader at its foot -----------------------------------

describe('a streamed chunk never pulls down a reader who scrolled back', () => {
  type Props = { messageCount: number; gameState: GameState; streamingText: string };
  function setup() {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const log = document.createElement('div');
    const end = document.createElement('div');
    const metrics = { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 };
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
    }, { messageCount: 3, gameState: GameState.AWAITING_PLAYER_INPUT, streamingText: '' });
    const scrollTo = (top: number) => act(() => { metrics.scrollTop = top; hook.current.onLogScroll(); });
    return { hook, scrollTo, advance: (ms: number) => { now += ms; } };
  }

  it('chunks a few hundred ms apart no longer swallow the scroll back', () => {
    const { hook, scrollTo, advance } = setup();
    advance(10_000);
    hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: '' });
    advance(1_000);
    let text = '';
    for (let chunk = 0; chunk < 4; chunk += 1) {
      text += 'The pen moves. ';
      hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: text });
      advance(250);
    }
    scrollTo(1500);
    advance(60);
    scrollTo(0);
    expect(hook.current.awayFromFoot).toBe(true);
    scrollIntoView.mockClear();
    hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: `${text}More.` });
    expect(scrollIntoView).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('a scroll UP is the reader even while a glide is under way', () => {
    const { hook, scrollTo, advance } = setup();
    advance(10_000);
    scrollTo(1500);
    hook.rerender({ messageCount: 3, gameState: GameState.PROCESSING, streamingText: '' }); // the send's glide
    advance(100);
    scrollTo(200);
    expect(hook.current.awayFromFoot).toBe(true);
    hook.unmount();
  });
});

// --- The log ---------------------------------------------------------------------

describe('the log speaks the player once, and says who speaks', () => {
  it("the leaf sent is the leaf committed - one node, one announcement - and each leaf leads with its speaker", async () => {
    withoutDeviceKey();
    const { container } = await mountGame();
    await act(async () => buttonNamed(container, 'Play against canned responses')!.click());
    const log = container.querySelector('[role="log"]')!;
    const added: Element[] = [];
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) added.push(node);
    })));
    observer.observe(log, { childList: true, subtree: true });
    await playCannedWeek(container, 'I summon the Praetorian prefect.');
    observer.disconnect();

    const playerLeavesAdded = added.filter(node => node.matches('.gor-msg-player') || node.querySelector('.gor-msg-player'));
    expect(playerLeavesAdded).toHaveLength(1);
    const leaves = log.querySelectorAll('.gor-msg-player');
    expect(leaves).toHaveLength(1);
    expect(leaves[0].parentElement!.querySelector('.gor-sr-only')?.textContent?.trim()).toBe(CHAT_LEAF_COPY.player);
    const chronicle = log.querySelector('.gor-msg-gm')!;
    expect(chronicle.parentElement!.querySelector('.gor-sr-only')?.textContent?.trim()).toBe(CHAT_LEAF_COPY.chronicle);
    // The lead sits outside the leaf, so the drop cap keeps the leaf's own first letter.
    expect(chronicle.querySelector('.gor-sr-only')).toBeNull();
  });
});

// --- Focus -----------------------------------------------------------------------

describe('focus lands on the tablet, never on <body>', () => {
  it("after 'Play against canned responses'", async () => {
    withoutDeviceKey();
    const { container } = await mountGame();
    const canned = buttonNamed(container, 'Play against canned responses')!;
    await focus(canned);
    await act(async () => canned.click());
    expect(buttonNamed(container, 'Play against canned responses')).toBeUndefined();
    expect(document.activeElement?.id).toBe('chat-input');
  });

  it("after 'Enter your key', a saved key and the configuration menu closed", async () => {
    withoutDeviceKey();
    const { container } = await mountGame();
    const enterKey = buttonNamed(container, 'Enter your key')!;
    await focus(enterKey);
    await act(async () => enterKey.click());
    await setValue(document.querySelector<HTMLInputElement>('[aria-label="Gemini API key"]')!, 'a-key-of-my-own');
    await act(async () => buttonNamed(document, 'Save')!.click());
    expect(buttonNamed(container, 'Enter your key')).toBeUndefined();
    const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(button => button.getAttribute('aria-label')?.startsWith('Close'))!;
    await act(async () => close.click());
    await flush();
    expect(document.activeElement?.id).toBe('chat-input');
  });

  it("after 'Back to the latest', which leaves as the reader arrives", async () => {
    const { container } = await mountGame();
    const log = container.querySelector<HTMLElement>('[role="log"]')!;
    Object.defineProperties(log, {
      scrollTop: { value: 0, configurable: true },
      scrollHeight: { value: 3000, configurable: true },
      clientHeight: { value: 600, configurable: true },
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    await act(async () => log.dispatchEvent(new Event('scroll')));
    const toLatest = container.querySelector<HTMLButtonElement>('button.gor-follow')!;
    await focus(toLatest);
    await act(async () => toLatest.click());
    expect(container.querySelector('button.gor-follow')).toBeNull();
    expect(document.activeElement?.id).toBe('chat-input');
  });
});

// --- Names --------------------------------------------------------------------------

describe('each control is named by the words it shows (WCAG 2.5.3)', () => {
  it('the tablets', async () => {
    const { container } = await mount(<ComposerHarness />);
    const speak = container.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(speak.getAttribute('aria-label')).toBeNull();
    expect(speak.textContent).toBe('Speak');

    await act(async () => buttonNamed(container, 'Structured')!.click());
    const seal = buttonNamed(container, 'Seal & send')!;
    expect(seal.getAttribute('aria-label')).toBeNull();
    for (const label of Object.values(STRUCTURED_ADD_ROW_LABELS)) {
      const button = buttonNamed(container, label)!;
      expect(button.getAttribute('aria-label')).toBe(label);
      // The fleuron is drawn, not read.
      expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('❧');
      expect(button.textContent).toContain(label);
    }
    for (const title of [STRUCTURED_REGISTER_TITLES.intent, STRUCTURED_REGISTER_TITLES.context]) {
      const field = container.querySelector(`textarea[aria-label="${title}"]`)!;
      expect(field).not.toBeNull();
      expect(field.closest('section')!.querySelector('h3')!.textContent).toBe(title);
    }
  });

  it('offline, the hold is named by what it says', async () => {
    const { container } = await mount(<ComposerHarness online={false} initialChat="Hold the Forum." />);
    expect(buttonNamed(container, 'Hold until the roads reopen')).toBeDefined();
    expect(container.querySelector('[aria-label="Send message"]')).toBeNull();
  });

  it('Hear Report keeps its name while it reads, and says it is pressed', async () => {
    const { container } = await mount(panel());
    const button = container.querySelector<HTMLButtonElement>('.gor-dispatch-btn')!;
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.textContent).toContain(DISPATCH_BUTTON_LABEL);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});

// --- The Imperial Dispatch ---------------------------------------------------------

describe('the Imperial Dispatch says why it is silent', () => {
  it('names a missing key, and describes its disabled button with it', async () => {
    const { container } = await mount(panel({ isMockMode: false, resolvedApiKey: null }));
    const button = container.querySelector<HTMLButtonElement>('.gor-dispatch-btn')!;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(NARRATION_VOICE_COPY.unavailable);
  });

  it('a failed reading says so in the words every voice control uses', () => {
    expect(dispatchNote('error')).toBe(NARRATION_VOICE_COPY.error);
    expect(dispatchNote('unavailable')).toBe(NARRATION_VOICE_COPY.unavailable);
    expect(dispatchNote('idle')).toBe('High English tab report');
  });
});

// --- The side panel's shape ---------------------------------------------------------

describe('the side panel', () => {
  it('steps aside on Choose Your Destiny', async () => {
    const { container } = await mount(panel({ gameState: GameState.SETUP }));
    expect(container.querySelector('[data-screen-label="Side Panel"]')).toBeNull();
  });

  it('strikes each count coin at its word, not at the corner of its tab', async () => {
    const { container } = await mount(panel({
      pulsingTabs: new Set<TabId>(['reports']), tabChangeCounts: new Map<TabId, number>([['reports', 2]]),
    }));
    const coin = container.querySelector('#sidepanel-tab-reports .gor-tab-count')!;
    expect(coin.parentElement!.classList.contains('gor-tab-label')).toBe(true);
    expect(coin.parentElement!.firstChild?.textContent).toBe('Reports');
  });

  it('the chronicle keeps its reading height, and only the Structured registers scroll', async () => {
    const { container } = await mountGame();
    const log = container.querySelector<HTMLElement>('[role="log"]')!;
    expect(log.style.minHeight).not.toBe('');
    const desk = log.nextElementSibling as HTMLElement;
    expect(desk.style.minHeight).toMatch(/^0(px)?$/);
    await act(async () => buttonNamed(container, 'Structured')!.click());
    expect(container.querySelector('.gor-register-scroll #structured-input')).not.toBeNull();
  });
});
