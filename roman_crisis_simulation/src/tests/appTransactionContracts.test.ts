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
import * as ambitionTool from '../ai/tools/ambition';
import * as turnCore from '../ai/core/turn';
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
    mockCreateCharacter: vi.fn(actual.mockCreateCharacter),
  };
});

vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../ai/tools/ambition', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/tools/ambition')>();
  return {
    ...actual,
    inferAmbition: vi.fn(actual.inferAmbition),
  };
});

vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return {
    ...actual,
    runNewTurn: vi.fn(actual.runNewTurn),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(aiMocks.mockRunNewTurn);
const mockGetDeepAnalysis = vi.mocked(aiMocks.mockGetDeepAnalysis);
const mockGetInvestigationResult = vi.mocked(aiMocks.mockGetInvestigationResult);
const mockCreateCharacter = vi.mocked(aiMocks.mockCreateCharacter);
const mockInferAmbition = vi.mocked(ambitionTool.inferAmbition);
const mockRunNewTurnCore = vi.mocked(turnCore.runNewTurn);
const defaultRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const defaultDeepAnalysis = mockGetDeepAnalysis.getMockImplementation()!;
const defaultInvestigation = mockGetInvestigationResult.getMockImplementation()!;
const defaultCreateCharacter = mockCreateCharacter.getMockImplementation()!;
const defaultInferAmbition = mockInferAmbition.getMockImplementation()!;
const defaultRunNewTurnCore = mockRunNewTurnCore.getMockImplementation()!;
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
  mockCreateCharacter.mockClear();
  mockCreateCharacter.mockImplementation(defaultCreateCharacter);
  mockInferAmbition.mockClear();
  mockInferAmbition.mockImplementation(defaultInferAmbition);
  mockRunNewTurnCore.mockClear();
  mockRunNewTurnCore.mockImplementation(defaultRunNewTurnCore);
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
  mockCreateCharacter.mockClear();
  mockCreateCharacter.mockImplementation(defaultCreateCharacter);
  mockInferAmbition.mockClear();
  mockInferAmbition.mockImplementation(defaultInferAmbition);
  mockRunNewTurnCore.mockClear();
  mockRunNewTurnCore.mockImplementation(defaultRunNewTurnCore);
  vi.useRealTimers();
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

async function openPersonaeTab(container: HTMLElement): Promise<void> {
  const personaeTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'));
  expect(personaeTab, 'Dramatis Personae tab').toBeDefined();
  await click(personaeTab!);
}

function entityCard(container: HTMLElement, name: string): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>('section.gor-card'))
    .find(candidate => candidate.querySelector('.gor-card-title')?.textContent?.trim() === name);
  expect(card, `Personae card for "${name}"`).toBeDefined();
  return card!;
}

