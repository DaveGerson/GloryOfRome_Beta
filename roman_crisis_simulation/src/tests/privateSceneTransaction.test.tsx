/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { GameProvider, useGame } from '../state/GameContext';
import { createInitialGameState, type GameAction } from '../state/gameReducer';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import type { PrivateSceneModelResponse, PrivateSceneRecord } from '../privateScene/model';
import * as sceneTool from '../ai/tools/privateScene';
import * as turnCore from '../ai/core/turn';
import { getMockInitialState } from './mockData';

vi.mock('../ai/tools/privateScene', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/tools/privateScene')>();
  return { ...actual, continuePrivateScene: vi.fn() };
});
vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ai/core/turn', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/core/turn')>();
  return { ...actual, runNewTurn: vi.fn(actual.runNewTurn) };
});
vi.mock('../components/GameMasterScreen', () => ({
  default: ({ onSetIntervention }: { onSetIntervention: (text: string) => Promise<boolean> }) => (
    <button type="button" aria-label="Force GM intervention callback"
      onClick={() => { void onSetIntervention('This must not cross the private-scene barrier.'); }}>
      Force GM intervention callback
    </button>
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockContinue = vi.mocked(sceneTool.continuePrivateScene);
const mockRunNewTurn = vi.mocked(turnCore.runNewTurn);
const defaultRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
let dispatchGame: React.Dispatch<GameAction> | null = null;
let livePrivateScenes: PrivateSceneRecord[] | null = null;

const DispatchCaptor: React.FC = () => {
  const { state, dispatch } = useGame();
  useLayoutEffect(() => {
    dispatchGame = dispatch;
    livePrivateScenes = state.privateScenes;
    return () => {
      dispatchGame = null;
      livePrivateScenes = null;
    };
  }, [dispatch, state.privateScenes]);
  return null;
};

function response(exchange: number, disposition: PrivateSceneModelResponse['disposition'] = 'continues'): PrivateSceneModelResponse {
  return { disposition, npcUtterance: `NPC reply ${exchange}`, speechActs: [{ speaker: 'npc', kind: 'claim', text: `Claim ${exchange}`, exchange }], npcPrivate: { sincerity: 'guarded', hiddenIntent: 'wait', plannedFollowThrough: ['observe'] } };
}

function appSave(overrides: Partial<SaveGameState> = {}): SaveGameState {
  const initial = getMockInitialState();
  const entities = initial.entities.map(entity => entity.entity_id === 'severus_alexander'
    ? { ...entity, visibility_network: ['maximinus_thrax', ...entity.visibility_network] }
    : entity);
  return { entities, worldState: initial.worldState, simulationState: createInitialGameState().simulationState,
    reports: [], truthLedger: [], knowledge: [], npcIntents: [], privateScenes: [], turnNumber: 3,
    playerCharacterId: 'severus_alexander', turnHistory: [], eventHistory: [], metaNarrative: 'Private scene transaction test.',
    messages: [], triggeredEventIds: [], eventFirings: [], suggestedActions: [], currentEvents: [], gmInterventionText: '',
    inferredAmbition: null, pendingIntelligenceFallout: [], ...overrides };
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function waitFor(assertion: () => void): Promise<void> { let error: unknown; for (let i = 0; i < 50; i++) { try { assertion(); return; } catch (next) { error = next; await flush(); } } throw error; }
function button(container: HTMLElement, text: string): HTMLButtonElement { const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === text); expect(found, text).toBeDefined(); return found!; }
async function click(element: HTMLElement): Promise<void> { await act(async () => element.click()); }
async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!; await act(async () => { setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }

async function mount(state = appSave(), openPrivateScene = true): Promise<HTMLDivElement> {
  saveGame(state); localStorage.setItem('gloryOfRome:onboardingSeen', '1'); localStorage.setItem('gloryOfRome:apiKey', 'test-key');
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); mounted.push({ root, container });
  await act(async () => root.render(<GameProvider><DispatchCaptor /><App /></GameProvider>));
  await waitFor(() => expect(container.textContent).toContain('Choose Your Destiny'));
  await click(button(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
  if (openPrivateScene) await click(button(container, 'Private scene'));
  return container;
}

async function mountForMacroTurn(state: SaveGameState): Promise<HTMLDivElement> {
  const container = await mount(state, false);
  await click(container.querySelector<HTMLInputElement>('#mock-toggle')!);
  return container;
}

async function submitMacroTurn(container: HTMLElement, text: string): Promise<void> {
  await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Chat input"]')!, text);
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!);
}

async function invite(container: HTMLElement, text = 'Speak with me.'): Promise<void> {
  await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene opening"]')!, text);
  await click(button(container, 'Send invitation'));
}

beforeEach(() => {
  localStorage.clear();
  livePrivateScenes = null;
  mockContinue.mockReset();
  mockRunNewTurn.mockReset();
  mockRunNewTurn.mockImplementation(defaultRunNewTurn);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.container.remove(); } localStorage.clear(); vi.restoreAllMocks(); });

describe('private-scene App transaction boundary', () => {
  it('projects one pending outcome, saves its consumption before reducer visibility, and never replays it to a later turn', async () => {
    const pending = outcomeScene(2, 'pending-main', 'maximinus_thrax', 'Maximinus Thrax', 'Three cohorts have sworn to me.');
    const unrelated = {
      ...outcomeScene(1, 'older-unrelated', 'gaius_pontius_magnus', 'Gaius Pontius Magnus', 'UNRELATED_SCENE_CLAIM'),
      consequenceStatus: 'consumed' as const,
      consumedByTurn: 2,
    };
    const state = appSave({ privateScenes: [pending, unrelated] });
    let returnedResult: Awaited<ReturnType<typeof turnCore.runNewTurn>> | null = null;
    mockRunNewTurn.mockImplementation(async (...args) => {
      returnedResult = await defaultRunNewTurn(...args);
      return returnedResult;
    });
    const container = await mountForMacroTurn(state);
    const originalSetItem = Storage.prototype.setItem;
    let candidateAtWrite: PrivateSceneRecord[] | null = null;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      const envelope = JSON.parse(value) as { state?: { turnNumber?: number; privateScenes?: PrivateSceneRecord[] } };
      if (key === 'gloryOfRome:autosave'
        && envelope.state?.turnNumber === state.turnNumber + 1
        && candidateAtWrite === null) {
        candidateAtWrite = envelope.state.privateScenes ?? null;
        expect(candidateAtWrite?.[0].consequenceStatus).toBe('consumed');
        expect(livePrivateScenes?.[0].consequenceStatus).toBe('pending');
      }
      return originalSetItem.call(this, key, value);
    });

    await submitMacroTurn(container, 'Resolve the audience claims');
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));

    const firstOptions = mockRunNewTurn.mock.calls[0][14]!;
    expect(firstOptions.privateSceneAdjudicatorProjection).toEqual(expect.objectContaining({
      npc: { entityId: pending.npcId, name: pending.npcName },
      latestNpcInternalIntent: pending.npcPrivate.hiddenIntent,
    }));
    expect(JSON.stringify(firstOptions.privateSceneAdjudicatorProjection)).toContain('Three cohorts have sworn to me.');
    expect(JSON.stringify(firstOptions.privateSceneAdjudicatorProjection)).not.toContain('RAW_TRANSCRIPT_PENDING_MAIN');
    expect(JSON.stringify(firstOptions.privateSceneNpcMemoriesByNpcId?.maximinus_thrax)).toContain('Three cohorts have sworn to me.');
    expect(JSON.stringify(firstOptions.privateSceneNpcMemoriesByNpcId?.maximinus_thrax)).not.toContain('UNRELATED_SCENE_CLAIM');
    expect(JSON.stringify(firstOptions.privateSceneNpcMemoriesByNpcId?.gaius_pontius_magnus)).toContain('UNRELATED_SCENE_CLAIM');

    const saved = loadGame()!.state;
    expect(candidateAtWrite).toEqual(saved.privateScenes);
    expect(livePrivateScenes).toEqual(saved.privateScenes);
    expect(saved.privateScenes?.[0]).toEqual(expect.objectContaining({
      sceneId: pending.sceneId,
      consequenceStatus: 'consumed',
      consumedByTurn: state.turnNumber + 1,
    }));
    expect(saved.entities).toEqual(returnedResult!.updatedEntities);
    expect(saved.worldState).toEqual(expect.objectContaining({
      political_climate: returnedResult!.updatedWorldState.political_climate,
      economic_stability: returnedResult!.updatedWorldState.economic_stability,
      regions: returnedResult!.updatedWorldState.regions,
    }));

    await submitMacroTurn(container, 'Advance another week');
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 2));
    expect(mockRunNewTurn.mock.calls[1][14]?.privateSceneAdjudicatorProjection).toBeUndefined();
    storage.mockRestore();
  });

  it('keeps a pending outcome unchanged after provider failure and consumes the same projection only on retry success', async () => {
    const pending = outcomeScene(2, 'retry-pending', 'maximinus_thrax', 'Maximinus Thrax', 'RETRY_SCENE_CLAIM');
    const state = appSave({ privateScenes: [pending] });
    mockRunNewTurn.mockRejectedValueOnce(new Error('turn provider offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = await mountForMacroTurn(state);

    await submitMacroTurn(container, 'Retry this exact macro turn');
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/retry/i));
    expect(loadGame()!.state.privateScenes).toEqual([pending]);
    expect(livePrivateScenes).toEqual([pending]);
    expect(JSON.stringify(mockRunNewTurn.mock.calls[0][14]?.privateSceneAdjudicatorProjection)).toContain('RETRY_SCENE_CLAIM');

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Retry the last action"]')!);
    await waitFor(() => expect(loadGame()!.state.turnNumber).toBe(state.turnNumber + 1));
    expect(JSON.stringify(mockRunNewTurn.mock.calls[1][14]?.privateSceneAdjudicatorProjection)).toContain('RETRY_SCENE_CLAIM');
    expect(loadGame()!.state.privateScenes?.[0]).toEqual(expect.objectContaining({
      consequenceStatus: 'consumed',
      consumedByTurn: state.turnNumber + 1,
    }));
    errorSpy.mockRestore();
  });

  it('leaves a pending outcome and reducer state untouched when the macro-turn autosave fails', async () => {
    const pending = outcomeScene(2, 'save-failure-pending', 'maximinus_thrax', 'Maximinus Thrax', 'SAVE_FAILURE_SCENE_CLAIM');
    const state = appSave({ privateScenes: [pending] });
    let release!: () => void;
    mockRunNewTurn.mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return defaultRunNewTurn(...args);
    });
    const container = await mountForMacroTurn(state);
    const beforeBytes = localStorage.getItem('gloryOfRome:autosave');
    await submitMacroTurn(container, 'Reach the failing save boundary');
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mockRunNewTurn.mock.calls[0][14]?.privateSceneAdjudicatorProjection))
      .toContain('SAVE_FAILURE_SCENE_CLAIM');
    const failingStorage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => release());
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/restored|retry/i));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(beforeBytes);
    expect(loadGame()!.state.privateScenes).toEqual([pending]);
    expect(livePrivateScenes).toEqual([pending]);
    failingStorage.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('drops a stale resolved turn when a reload replaces the exact pending-scene list in flight', async () => {
    const pending = outcomeScene(2, 'stale-pending', 'maximinus_thrax', 'Maximinus Thrax', 'STALE_SCENE_CLAIM');
    const state = appSave({ privateScenes: [pending] });
    let release!: () => void;
    mockRunNewTurn.mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return defaultRunNewTurn(...args);
    });
    const container = await mountForMacroTurn(state);
    await submitMacroTurn(container, 'Resolve after replacement');
    await waitFor(() => expect(mockRunNewTurn).toHaveBeenCalledTimes(1));

    const replacementScene = outcomeScene(8, 'replacement-scene', 'gaius_pontius_magnus', 'Gaius Pontius Magnus', 'REPLACEMENT_SCENE_CLAIM');
    const replacement = appSave({ turnNumber: 9, privateScenes: [replacementScene] });
    saveGame(replacement);
    const replacementBytes = localStorage.getItem('gloryOfRome:autosave');
    await act(async () => dispatchGame!({ type: 'GAME_LOADED', save: replacement }));
    await act(async () => release());
    await flush();

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(replacementBytes);
    expect(loadGame()!.state).toEqual(replacement);
    expect(livePrivateScenes).toEqual([replacementScene]);
    expect(loadGame()!.state.privateScenes?.[0].consequenceStatus).toBe('pending');
    expect(container.textContent).not.toContain('STALE_SCENE_CLAIM');
  });

  it('provider failure consumes nothing and keeps the exact opening draft retryable', async () => {
    mockContinue.mockRejectedValueOnce(new Error('provider down'));
    const container = await mount(); await invite(container, 'Exact retryable opening');
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/ready to retry/i));
    expect(loadGame()!.state.privateScenes).toEqual([]);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene opening"]')!.value).toBe('Exact retryable opening');
  });

  it('persists the atomic player+NPC exchange before it becomes visible and rejects duplicate send', async () => {
    let resolve!: (value: PrivateSceneModelResponse) => void;
    mockContinue.mockReturnValueOnce(new Promise(next => { resolve = next; }));
    const container = await mount();
    const before = localStorage.getItem('gloryOfRome:autosave');
    await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene opening"]')!, 'One invitation');
    const send = button(container, 'Send invitation'); await click(send); await click(send);
    expect(mockContinue).toHaveBeenCalledTimes(1); expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    await act(async () => resolve(response(1))); await waitFor(() => expect(loadGame()!.state.privateScenes).toHaveLength(1));
    const scene = loadGame()!.state.privateScenes![0];
    expect(scene.transcript.map(line => line.text)).toEqual(['One invitation', 'NPC reply 1']);
    expect(container.textContent).toContain('NPC reply 1');
  });

  it('reaches the durable-write boundary with the candidate while reducer state and DOM still show the prior scene list', async () => {
    mockContinue.mockResolvedValueOnce(response(1));
    const container = await mount();
    const originalSetItem = Storage.prototype.setItem;
    let candidateTranscriptAtWriteBoundary: string[] | null = null;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      const envelope = JSON.parse(value) as { state?: { privateScenes?: PrivateSceneRecord[] } };
      const candidate = envelope.state?.privateScenes;
      if (key === 'gloryOfRome:autosave' && candidate?.[0]?.transcript.some(line => line.text === 'NPC reply 1')) {
        candidateTranscriptAtWriteBoundary = candidate[0].transcript.map(line => line.text);
        expect(livePrivateScenes).toEqual([]);
        expect(container.textContent).not.toContain('NPC reply 1');
      }
      return originalSetItem.call(this, key, value);
    });

    await invite(container, 'Durable boundary invitation');
    await waitFor(() => expect(livePrivateScenes).toHaveLength(1));

    expect(candidateTranscriptAtWriteBoundary).toEqual([
      'Durable boundary invitation',
      'NPC reply 1',
    ]);
    expect(livePrivateScenes?.[0].transcript.map(line => line.text)).toEqual([
      'Durable boundary invitation',
      'NPC reply 1',
    ]);
    expect(container.textContent).toContain('NPC reply 1');
    storage.mockRestore();
  });

  it('save failure preserves the prior record and reply draft, then end/skip make zero provider calls', async () => {
    const existing = { ...closedScene(2), status: 'active' as const, closureReason: undefined, npcResponseCount: 1 };
    mockContinue.mockResolvedValueOnce(response(2));
    const container = await mount(appSave({ privateScenes: [existing] }));
    await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene reply"]')!, 'Keep this reply');
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await click(button(container, 'Send reply')); await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be saved/i));
    expect(loadGame()!.state.privateScenes![0]).toEqual(existing);
    expect(livePrivateScenes).toEqual([existing]);
    expect(container.textContent).not.toContain('NPC reply 2');
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene reply"]')!.value).toBe('Keep this reply');
    storage.mockRestore(); warn.mockRestore(); mockContinue.mockClear();
    await click(button(container, 'End scene')); await waitFor(() => expect(loadGame()!.state.privateScenes![0].status).toBe('awaiting_last_word'));
    await click(button(container, 'Skip last word')); await waitFor(() => expect(loadGame()!.state.privateScenes![0].status).toBe('closed'));
    expect(mockContinue).not.toHaveBeenCalled();
  });

  it('closes atomically on the sixth response and last word is local, one-way, and bounded', async () => {
    const existing = { ...closedScene(3), status: 'active' as const, closureReason: undefined, npcResponseCount: 5 };
    mockContinue.mockResolvedValueOnce(response(6));
    const container = await mount(appSave({ privateScenes: [existing] }));
    await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene reply"]')!, 'Sixth exchange'); await click(button(container, 'Send reply'));
    await waitFor(() => expect(loadGame()!.state.privateScenes![0].closureReason).toBe('response_limit'));
    expect(loadGame()!.state.privateScenes![0].npcResponseCount).toBe(6);
    mockContinue.mockClear(); await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene last word"]')!, 'Remember this.'); await click(button(container, 'Leave last word'));
    await waitFor(() => expect(loadGame()!.state.privateScenes![0].lastWord).toBe('Remember this.'));
    expect(mockContinue).not.toHaveBeenCalled();
  });

  it('resumes closed history after reload and permits a later-turn invitation but not a same-turn second scene', async () => {
    const sameTurn = closedScene(3); let container = await mount(appSave({ privateScenes: [sameTurn] }));
    expect(container.querySelector('[aria-label="Private-scene opening"]')).toBeNull();
    await act(async () => mounted.pop()!.root.unmount()); container.remove();
    mockContinue.mockResolvedValueOnce(response(1));
    container = await mount(appSave({ turnNumber: 4, privateScenes: [sameTurn] }));
    expect(container.textContent).toContain('Past private scenes');
    await invite(container, 'A later audience'); await waitFor(() => expect(loadGame()!.state.privateScenes).toHaveLength(2));
  });

  it('drops a retained async reply after a reload replaces its exact scene fingerprint', async () => {
    const existing = { ...closedScene(3), status: 'active' as const, closureReason: undefined };
    let resolve!: (value: PrivateSceneModelResponse) => void;
    mockContinue.mockReturnValueOnce(new Promise(next => { resolve = next; }));
    const container = await mount(appSave({ privateScenes: [existing] }));
    await setValue(container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene reply"]')!, 'Obsolete reply');
    await click(button(container, 'Send reply'));
    const replacement = closedScene(3);
    const replacementSave = appSave({ privateScenes: [replacement] });
    saveGame(replacementSave);
    await act(async () => dispatchGame!({ type: 'GAME_LOADED', save: replacementSave }));
    await act(async () => resolve(response(2)));
    await flush();
    expect(loadGame()!.state.privateScenes).toEqual([replacement]);
    expect(loadGame()!.state.privateScenes![0].transcript.some(line => line.text === 'Obsolete reply')).toBe(false);
  });

  it('blocks over-limit invitations before provider cost and preserves the visible draft/error', async () => {
    const container = await mount();
    const opening = container.querySelector<HTMLTextAreaElement>('[aria-label="Private-scene opening"]')!;
    await setValue(opening, 'x'.repeat(2001));
    expect(opening.value).toHaveLength(2001);
    expect(button(container, 'Send invitation').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/2,000/);
    expect(mockContinue).not.toHaveBeenCalled();
  });

  it('rejects a forced macro submit at handler level while a scene owns the central domain lock', async () => {
    const existing = { ...closedScene(3), status: 'active' as const, closureReason: undefined };
    const container = await mount(appSave({ privateScenes: [existing] }));
    const macro = container.querySelector<HTMLTextAreaElement>('[aria-label="Chat input"]')!;
    macro.disabled = false;
    await setValue(macro, 'Force a macro action');
    const submit = button(container, 'Send message'); submit.disabled = false;
    await click(submit); await flush();
    expect(mockRunNewTurn).not.toHaveBeenCalled();
    expect(loadGame()!.state.turnNumber).toBe(3);
    expect(loadGame()!.state.privateScenes).toEqual([existing]);
  });

  it('rejects a forced GM intervention at the central scene barrier before save or reducer effect', async () => {
    const existing = { ...closedScene(3), status: 'active' as const, closureReason: undefined };
    const historyEntry = {
      turnNumber: 2,
      playerIntent: 'Wait and observe.',
      adjudication: { turn: 2, entityActions: [], deltas: [], headlines: [], gm_private: [] },
      narration: 'Rome waits.',
    };
    const container = await mount(appSave({ privateScenes: [existing], turnHistory: [historyEntry] }));
    // Close only the presentation. The active scene remains committed and
    // must continue to own the central mutation barrier.
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Close private scene"]')!);
    await click(container.querySelector<HTMLInputElement>('#gm-console-toggle')!);
    await click(button(container, 'GM Log'));
    const storage = vi.spyOn(Storage.prototype, 'setItem');

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Force GM intervention callback"]')!);
    await flush();

    expect(storage).not.toHaveBeenCalled();
    expect(loadGame()!.state.gmInterventionText).toBe('');
    expect(livePrivateScenes).toEqual([existing]);
    storage.mockRestore();
  });
});

