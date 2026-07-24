/**
 * @vitest-environment jsdom
 *
 * Phase 6 Task 4 repair contract: every App mutation is a persisted
 * transaction, and no out-of-band mutation may interleave with a turn.
 * The real App/provider/reducer/persistence/event/intelligence wiring runs;
 * only the external AI boundary is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { GameProvider } from '../state/GameContext';
import { createInitialGameState } from '../state/gameReducer';
import * as aiMocks from '../ai/mocks';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import { AiServiceError } from '../ai/core/geminiService';
import type { Entity } from '../types';
import { getMockInitialState } from './mockData';

vi.mock('../ai/mocks', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/mocks')>();
  return {
    ...actual,
    mockRunNewTurn: vi.fn(actual.mockRunNewTurn),
    mockGetDeepAnalysis: vi.fn(actual.mockGetDeepAnalysis),
    mockGetInvestigationResult: vi.fn(actual.mockGetInvestigationResult),
  };
});

vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(aiMocks.mockRunNewTurn);
const mockGetDeepAnalysis = vi.mocked(aiMocks.mockGetDeepAnalysis);
const mockGetInvestigationResult = vi.mocked(aiMocks.mockGetInvestigationResult);
const defaultRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const defaultDeepAnalysis = mockGetDeepAnalysis.getMockImplementation()!;
const defaultInvestigation = mockGetInvestigationResult.getMockImplementation()!;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gloryOfRome:onboardingSeen', '1');
  mockRunNewTurn.mockClear();
  mockRunNewTurn.mockImplementation(defaultRunNewTurn);
  mockGetDeepAnalysis.mockClear();
  mockGetDeepAnalysis.mockImplementation(defaultDeepAnalysis);
  mockGetInvestigationResult.mockClear();
  mockGetInvestigationResult.mockImplementation(defaultInvestigation);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  localStorage.clear();
  vi.restoreAllMocks();
  mockRunNewTurn.mockClear();
  mockRunNewTurn.mockImplementation(defaultRunNewTurn);
  mockGetDeepAnalysis.mockClear();
  mockGetDeepAnalysis.mockImplementation(defaultDeepAnalysis);
  mockGetInvestigationResult.mockClear();
  mockGetInvestigationResult.mockImplementation(defaultInvestigation);
});

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name);
  expect(button, `button named "${name}"`).toBeDefined();
  return button as HTMLButtonElement;
}

function buttonContaining(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.includes(text));
  expect(button, `button containing "${text}"`).toBeDefined();
  return button as HTMLButtonElement;
}

function byAriaLabel<T extends Element>(container: HTMLElement, label: string): T {
  const control = container.querySelector(`[aria-label="${label}"]`);
  expect(control, `control with aria-label="${label}"`).not.toBeNull();
  return control as T;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  expect(descriptor?.set).toBeTypeOf('function');
  await act(async () => {
    descriptor!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
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

function makeAppSave(overrides: Partial<SaveGameState> = {}): SaveGameState {
  const initial = getMockInitialState();
  const player = initial.entities.find(entity => entity.entity_id === 'severus_alexander')!;
  const template = initial.entities.find(entity => entity.entity_id === 'maximinus_thrax')!;
  const hiddenActor: Entity = {
    ...template,
    entity_id: 'hidden_actor',
    name: 'HIDDEN_ACTOR_SENTINEL',
    relationships: {},
    memories: [],
    visibility_network: [],
  };
  return {
    entities: [
      ...initial.entities.map(entity => entity.entity_id === player.entity_id
        ? { ...entity, visibility_network: ['maximinus_thrax', 'gaius_pontius_magnus'] }
        : entity),
      hiddenActor,
    ],
    worldState: initial.worldState,
    simulationState: createInitialGameState().simulationState,
    reports: [],
    truthLedger: [],
    knowledge: [],
    npcIntents: [],
    turnNumber: 2,
    playerCharacterId: player.entity_id,
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'Task 4 transaction contract.',
    messages: [],
    triggeredEventIds: [],
    eventFirings: [],
    suggestedActions: [],
    currentEvents: [],
    gmInterventionText: '',
    inferredAmbition: null,
    pendingIntelligenceFallout: [],
    ...overrides,
  };
}

async function renderApp(continueSave: boolean): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(React.createElement(GameProvider, null, React.createElement(App)));
  });
  await waitFor(() => expect(container.textContent).toContain('Choose Your Destiny'));
  if (!continueSave) return container;
  await click(buttonNamed(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
  const mockToggle = container.querySelector<HTMLInputElement>('#mock-toggle');
  expect(mockToggle).not.toBeNull();
  await click(mockToggle!);
  expect(mockToggle!.checked).toBe(true);
  return container;
}

async function mountApp(state = makeAppSave(), continueSave = true): Promise<HTMLDivElement> {
  saveGame(state);
  return renderApp(continueSave);
}

function failBothSaveWrites(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
}

function expectOneTransactionAlert(container: HTMLElement): void {
  const alerts = container.querySelectorAll('[role="alert"]');
  expect(alerts, 'one accessible in-session persistence alert').toHaveLength(1);
  expect(alerts[0].textContent).toMatch(/save|persist|retry|try again/i);
}

function expectV1BuildSaveShape(raw: string | null): void {
  expect(raw).not.toBeNull();
  const envelope = JSON.parse(raw!) as { version: number; state: Record<string, unknown> };
  expect(envelope.version).toBe(1);
  expect(Object.keys(envelope.state).sort()).toEqual([
    'currentEvents',
    'entities',
    'eventFirings',
    'eventHistory',
    'gmInterventionText',
    'inferredAmbition',
    'knowledge',
    'messages',
    'metaNarrative',
    'npcIntents',
    'pendingIntelligenceFallout',
    'playerCharacterId',
    'reports',
    'simulationState',
    'suggestedActions',
    'triggeredEventIds',
    'truthLedger',
    'turnHistory',
    'turnNumber',
    'worldState',
  ]);
  expect(envelope.state).not.toHaveProperty('activeEvent');
  expect(envelope.state).not.toHaveProperty('gameState');
  expect(envelope.state).not.toHaveProperty('retrySubmission');
}

async function openFirstIntelCard(container: HTMLElement): Promise<void> {
  const personaeTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'));
  expect(personaeTab, 'Dramatis Personae tab').toBeDefined();
  await click(personaeTab!);
  await click(buttonNamed(container, 'Intel'));
}

function revealSecretsButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.startsWith('Reveal') &&
    candidate.parentElement?.parentElement?.textContent?.includes('Secrets'));
  expect(button, 'Secrets reveal button').toBeDefined();
  return button as HTMLButtonElement;
}

async function playOneTurn(container: HTMLElement, text = 'Open the transaction ledger'): Promise<void> {
  await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), text);
  await click(buttonNamed(container, 'Send message'));
  await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
}

describe('App non-turn save atomicity', () => {
  it('keeps CharacterSelection and the prior bytes when a new campaign cannot persist, then permits the same selection retry', async () => {
    const container = await mountApp(makeAppSave(), false);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const preset = buttonContaining(container, 'The Young Emperor');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(preset);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    expect(container.textContent).toContain('Choose Your Destiny');
    expect(container.querySelector('[aria-label="Chat input"]')).toBeNull();
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expectOneTransactionAlert(container);
    expect(container.contains(preset)).toBe(true);

    storageSpy.mockRestore();
    await click(preset);
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(loadGame()!.state.messages).toHaveLength(1);
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    warnSpy.mockRestore();
  });

  it('does not spend or display a Deep Analysis until the same state is durably saved, and keeps Commission retryable', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const commission = buttonContaining(container, 'Commission');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(commission);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(container.textContent).toContain('[ No deep analysis commissioned ]');
    expect(container.textContent).not.toContain('(Mock Analysis)');
    expectOneTransactionAlert(container);
    expect(container.contains(commission)).toBe(true);

    storageSpy.mockRestore();
    await click(commission);
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    expect(container.textContent).toContain('(Mock Analysis)');
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    warnSpy.mockRestore();
  });

  it('rolls back paid intel, knowledge, blackmail, fallout, hint, and display on write failure and retries the same reveal once', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const revealSecrets = revealSecretsButton(container);
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(revealSecrets);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(container.textContent).not.toContain('(Mock) Is secretly illiterate.');
    expect(container.textContent).not.toContain('visit did not go unnoticed');
    expectOneTransactionAlert(container);
    expect(container.contains(revealSecrets)).toBe(true);

    storageSpy.mockRestore();
    await click(revealSecrets);
    await waitFor(() => expect(loadGame()!.state.knowledge).toHaveLength(1));
    const committed = loadGame()!.state;
    expect(committed.messages.filter(message => message.text.includes('visit did not go unnoticed'))).toHaveLength(1);
    expect(committed.pendingIntelligenceFallout).toHaveLength(1);
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    warnSpy.mockRestore();
  });

  it('persists the investigation fallout hint in the same commit and renders it once after immediate reload', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    await click(revealSecretsButton(container));
    await waitFor(() => expect(loadGame()!.state.knowledge).toHaveLength(1));

    const hint = 'Your agent returns';
    const savedRaw = localStorage.getItem('gloryOfRome:autosave');
    expect(loadGame()!.state.messages.filter(message => message.text.includes(hint))).toHaveLength(1);
    expectV1BuildSaveShape(savedRaw);

    const current = mounted.pop()!;
    await act(async () => current.root.unmount());
    current.container.remove();
    const reloaded = await renderApp(true);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(savedRaw);
    expect(reloaded.querySelector('[role="log"]')!.textContent?.match(/Your agent returns/g)).toHaveLength(1);
  });

  it('keeps a triggered event modal and all event/domain/transcript slices unchanged when its choice cannot persist', async () => {
    const base = makeAppSave();
    const state = makeAppSave({
      worldState: { ...base.worldState, economic_stability: 'Failing' },
    });
    const container = await mountApp(state);
    await playOneTurn(container, 'Inspect the failing grain supply');
    await waitFor(() => expect(container.textContent).toContain('Grain Shortage in the Capital'));
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const choice = buttonContaining(container, 'Spend your own fortune on grain');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(choice);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    expect(container.textContent).toContain('Grain Shortage in the Capital');
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expectOneTransactionAlert(container);
    expect(container.contains(choice)).toBe(true);

    storageSpy.mockRestore();
    await click(choice);
    await waitFor(() => expect(loadGame()!.state.eventHistory).toHaveLength(1));
    expect(loadGame()!.state.messages.filter(message => message.text.includes('Event: Grain Shortage'))).toHaveLength(1);
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    warnSpy.mockRestore();
  });

  it('persists a GM directive immediately, with the v1 buildSaveState shape and one confirmation', async () => {
    const container = await mountApp();
    await playOneTurn(container);
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(container, 'GM Log'));
    const directive = 'The grain fleet arrives under armed escort.';
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input'), directive);
    await click(buttonNamed(container, 'Set Directive for Next Turn'));
    await waitFor(() => expect(loadGame()!.state.gmInterventionText).toBe(directive));

    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    expect(container.textContent?.match(/The Fates have heard/g)).toHaveLength(1);
  });

  it('does not confirm or change a GM directive when both writes fail, and leaves the exact directive retryable', async () => {
    const container = await mountApp();
    await playOneTurn(container);
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(container, 'GM Log'));
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const directive = 'Keep this exact directive retryable.';
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input');
    const submit = buttonNamed(container, 'Set Directive for Next Turn');
    await setValue(input, directive);
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(submit);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(container.textContent).not.toContain('The Fates have heard');
    expect(input.value).toBe(directive);
    expectOneTransactionAlert(container);
    expect(container.contains(submit)).toBe(true);

    storageSpy.mockRestore();
    await click(submit);
    await waitFor(() => expect(loadGame()!.state.gmInterventionText).toBe(directive));
    expect(container.textContent?.match(/The Fates have heard/g)).toHaveLength(1);
    warnSpy.mockRestore();
  });
});

describe('App in-flight transaction barrier', () => {
  for (const outcome of ['success', 'failure'] as const) {
    it(`visibly and at handler level rejects Deep Analysis, investigation, and GM writes during a turn that ends in ${outcome}`, async () => {
      const container = await mountApp();
      await playOneTurn(container, 'Create one ledger entry');
      await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
      await click(buttonNamed(container, 'GM Log'));
      const directiveInput = byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input');
      const directiveButton = buttonNamed(container, 'Set Directive for Next Turn');
      await setValue(directiveInput, `Barrier ${outcome} directive`);
      await openFirstIntelCard(container);
      const commission = buttonContaining(container, 'Commission');
      const investigation = revealSecretsButton(container);
      const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
      const before = localStorage.getItem('gloryOfRome:autosave');
      const beforeState = loadGame()!.state;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      mockRunNewTurn.mockImplementationOnce(async (...args) => {
        await gate;
        if (outcome === 'failure') {
          throw new AiServiceError('transient', 'mockRunNewTurn', 'barrier failure', new Error('offline'));
        }
        return defaultRunNewTurn(...args);
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

      await setValue(input, `Hold the turn open for ${outcome}`);
      await act(async () => {
        input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(2));

      expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').disabled).toBe(true);
      expect(commission.disabled).toBe(true);
      expect(investigation.disabled).toBe(true);
      expect(directiveButton.disabled).toBe(true);

      // Force adversarial stale controls enabled. The handler barrier, not
      // only HTML disabled state, must reject these programmatic clicks.
      commission.disabled = false;
      investigation.disabled = false;
      directiveButton.disabled = false;
      await click(commission);
      await click(investigation);
      await click(directiveButton);
      expect(mockGetDeepAnalysis).not.toHaveBeenCalled();
      expect(mockGetInvestigationResult).not.toHaveBeenCalled();
      expect(storageSpy).not.toHaveBeenCalled();

      release();
      if (outcome === 'success') {
        // This turn starts on the ambition-inference interval, so let its
        // legitimate delayed ambition-only storage patch settle. The barrier
        // contract concerns saves attributable to the blocked handlers and
        // the completed turn, not unrelated post-commit enrichment.
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 75));
        });
        await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(beforeState.turnNumber + 1));
        const capturedStates = storageSpy.mock.calls
          .filter(([key]) => key === 'gloryOfRome:autosave')
          .map(([, raw]) => (JSON.parse(String(raw)) as { state: SaveGameState }).state);
        const completedTurnSaves = capturedStates.filter(state =>
          state.turnNumber === beforeState.turnNumber + 1 &&
          state.turnHistory.length === beforeState.turnHistory.length + 1 &&
          state.inferredAmbition === beforeState.inferredAmbition,
        );
        expect(completedTurnSaves, 'exactly one durable save from the completed turn').toHaveLength(1);
        for (const persisted of capturedStates) {
          expect(persisted.gmInterventionText).toBe(beforeState.gmInterventionText);
          expect(persisted.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses)
            .toBe(beforeState.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses);
          expect(persisted.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.investigations)
            .toBe(beforeState.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.investigations);
          expect(JSON.stringify(persisted)).not.toContain(`Barrier ${outcome} directive`);
          expect(JSON.stringify(persisted)).not.toContain('(Mock Analysis)');
          expect(JSON.stringify(persisted)).not.toContain('(Mock) Is secretly illiterate.');
        }
        expect(loadGame()!.state.turnHistory).toHaveLength(beforeState.turnHistory.length + 1);
        expect(loadGame()!.state.messages.filter(message => message.sender === 'player')).toHaveLength(2);
      } else {
        await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));
        expect(storageSpy).not.toHaveBeenCalled();
        expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
        expect(loadGame()!.state).toEqual(beforeState);
      }
      await flush();
      expect(mockGetDeepAnalysis).not.toHaveBeenCalled();
      expect(mockGetInvestigationResult).not.toHaveBeenCalled();
      expect(loadGame()!.state.gmInterventionText).toBe(beforeState.gmInterventionText);
      // A successful turn may legitimately ingest perception knowledge or
      // consume pre-existing fallout. This asserts only the barred concurrent
      // actions, while the failure branch above retains full-state equality.
      expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses)
        .toBe(beforeState.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses);
      expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.investigations)
        .toBe(beforeState.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.investigations);
      expect(JSON.stringify(loadGame()!.state)).not.toContain(`Barrier ${outcome} directive`);
      expect(container.textContent).not.toContain('(Mock Analysis)');
      expect(container.textContent).not.toContain('(Mock) Is secretly illiterate.');
      storageSpy.mockRestore();
      errorSpy.mockRestore();
    });
  }
});
