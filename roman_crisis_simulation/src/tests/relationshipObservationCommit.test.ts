/**
 * @vitest-environment jsdom
 *
 * Phase 6 Task 7 RED contract: relationship observations are selected only
 * from player-safe evidence and are awaited inside App's atomic turn lease.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { GameProvider } from '../state/GameContext';
import { createInitialGameState } from '../state/gameReducer';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import { projectForExternalInference } from '../playerInput/turnSubmission';
import * as relationshipModule from '../knowledge/relationships';
import * as observationTool from '../ai/tools/relationshipObservations';
import * as turnModule from '../ai/core/turn';
import * as visibilityModule from '../perception/visibility';
import * as aiMocks from '../ai/mocks';
import * as intelModule from '../components/tabs/dramatisPersonaeIntel';
import type { PerceivedChange } from '../perception/visibility';
import type { PlayerSafeEvidence, RelationshipObservationDraft } from '../knowledge/store';
import type { GeminiClient } from '../ai/core/geminiService';
import type { Entity, Report, TurnSubmission } from '../types';
import { ingestRelationshipObservations } from '../knowledge/relationships';
import { getMockInitialState } from './mockData';

vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn() };
});

vi.mock('../ai/tools/relationshipObservations', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/tools/relationshipObservations')>();
  return { ...actual, getRelationshipObservations: vi.fn() };
});

vi.mock('../perception/visibility', async importOriginal => {
  const actual = await importOriginal<typeof import('../perception/visibility')>();
  return {
    ...actual,
    buildPerceivedDigest: vi.fn(actual.buildPerceivedDigest),
    buildPlayerPerceivedDigest: vi.fn(actual.buildPlayerPerceivedDigest),
  };
});

vi.mock('../components/tabs/dramatisPersonaeIntel', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/tabs/dramatisPersonaeIntel')>();
  return { ...actual, resolveIntelRequest: vi.fn() };
});

vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRunNewTurn = vi.mocked(turnModule.runNewTurn);
const mockGetRelationshipObservations = vi.mocked(observationTool.getRelationshipObservations);
const mockBuildPlayerPerceivedDigest = vi.mocked(visibilityModule.buildPlayerPerceivedDigest);
const mockResolveIntelRequest = vi.mocked(intelModule.resolveIntelRequest);
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

async function runRealToolWithDrafts(
  evidence: PlayerSafeEvidence[],
  directory: Array<{ entity_id: string; name: string }>,
  knownEntityIds: readonly string[],
  drafts: unknown[],
): Promise<RelationshipObservationDraft[]> {
  const realTool = await vi.importActual<typeof import('../ai/tools/relationshipObservations')>(
    '../ai/tools/relationshipObservations'
  );
  const ai: GeminiClient = {
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(drafts) }),
    },
  };
  return realTool.getRelationshipObservations(
    ai,
    evidence,
    directory,
    knownEntityIds,
    false,
  );
}

function validDraftCiting(evidence: PlayerSafeEvidence[], evidenceId: string): RelationshipObservationDraft {
  const cited = evidence.find(item => item.id === evidenceId)!;
  return {
    evidenceId: cited.id,
    participantIds: ['severus_alexander', 'maximinus_thrax'],
    excerpt: cited.text,
  };
}

type TurnEvidenceInput = {
  submission: string | null;
  perceivedChanges: PerceivedChange[];
  reports: Report[];
};

type TurnEvidenceBuilder = (input: TurnEvidenceInput) => PlayerSafeEvidence[];

function turnEvidenceBuilder(): TurnEvidenceBuilder {
  const candidate = (relationshipModule as unknown as Record<string, unknown>).buildTurnRelationshipEvidence;
  expect(candidate, 'Task 7 public buildTurnRelationshipEvidence export').toBeTypeOf('function');
  return candidate as TurnEvidenceBuilder;
}

async function defaultTurnResult(...args: Parameters<typeof turnModule.runNewTurn>) {
  return aiMocks.mockRunNewTurn(
    args[1], args[2], args[3], args[4], args[5], args[8], args[11], args[13],
    args[6], args[9], args[10],
  );
}

function makeAppSave(overrides: Partial<SaveGameState> = {}): SaveGameState {
  const initial = getMockInitialState();
  return {
    entities: initial.entities,
    worldState: initial.worldState,
    simulationState: createInitialGameState().simulationState,
    reports: [],
    truthLedger: [],
    knowledge: [],
    npcIntents: [],
    turnNumber: 2,
    playerCharacterId: 'severus_alexander',
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'Task 7 observation integration.',
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

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate =>
    candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name);
  expect(button, `button named "${name}"`).toBeDefined();
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

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  expect(descriptor?.set).toBeTypeOf('function');
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

async function mountApp(state = makeAppSave()): Promise<HTMLDivElement> {
  saveGame(state);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(React.createElement(GameProvider, null, React.createElement(App))));
  await waitFor(() => expect(container.textContent).toContain('Choose Your Destiny'));
  await click(buttonNamed(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
  return container;
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

function withPoisonedPlayerResult(result: Awaited<ReturnType<typeof defaultTurnResult>>) {
  const report: Report = {
    id: 'report_task7_lucius',
    turn: 999,
    source: 'rumor',
    about: 'maximinus_thrax',
    claim: 'Maximinus Thrax publicly warned Severus Alexander before the Senate.',
    credibility: 0.7,
  };
  const poisonedEntities = result.updatedEntities.map(entity => entity.entity_id === 'maximinus_thrax'
    ? {
        ...entity,
        secret_truth: { actually_alive: true, hidden_since_turn: 1, motive: 'SECRET_TRUTH_POISON' },
        short_term_goals: ['GOAL_POISON'],
        relationships: { ...entity.relationships, severus_alexander: { ...entity.relationships.severus_alexander, relationship_type: 'RELATION_OBJECT_POISON' } },
      } as unknown as Entity
    : entity);
  const relationDelta = {
    type: 'relation' as const,
    key: 'maximinus_thrax:severus_alexander:trust_level',
    delta: -9,
    reason: 'RAW_RELATION_DELTA_POISON',
  };
  const adjudication = {
    ...result.newHistoryEntry.adjudication,
    deltas: [...result.newHistoryEntry.adjudication.deltas, relationDelta],
    gm_private: [...result.newHistoryEntry.adjudication.gm_private, 'TRACE_POISON'],
  };
  return {
    ...result,
    updatedEntities: poisonedEntities,
    updatedReports: [...result.updatedReports, report],
    narration: "the player secretly plans Lucius's death.",
    headlines: ['HEADLINE_POISON'],
    newHistoryEntry: {
      ...result.newHistoryEntry,
      adjudication,
      narration: "the player secretly plans Lucius's death.",
      postTurnEntities: poisonedEntities,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gloryOfRome:onboardingSeen', '1');
  localStorage.setItem('gloryOfRome:apiKey', 'test-only-key');
  mockRunNewTurn.mockReset();
  mockRunNewTurn.mockImplementation(defaultTurnResult);
  mockGetRelationshipObservations.mockReset();
  mockGetRelationshipObservations.mockResolvedValue([]);
  mockBuildPlayerPerceivedDigest.mockClear();
  mockResolveIntelRequest.mockReset();
  mockResolveIntelRequest.mockResolvedValue({
    kind: 'investigation',
    investigationKind: 'secrets',
    charged: true,
    cost: 1,
    display: ['REPORT_DATA_PRIVATE_POISON'],
    reportData: ['REPORT_DATA_PRIVATE_POISON'],
    outcome: {
      target_id: 'maximinus_thrax',
      report: 'A public agent report says Maximinus Thrax met Severus Alexander in the Curia.',
      consequences: 'FALLOUT_TRACE_POISON',
    },
  });
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
});

describe('buildTurnRelationshipEvidence allowlist', () => {
  it('builds only from the observable submission projection, player digest, and new reports', () => {
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Warn the Senate'],
      privateIntent: 'poison Lucius',
    };
    const perceivedChanges: PerceivedChange[] = [{
      text: 'A public courier reached the Curia.',
      source: 'public',
      tabs: ['reports'],
      subject: 'world',
      deltaType: 'rumor',
      deltaKey: 'courier',
    }];
    const reports: Report[] = [{
      id: 'report_safe_1', turn: 88, source: 'rumor', about: 'lucius',
      claim: 'Senator Lucius answered the public warning.', credibility: 0.6,
    }];

    const input: TurnEvidenceInput = {
      submission: projectForExternalInference(submission),
      perceivedChanges,
      reports,
    };
    const inputSnapshot = structuredClone(input);
    const builder = turnEvidenceBuilder();
    const evidence = builder(input);
    const serialized = JSON.stringify(evidence);

    expect(evidence.map(item => item.text)).toEqual(expect.arrayContaining([
      expect.stringContaining('Warn the Senate'),
      'A public courier reached the Curia.',
      'Senator Lucius answered the public warning.',
    ]));
    expect(new Set(evidence.map(item => item.id)).size).toBe(evidence.length);
    expect(builder(input)).toEqual(evidence);
    expect(input).toEqual(inputSnapshot);
    expect(evidence.every(item => Object.keys(item).every(key => ['id', 'source', 'text', 'trustedQuote'].includes(key)))).toBe(true);
    expect(serialized).not.toContain('poison Lucius');
    for (const forbidden of [
      'narration', 'headlines', 'privateIntent', 'deltas', 'adjudication', 'trace',
      'entities', 'relationships', 'goals', 'schemes', 'simulationState',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('emits no self evidence for a private-only submission', () => {
    const privateOnly: TurnSubmission = { version: 1, kind: 'structured', privateIntent: 'poison Lucius' };
    const evidence = turnEvidenceBuilder()({
      submission: projectForExternalInference(privateOnly),
      perceivedChanges: [],
      reports: [],
    });
    expect(projectForExternalInference(privateOnly)).toBeNull();
    expect(evidence).toEqual([]);
  });
});

describe('App relationship-observation transaction', () => {
  it('extracts after runNewTurn and before save from player-safe evidence only', async () => {
    const order: string[] = [];
    mockRunNewTurn.mockImplementation(async (...args) => {
      order.push('run:start');
      const result = withPoisonedPlayerResult(await defaultTurnResult(...args));
      order.push('run:return');
      return result;
    });
    mockGetRelationshipObservations.mockImplementation(async () => {
      order.push('extract');
      return [];
    });
    const priorReport: Report = {
      id: 'report_prior', turn: 1, source: 'rumor', about: 'hidden_actor',
      claim: 'PRIOR_REPORT_REPLAY_POISON', credibility: 0.4,
    };
    const container = await mountApp(makeAppSave({ reports: [priorReport] }));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'gloryOfRome:autosave') order.push('save');
      return originalSetItem.call(this, key, value);
    });

    await click(buttonNamed(container, 'Structured'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), 'Warn the Senate');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent'), 'poison Lucius');
    await click(buttonNamed(container, 'Submit turn'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect(mockGetRelationshipObservations).toHaveBeenCalledTimes(1);
    expect(mockBuildPlayerPerceivedDigest).toHaveBeenCalled();
    expect(order.indexOf('run:return')).toBeLessThan(order.indexOf('extract'));
    expect(order.indexOf('extract')).toBeLessThan(order.indexOf('save'));
    const [, evidence, directory] = mockGetRelationshipObservations.mock.calls[0];
    const sent = JSON.stringify({ evidence, directory });
    expect(sent).toContain('Warn the Senate');
    expect(sent).toContain('Maximinus Thrax publicly warned Severus Alexander');
    for (const poison of [
      'poison Lucius', "the player secretly plans Lucius's death", 'HEADLINE_POISON',
      'RAW_RELATION_DELTA_POISON', 'TRACE_POISON', 'SECRET_TRUTH_POISON',
      'RELATION_OBJECT_POISON', 'GOAL_POISON',
      'PRIOR_REPORT_REPLAY_POISON',
    ]) {
      expect(sent).not.toContain(poison);
    }
    expect(directory.every(entry => Object.keys(entry).sort().join(',') === 'entity_id,name')).toBe(true);
  });

  it('uses the player-only digest projection for commit knowledge, Dispatches, and tab pulses', async () => {
    mockRunNewTurn.mockImplementation(async (...args) => withPoisonedPlayerResult(await defaultTurnResult(...args)));
    const container = await mountApp();
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Observe the public meeting');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect(mockBuildPlayerPerceivedDigest).toHaveBeenCalled();
    const playerCalls = mockBuildPlayerPerceivedDigest.mock.calls.filter(([, viewer]) => viewer.entity_id === 'severus_alexander');
    expect(playerCalls.length).toBeGreaterThanOrEqual(2);
    expect((loadGame()!.state.knowledge ?? []).some(claim => claim.claim.includes('RAW_RELATION_DELTA_POISON'))).toBe(false);
    expect(container.textContent).not.toContain('RAW_RELATION_DELTA_POISON');
    const personaeTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
      .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'))!;
    expect(personaeTab.classList.contains('gor-tab-pulse')).toBe(false);
  });

  it('pulses Personae from a relationship claim learned on the committed turn, not from relation deltas', async () => {
    mockRunNewTurn.mockImplementation(async (...args) => {
      const result = withPoisonedPlayerResult(await defaultTurnResult(...args));
      return {
        ...result,
        newHistoryEntry: {
          ...result.newHistoryEntry,
          adjudication: {
            ...result.newHistoryEntry.adjudication,
            deltas: result.newHistoryEntry.adjudication.deltas.filter(delta => delta.type !== 'relation'),
          },
        },
      };
    });
    mockGetRelationshipObservations.mockImplementation(async (_ai, evidence) => {
      const cited = evidence.find(item => item.id === 'report_task7_lucius')!;
      return [{
        evidenceId: cited.id,
        participantIds: ['severus_alexander', 'maximinus_thrax'],
        excerpt: cited.text,
      }];
    });
    const container = await mountApp();
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Observe the public meeting');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect((loadGame()!.state.knowledge ?? []).filter(claim => claim.relationshipObservation)).toHaveLength(1);
    const personaeTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
      .find(button => button.getAttribute('aria-label')?.startsWith('Dramatis Personae'))!;
    expect(personaeTab.getAttribute('aria-label')).toBe('Dramatis Personae (new intelligence)');
    expect(personaeTab.classList.contains('gor-tab-pulse')).toBe(true);
  });

  it('rolls back a failed extraction call, restores the exact draft, and retry commits one evidence id once', async () => {
    mockRunNewTurn.mockImplementation(async (...args) => withPoisonedPlayerResult(await defaultTurnResult(...args)));
    mockGetRelationshipObservations
      .mockRejectedValueOnce(new Error('observation provider offline'))
      .mockImplementationOnce(async (_ai, evidence) => {
        const cited = evidence.find(item => item.id === 'report_task7_lucius')!;
        return [{
          evidenceId: cited.id,
          participantIds: ['severus_alexander', 'maximinus_thrax'],
          excerpt: cited.text,
        }];
      });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = await mountApp();
    const before = localStorage.getItem('gloryOfRome:autosave');
    const original = '  Exact Task 7 retry draft\nwith authored whitespace  ';
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), original);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(original);
    expect(loadGame()!.state.turnNumber).toBe(2);
    expect(loadGame()!.state.turnHistory).toHaveLength(0);
    expect(loadGame()!.state.knowledge ?? []).toHaveLength(0);

    await click(buttonNamed(container, 'Retry the last action'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    const observations = (loadGame()!.state.knowledge ?? []).filter(claim => claim.relationshipObservation);
    expect(mockGetRelationshipObservations).toHaveBeenCalledTimes(2);
    expect(observations).toHaveLength(1);
    expect(observations[0].relationshipObservation?.evidenceId).toBe('report_task7_lucius');
    expect(observations[0].firstLearnedTurn).toBe(2);
    expect(observations[0].updates.map(update => update.turn)).toEqual([2]);
    expect(new Set(observations.map(claim => claim.relationshipObservation!.evidenceId)).size).toBe(1);
    expect((loadGame()!.state.reports ?? []).some(report => report.id === 'report_task7_lucius')).toBe(true);
    expect(loadGame()!.state.messages.some(message => message.text.includes("the player secretly plans Lucius's death"))).toBe(true);
    errorSpy.mockRestore();
  });

  it('awaits investigation extraction inside the atomic lease and retries without partial display, spend, fallout, knowledge, or save', async () => {
    mockGetRelationshipObservations
      .mockRejectedValueOnce(new Error('observation provider offline'))
      .mockImplementationOnce(async (_ai, evidence) => [{
        evidenceId: evidence[0].id,
        participantIds: ['severus_alexander', 'maximinus_thrax'],
        excerpt: evidence[0].text,
      }]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = await mountApp();
    await openFirstIntelCard(container);
    const before = localStorage.getItem('gloryOfRome:autosave');
    const beforeState = loadGame()!.state;
    const reveal = revealSecretsButton(container);

    await click(reveal);
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));

    expect(mockGetRelationshipObservations).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state).toEqual(beforeState);
    expect(container.textContent).not.toContain('REPORT_DATA_PRIVATE_POISON');
    expect(container.textContent).not.toContain('visit did not go unnoticed');
    const [, evidence, directory] = mockGetRelationshipObservations.mock.calls[0];
    const sent = JSON.stringify({ evidence, directory });
    expect(evidence).toHaveLength(1);
    expect(sent).toContain('A public agent report says Maximinus Thrax met Severus Alexander');
    for (const poison of ['REPORT_DATA_PRIVATE_POISON', 'FALLOUT_TRACE_POISON', 'secret_truth', 'relationships', 'short_term_goals']) {
      expect(sent).not.toContain(poison);
    }

    await click(revealSecretsButton(container));
    await waitFor(() => expect(loadGame()!.state.knowledge ?? []).toHaveLength(2));
    const committed = loadGame()!.state;
    expect(mockGetRelationshipObservations).toHaveBeenCalledTimes(2);
    expect(committed.entities.find(entity => entity.entity_id === 'severus_alexander')!.resources.investigations).toBe(0);
    expect(committed.pendingIntelligenceFallout).toHaveLength(1);
    expect((committed.knowledge ?? []).filter(claim => claim.relationshipObservation)).toHaveLength(1);
    expect((committed.knowledge ?? []).every(claim => claim.firstLearnedTurn === 2)).toBe(true);
    expect(container.textContent).toContain('REPORT_DATA_PRIVATE_POISON');
    errorSpy.mockRestore();
  });

  it('commits the turn once with only the validated subset when the provider mixes valid and invalid drafts', async () => {
    mockRunNewTurn.mockImplementation(async (...args) => withPoisonedPlayerResult(await defaultTurnResult(...args)));
    mockGetRelationshipObservations.mockImplementationOnce((_ai, evidence, directory, knownEntityIds) =>
      runRealToolWithDrafts(evidence, directory, knownEntityIds, [
        validDraftCiting(evidence, 'report_task7_lucius'),
        {
          evidenceId: 'missing_semantic_evidence',
          participantIds: directory.slice(0, 2).map(entity => entity.entity_id),
          excerpt: evidence[0].text,
        },
      ]));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = await mountApp();
    const before = localStorage.getItem('gloryOfRome:autosave');
    const saveWrites: string[] = [];
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'gloryOfRome:autosave') saveWrites.push('save');
      return originalSetItem.call(this, key, value);
    });

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Observe the public meeting');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Retry the last action"]')).toBeNull();
    expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe('');
    expect(saveWrites).toHaveLength(1);
    expect(localStorage.getItem('gloryOfRome:autosave')).not.toBe(before);
    const observations = (loadGame()!.state.knowledge ?? []).filter(claim => claim.relationshipObservation);
    expect(observations).toHaveLength(1);
    expect(observations[0].relationshipObservation?.evidenceId).toBe('report_task7_lucius');
    expect(warnSpy.mock.calls.some(call => JSON.stringify(call).includes('dropped 1 of 2'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('commits the turn once with zero observations when every draft fails semantic validation', async () => {
    mockRunNewTurn.mockImplementation(async (...args) => withPoisonedPlayerResult(await defaultTurnResult(...args)));
    mockGetRelationshipObservations.mockImplementationOnce((_ai, evidence, directory, knownEntityIds) =>
      runRealToolWithDrafts(evidence, directory, knownEntityIds, [
        {
          evidenceId: 'missing_semantic_evidence',
          participantIds: directory.slice(0, 2).map(entity => entity.entity_id),
          excerpt: evidence[0].text,
        },
      ]));
    const container = await mountApp();
    const before = localStorage.getItem('gloryOfRome:autosave');

    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Observe the public meeting');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Retry the last action"]')).toBeNull();
    expect((loadGame()!.state.knowledge ?? []).filter(claim => claim.relationshipObservation)).toHaveLength(0);
    expect(localStorage.getItem('gloryOfRome:autosave')).not.toBe(before);
  });
});

describe('ingestRelationshipObservations dedup boundary', () => {
  it('documents one-observation-per-evidence-id dedup at ingestion', () => {
    const dedupEvidence: PlayerSafeEvidence[] = [{
      id: 'report_dedup_1',
      source: 'rumor',
      text: 'Senator Lucius defended Severus Alexander before the Curia.',
    }];
    const dedupDirectory = [
      { entity_id: 'severus_alexander', name: 'Severus Alexander' },
      { entity_id: 'lucius', name: 'Senator Lucius' },
    ];
    const dedupDraft: RelationshipObservationDraft = {
      evidenceId: 'report_dedup_1',
      participantIds: ['severus_alexander', 'lucius'],
      excerpt: dedupEvidence[0].text,
    };
    const knownEntityIds = dedupDirectory.map(entity => entity.entity_id);

    const afterFirstBatch = ingestRelationshipObservations([], {
      drafts: [dedupDraft, { ...dedupDraft }],
      evidence: dedupEvidence,
      entities: dedupDirectory,
      knownEntityIds,
      turn: 5,
    });
    expect(afterFirstBatch.filter(claim => claim.relationshipObservation)).toHaveLength(1);

    const afterSecondCall = ingestRelationshipObservations(afterFirstBatch, {
      drafts: [dedupDraft],
      evidence: dedupEvidence,
      entities: dedupDirectory,
      knownEntityIds,
      turn: 6,
    });
    expect(afterSecondCall).toBe(afterFirstBatch);
    expect(afterSecondCall.filter(claim => claim.relationshipObservation)).toHaveLength(1);
  });
});