function closedScene(turn: number): PrivateSceneRecord {
  return { sceneId: `scene-${turn}`, macroTurn: turn, playerId: 'severus_alexander', npcId: 'maximinus_thrax', playerName: 'Severus Alexander', npcName: 'Maximinus Thrax', status: 'closed',
    transcript: [{ sequence: 1, speaker: 'player', text: 'Opening' }, { sequence: 2, speaker: 'npc', text: 'NPC reply 1' }], npcResponseCount: 1, speechActs: [],
    npcPrivate: { sincerity: 'hidden', hiddenIntent: 'HIDDEN_INTENT_POISON', plannedFollowThrough: [] }, closureReason: 'player_ended', consequenceStatus: 'pending' };
}

function outcomeScene(
  turn: number,
  sceneId: string,
  npcId: string,
  npcName: string,
  claim: string,
): PrivateSceneRecord {
  return {
    ...closedScene(turn),
    sceneId,
    npcId,
    npcName,
    transcript: [
      { sequence: 1, speaker: 'player', text: `RAW_TRANSCRIPT_${sceneId.toUpperCase().replace(/-/g, '_')}` },
      { sequence: 2, speaker: 'npc', text: claim },
    ],
    speechActs: [{ speaker: 'npc', kind: 'claim', text: claim, exchange: 1 }],
    npcPrivate: {
      sincerity: 'guarded',
      hiddenIntent: `HIDDEN_INTENT_${sceneId}`,
      plannedFollowThrough: [`FOLLOW_THROUGH_${sceneId}`],
    },
  };
}