async function openFirstIntelCard(container: HTMLElement): Promise<void> {
  await openPersonaeTab(container);
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
    const container = await mountApp(makeAppSave({
      inferredAmbition: {
        apparent_ambition: 'OLD CAMPAIGN AMBITION MUST NOT LEAK',
        confidence: 'high',
        asOfTurn: 2,
      },
    }), false);
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
  it('ignores late turn stage and narration callbacks after the owning App unmounts', async () => {
    const container = await mountApp();
    let capturedOptions: turnCore.RunNewTurnOptions | undefined;
    mockRunNewTurnCore.mockImplementationOnce((...args) => {
      capturedOptions = args[14];
      return new Promise(() => {});
    });
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Hold callbacks past unmount');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(capturedOptions).toBeDefined());

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const replacement = makeAppSave({ turnNumber: 9 });
    saveGame(replacement);
    const replacementBytes = localStorage.getItem('gloryOfRome:autosave');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    capturedOptions!.onStage?.('narration');
    capturedOptions!.onNarrationChunk?.('STALE STREAM');
    await flush();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
    expect(loadGame()!.state).toEqual(replacement);
    errorSpy.mockRestore();
  });

  it('drops a late turn rejection after unmount without rollback, state writes, or warnings', async () => {
    const container = await mountApp();
    let rejectTurn!: (reason: unknown) => void;
    mockRunNewTurnCore.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectTurn = reject;
    }));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Reject after unmount');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(mockRunNewTurnCore).toHaveBeenCalledTimes(1));

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const replacement = makeAppSave({ turnNumber: 11 });
    saveGame(replacement);
    const replacementBytes = localStorage.getItem('gloryOfRome:autosave');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    rejectTurn(new Error('late rejected turn'));
    await flush();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
    expect(loadGame()!.state).toEqual(replacement);
    errorSpy.mockRestore();
  });

  for (const outcome of ['resolve', 'reject'] as const) {
    it(`cancels custom-character ${outcome} after App unmount without child state writes or save replacement`, async () => {
      const container = await mountApp(makeAppSave(), false);
      const mockToggle = container.querySelector<HTMLInputElement>('#mock-toggle')!;
      await click(mockToggle);
      await click(buttonContaining(container, 'Create Your Own'));
      const description = `Custom lifecycle ${outcome}`;
      await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description'), description);
      let settle!: () => void;
      mockCreateCharacter.mockImplementationOnce(() => new Promise((resolve, reject) => {
        settle = () => {
          if (outcome === 'resolve') {
            void defaultCreateCharacter(description).then(resolve);
          } else {
            reject(new Error('late custom creation rejection'));
          }
        };
      }));
      await click(buttonNamed(container, 'Create Character'));
      await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
      expect(container.textContent).toContain('Consulting the Fates');

      const oldInstance = mounted.pop()!;
      await act(async () => oldInstance.root.unmount());
      oldInstance.container.remove();
      const replacement = makeAppSave({ turnNumber: 13 });
      saveGame(replacement);
      const replacementBytes = localStorage.getItem('gloryOfRome:autosave');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      settle();
      await flush();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
      expect(loadGame()!.state).toEqual(replacement);
      errorSpy.mockRestore();
    });
  }

  it('holds one shared mutex from intel request through durable commit and rejects forced cross-surface entry', async () => {
    const container = await mountApp();
    await playOneTurn(container, 'Establish the shared transaction baseline');
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(container, 'GM Log'));
    const directiveInput = byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input');
    const directiveButton = buttonNamed(container, 'Set Directive for Next Turn');
    await setValue(directiveInput, 'This stale directive must not interleave.');
    await openFirstIntelCard(container);
    const commission = buttonContaining(container, 'Commission');
    const investigation = revealSecretsButton(container);
    const chatInput = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    const queuedDraft = 'This valid draft must wait for the intelligence lease';
    await setValue(chatInput, queuedDraft);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockGetDeepAnalysis.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultDeepAnalysis(...args);
    });
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    await act(async () => {
      commission.click();
      commission.click();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));

    expect(container.textContent).toContain('The assessment is being drawn up');
    expect(investigation.disabled).toBe(true);
    expect(directiveButton.disabled).toBe(true);
    expect(chatInput.disabled).toBe(true);

    investigation.disabled = false;
    directiveButton.disabled = false;
    chatInput.disabled = false;
    await click(investigation);
    await click(directiveButton);
    await act(async () => {
      chatInput.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1);
    expect(mockGetInvestigationResult).not.toHaveBeenCalled();
    expect(mockRunNewTurn).toHaveBeenCalledTimes(1);
    expect(storageSpy).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    expect(container.textContent).toContain('(Mock Analysis)');
    expect(loadGame()!.state.gmInterventionText).toBe('');
    expect(storageSpy).toHaveBeenCalledTimes(1);

    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(queuedDraft);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(4));
    expect(mockRunNewTurn).toHaveBeenCalledTimes(2);
    expect(loadGame()!.state.messages.some(message => message.text.includes(queuedDraft))).toBe(true);
    storageSpy.mockRestore();
  });

  it('serializes intelligence requests across different Personae cards and releases the second card after commit', async () => {
    const container = await mountApp();
    await openPersonaeTab(container);
    const maximinusCard = entityCard(container, 'Maximinus Thrax');
    const gaiusCard = entityCard(container, 'Gaius Pontius Magnus');
    await click(buttonNamed(maximinusCard, 'Intel'));
    await click(buttonNamed(gaiusCard, 'Intel'));
    const firstCommission = buttonContaining(maximinusCard, 'Commission');
    const secondCommission = buttonContaining(gaiusCard, 'Commission');
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mockGetDeepAnalysis.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultDeepAnalysis(...args);
    });
    const before = loadGame()!.state;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    await click(firstCommission);
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));
    expect(secondCommission.disabled).toBe(true);
    secondCommission.disabled = false;
    await click(secondCommission);

    expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1);
    expect(storageSpy).not.toHaveBeenCalled();
    expect(loadGame()!.state).toEqual(before);
    expect(container.textContent).not.toContain('(Mock Analysis)');

    release();
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    expect(maximinusCard.textContent).toContain('(Mock Analysis)');
    expect(gaiusCard.textContent).not.toContain('(Mock Analysis)');

    await click(secondCommission);
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(2));
    expect(gaiusCard.textContent).toContain('(Mock Analysis)');
    expect(storageSpy).toHaveBeenCalledTimes(2);
    storageSpy.mockRestore();
  });

  it('rejects a forced event choice while an intel request owns the shared mutex', async () => {
    const base = makeAppSave();
    const container = await mountApp(makeAppSave({
      worldState: { ...base.worldState, economic_stability: 'Failing' },
    }));
    await playOneTurn(container, 'Bring the grain crisis to a decision');
    await waitFor(() => expect(container.textContent).toContain('Grain Shortage in the Capital'));
    const eventChoice = buttonContaining(container, 'Spend your own fortune on grain');
    await openFirstIntelCard(container);
    const commission = buttonContaining(container, 'Commission');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockGetDeepAnalysis.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultDeepAnalysis(...args);
    });
    const before = localStorage.getItem('gloryOfRome:autosave');
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    await click(commission);
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));
    expect(eventChoice.disabled).toBe(true);
    eventChoice.disabled = false;
    await click(eventChoice);
    expect(storageSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);

    release();
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(1));
    expect(loadGame()!.state.eventHistory).toHaveLength(0);
    expect(container.textContent).toContain('Grain Shortage in the Capital');
    storageSpy.mockRestore();
  });

  it('releases the mutex after an intel AI rejection and leaves the exact request retryable', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    const commission = buttonContaining(container, 'Commission');
    mockGetDeepAnalysis.mockRejectedValueOnce(new Error('intel provider offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await click(commission);
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));
    await flush();

    expect(container.contains(commission)).toBe(true);
    expect(commission.disabled).toBe(false);
    await click(commission);
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    expect(container.textContent).toContain('(Mock Analysis)');
    errorSpy.mockRestore();
  });

  it('rejects a stale Retry handler during intel, then submits the exact restored draft after release', async () => {
    const container = await mountApp();
    const exactDraft = 'Restore this exact failed action for retry';
    mockRunNewTurnCore.mockRejectedValueOnce(new Error('turn provider offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), exactDraft);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(container.textContent).toContain('draft has been restored'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(exactDraft);
    const retry = buttonNamed(container, 'Retry the last action');

    await openFirstIntelCard(container);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mockGetDeepAnalysis.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultDeepAnalysis(...args);
    });
    await click(buttonContaining(container, 'Commission'));
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));
    expect(retry.disabled).toBe(true);

    retry.disabled = false;
    await click(retry);
    expect(mockRunNewTurnCore).toHaveBeenCalledTimes(1);
    expect(loadGame()!.state.turnNumber).toBe(2);

    release();
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    await click(retry);
    await waitFor(() => expect(mockRunNewTurnCore).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(3));
    expect(loadGame()!.state.messages.some(message => message.text.includes(exactDraft))).toBe(true);
    expect(container.textContent).not.toContain('draft has been restored');
    errorSpy.mockRestore();
  });

  it('cancels an in-flight intel commit when its owning App unmounts', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockGetDeepAnalysis.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultDeepAnalysis(...args);
    });
    await click(buttonContaining(container, 'Commission'));
    await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const replacement = makeAppSave({ turnNumber: 9 });
    saveGame(replacement);
    const replacementBytes = localStorage.getItem('gloryOfRome:autosave');

    release();
    await flush();

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
    expect(loadGame()!.state).toEqual(replacement);
  });

  it('keeps one custom creation lease across duplicate submits, then restores the exact live draft for retry', async () => {
    const container = await mountApp(makeAppSave(), false);
    await click(container.querySelector<HTMLInputElement>('#mock-toggle')!);
    await click(buttonContaining(container, 'Create Your Own'));
    const draft = 'A veteran jurist with an exact retryable history';
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description');
    await setValue(input, draft);
    let rejectCreation!: (reason: unknown) => void;
    mockCreateCharacter.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectCreation = reject;
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const form = input.closest('form')!;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(container.textContent).toContain('Consulting the Fates');

    rejectCreation(new Error('live custom provider failure'));
    await waitFor(() => expect(container.textContent).toContain('auguries are not in our favor'));
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Custom character description').value).toBe(draft);
    expect(buttonNamed(container, 'Create Character').disabled).toBe(false);

    await click(buttonNamed(container, 'Create Character'));
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(loadGame()!.state.messages).toHaveLength(1);
    expect(loadGame()!.state.inferredAmbition).toBeNull();
    expect(JSON.stringify(loadGame()!.state)).not.toContain('OLD CAMPAIGN AMBITION MUST NOT LEAK');
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
    errorSpy.mockRestore();
  });

  it('rejects a re-entrant stale campaign control before its first synchronous save returns', async () => {
    const container = await mountApp(makeAppSave(), false);
    const firstDestiny = buttonContaining(container, 'The Young Emperor');
    const staleSecondDestiny = buttonContaining(container, 'The Ambitious General');
    const originalSetItem = Storage.prototype.setItem;
    let forcedReentry = false;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'gloryOfRome:autosave' && !forcedReentry) {
        forcedReentry = true;
        staleSecondDestiny.disabled = false;
        staleSecondDestiny.click();
      }
      return originalSetItem.call(this, key, value);
    });

    await click(firstDestiny);
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());

    expect(storageSpy).toHaveBeenCalledTimes(1);
    expect(loadGame()!.state.playerCharacterId).toBe('severus_alexander');
    expect(loadGame()!.state.messages).toHaveLength(1);
    storageSpy.mockRestore();
  });

  it('lets Continue own the lease and rejects a re-entrant preset handler', async () => {
    const container = await mountApp(makeAppSave(), false);
    const continueButton = buttonNamed(container, 'Continue Your Reign');
    const stalePreset = buttonContaining(container, 'The Ambitious General');
    const originalGetItem = Storage.prototype.getItem;
    let forcedReentry = false;
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'gloryOfRome:autosave' && !forcedReentry) {
        forcedReentry = true;
        stalePreset.disabled = false;
        stalePreset.click();
      }
      return originalGetItem.call(this, key);
    });

    await click(continueButton);
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());

    expect(forcedReentry).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(loadGame()!.state.playerCharacterId).toBe('severus_alexander');
    getSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('lets confirmed Start anew own the lease and rejects a re-entrant preset handler', async () => {
    const container = await mountApp(makeAppSave(), false);
    await click(buttonNamed(container, 'Start anew'));
    const stalePreset = buttonContaining(container, 'The Ambitious General');
    const abandonButton = buttonNamed(container, 'Abandon');
    const originalRemoveItem = Storage.prototype.removeItem;
    let forcedReentry = false;
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === 'gloryOfRome:autosave' && !forcedReentry) {
        forcedReentry = true;
        stalePreset.disabled = false;
        stalePreset.click();
      }
      return originalRemoveItem.call(this, key);
    });

    await click(abandonButton);
    await waitFor(() => expect(container.textContent).not.toContain('Continue Your Reign'));

    expect(forcedReentry).toBe(true);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
    expect(container.textContent).toContain('Choose Your Destiny');
    expect(container.querySelector('[aria-label="Chat input"]')).toBeNull();
    removeSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('rejects a re-entrant confirmed Start anew handler while a preset save owns the lease', async () => {
    const container = await mountApp(makeAppSave(), false);
    await click(buttonNamed(container, 'Start anew'));
    const preset = buttonContaining(container, 'The Young Emperor');
    const staleAbandon = buttonNamed(container, 'Abandon');
    const originalSetItem = Storage.prototype.setItem;
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
    let forcedReentry = false;
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'gloryOfRome:autosave' && !forcedReentry) {
        forcedReentry = true;
        staleAbandon.disabled = false;
        staleAbandon.click();
      }
      return originalSetItem.call(this, key, value);
    });

    await click(preset);
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());

    expect(forcedReentry).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(loadGame()!.state.playerCharacterId).toBe('severus_alexander');
    writeSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('keeps committed pills and persisted bytes exact while AI is held, hiding pills only in presentation', async () => {
    const state = makeAppSave({ suggestedActions: ['OLD_COMMITTED_PILL'] });
    const container = await mountApp(state);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockRunNewTurn.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultRunNewTurn(...args);
    });
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');

    await setValue(input, 'Hold the candidate open');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(1));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(container.textContent).not.toContain('OLD_COMMITTED_PILL');

    release();
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(3));
    expect(loadGame()!.state.suggestedActions).not.toContain('OLD_COMMITTED_PILL');
  });

  it('cancels a delayed ambition result when the owning App session is abandoned', async () => {
    const container = await mountApp(makeAppSave({ turnNumber: 3 }));
    let resolveAmbition!: (value: Awaited<ReturnType<typeof ambitionTool.inferAmbition>>) => void;
    mockInferAmbition.mockImplementationOnce(() => new Promise(resolve => { resolveAmbition = resolve; }));

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Trigger the old campaign inference');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(mockInferAmbition).toHaveBeenCalledTimes(1));

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const replacement = makeAppSave({ turnNumber: 1, inferredAmbition: null });
    saveGame(replacement);
    await renderApp(true);

    vi.useFakeTimers();
    resolveAmbition({
      apparent_ambition: 'STALE_ABANDONED_CAMPAIGN_AMBITION',
      confidence: 'high',
    });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });
    vi.useRealTimers();

    expect(loadGame()!.state.inferredAmbition).toBeNull();
    expect(JSON.stringify(loadGame()!.state)).not.toContain('STALE_ABANDONED_CAMPAIGN_AMBITION');
  });

  it('keeps a newer periodic ambition when the following full-turn save commits later', async () => {
    const container = await mountApp(makeAppSave({ turnNumber: 3 }));
    let resolveAmbition!: (value: Awaited<ReturnType<typeof ambitionTool.inferAmbition>>) => void;
    mockInferAmbition.mockImplementationOnce(() => new Promise(resolve => {
      resolveAmbition = resolve;
    }));

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Trigger the periodic ambition read');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(4));
    await waitFor(() => expect(mockInferAmbition).toHaveBeenCalledTimes(1));
    expect(loadGame()!.state.inferredAmbition).toBeNull();

    let releaseTurn!: () => void;
    const turnGate = new Promise<void>(resolve => {
      releaseTurn = resolve;
    });
    mockRunNewTurnCore.mockImplementationOnce(async (...args) => {
      await turnGate;
      return defaultRunNewTurnCore(...args);
    });
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Commit after ambition');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(mockRunNewTurnCore).toHaveBeenCalledTimes(2));

    const newestAmbition = {
      apparent_ambition: 'PRESERVE THE LATEST AMBITION',
      confidence: 'high' as const,
    };
    vi.useFakeTimers();
    resolveAmbition(newestAmbition);
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(loadGame()!.state.inferredAmbition).toEqual({ ...newestAmbition, asOfTurn: 3 });

    releaseTurn();
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(5));

    expect(loadGame()!.state.inferredAmbition).toEqual({ ...newestAmbition, asOfTurn: 3 });
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(container, 'GM Log'));
    expect(container.textContent).toContain('PRESERVE THE LATEST AMBITION');
    await click(buttonNamed(container, 'Close Game Master screen'));

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const reloaded = await renderApp(true);
    await click(reloaded.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(reloaded, 'GM Log'));
    expect(reloaded.textContent).toContain('PRESERVE THE LATEST AMBITION');
    expect(loadGame()!.state.turnNumber).toBe(5);
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
  });

  it('keeps a failed non-turn alert until the next turn is durably committed, then clears it', async () => {
    const container = await mountApp();
    await playOneTurn(container, 'Create a GM history entry');
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(buttonNamed(container, 'GM Log'));
    const directiveButton = buttonNamed(container, 'Set Directive for Next Turn');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input'), 'This write will fail.');
    const failingStorage = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await click(directiveButton);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));
    failingStorage.mockRestore();
    await click(buttonNamed(container, 'Close Game Master screen'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockRunNewTurn.mockImplementationOnce(async (...args) => {
      await gate;
      return defaultRunNewTurn(...args);
    });
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    const beforeTurn = loadGame()!.state.turnNumber;
    await setValue(input, 'Commit a clean durable turn');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(2));

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(loadGame()!.state.turnNumber).toBe(beforeTurn);

    release();
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(beforeTurn + 1));
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0));
    expect(loadGame()!.state.messages.some(message => message.text.includes('Commit a clean durable turn'))).toBe(true);
    warnSpy.mockRestore();
  });

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
