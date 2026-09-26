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
import { whenLazyScreensReady } from '../app/lazyScreens';
import { GameProvider } from '../state/GameContext';
import * as aiMocks from '../ai/mocks';
import * as ambitionTool from '../ai/tools/ambition';
import * as turnCore from '../ai/core/turn';
import * as geminiService from '../ai/core/geminiService';
import * as privateSceneModel from '../privateScene/model';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import { AiServiceError } from '../ai/core/geminiService';
import type { Entity, TurnSubmission } from '../types';
import { getMockInitialState } from './mockData';
import { makeAppSave as baseMakeAppSave } from './factories';
import {
  NO_ATTEMPT_NO_ANSWER,
  PRIVATE_INTENT_ACKNOWLEDGEMENT,
} from '../playerView/noAttemptResponse';

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

vi.mock('../ai/core/geminiService', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/geminiService')>();
  return {
    ...actual,
    generateStructured: vi.fn(actual.generateStructured),
    resetSessionCallLog: vi.fn(actual.resetSessionCallLog),
  };
});

vi.mock('../privateScene/model', async importOriginal => {
  const actual = await importOriginal<typeof import('../privateScene/model')>();
  return { ...actual, eligiblePrivateSceneTargets: vi.fn(actual.eligiblePrivateSceneTargets) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(aiMocks.mockRunNewTurn);
const mockGetDeepAnalysis = vi.mocked(aiMocks.mockGetDeepAnalysis);
const mockGetInvestigationResult = vi.mocked(aiMocks.mockGetInvestigationResult);
const mockCreateCharacter = vi.mocked(aiMocks.mockCreateCharacter);
const mockInferAmbition = vi.mocked(ambitionTool.inferAmbition);
const mockRunNewTurnCore = vi.mocked(turnCore.runNewTurn);
const mockGenerateStructured = vi.mocked(geminiService.generateStructured);
const mockResetSessionCallLog = vi.mocked(geminiService.resetSessionCallLog);
const mockEligibleTargets = vi.mocked(privateSceneModel.eligiblePrivateSceneTargets);
const defaultRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const defaultDeepAnalysis = mockGetDeepAnalysis.getMockImplementation()!;
const defaultInvestigation = mockGetInvestigationResult.getMockImplementation()!;
const defaultCreateCharacter = mockCreateCharacter.getMockImplementation()!;
const defaultInferAmbition = mockInferAmbition.getMockImplementation()!;
const defaultRunNewTurnCore = mockRunNewTurnCore.getMockImplementation()!;
const defaultGenerateStructured = mockGenerateStructured.getMockImplementation()!;
const defaultEligibleTargets = mockEligibleTargets.getMockImplementation()!;
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
  mockGenerateStructured.mockClear();
  mockGenerateStructured.mockImplementation(defaultGenerateStructured);
  mockEligibleTargets.mockClear();
  mockEligibleTargets.mockImplementation(defaultEligibleTargets);
  mockResetSessionCallLog.mockClear();
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
  mockGenerateStructured.mockClear();
  mockGenerateStructured.mockImplementation(defaultGenerateStructured);
  mockEligibleTargets.mockClear();
  mockEligibleTargets.mockImplementation(defaultEligibleTargets);
  mockResetSessionCallLog.mockClear();
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

// The dev-only Mock Mode / GM-console runtime switches live in the
// configuration menu's Developer card since the options-consolidation pass
// (they were Header pills before) - reach them through the menu the way a
// developer does.
async function clickDevSwitch(container: HTMLElement, id: string): Promise<void> {
  await click(buttonNamed(container, 'Open configuration menu'));
  const control = container.querySelector<HTMLInputElement>(id);
  expect(control, `dev switch "${id}"`).not.toBeNull();
  await click(control!);
  await click(buttonNamed(container, 'Close configuration menu'));
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
  return baseMakeAppSave({
    entities: [
      ...initial.entities.map(entity => entity.entity_id === player.entity_id
        ? { ...entity, visibility_network: ['maximinus_thrax', 'gaius_pontius_magnus'] }
        : entity),
      hiddenActor,
    ],
    metaNarrative: 'Task 4 transaction contract.',
    ...overrides,
  });
}

async function renderApp(continueSave: boolean, mockMode = true): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(React.createElement(GameProvider, null, React.createElement(App)));
  });
  // App warms its lazy screens (app/lazyScreens.tsx) right after mount;
  // wait for that warm-up so opening one renders it synchronously.
  await act(() => whenLazyScreensReady());
  await waitFor(() => expect(container.textContent).toContain('Choose Your Destiny'));
  if (!continueSave) return container;
  await click(buttonNamed(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
  if (mockMode) {
    await click(buttonNamed(container, 'Open configuration menu'));
    const mockToggle = container.querySelector<HTMLInputElement>('#mock-toggle');
    expect(mockToggle).not.toBeNull();
    await click(mockToggle!);
    expect(mockToggle!.checked).toBe(true);
    await click(buttonNamed(container, 'Close configuration menu'));
  }
  return container;
}

async function mountApp(state = makeAppSave(), continueSave = true, mockMode = true): Promise<HTMLDivElement> {
  saveGame(state);
  return renderApp(continueSave, mockMode);
}

function failBothSaveWrites(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
}

/**
 * The laurel half-commit notice (WP-21), found by what it says. It is the
 * one notice in the app that reports a SUCCESS, so it takes `role="status"`
 * rather than `role="alert"` — and that role is shared with the composer's
 * character count, so a bare count would prove nothing.
 */
function halfCommitNotes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="status"]'))
    .filter(node => /turn was saved.*follow-up step failed/i.test(node.textContent ?? ''));
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
    'privateScenes',
    'reports',
    'simulationState',
    'suggestedActions',
    'triggeredEventIds',
    'truthLedger',
    'turnHistory',
    'turnNumber',
    'voiceCast',
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

async function openWorldTab(container: HTMLElement): Promise<void> {
  const worldTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .find(button => button.getAttribute('aria-label') === 'World State');
  expect(worldTab, 'World State tab').toBeDefined();
  await click(worldTab!);
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

type ResolvedTurn = Awaited<ReturnType<typeof turnCore.runNewTurn>>;

const SAFE_EVIDENCE_TEXT = 'The west benches are empty before the scheduled vote.';
const SAFE_EVIDENCE_ANSWER = `What you can currently tell:\n- From a scout: ${SAFE_EVIDENCE_TEXT}`;
const BASE_GM_PRIVATE = 'BASE_GM_PRIVATE_SENTINEL: retain this only in the GM artifact.';
const RESPONSE_DIAGNOSTIC = '[No-attempt response] Evidence selection failed; the player received the safe no-answer fallback.';

async function makeResolvedTurn(
  state: SaveGameState,
  submission: TurnSubmission,
  options: { prospectiveEvidence?: boolean; narration?: string; playerMonologue?: string } = {},
): Promise<ResolvedTurn> {
  const player = state.entities.find(entity => entity.entity_id === state.playerCharacterId)!;
  const result = await defaultRunNewTurn(
    submission,
    player,
    state.turnNumber,
    state.entities,
    state.worldState,
    state.reports,
    state.gmInterventionText,
    state.metaNarrative,
    state.simulationState,
    state.truthLedger,
    state.npcIntents,
  );
  const prospectiveEvidence = options.prospectiveEvidence !== false;
  const report = {
    id: `report_${state.turnNumber}_safe_question`,
    turn: state.turnNumber,
    source: 'scout' as const,
    about: 'roman_senate',
    claim: SAFE_EVIDENCE_TEXT,
    credibility: 0.9,
  };
  const narration = options.narration ?? result.narration;
  const playerMonologue = options.playerMonologue ?? result.playerMonologue;
  return {
    ...result,
    narration,
    playerMonologue,
    updatedReports: prospectiveEvidence ? [...state.reports, report] : state.reports,
    newHistoryEntry: {
      ...result.newHistoryEntry,
      narration,
      adjudication: {
        ...result.newHistoryEntry.adjudication,
        deltas: prospectiveEvidence ? result.newHistoryEntry.adjudication.deltas : [],
        gm_private: [...result.newHistoryEntry.adjudication.gm_private, BASE_GM_PRIVATE],
      },
    },
  };
}

interface ObservedSelectorCall {
  prompt: string;
  systemInstruction: string;
}

type SelectorBehavior =
  | 'select_safe_evidence'
  | { decision: 'answer' | 'no_answer'; evidenceIds: readonly string[] }
  | Error;

function installStructuredAi(behavior: SelectorBehavior): ObservedSelectorCall[] {
  const selectorCalls: ObservedSelectorCall[] = [];
  mockGenerateStructured.mockImplementation(async (_ai, request) => {
    if (request.callName === 'relationshipObservations') return [] as never;
    if (request.callName !== 'noAttemptEvidenceSelection') {
      throw new Error(`Unexpected structured call: ${request.callName}`);
    }
    selectorCalls.push({
      prompt: request.prompt,
      systemInstruction: String(request.systemInstruction ?? ''),
    });
    if (behavior instanceof Error) throw behavior;
    if (behavior !== 'select_safe_evidence') return behavior as never;
    const offered = JSON.parse(request.prompt.split('OFFERED EVIDENCE:\n')[1]) as Array<{
      id: string;
      source: string;
      text: string;
    }>;
    const selected = offered.find(item => item.text === SAFE_EVIDENCE_TEXT);
    if (!selected) throw new Error('safe prospective evidence was not offered');
    return { decision: 'answer', evidenceIds: [selected.id] } as never;
  });
  return selectorCalls;
}

async function mountRealApp(state: SaveGameState): Promise<HTMLDivElement> {
  localStorage.setItem('gloryOfRome:apiKey', 'task-4-transaction-provider-key');
  return mountApp(state, true, false);
}

async function submitStructured(
  container: HTMLElement,
  draft: {
    action?: string;
    privateIntent?: string;
    questionOrContext?: string;
  },
): Promise<void> {
  await click(buttonNamed(container, 'Structured'));
  if (draft.action !== undefined) {
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), draft.action);
  }
  if (draft.privateIntent !== undefined) {
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent'), draft.privateIntent);
  }
  if (draft.questionOrContext !== undefined) {
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context'), draft.questionOrContext);
  }
  await click(buttonNamed(container, 'Submit turn'));
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
    await clickDevSwitch(container, '#gm-console-toggle');
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
    await clickDevSwitch(container, '#gm-console-toggle');
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
      await clickDevSwitch(container, '#mock-toggle');
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
      await click(buttonNamed(container, 'Take your place'));
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
    await clickDevSwitch(container, '#gm-console-toggle');
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
    await waitFor(() => expect(container.textContent).toMatch(/your draft is kept/i));
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
    expect(container.textContent).not.toMatch(/your draft is kept/i);
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

  for (const intelKind of ['deep analysis', 'investigation'] as const) {
    for (const outcome of ['resolve', 'reject'] as const) {
      it(`cancels ${intelKind} ${outcome} after Personae unmount with no paid or stale child effects, then permits retry`, async () => {
        const container = await mountApp();
        await openFirstIntelCard(container);
        const beforeBytes = localStorage.getItem('gloryOfRome:autosave');
        const beforeState = loadGame()!.state;
        let settle!: () => void;

        if (intelKind === 'deep analysis') {
          mockGetDeepAnalysis.mockImplementationOnce((...args) => new Promise((resolve, reject) => {
            settle = () => {
              if (outcome === 'resolve') {
                void defaultDeepAnalysis(...args).then(resolve, reject);
              } else {
                reject(new Error('late deep-analysis rejection'));
              }
            };
          }));
          await click(buttonContaining(container, 'Commission'));
          await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(1));
        } else {
          mockGetInvestigationResult.mockImplementationOnce((...args) => new Promise((resolve, reject) => {
            settle = () => {
              if (outcome === 'resolve') {
                void defaultInvestigation(...args).then(resolve, reject);
              } else {
                reject(new Error('late investigation rejection'));
              }
            };
          }));
          await click(revealSecretsButton(container));
          await waitFor(() => expect(mockGetInvestigationResult).toHaveBeenCalledTimes(1));
        }

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await openWorldTab(container);
        expect(container.textContent).not.toContain('Intelligence Briefing');

        settle();
        await flush();

        expect(errorSpy).not.toHaveBeenCalled();
        expect(localStorage.getItem('gloryOfRome:autosave')).toBe(beforeBytes);
        expect(loadGame()!.state).toEqual(beforeState);

        await openFirstIntelCard(container);
        if (intelKind === 'deep analysis') {
          await click(buttonContaining(container, 'Commission'));
          await waitFor(() => expect(mockGetDeepAnalysis).toHaveBeenCalledTimes(2));
          await waitFor(() => expect(
            loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses,
          ).toBe(3));
          expect(container.textContent).toContain('(Mock Analysis)');
        } else {
          await click(revealSecretsButton(container));
          await waitFor(() => expect(mockGetInvestigationResult).toHaveBeenCalledTimes(2));
          await waitFor(() => expect(loadGame()!.state.knowledge).toHaveLength(1));
          expect(container.textContent).toContain('(Mock) Is secretly illiterate.');
        }
        errorSpy.mockRestore();
      });
    }
  }

  it('keeps one custom creation lease across duplicate submits, then restores the exact live draft for retry', async () => {
    const container = await mountApp(makeAppSave(), false);
    await clickDevSwitch(container, '#mock-toggle');
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
    expect(buttonNamed(container, 'Take your place').disabled).toBe(false);

    await click(buttonNamed(container, 'Take your place'));
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

  it('keeps a saved reign retrievable when Start anew cannot durably delete it, then permits the exact retry', async () => {
    const container = await mountApp(makeAppSave(), false);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
      .mockImplementationOnce(() => {
        throw new DOMException('storage unavailable', 'SecurityError');
      });
    mockResetSessionCallLog.mockClear();

    await click(buttonNamed(container, 'Start anew'));
    await click(buttonNamed(container, 'Abandon'));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(1));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state.playerCharacterId).toBe('severus_alexander');
    expect(container.textContent).toContain('Continue Your Reign');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/could not be removed|try again/i);
    expect(mockResetSessionCallLog).not.toHaveBeenCalled();

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const reloaded = await renderApp(false);
    expect(reloaded.textContent).toContain('Continue Your Reign');

    await click(buttonNamed(reloaded, 'Start anew'));
    await click(buttonNamed(reloaded, 'Abandon'));
    await waitFor(() => expect(reloaded.textContent).not.toContain('Continue Your Reign'));

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
    expect(mockResetSessionCallLog).toHaveBeenCalledOnce();
    expect(reloaded.querySelectorAll('[role="alert"]')).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('keeps a finished reign retrievable when Begin a New Chronicle cannot durably delete it, then permits retry', async () => {
    const base = makeAppSave();
    const terminal = makeAppSave({
      entities: base.entities.map(entity => entity.entity_id === 'severus_alexander'
        ? { ...entity, status: 'dead' as const }
        : entity),
    });
    const container = await mountApp(terminal, false);
    await clickDevSwitch(container, '#mock-toggle');
    await click(buttonNamed(container, 'Continue Your Reign'));
    await waitFor(() => expect(container.textContent).toContain('The Story Has Ended'));
    const before = localStorage.getItem('gloryOfRome:autosave');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
      .mockImplementationOnce(() => {
        throw new DOMException('storage unavailable', 'SecurityError');
      });

    await click(buttonNamed(container, 'Begin a New Chronicle'));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/could not be removed|try again/i);
    expect(removeSpy).toHaveBeenCalledOnce();

    await click(buttonNamed(container, 'Begin a New Chronicle'));

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
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
    await clickDevSwitch(container, '#gm-console-toggle');
    await click(buttonNamed(container, 'GM Log'));
    expect(container.textContent).toContain('PRESERVE THE LATEST AMBITION');
    await click(buttonNamed(container, 'Close Game Master screen'));

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const reloaded = await renderApp(true);
    await clickDevSwitch(reloaded, '#gm-console-toggle');
    await click(buttonNamed(reloaded, 'GM Log'));
    expect(reloaded.textContent).toContain('PRESERVE THE LATEST AMBITION');
    expect(loadGame()!.state.turnNumber).toBe(5);
    expectV1BuildSaveShape(localStorage.getItem('gloryOfRome:autosave'));
  });

  it('keeps a failed non-turn alert until the next turn is durably committed, then clears it', async () => {
    const container = await mountApp();
    await playOneTurn(container, 'Create a GM history entry');
    await clickDevSwitch(container, '#gm-console-toggle');
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
      await clickDevSwitch(container, '#gm-console-toggle');
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

describe('App no-attempt response transaction', () => {
  it('selects only prospective safe knowledge and commits one identical deterministic question answer everywhere', async () => {
    const state = makeAppSave();
    const question = 'What can I tell from the west benches?';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: question,
    };
    const resolved = await makeResolvedTurn(state, submission);
    const originalGmPrivate = [...resolved.newHistoryEntry.adjudication.gm_private];
    mockRunNewTurnCore.mockResolvedValueOnce(resolved);
    const selectorCalls = installStructuredAi('select_safe_evidence');
    const container = await mountRealApp(state);

    await submitStructured(container, { questionOrContext: question });
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

    const saved = loadGame()!.state;
    const entry = saved.turnHistory.at(-1)!;
    const committedMessages = saved.messages.slice(-3);
    expect(mockRunNewTurnCore).toHaveBeenCalledTimes(1);
    expect(selectorCalls).toHaveLength(1);
    expect(selectorCalls[0].prompt).toContain(JSON.stringify(question));
    expect(selectorCalls[0].prompt).toContain(SAFE_EVIDENCE_TEXT);
    expect(selectorCalls[0].prompt).not.toContain(BASE_GM_PRIVATE);
    expect(entry.narration).toBe(SAFE_EVIDENCE_ANSWER);
    expect(committedMessages).toEqual([
      expect.objectContaining({ sender: 'player' }),
      { sender: 'gm', text: SAFE_EVIDENCE_ANSWER },
      expect.objectContaining({ sender: 'ribbon' }),
    ]);
    expect(container.textContent).toContain(SAFE_EVIDENCE_ANSWER);
    expect(entry.adjudication.gm_private).toEqual(originalGmPrivate);
    expect(resolved.newHistoryEntry.adjudication.gm_private).toEqual(originalGmPrivate);
  });

  for (const scenario of [
    {
      label: 'no evidence',
      prospectiveEvidence: false,
      behavior: 'select_safe_evidence' as const,
      selectorExpected: false,
      diagnosticExpected: false,
    },
    {
      label: 'explicit model no-answer',
      prospectiveEvidence: true,
      behavior: { decision: 'no_answer', evidenceIds: [] } as const,
      selectorExpected: true,
      diagnosticExpected: false,
    },
    {
      label: 'invalid evidence IDs',
      prospectiveEvidence: true,
      behavior: { decision: 'answer', evidenceIds: ['not-offered'] } as const,
      selectorExpected: true,
      diagnosticExpected: true,
    },
    {
      label: 'schema failure',
      prospectiveEvidence: true,
      behavior: new AiServiceError(
        'fatal',
        'noAttemptEvidenceSelection',
        'SCHEMA_FAILURE_SENTINEL: malformed provider result',
      ),
      selectorExpected: true,
      diagnosticExpected: true,
    },
    {
      label: 'provider failure',
      prospectiveEvidence: true,
      behavior: new Error('PROVIDER_FAILURE_SENTINEL: socket closed'),
      selectorExpected: true,
      diagnosticExpected: true,
    },
  ]) {
    it(`commits the resolved world turn once with the fixed safe fallback after ${scenario.label}`, async () => {
      const state = makeAppSave();
      const question = `QUESTION_SENTINEL_${scenario.label}: what is established?`;
      const submission: TurnSubmission = {
        version: 1,
        kind: 'structured',
        questionOrContext: question,
      };
      const resolved = await makeResolvedTurn(state, submission, {
        prospectiveEvidence: scenario.prospectiveEvidence,
      });
      const originalGmPrivate = [...resolved.newHistoryEntry.adjudication.gm_private];
      mockRunNewTurnCore.mockResolvedValueOnce(resolved);
      const selectorCalls = installStructuredAi(scenario.behavior);
      const container = await mountRealApp(state);

      await submitStructured(container, { questionOrContext: question });
      await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

      const saved = loadGame()!.state;
      const entry = saved.turnHistory.at(-1)!;
      const diagnostics = entry.adjudication.gm_private.filter(item => item.startsWith('[No-attempt response]'));
      expect(mockRunNewTurnCore).toHaveBeenCalledTimes(1);
      expect(saved.turnHistory).toHaveLength(state.turnHistory.length + 1);
      expect(entry.narration).toBe(NO_ATTEMPT_NO_ANSWER);
      expect(saved.messages.filter(message => message.sender === 'gm').at(-1)?.text).toBe(NO_ATTEMPT_NO_ANSWER);
      expect(container.textContent).toContain(NO_ATTEMPT_NO_ANSWER);
      expect(selectorCalls).toHaveLength(scenario.selectorExpected ? 1 : 0);
      expect(diagnostics).toEqual(scenario.diagnosticExpected ? [RESPONSE_DIAGNOSTIC] : []);
      expect(entry.adjudication.gm_private).toEqual(
        scenario.diagnosticExpected
          ? [...originalGmPrivate, RESPONSE_DIAGNOSTIC]
          : originalGmPrivate,
      );
      if (scenario.diagnosticExpected) {
        expect(diagnostics[0]).not.toContain(question);
        expect(diagnostics[0]).not.toContain(SAFE_EVIDENCE_TEXT);
        expect(diagnostics[0]).not.toMatch(/SCHEMA_FAILURE_SENTINEL|PROVIDER_FAILURE_SENTINEL/);
      }
      expect(resolved.newHistoryEntry.adjudication.gm_private).toEqual(originalGmPrivate);
    });
  }
});

describe('App no-attempt response privacy and atomicity', () => {
  it('commits the fixed private-intent acknowledgement without selecting evidence or adding Inner Thoughts', async () => {
    const state = makeAppSave();
    const privateIntent = 'PRIVATE_ONLY_SENTINEL: wait for a better moment.';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      privateIntent,
    };
    const resolved = await makeResolvedTurn(state, submission, { prospectiveEvidence: false });
    mockRunNewTurnCore.mockResolvedValueOnce(resolved);
    const selectorCalls = installStructuredAi('select_safe_evidence');
    const container = await mountRealApp(state);

    await submitStructured(container, { privateIntent });
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

    const saved = loadGame()!.state;
    expect(selectorCalls).toHaveLength(0);
    expect(saved.turnHistory.at(-1)?.narration).toBe(PRIVATE_INTENT_ACKNOWLEDGEMENT);
    expect(saved.messages.slice(-3)).toEqual([
      expect.objectContaining({ sender: 'player' }),
      { sender: 'gm', text: PRIVATE_INTENT_ACKNOWLEDGEMENT },
      expect.objectContaining({ sender: 'ribbon' }),
    ]);
    expect(saved.messages.some(message => message.sender === 'player_monologue')).toBe(false);
    expect(container.textContent).toContain(PRIVATE_INTENT_ACKNOWLEDGEMENT);
  });

  it('sends a question and prospective evidence to the selector without sending or rendering Private Intent', async () => {
    const state = makeAppSave();
    const question = 'QUESTION_WITH_PRIVATE_SENTINEL: what do the benches show?';
    const privateIntent = 'PRIVATE_SELECTOR_POISON_SENTINEL: exploit whichever senator is absent.';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: question,
      privateIntent,
    };
    const resolved = await makeResolvedTurn(state, submission);
    mockRunNewTurnCore.mockResolvedValueOnce(resolved);
    const selectorCalls = installStructuredAi('select_safe_evidence');
    const container = await mountRealApp(state);

    await submitStructured(container, { questionOrContext: question, privateIntent });
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

    const saved = loadGame()!.state;
    expect(selectorCalls).toHaveLength(1);
    expect(selectorCalls[0].prompt).toContain(question);
    expect(selectorCalls[0].prompt).toContain(SAFE_EVIDENCE_TEXT);
    expect(selectorCalls[0].prompt).not.toContain(privateIntent);
    expect(saved.turnHistory.at(-1)?.narration).toBe(SAFE_EVIDENCE_ANSWER);
    expect(SAFE_EVIDENCE_ANSWER).not.toContain(privateIntent);
    expect(saved.messages.filter(message => message.sender === 'gm').at(-1)?.text).not.toContain(privateIntent);
  });

  it('does not invoke the selector for an observable submission and preserves its presentation bytes', async () => {
    const state = makeAppSave();
    const action = 'OBSERVABLE_ACTION_SENTINEL: address the west benches.';
    const question = 'OBSERVABLE_QUESTION_SENTINEL: who answers?';
    const privateIntent = 'OBSERVABLE_PRIVATE_SENTINEL: test their loyalty.';
    const narration = 'OBSERVABLE_NARRATION_SENTINEL: the Senate answers in a single voice.';
    const monologue = 'OBSERVABLE_MONOLOGUE_SENTINEL: their unity may be useful.';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: [action],
      questionOrContext: question,
      privateIntent,
    };
    const resolved = await makeResolvedTurn(state, submission, { narration, playerMonologue: monologue });
    mockRunNewTurnCore.mockImplementationOnce(async (...args) => {
      args[14]?.onNarrationChunk?.(narration);
      return resolved;
    });
    const selectorCalls = installStructuredAi('select_safe_evidence');
    const container = await mountRealApp(state);

    await submitStructured(container, { action, questionOrContext: question, privateIntent });
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

    const saved = loadGame()!.state;
    expect(selectorCalls).toHaveLength(0);
    expect(saved.turnHistory.at(-1)?.narration).toBe(narration);
    expect(saved.messages.slice(-4)).toEqual([
      expect.objectContaining({ sender: 'player' }),
      { sender: 'gm', text: narration },
      { sender: 'player_monologue', text: monologue },
      expect.objectContaining({ sender: 'ribbon' }),
    ]);
    expect(saved.suggestedActions).toEqual(resolved.suggestedActions);
    expect(container.textContent).toContain(narration);
    expect(container.textContent).toContain(monologue);
  });

  it('does not save or reduce a question turn whose transaction is superseded while selector resolution is pending', async () => {
    const state = makeAppSave();
    const question = 'SUPERSEDED_QUESTION_SENTINEL: what is visible?';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: question,
    };
    const resolved = await makeResolvedTurn(state, submission);
    mockRunNewTurnCore.mockResolvedValueOnce(resolved);
    let resolveSelector!: (value: { decision: 'answer'; evidenceIds: string[] }) => void;
    const selectorGate = new Promise<{ decision: 'answer'; evidenceIds: string[] }>(resolve => {
      resolveSelector = resolve;
    });
    const selectorCalls: ObservedSelectorCall[] = [];
    mockGenerateStructured.mockImplementation(async (_ai, request) => {
      if (request.callName === 'relationshipObservations') return [] as never;
      selectorCalls.push({ prompt: request.prompt, systemInstruction: String(request.systemInstruction ?? '') });
      return selectorGate as never;
    });
    const container = await mountRealApp(state);
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    await submitStructured(container, { questionOrContext: question });
    await waitFor(() => expect(selectorCalls).toHaveLength(1));
    expect(
      storageSpy.mock.calls.filter(([key]) => key === 'gloryOfRome:autosave'),
    ).toHaveLength(0);
    storageSpy.mockRestore();

    const oldInstance = mounted.pop()!;
    await act(async () => oldInstance.root.unmount());
    oldInstance.container.remove();
    const replacement = makeAppSave({ turnNumber: 41 });
    saveGame(replacement);
    const replacementBytes = localStorage.getItem('gloryOfRome:autosave');
    const offered = JSON.parse(selectorCalls[0].prompt.split('OFFERED EVIDENCE:\n')[1]) as Array<{ id: string; text: string }>;
    resolveSelector({
      decision: 'answer',
      evidenceIds: [offered.find(item => item.text === SAFE_EVIDENCE_TEXT)!.id],
    });
    await flush();

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
    expect(loadGame()!.state).toEqual(replacement);
    expect(mockRunNewTurnCore).toHaveBeenCalledTimes(1);
  });

  it('restores the exact structured draft and commits no prospective response or knowledge when saving fails', async () => {
    const state = makeAppSave();
    const question = 'SAVE_FAILURE_QUESTION_SENTINEL: what is visible?';
    const privateIntent = 'SAVE_FAILURE_PRIVATE_SENTINEL: preserve this exact draft.';
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      questionOrContext: question,
      privateIntent,
    };
    const resolved = await makeResolvedTurn(state, submission);
    mockRunNewTurnCore.mockResolvedValueOnce(resolved);
    const selectorCalls = installStructuredAi('select_safe_evidence');
    const container = await mountRealApp(state);
    const beforeBytes = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const failingStorage = failBothSaveWrites();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await submitStructured(container, { questionOrContext: question, privateIntent });
    await waitFor(() => expect(container.textContent).toMatch(/your draft is kept/i));
    failingStorage.mockRestore();

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(beforeBytes);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(selectorCalls).toHaveLength(1);
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context').value).toBe(question);
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent').value).toBe(privateIntent);
    expect(container.textContent).not.toContain(SAFE_EVIDENCE_ANSWER);
    expect(JSON.stringify(loadGame()!.state.knowledge)).not.toContain(SAFE_EVIDENCE_TEXT);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('App turn-commit boundary and hidden-error surfacing (C1)', () => {
  it('keeps the durable commit and never rolls back or offers Retry when post-commit work throws', async () => {
    const container = await mountApp(makeAppSave({ turnNumber: 3 }));
    // A sync throw from the direct (unawaited) inferAmbition call at
    // App.tsx:1129 - not a rejected promise, which the existing
    // .catch(console.warn) already absorbs.
    mockInferAmbition.mockImplementationOnce(() => {
      throw new Error('SYNC_POST_COMMIT_SENTINEL');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Trigger post-commit failure');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(4));

    // Autosave stays at N+1.
    expect(loadGame()!.state.turnHistory).toHaveLength(1);
    expect(loadGame()!.state.messages.some(message => message.text.includes('Trigger post-commit failure'))).toBe(true);

    // No rollback / no Retry.
    expect(container.textContent).not.toMatch(/your draft is kept/i);
    expect(container.querySelector('[aria-label="Retry the last action"]')).toBeNull();
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe('');

    // Non-destructive surfacing. WP-21: this is the ONE notice in the app
    // that reports a success, so it is laurel and takes `role="status"` —
    // announcing a saved turn as an error was the defect. It must still be
    // surfaced, still be exactly one, and still say the same thing.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    // Scoped by text, not by count: `role="status"` is not unique on this
    // screen (the composer's character count is one), unlike `role="alert"`.
    expect(halfCommitNotes(container)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();

    // Liveness: no PROCESSING soft-lock, and no double resolution.
    await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').disabled).toBe(false));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Play continues');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(5));
    // And it clears on the next successful commit, as it always did.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(halfCommitNotes(container)).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it('surfaces a failed event-choice save inside the modal dialog and keeps the choice retryable', async () => {
    const base = makeAppSave();
    const state = makeAppSave({
      worldState: { ...base.worldState, economic_stability: 'Failing' },
    });
    const container = await mountApp(state);
    await playOneTurn(container, 'Inspect the failing grain supply');
    await waitFor(() => expect(container.textContent).toContain('Grain Shortage in the Capital'));
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const choice = buttonContaining(container, 'Spend your own fortune on grain');
    await click(choice);
    await waitFor(() => expect(storageSpy).toHaveBeenCalledTimes(2));

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const dialogAlerts = dialog.querySelectorAll('[role="alert"]');
    expect(dialogAlerts).toHaveLength(1);
    expect(dialogAlerts[0].textContent).toMatch(/could not be saved.*try again/i);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(choice.disabled).toBe(false);

    storageSpy.mockRestore();
    await click(choice);
    await waitFor(() => expect(loadGame()!.state.eventHistory).toHaveLength(1));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    warnSpy.mockRestore();
  });

  it('reports a no-longer-eligible private-scene target inside the dialog and permits retry', async () => {
    // The retry below must reach a real successful commit, which requires a
    // non-empty NPC current_state_narrative (the private-scene prompt's
    // selfDescription field, ai/prompts/privateScene.ts) - unlike every
    // other test above, which never exercises a full private-scene commit.
    // mockData.ts's fixture entities carry "" there; patched here (not in
    // that shared, out-of-ownership file) via the same makeAppSave overrides
    // every other test in this file already uses.
    const state = makeAppSave({
      entities: makeAppSave().entities.map(entity => entity.entity_id === 'maximinus_thrax'
        ? { ...entity, current_state_narrative: 'Watches the capital with grim, patient calculation.' }
        : entity),
    });
    const container = await mountApp(state);
    await click(buttonNamed(container, 'Private scene'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private-scene opening'), 'A word in private, general.');
    // Flip handler-time eligibility only - the rendered select survives
    // (privateSceneTargets useMemo at App.tsx:429-432 doesn't recompute on
    // draft typing).
    mockEligibleTargets.mockReturnValue([]);

    const before = localStorage.getItem('gloryOfRome:autosave');
    await click(buttonNamed(container, 'Send invitation'));
    await flush();

    const dialogAlert = container.querySelector('dialog')!.querySelector('[role="alert"]')!;
    expect(dialogAlert.textContent).toMatch(/no longer within reach/i);
    expect(loadGame()!.state.privateScenes ?? []).toHaveLength(0);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);

    // Retry.
    mockEligibleTargets.mockImplementation(defaultEligibleTargets);
    await click(buttonNamed(container, 'Send invitation'));
    await waitFor(() => expect(loadGame()!.state.privateScenes ?? []).toHaveLength(1));
    expect(container.querySelector('dialog')!.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports a vanished private-scene contact inside the dialog', async () => {
    mockEligibleTargets.mockReturnValue([{ entityId: 'ghost_contact', displayName: 'A Vanished Contact' }]);
    const container = await mountApp();
    await click(buttonNamed(container, 'Private scene'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private-scene opening'), 'A word in private, general.');

    const before = localStorage.getItem('gloryOfRome:autosave');
    await click(buttonNamed(container, 'Send invitation'));
    await flush();

    const dialogAlert = container.querySelector('dialog')!.querySelector('[role="alert"]')!;
    expect(dialogAlert.textContent).toMatch(/no longer be found/i);
    expect(loadGame()!.state.privateScenes ?? []).toHaveLength(0);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
  });
});

// Task 7 Part 2 (commitDomainMutation extraction) [REGRESSION PIN]: every
// save-then-dispatch site clears its App-level error channel on the success
// path (App.tsx's setTransactionError(null), placed BEFORE the dispatch at
// these four sites). The failure halves of these journeys are pinned in
// "App non-turn save atomicity" above; these add the missing half - after a
// failed durable write, the SAME retry that durably commits must also remove
// the alert. A dropped or mis-wired error clear during the helper extraction
// turns exactly one of these red. (The remaining sites' clears are already
// pinned: turn commit by "keeps a failed non-turn alert until the next turn
// is durably committed, then clears it"; event choice by C1's "surfaces a
// failed event-choice save inside the modal dialog and keeps the choice
// retryable"; private scene by C1's "reports a no-longer-eligible
// private-scene target inside the dialog and permits retry".)
describe('App commit-site success paths clear the transaction alert (Task 7 pins)', () => {
  it('clears the campaign-save alert when the same character selection retry durably commits [REGRESSION PIN]', async () => {
    const container = await mountApp(makeAppSave(), false);
    const preset = buttonContaining(container, 'The Young Emperor');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(preset);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    storageSpy.mockRestore();
    await click(preset);
    await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('clears the Deep Analysis alert when the same commission retry durably commits [REGRESSION PIN]', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    const commission = buttonContaining(container, 'Commission');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(commission);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    storageSpy.mockRestore();
    await click(commission);
    await waitFor(() => expect(loadGame()!.state.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.deep_analyses).toBe(3));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('clears the investigation alert when the same reveal retry durably commits [REGRESSION PIN]', async () => {
    const container = await mountApp();
    await openFirstIntelCard(container);
    const revealSecrets = revealSecretsButton(container);
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(revealSecrets);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    storageSpy.mockRestore();
    await click(revealSecrets);
    await waitFor(() => expect(loadGame()!.state.knowledge).toHaveLength(1));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('clears the GM directive alert when the same directive retry durably commits [REGRESSION PIN]', async () => {
    const container = await mountApp();
    await playOneTurn(container);
    await clickDevSwitch(container, '#gm-console-toggle');
    await click(buttonNamed(container, 'GM Log'));
    const directive = 'Clear this alert on durable success.';
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Game Master Intervention Input');
    const submit = buttonNamed(container, 'Set Directive for Next Turn');
    await setValue(input, directive);
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(submit);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    storageSpy.mockRestore();
    await click(submit);
    await waitFor(() => expect(loadGame()!.state.gmInterventionText).toBe(directive));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

// Reign export/import wiring (spec:
// docs/superpowers/specs/2026-08-05-reign-export-import-design.md, "Tests").
// The feature died at the wiring once — d8df778 removed onTakeCopy at the
// App seam while every unit surface stayed green — so these mount the REAL
// App and pin the seams themselves: the save-failure notice actually carries
// the copy action, pressing it actually runs the download path against the
// real slot, and character select's "Restore from a copy" actually reaches
// importSaveBlob's slot write.
//
// jsdom implements neither URL.createObjectURL nor revokeObjectURL, so the
// pair is defined here for the whole file — downloadTheReign cannot run
// without them. They are installed once and never removed: the 10s deferred
// revoke can fire after the suite is done, and that late timer must meet a
// function, not undefined.
const createdObjectUrlBlobs: Blob[] = [];
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: (blob: Blob): string => {
    createdObjectUrlBlobs.push(blob);
    return `blob:gor-test-${createdObjectUrlBlobs.length}`;
  },
});
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (): void => {} });

// An anchor click in jsdom would try to navigate; capture the download name
// it would have started instead. Same never-removed rule as the URL pair.
const anchorDownloads: string[] = [];
Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
  configurable: true,
  value(this: HTMLAnchorElement): void {
    anchorDownloads.push(this.download);
  },
});

/** jsdom's Blob has no .text() — read it the way the app itself reads files. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * Plants a File on the hidden import input and fires the change the OS
 * picker would (same shape as reignImportSurfaces.test.tsx — the array
 * carries `item` too, so the component may read `files[0]` or `files.item(0)`).
 */
async function chooseImportFile(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, 'the hidden reign file input').not.toBeNull();
  const file = new File([text], 'gor-reign-week5.json', { type: 'application/json' });
  const fileList = Object.assign([file], { item: (index: number) => [file][index] ?? null });
  Object.defineProperty(input!, 'files', { configurable: true, value: fileList });
  await act(async () => {
    input!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('App reign export/import wiring (VERIFY pins)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createdObjectUrlBlobs.length = 0;
    anchorDownloads.length = 0;
  });

  it('offers "Take a copy of the reign" on a real forced save failure, and pressing it downloads the slot bytes', async () => {
    const container = await mountApp(makeAppSave(), false);
    const slotBefore = localStorage.getItem('gloryOfRome:autosave');
    const preset = buttonContaining(container, 'The Young Emperor');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(preset);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    // The notice ITSELF — not some other control on the screen — offers the
    // copy: TransactionNoteView passes onTakeCopy through to SaveFailureNotice.
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('Take a copy of the reign');

    // Pressing it runs the real download path against the real slot: reads
    // still work while writes fail, which is exactly the rescue this notice
    // exists for. The filename carries the SLOT's week (the failed campaign
    // never landed), and the blob handed over is the slot byte-for-byte.
    await click(buttonNamed(alert, 'Take a copy of the reign'));
    expect(anchorDownloads).toEqual(['gor-reign-week2.json']);
    expect(createdObjectUrlBlobs).toHaveLength(1);
    expect(await readBlobText(createdObjectUrlBlobs[0])).toBe(slotBefore);

    storageSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('offers no copy on a save failure when there is no reign on disk to copy', async () => {
    // Fresh device, first campaign, and the write fails. The copy action
    // gates on the SAME loadGame() read as lastSafeTurn, so the notice that
    // says nothing is written down yet cannot also offer a download of it.
    const container = await renderApp(false);
    const preset = buttonContaining(container, 'The Young Emperor');
    const storageSpy = failBothSaveWrites();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await click(preset);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    const alert = container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('Nothing of this reign has been written down yet');
    expect(alert.textContent).not.toMatch(/take a copy/i);
    expect(anchorDownloads).toEqual([]);

    storageSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('wires character select\'s "Restore from a copy" to the real import route: refusal in fiction, then a real slot write and reload', async () => {
    // Mint a genuine blob through the real save pipeline, then clear the
    // device — the fresh-device restore case, where no confirm gates it.
    saveGame(makeAppSave({ turnNumber: 5 }));
    const blob = localStorage.getItem('gloryOfRome:autosave')!;
    localStorage.clear();
    localStorage.setItem('gloryOfRome:onboardingSeen', '1');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = await renderApp(false);
    expect(container.textContent).toContain('Restore from a copy');

    // A refused scroll speaks in fiction and writes nothing. The reason can
    // only have come from the real validateSaveBlob, so the seam is live.
    await chooseImportFile(container, 'not even json');
    await waitFor(() => expect(container.textContent).toContain('This scroll could not be read as a reign.'));
    expect(container.textContent).toContain('Your current reign is untouched.');
    expect(localStorage.getItem('gloryOfRome:autosave')).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    // The genuine blob goes through: the REAL importSaveBlob writes the slot
    // byte-for-byte, and only then does the boot-path reload fire.
    await chooseImportFile(container, blob);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(blob);
    expect(loadGame()!.state.turnNumber).toBe(5);
    warnSpy.mockRestore();
  });
});

describe('B7a hardening — the import-review residuals (spec: 2026-08-05-b7a-hardening-and-tablist-design.md)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('boots a saved reign whose name is not a string to the continue summary — never a crash loop (1a)', async () => {
    // The boot reader (App's loadSavedGameSummary) mirrors importSaveBlob's
    // derive: a non-string name reads 'Unknown' — NOT String() coercion ("5"
    // is a pretense), and NOT the raw 5, which crashed CharacterSelection at
    // `(characterName || 'R').charAt(0)` and, behind the ErrorBoundary's
    // reload, crash-looped boot forever. The shallow validator accepts this
    // slot on purpose (hand-edit parity), so the derive is the guard.
    // React reports the render crash this red test exists to remove; the spy
    // keeps the run readable in both states.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const poisoned = makeAppSave({
      playerCharacterId: 'p',
      entities: [{ entity_id: 'p', name: 5 } as unknown as Entity],
    });

    const container = await mountApp(poisoned, false);

    expect(container.textContent).toContain('Choose Your Destiny');
    expect(container.textContent).toContain('Playing as');
    expect(container.textContent).toContain('Unknown');
  });

  it('an ok reign import invalidates the pending ambition tail, exactly like turn rollback (1c)', async () => {
    // The D8 tail is fire-and-forget and lands well after its turn: without
    // a campaign-generation bump on import, a tail armed by the OLD reign
    // patches its stale ambition into the freshly IMPORTED slot. The ruling:
    // App wraps importSaveBlob in a handleImportReign that bumps
    // campaignGenerationRef on ok, and BOTH homes receive the wrapper. The
    // ref is App-internal, so the bump's one honest observable is the
    // existing generation guard at useExecuteTurn's tail — pinned here in
    // this file's own held-ambition idiom, through the Settings home.
    const container = await mountApp(makeAppSave({ turnNumber: 3 }));
    let resolveAmbition!: (value: Awaited<ReturnType<typeof ambitionTool.inferAmbition>>) => void;
    mockInferAmbition.mockImplementationOnce(() => new Promise(resolve => { resolveAmbition = resolve; }));

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Arm the ambition tail');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(4));
    await waitFor(() => expect(mockInferAmbition).toHaveBeenCalledTimes(1));

    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const imported = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      state: makeAppSave({ turnNumber: 9 }),
    });

    await click(buttonNamed(container, 'Open configuration menu'));
    await chooseImportFile(container, imported);
    // A reign is at stake, so the Abandon-grammar confirm gates the write.
    await waitFor(() => expect(container.textContent).toContain('Keep my reign'));
    await click(buttonNamed(container, 'Replace'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(loadGame()!.state.turnNumber).toBe(9);
    expect(loadGame()!.state.inferredAmbition).toBeNull();

    // Now the held inference resolves — AFTER the import bumped the
    // generation. The tail must not dispatch and must not patch the slot.
    vi.useFakeTimers();
    resolveAmbition({ apparent_ambition: 'STALE_PRE_IMPORT_AMBITION', confidence: 'high' });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });
    vi.useRealTimers();

    expect(loadGame()!.state.turnNumber).toBe(9);
    expect(loadGame()!.state.inferredAmbition).toBeNull();
    expect(JSON.stringify(loadGame()!.state)).not.toContain('STALE_PRE_IMPORT_AMBITION');
  });
});
