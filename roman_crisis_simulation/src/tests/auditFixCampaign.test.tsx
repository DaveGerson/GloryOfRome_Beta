/**
 * @vitest-environment jsdom
 *
 * tests/auditFixCampaign.test.tsx - regression pins for the campaign cluster
 * of the September 2026 audit: the turn's retry and keyless holds, the saved
 * reign's safety on the destiny screen, a fate that survives a reload, the
 * forge's failure and no-key paths, the fate's chronicle leaf, the masthead
 * before a reign loads, the "fell this week" mark, and focus after Continue.
 *
 * The real App/provider/reducer/persistence wiring runs; only the external
 * AI boundary and the authored-event trigger check are steerable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { whenLazyScreensReady } from '../app/lazyScreens';
import { GameProvider } from '../state/GameContext';
import * as aiMocks from '../ai/mocks';
import * as turnCore from '../ai/core/turn';
import * as eventsEngine from '../events/engine';
import * as initiator from '../ai/core/initiator';
import { AiServiceError } from '../ai/core/geminiService';
import { ALL_EVENTS } from '../constants/events';
import { loadGame, saveGame, updateSavedPendingEvent, SAVE_KEY, type SaveGameState } from '../persistence/saveGame';
import { createInitialGameState, gameReducer, withOldSnapshotsDropped, KEEP_FULL_SNAPSHOTS } from '../state/gameReducer';
import { GameState, type SimulationState } from '../types';
import { makeAppSave, makeTurnHistoryEntry } from './factories';
import { eventLeafText, isEventLeaf, toSegments } from '../components/textFormat';
import { illuminatedNarrationIndices, ChatMessage } from '../components/Chat';
import EventModal from '../components/EventModal';
import Header, { HEADER_COPY } from '../components/Header';
import { fellStandings, STANDING_ORDER, STANDING_SEVERITY, type MacroStanding } from '../components/tabs/WorldStateTab';
import { INITIAL_SIMULATION_STATE, INITIAL_WORLD_STATE } from '../constants/baseScenario';

vi.mock('../ai/mocks', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/mocks')>();
  return {
    ...actual,
    mockRunNewTurn: vi.fn(actual.mockRunNewTurn),
    mockCreateCharacter: vi.fn(actual.mockCreateCharacter),
  };
});

vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn(actual.runNewTurn) };
});

vi.mock('../events/engine', async importOriginal => {
  const actual = await importOriginal<typeof import('../events/engine')>();
  return { ...actual, checkForTriggeredEvent: vi.fn(actual.checkForTriggeredEvent) };
});

vi.mock('../ai/core/initiator', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/initiator')>();
  return { ...actual, initiateWorld: vi.fn(actual.initiateWorld) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(aiMocks.mockRunNewTurn);
const mockCreateCharacter = vi.mocked(aiMocks.mockCreateCharacter);
const mockRunNewTurnCore = vi.mocked(turnCore.runNewTurn);
const mockCheckForTriggeredEvent = vi.mocked(eventsEngine.checkForTriggeredEvent);
const mockInitiateWorld = vi.mocked(initiator.initiateWorld);
const defaultRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const defaultCreateCharacter = mockCreateCharacter.getMockImplementation()!;
const defaultRunNewTurnCore = mockRunNewTurnCore.getMockImplementation()!;
const defaultCheckForTriggeredEvent = mockCheckForTriggeredEvent.getMockImplementation()!;
const defaultInitiateWorld = mockInitiateWorld.getMockImplementation()!;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

// jsdom implements neither URL.createObjectURL nor anchor downloads; capture
// what "Take a copy of the reign" would hand over. Installed once, never
// removed (downloadTheReign's deferred revoke can fire after the suite).
const createdObjectUrlBlobs: Blob[] = [];
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: (blob: Blob): string => {
    createdObjectUrlBlobs.push(blob);
    return `blob:gor-campaign-${createdObjectUrlBlobs.length}`;
  },
});
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (): void => {} });
const anchorDownloads: string[] = [];
Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
  configurable: true,
  value(this: HTMLAnchorElement): void {
    anchorDownloads.push(this.download);
  },
});

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function resetMocks(): void {
  mockRunNewTurn.mockReset();
  mockRunNewTurn.mockImplementation(defaultRunNewTurn);
  mockCreateCharacter.mockReset();
  mockCreateCharacter.mockImplementation(defaultCreateCharacter);
  mockRunNewTurnCore.mockReset();
  mockRunNewTurnCore.mockImplementation(defaultRunNewTurnCore);
  mockCheckForTriggeredEvent.mockReset();
  mockCheckForTriggeredEvent.mockImplementation(defaultCheckForTriggeredEvent);
  mockInitiateWorld.mockReset();
  mockInitiateWorld.mockImplementation(defaultInitiateWorld);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gloryOfRome:onboardingSeen', '1');
  resetMocks();
  createdObjectUrlBlobs.length = 0;
  anchorDownloads.length = 0;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  localStorage.clear();
  vi.restoreAllMocks();
  resetMocks();
});

// --- harness (the createRoot + act idiom of tests/appTransactionContracts.test.ts)

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  await act(async () => {
    descriptor!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void, attempts = 50): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

function findButton(container: HTMLElement, name: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name) ?? null;
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = findButton(container, name);
  expect(button, `button named "${name}"`).not.toBeNull();
  return button!;
}

function buttonContaining(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text));
  expect(button, `button containing "${text}"`).toBeDefined();
  return button!;
}

function byAriaLabel<T extends Element>(container: HTMLElement, label: string): T {
  const control = container.querySelector(`[aria-label="${label}"]`);
  expect(control, `control with aria-label="${label}"`).not.toBeNull();
  return control as T;
}

const chatInput = (container: HTMLElement) => byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
const retryButton = (container: HTMLElement) => findButton(container, 'Retry the last action');
const fateDialog = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="event-modal-title"]');

async function mountApp(): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(React.createElement(GameProvider, null, React.createElement(App)));
  });
  await act(() => whenLazyScreensReady());
  await waitFor(() => expect(container.textContent).toContain('Choose Your Destiny'));
  return container;
}

async function unmountLatest(): Promise<void> {
  const instance = mounted.pop()!;
  await act(async () => instance.root.unmount());
  instance.container.remove();
}

async function continueReign(container: HTMLElement): Promise<void> {
  await click(buttonNamed(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
}

async function setMockMode(container: HTMLElement, on: boolean): Promise<void> {
  await click(buttonNamed(container, 'Settings'));
  const toggle = container.querySelector<HTMLInputElement>('#mock-toggle');
  expect(toggle).not.toBeNull();
  if (toggle!.checked !== on) await click(toggle!);
  expect(toggle!.checked).toBe(on);
  await click(buttonNamed(container, 'Close configuration menu'));
}

async function mountFromSave(state: SaveGameState = makeAppSave(), mockMode = true): Promise<HTMLDivElement> {
  saveGame(state);
  const container = await mountApp();
  await continueReign(container);
  if (mockMode) await setMockMode(container, true);
  return container;
}

async function speak(container: HTMLElement, text: string): Promise<void> {
  await setValue(chatInput(container), text);
  await click(buttonNamed(container, 'Speak'));
}

const transientFailure = () => new AiServiceError('transient', 'mockRunNewTurn', 'provider failed', new Error('offline'));

async function withoutDevKey(run: () => Promise<void>): Promise<void> {
  const priorKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await run();
  } finally {
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorKey;
  }
}

// ---------------------------------------------------------------------------

describe('state-retry-clobbers-edited-draft: Retry never writes over newer words', () => {
  it('steps aside once the tablet is edited after a failure, and returns when the draft is the failed one again', async () => {
    const container = await mountFromSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await speak(container, 'Order A');
    await waitFor(() => expect(retryButton(container)).not.toBeNull());
    expect(chatInput(container).value).toBe('Order A');

    await setValue(chatInput(container), 'Order A, and also seize the granary');
    expect(retryButton(container)).toBeNull();
    expect(chatInput(container).value).toBe('Order A, and also seize the granary');

    // Back to exactly the words that failed: Retry is the same act as Send again.
    await setValue(chatInput(container), 'Order A');
    expect(retryButton(container)).not.toBeNull();
    errorSpy.mockRestore();
  });

  it('a second failure after an edit keeps the edit: only Send is offered, and it sends the new words', async () => {
    const container = await mountFromSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await speak(container, 'Order A');
    await waitFor(() => expect(retryButton(container)).not.toBeNull());

    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await setValue(chatInput(container), 'Order A, and also seize the granary');
    await click(buttonNamed(container, 'Speak'));
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(chatInput(container).value).toBe('Order A, and also seize the granary'));
    expect(retryButton(container)).not.toBeNull();
    expect(loadGame()!.state.turnNumber).toBe(2);
    errorSpy.mockRestore();
  });

  it('never commits the old words over an unsent new thought: the new thought is what Send commits', async () => {
    const container = await mountFromSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await speak(container, 'Order A');
    await waitFor(() => expect(retryButton(container)).not.toBeNull());

    await setValue(chatInput(container), 'A fresh thought I have not sent');
    expect(retryButton(container)).toBeNull();
    await click(buttonNamed(container, 'Speak'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    expect(loadGame()!.state.turnHistory[0].playerIntent).toContain('A fresh thought I have not sent');
    expect(loadGame()!.state.turnHistory[0].playerIntent).not.toContain('Order A');
    errorSpy.mockRestore();
  });

  it('an unedited Retry still resends the failed words and clears the tablet on success', async () => {
    const container = await mountFromSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await speak(container, 'Order A');
    await waitFor(() => expect(retryButton(container)).not.toBeNull());

    await click(retryButton(container)!);
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    expect(loadGame()!.state.turnHistory[0].playerIntent).toContain('Order A');
    expect(chatInput(container).value).toBe('');
    expect(retryButton(container)).toBeNull();
    errorSpy.mockRestore();
  });

  it('holds for the structured tablet too: an edited row hides Retry', async () => {
    const container = await mountFromSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunNewTurn.mockRejectedValueOnce(transientFailure());
    await click(buttonNamed(container, 'Structured'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), 'Hold the forum');
    await click(buttonNamed(container, 'Seal & send'));
    await waitFor(() => expect(retryButton(container)).not.toBeNull());
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1').value).toBe('Hold the forum');

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), 'Hold the forum and the bridge');
    expect(retryButton(container)).toBeNull();
    errorSpy.mockRestore();
  });
});

describe('state-keyless-send-offers-retry: with no key the send is held, and nothing is armed', () => {
  it('holds Speak and every other way in: no turn starts, no Retry, the draft stays', async () => {
    await withoutDevKey(async () => {
      const container = await mountFromSave(makeAppSave(), false);
      const before = localStorage.getItem(SAVE_KEY);
      await setValue(chatInput(container), 'Order A');
      expect(buttonNamed(container, 'Speak').disabled).toBe(true);
      expect(container.textContent).toContain('No token on this device');

      // Enter-to-send reaches the same hold.
      await act(async () => {
        chatInput(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await flush();
      expect(mockRunNewTurnCore).not.toHaveBeenCalled();
      expect(retryButton(container)).toBeNull();
      expect(chatInput(container).value).toBe('Order A');
      expect(container.querySelector('[role="log"]')!.textContent).not.toContain('Order A');
      expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    });
  });

  it('a Retry armed in canned play steps aside when the key goes away, and returns with it', async () => {
    await withoutDevKey(async () => {
      const container = await mountFromSave();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRunNewTurn.mockRejectedValueOnce(transientFailure());
      await speak(container, 'Order A');
      await waitFor(() => expect(retryButton(container)).not.toBeNull());

      await setMockMode(container, false);
      expect(retryButton(container)).toBeNull();
      await setMockMode(container, true);
      expect(retryButton(container)).not.toBeNull();
      errorSpy.mockRestore();
    });
  });
});

describe('forge-without-key-fires-keyless-requests: no custom destiny is forged keyless', () => {
  it('shows the no-key choices over the form, holds the forge, keeps the words, and canned play releases it', async () => {
    await withoutDevKey(async () => {
      const container = await mountApp();
      await click(buttonContaining(container, 'Create Your Own'));
      expect(container.textContent).toContain('No token on this device');
      expect(findButton(container, 'Enter your key')).not.toBeNull();
      const description = byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description');
      await setValue(description, 'A keyless jurist');
      expect(buttonNamed(container, 'Take your place').disabled).toBe(true);

      // A submit that gets past the button is held too.
      await act(async () => {
        description.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await flush();
      expect(mockCreateCharacter).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('Consulting the Fates');
      expect(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description').value).toBe('A keyless jurist');

      await click(buttonNamed(container, 'Play against canned responses'));
      expect(container.textContent).not.toContain('No token on this device');
      expect(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description').value).toBe('A keyless jurist');
      await click(buttonNamed(container, 'Take your place'));
      await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
      expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    });
  });
});

describe('state-worldgen-no-player-silent-and-leaks: a world that names no player fails aloud and leaves nothing behind', () => {
  it('shows the refusal with the words kept, and the next campaign starts from a clean chronicle', async () => {
    const container = await mountApp();
    await setMockMode(container, true);
    mockInitiateWorld.mockImplementationOnce(async (ai, meta, description, isMock) => ({
      ...(await defaultInitiateWorld(ai, meta, description, isMock)),
      playerCharacterId: 'the_stub_id',
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await click(buttonContaining(container, 'Create Your Own'));
    await click(buttonContaining(container, 'A world of your design'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Meta-narrative for custom world'), 'A gothic province');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description'), 'A haunted legate');
    await click(buttonNamed(container, 'Weave the world'));
    await waitFor(() => expect(container.textContent).toContain('The auguries are unfavourable'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description').value).toBe('A haunted legate');

    await click(buttonContaining(container, 'Back to the destinies'));
    await click(buttonContaining(container, 'The Young Emperor'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    const messages = loadGame()!.state.messages;
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toContain('Failed to generate');
    errorSpy.mockRestore();
  });
});

describe('state-destiny-click-overwrites-saved-reign: a destiny over a saved reign asks first', () => {
  it('asks the Abandon question on a preset, keeps the slot on "Keep my reign", and returns focus to the destiny', async () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    const before = localStorage.getItem(SAVE_KEY);
    const container = await mountApp();
    const preset = buttonContaining(container, 'The Young Emperor');
    await act(async () => preset.focus());
    await click(preset);
    expect(container.textContent).toContain('Abandon your saved reign?');
    expect(document.activeElement?.textContent).toBe('Keep my reign');
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);

    await click(buttonNamed(container, 'Keep my reign'));
    expect(container.textContent).not.toContain('Abandon your saved reign?');
    expect(document.activeElement).toBe(preset);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(7);
  });

  it('starts the chosen destiny only once the abandonment is confirmed', async () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    const container = await mountApp();
    await click(buttonContaining(container, 'The Young Emperor'));
    await click(buttonNamed(container, 'Abandon'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(loadGame()!.state.turnNumber).toBe(1);
  });

  it('gates Create Your Own the same way, before any paid call, and a forge abandoned at Back leaves the reign', async () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    const before = localStorage.getItem(SAVE_KEY);
    const container = await mountApp();
    await click(buttonContaining(container, 'Create Your Own'));
    expect(container.textContent).toContain('Abandon your saved reign?');
    expect(container.querySelector('[aria-label="Custom character description"]')).toBeNull();
    await click(buttonNamed(container, 'Abandon'));
    expect(container.querySelector('[aria-label="Custom character description"]')).not.toBeNull();
    await click(buttonContaining(container, 'Back to the destinies'));
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(findButton(container, 'Continue Your Reign')).not.toBeNull();
  });

  it('asks nothing on a fresh device', async () => {
    const container = await mountApp();
    await click(buttonContaining(container, 'The Young Emperor'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(container.textContent).not.toContain('Abandon your saved reign?');
  });
});

describe('state-newer-save-hidden-then-overwritten: a reign this build cannot read is said, kept and guarded', () => {
  it('names a newer version, offers the bytes verbatim, and gates the overwrite behind Abandon', async () => {
    const newer = JSON.stringify({ version: 2, savedAt: '2026-09-01T00:00:00.000Z', state: makeAppSave({ turnNumber: 30 }) });
    localStorage.setItem(SAVE_KEY, newer);
    const container = await mountApp();
    expect(findButton(container, 'Continue Your Reign')).toBeNull();
    expect(container.textContent).toContain('The saved reign cannot be read');
    expect(container.textContent).toContain('another age of the Republic');

    await click(buttonNamed(container, 'Take a copy of the reign'));
    expect(anchorDownloads).toEqual(['gor-reign-turn30.json']);
    expect(await readBlobText(createdObjectUrlBlobs[0])).toBe(newer);

    await click(buttonContaining(container, 'The Young Emperor'));
    expect(container.textContent).toContain('Abandon your saved reign?');
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
    await click(buttonNamed(container, 'Keep my reign'));
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);

    await click(buttonContaining(container, 'The Young Emperor'));
    await click(buttonNamed(container, 'Abandon'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(loadGame()!.state.turnNumber).toBe(1);
  });

  it('Settings offers the copy too, and asks before a restore replaces the unreadable reign', async () => {
    const newer = JSON.stringify({ version: 2, savedAt: '2026-09-01T00:00:00.000Z', state: makeAppSave({ turnNumber: 30 }) });
    localStorage.setItem(SAVE_KEY, newer);
    const container = await mountApp();
    await click(buttonNamed(container, 'Settings'));
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(buttonNamed(dialog, 'Take a copy of the reign'));
    expect(await readBlobText(createdObjectUrlBlobs[0])).toBe(newer);

    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([JSON.stringify({ version: 1, savedAt: 'x', state: makeAppSave({ turnNumber: 4 }) })], 'copy.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: Object.assign([file], { item: () => file }) });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(() => expect(dialog.textContent).toContain('Replace your saved reign with this copy?'));
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  it('says a damaged blob could not be read, and still hands it over without throwing', async () => {
    localStorage.setItem(SAVE_KEY, '{not a reign');
    const container = await mountApp();
    expect(container.textContent).toContain('The reign saved on this device could not be read.');
    await click(buttonNamed(container, 'Take a copy of the reign'));
    expect(anchorDownloads).toEqual(['gor-reign-turn0.json']);
    expect(await readBlobText(createdObjectUrlBlobs[0])).toBe('{not a reign');
  });

  it('a stale tab: Continue over a slot a newer build has since rewritten shows the unreadable reign and keeps the gate', async () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    const container = await mountApp();
    expect(findButton(container, 'Continue Your Reign')).not.toBeNull();

    // Another tab, on a newer build, writes its save after this screen mounted.
    const newer = JSON.stringify({ version: 2, savedAt: '2026-09-01T00:00:00.000Z', state: makeAppSave({ turnNumber: 30 }) });
    localStorage.setItem(SAVE_KEY, newer);
    await click(buttonNamed(container, 'Continue Your Reign'));

    expect(container.querySelector('[aria-label="Chat input"]')).toBeNull();
    expect(findButton(container, 'Continue Your Reign')).toBeNull();
    expect(container.textContent).toContain('The saved reign cannot be read');
    expect(findButton(container, 'Take a copy of the reign')).not.toBeNull();

    await click(buttonContaining(container, 'The Young Emperor'));
    expect(container.textContent).toContain('Abandon your saved reign?');
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
    await click(buttonNamed(container, 'Keep my reign'));
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  it('a stale tab: Continue over a slot another tab has emptied drops the reign card, and a destiny asks nothing', async () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    const container = await mountApp();
    localStorage.removeItem(SAVE_KEY);
    await click(buttonNamed(container, 'Continue Your Reign'));

    expect(findButton(container, 'Continue Your Reign')).toBeNull();
    expect(container.textContent).not.toContain('The saved reign cannot be read');
    await click(buttonContaining(container, 'The Young Emperor'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(container.textContent).not.toContain('Abandon your saved reign?');
  });
});

describe('state-active-event-lost-on-reload: a fate awaiting its choice survives a reload', () => {
  const fate = ALL_EVENTS[0];

  it('restores the fate from the save, holds the tablet, and the choice clears it from the save', async () => {
    mockCheckForTriggeredEvent.mockReturnValueOnce(fate);
    const container = await mountFromSave();
    await speak(container, 'Hold the grain fleet');
    await waitFor(() => expect(fateDialog(container)).not.toBeNull());
    expect(loadGame()!.state.turnNumber).toBe(3);
    expect(loadGame()!.state.pendingEventId).toBe(fate.id);

    // The fate is on disk and a reload reopens it, so leaving asks nothing:
    // a prompt with nothing at risk teaches players to dismiss it (B14).
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);

    await unmountLatest();
    const reloaded = await mountApp();
    await click(buttonNamed(reloaded, 'Continue Your Reign'));
    await waitFor(() => expect(fateDialog(reloaded)).not.toBeNull());
    expect(fateDialog(reloaded)!.textContent).toContain(fate.title);
    expect(chatInput(reloaded).disabled).toBe(true);
    expect(mockCheckForTriggeredEvent).toHaveBeenCalledTimes(1);

    await click(reloaded.querySelector<HTMLButtonElement>('.gor-event-choice')!);
    await waitFor(() => expect(fateDialog(reloaded)).toBeNull());
    const saved = loadGame()!.state;
    expect(saved.pendingEventId).toBeUndefined();
    expect(saved.triggeredEventIds).toContain(fate.id);
    expect(saved.eventHistory).toHaveLength(1);
    const afterChoice = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterChoice);
    expect(afterChoice.defaultPrevented).toBe(false);
  });

  it('asks before leaving only while a fate that failed to reach disk waits, and stops once it is answered', async () => {
    const container = await mountFromSave();
    // The turn autosaves first; the fate's own patch is the write that fails.
    let setItem: ReturnType<typeof vi.spyOn> | undefined;
    mockCheckForTriggeredEvent.mockImplementationOnce(() => {
      setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
      return fate;
    });
    await speak(container, 'Hold the grain fleet');
    await waitFor(() => expect(fateDialog(container)).not.toBeNull());
    expect(loadGame()!.state.pendingEventId).toBeUndefined();

    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    setItem!.mockRestore();
    await click(container.querySelector<HTMLButtonElement>('.gor-event-choice')!);
    await waitFor(() => expect(fateDialog(container)).toBeNull());
    const afterChoice = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterChoice);
    expect(afterChoice.defaultPrevented).toBe(false);
  });

  it('still asks before leaving while a turn is in flight', async () => {
    const container = await mountFromSave();
    let release!: () => void;
    mockRunNewTurn.mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return defaultRunNewTurn(...args);
    });
    await speak(container, 'Hold the grain fleet');
    await waitFor(() => expect(release).toBeTypeOf('function'));

    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(chatInput(container).disabled).toBe(false));
  });

  it('GAME_LOADED reopens a known fate, ignores an unknown id, and never opens one for a dead player', () => {
    const base = makeAppSave();
    const loaded = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: { ...base, pendingEventId: fate.id } });
    expect(loaded.activeEvent?.id).toBe(fate.id);
    expect(loaded.gameState).toBe(GameState.AWAITING_EVENT_CHOICE);

    const unknown = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: { ...base, pendingEventId: 'retired_fate' } });
    expect(unknown.activeEvent).toBeNull();
    expect(unknown.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);

    const legacy = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: base });
    expect(legacy.activeEvent).toBeNull();
    expect(legacy.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);

    const dead = {
      ...base,
      pendingEventId: fate.id,
      entities: base.entities.map(entity => entity.entity_id === base.playerCharacterId ? { ...entity, status: 'dead' as const } : entity),
    };
    const ended = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: dead });
    expect(ended.activeEvent).toBeNull();
    expect(ended.gameState).toBe(GameState.GAME_OVER);
  });

  it('patches the fate only into the save of the campaign and turn that fired it', () => {
    saveGame(makeAppSave({ turnNumber: 4 }));
    expect(updateSavedPendingEvent(fate.id, 3, 'severus_alexander')).toBe(false);
    expect(updateSavedPendingEvent(fate.id, 4, 'someone_else')).toBe(false);
    expect(loadGame()!.state.pendingEventId).toBeUndefined();
    expect(updateSavedPendingEvent(fate.id, 4, 'severus_alexander')).toBe(true);
    expect(loadGame()!.state.pendingEventId).toBe(fate.id);
  });
});

describe('fate-choice-literal-asterisks: the fate leaf carries no markup, and no drop cap', () => {
  it('writes the choice in quotes, with only the bold title as markup', () => {
    const leaf = eventLeafText('Grain Shortage in the Capital', 'Spend your own fortune.');
    expect(leaf).toBe('**Event: Grain Shortage in the Capital**\nYou chose to: “Spend your own fortune.”');
    expect(toSegments(leaf).map(segment => segment.text).join('')).not.toContain('*');
    expect(isEventLeaf(leaf)).toBe(true);
  });

  it('reads a single-asterisk span as emphasis, so older leaves and model italics lose their asterisks', () => {
    expect(toSegments('You chose to: *Pay the legions*')).toEqual([
      { bold: false, text: 'You chose to: ' },
      { bold: false, italic: true, text: 'Pay the legions' },
    ]);
    expect(toSegments('**Event: X**\nYou chose to: *Y*')).toEqual([
      { bold: true, text: 'Event: X' },
      { bold: false, text: '\nYou chose to: ' },
      { bold: false, italic: true, text: 'Y' },
    ]);
    // Arithmetic, bullets and loose asterisks are left as written.
    expect(toSegments('5 * 3 * 2')).toEqual([{ bold: false, text: '5 * 3 * 2' }]);
    expect(toSegments('* one\n* two')).toEqual([{ bold: false, text: '* one\n* two' }]);
    expect(toSegments('a *b\nc* d')).toEqual([{ bold: false, text: 'a *b\nc* d' }]);
  });

  it('renders the emphasis as <em>, never as asterisks', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<ChatMessage message={{ sender: 'gm', text: '**Event: The Mutiny**\nYou chose to: *Pay the legions*' }} />));
    expect(container.querySelector('em')?.textContent).toBe('Pay the legions');
    expect(container.textContent).not.toContain('*');
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the week\'s illuminated initial for the narration, not the fate leaf', () => {
    const stream = [
      { sender: 'gm' as const, text: 'The reign begins.' },
      { sender: 'player' as const, text: 'x' },
      { sender: 'gm' as const, text: 'Narration I' },
      { sender: 'ribbon' as const, text: 'Week II' },
      { sender: 'gm' as const, text: eventLeafText('Grain', 'Pay') },       // 4 - older leaves too:
      { sender: 'gm' as const, text: '**Event: Old**\nYou chose to: *Pay*' }, // 5
      { sender: 'player' as const, text: 'y' },
      { sender: 'gm' as const, text: 'Narration II' },                      // 7 - opens week II
    ];
    expect([...illuminatedNarrationIndices(stream)]).toEqual([0, 7]);
  });
});

describe('destiny-masthead-stale-week and the Header labels', () => {
  const renderHeader = async (props: Partial<React.ComponentProps<typeof Header>>) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Header worldState={INITIAL_WORLD_STATE} onOpenSettings={() => {}} {...props} />));
    return { container, done: async () => { await act(async () => root.unmount()); container.remove(); } };
  };

  it('draws no world stats before a reign is loaded, and draws them in play', async () => {
    const setup = await renderHeader({ showWorldStats: false });
    expect(setup.container.querySelector('.gor-masthead-stats')).toBeNull();
    expect(setup.container.textContent).not.toContain('Economic Stability');
    await setup.done();
    const inPlay = await renderHeader({ compact: true });
    expect(inPlay.container.querySelector('.gor-masthead-stats')).not.toBeNull();
    await inPlay.done();
  });

  it('hides the stats on the destiny screen of the real App, above a saved reign', async () => {
    saveGame(makeAppSave({ turnNumber: 5 }));
    const container = await mountApp();
    expect(container.querySelector('.gor-masthead-stats')).toBeNull();
    await continueReign(container);
    expect(container.querySelector('.gor-masthead-stats')).not.toBeNull();
  });

  it('names Settings and Commands by their visible words (WCAG 2.5.3)', async () => {
    const header = await renderHeader({ onOpenCommands: () => {} });
    const settings = header.container.querySelector<HTMLButtonElement>('.gor-masthead-settings:not(.gor-masthead-commands)')!;
    const commands = header.container.querySelector<HTMLButtonElement>('.gor-masthead-commands')!;
    expect(settings.getAttribute('aria-label')).toBe('Settings');
    expect(settings.textContent).toContain('Settings');
    expect(commands.getAttribute('aria-label')).toBe(HEADER_COPY.commands);
    expect(commands.textContent).toContain(HEADER_COPY.commands);
    await header.done();
  });
});

describe('gui-eventmodal-no-description: the fate dialog is described by its own words', () => {
  it('points aria-describedby at the event body', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<EventModal event={ALL_EVENTS[0]} onChoose={() => {}} />));
    const dialog = container.querySelector('[role="dialog"]')!;
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(ALL_EVENTS[0].description);
    await act(async () => root.unmount());
    container.remove();
  });
});

describe('knowledge-fell-this-week-unwired: the briefing marks a standing that fell, and the mark survives a reload', () => {
  it('orders every standing consistently with its colour bands', () => {
    const rank = { good: 0, warn: 1, bad: 2 } as const;
    for (const standing of Object.keys(STANDING_ORDER) as MacroStanding[]) {
      const order = STANDING_ORDER[standing] as readonly string[];
      const bands = STANDING_SEVERITY[standing] as Record<string, keyof typeof rank>;
      expect(Object.keys(bands).sort()).toEqual([...order].sort());
      for (let index = 1; index < order.length; index += 1) {
        expect(rank[bands[order[index]]]).toBeGreaterThanOrEqual(rank[bands[order[index - 1]]]);
      }
    }
  });

  it('reads a fall along each ordinal, and nothing without a starting state or off the vocabulary', () => {
    const before: SimulationState = INITIAL_SIMULATION_STATE;
    const after: SimulationState = { ...before, plebeian_mood: 'Rioting', senate_status: 'Ascendant', military_status: 'Loyal' };
    expect([...fellStandings(before, after)]).toEqual(['plebeian_mood']);
    expect(fellStandings(undefined, after).size).toBe(0);
    expect(fellStandings({ ...before, senate_status: 'Ascendant' }, before)).toEqual(new Set(['senate_status']));
    const offVocabulary = { ...before, imperial_status: 'Shaken' as SimulationState['imperial_status'] };
    expect(fellStandings(before, offVocabulary).size).toBe(0);
    expect(fellStandings(offVocabulary, before).size).toBe(0);
  });

  it('trims the pre-turn state with the snapshot window, never from the newest entry', () => {
    const history = Array.from({ length: KEEP_FULL_SNAPSHOTS + 2 }, (_, index) => ({
      ...makeTurnHistoryEntry({ turnNumber: index + 1 }),
      preTurnSimulationState: INITIAL_SIMULATION_STATE,
    }));
    const trimmed = withOldSnapshotsDropped(history);
    expect('preTurnSimulationState' in trimmed[0]).toBe(false);
    expect(trimmed[trimmed.length - 1].preTurnSimulationState).toEqual(INITIAL_SIMULATION_STATE);
  });

  it('records the pre-turn state with the committed week and draws the mark, before and after a reload', async () => {
    mockRunNewTurn.mockImplementationOnce(async (...args: Parameters<typeof aiMocks.mockRunNewTurn>) => {
      const result = await defaultRunNewTurn(...args);
      return { ...result, updatedSimulationState: { ...result.updatedSimulationState, plebeian_mood: 'Rioting' } };
    });
    const container = await mountFromSave(makeAppSave({ simulationState: INITIAL_SIMULATION_STATE }));
    expect(container.querySelector('[aria-label="fell this week"]')).toBeNull();
    await speak(container, 'Let the bread run short');
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    expect(loadGame()!.state.turnHistory[0].preTurnSimulationState).toEqual(INITIAL_SIMULATION_STATE);
    await waitFor(() => expect(container.querySelectorAll('[aria-label="fell this week"]')).toHaveLength(1));
    expect(container.textContent).toContain('marks a standing that fell this week');

    await unmountLatest();
    const reloaded = await mountApp();
    await continueReign(reloaded);
    expect(reloaded.querySelectorAll('[aria-label="fell this week"]')).toHaveLength(1);
  });
});

describe('focus-lost-to-body: Continue and a chosen destiny hand the tablet the focus', () => {
  it('focuses the tablet once the continued reign is writable', async () => {
    saveGame(makeAppSave());
    const container = await mountApp();
    await continueReign(container);
    await waitFor(() => expect(document.activeElement).toBe(chatInput(container)));
  });

  it('focuses the tablet after a preset destiny begins', async () => {
    const container = await mountApp();
    await click(buttonContaining(container, 'The Young Emperor'));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(chatInput(container)));
  });

  it('leaves focus with a fate that opens on load', async () => {
    saveGame(makeAppSave({ pendingEventId: ALL_EVENTS[0].id }));
    const container = await mountApp();
    await click(buttonNamed(container, 'Continue Your Reign'));
    await waitFor(() => expect(fateDialog(container)).not.toBeNull());
    await flush();
    expect(fateDialog(container)!.contains(document.activeElement)).toBe(true);
  });
});
