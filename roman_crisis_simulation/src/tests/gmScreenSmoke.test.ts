/**
 * @vitest-environment jsdom
 *
 * Smoke render for components/GameMasterScreen.tsx with LEGACY-shaped props:
 * a save (or campaign) from before the D11 truth ledger / D21 knowledge
 * store / D8 ambition / fallout queue existed passes `undefined` for every
 * optional prop and an empty history. The screen must render (not throw) -
 * the optional-prop defaults (`truthLedger ?? []`, `knowledge ?? []`, the
 * conditional ambition/fallout blocks) are what this pins.
 *
 * Deliberately react-dom only (createRoot + React 19's exported `act`) - no
 * testing-library dependency exists in this project and none is added.
 * `React.createElement` keeps this a plain .ts file (no JSX transform).
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import GameMasterScreen from '../components/GameMasterScreen';
import App from '../App';
import { GameProvider } from '../state/GameContext';
import { createInitialGameState } from '../state/gameReducer';
import { AiServiceError } from '../ai/core/geminiService';
import * as aiMocks from '../ai/mocks';
import { loadGame, saveGame, type SaveGameState } from '../persistence/saveGame';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { Entity, TurnHistoryEntry, TurnSubmission, WorldState } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import type { PrivateSceneRecord } from '../privateScene/model';
import { getMockInitialState } from './mockData';

vi.mock('../ai/mocks', async importOriginal => {
  const actual = await importOriginal<typeof import('../ai/mocks')>();
  return { ...actual, mockRunNewTurn: vi.fn(actual.mockRunNewTurn) };
});

// App's development-only boot diagnostic is orthogonal to Task 4 and also
// invokes the same mock boundary. Keep it from polluting attempt counts while
// leaving the actual turn pipeline intact.
vi.mock('./smokeTest', () => ({ runSmokeTest: vi.fn().mockResolvedValue(undefined) }));

// React's act() warning gate: without this flag React logs a console error
// for every act() call in a non-test-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const worldState: WorldState = {
  year: 235,
  week: 1,
  economic_stability: 'Stable',
  political_climate: 'Tense',
  regions: {},
};

const mockRunNewTurn = vi.mocked(aiMocks.mockRunNewTurn);
const defaultMockRunNewTurn = mockRunNewTurn.getMockImplementation()!;
const mountedApps: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  localStorage.clear();
  mockRunNewTurn.mockClear();
  mockRunNewTurn.mockImplementation(defaultMockRunNewTurn);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  while (mountedApps.length > 0) {
    const instance = mountedApps.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  localStorage.clear();
  vi.restoreAllMocks();
  mockRunNewTurn.mockClear();
  mockRunNewTurn.mockImplementation(defaultMockRunNewTurn);
});

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

async function waitFor(assertion: () => void, attempts = 40): Promise<void> {
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

function makeKnowledgeClaim(subject: string): KnowledgeClaim {
  return {
    id: `known-${subject}`,
    subject,
    claim: 'The player has learned this group exists.',
    claimKey: `report:${subject}:existence:rumor`,
    firstLearnedTurn: 1,
    updates: [{ turn: 1, source: 'rumor', text: 'The player has learned this group exists.' }],
  };
}

function makeAppSave(): SaveGameState {
  const initial = getMockInitialState();
  const player = initial.entities.find(entity => entity.entity_id === 'severus_alexander')!;
  const template = initial.entities.find(entity => entity.entity_id === 'maximinus_thrax')!;
  const knownFaction: Entity = {
    ...template,
    entity_id: 'known_faction',
    name: 'Known Faction',
    entity_type: 'faction',
    relationships: {},
    memories: [],
    visibility_network: [],
  };
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
        ? { ...entity, visibility_network: ['maximinus_thrax'] }
        : entity),
      knownFaction,
      hiddenActor,
    ],
    worldState: initial.worldState,
    simulationState: createInitialGameState().simulationState,
    reports: [],
    truthLedger: [],
    knowledge: [makeKnowledgeClaim(knownFaction.entity_id)],
    npcIntents: [],
    turnNumber: 2,
    playerCharacterId: player.entity_id,
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'A test of exact turn orchestration.',
    messages: [],
    triggeredEventIds: [],
    eventFirings: [],
    suggestedActions: [],
    currentEvents: [],
    gmInterventionText: '',
    pendingIntelligenceFallout: [],
  };
}

async function mountAppFromSave(state = makeAppSave()): Promise<HTMLDivElement> {
  saveGame(state);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedApps.push({ root, container });
  await act(async () => {
    root.render(React.createElement(GameProvider, null, React.createElement(App)));
  });
  await waitFor(() => expect(buttonNamed(container, 'Continue Your Reign')).not.toBeNull());
  await click(buttonNamed(container, 'Continue Your Reign'));
  await waitFor(() => expect(container.querySelector('[aria-label="Chat input"]')).not.toBeNull());
  // Mock Mode moved into the configuration menu's Developer card in the
  // options-consolidation pass - reach it through the menu.
  await click(buttonNamed(container, 'Open configuration menu'));
  const mockToggle = container.querySelector<HTMLInputElement>('#mock-toggle');
  expect(mockToggle).not.toBeNull();
  await click(mockToggle!);
  expect(mockToggle!.checked).toBe(true);
  await click(buttonNamed(container, 'Close configuration menu'));
  return container;
}

describe('components/GameMasterScreen - legacy-save smoke render', () => {
  it('renders GM private-scene ledger separators as middle dots without mojibake', async () => {
    const privateScenes: PrivateSceneRecord[] = [{
      sceneId: 'scene-ledger-separators',
      macroTurn: 4,
      playerId: 'player',
      npcId: 'marcia',
      playerName: 'Lucius',
      npcName: 'Marcia',
      status: 'closed',
      transcript: [{ sequence: 1, speaker: 'player', text: 'Speak with me.' }],
      npcResponseCount: 1,
      speechActs: [{ speaker: 'player', kind: 'unclassified', text: 'Speak with me.', exchange: 1 }],
      npcPrivate: {
        sincerity: 'guarded',
        hiddenIntent: 'Keep her patronage concealed.',
        plannedFollowThrough: ['Send a servant', 'Watch the Forum'],
      },
      closureReason: 'player_ended',
      consequenceStatus: 'consumed',
      consumedByTurn: 5,
    }];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(React.createElement(GameMasterScreen, {
          history: [], onClose: () => {}, interventionText: '', onSetIntervention: () => {},
          playerCharacterId: 'player', worldState, turnNumber: 5, privateScenes,
        }));
      });
      await click(buttonNamed(container, 'private'));

      const ledger = byAriaLabel<HTMLElement>(container, 'Private scene GM ledger');
      expect(ledger.textContent).toContain('Turn 4 · Lucius / Marcia · closed');
      expect(ledger.textContent).toContain('Consumed by turn 5');
      expect(ledger.textContent).toContain('Exchange 1 · player · unclassified: Speak with me.');
      expect(ledger.textContent).toContain('Send a servant · Watch the Forum');
      expect(ledger.textContent).not.toContain('Â');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders with legacy-shaped props (undefined truthLedger/knowledge/reports/ambition/fallout, empty history) without throwing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(GameMasterScreen, {
            history: [],
            onClose: () => {},
            interventionText: '',
            onSetIntervention: () => {},
            playerCharacterId: null,
            worldState,
            turnNumber: 1,
            // Every optional prop deliberately absent - the legacy shape.
          })
        );
      });

      expect(container.textContent).toContain('Game Master Tools');
      expect(container.textContent).toContain('No turns have been processed yet.');
      // The campaign-wide tabs exist even when their slices are absent.
      expect(container.textContent).toContain('truth ledger');
      expect(container.textContent).toContain('player knowledge');
      // The per-turn npc perception tab exists even for a legacy history
      // whose entries carry no perceivingNpcIds.
      expect(container.textContent).toContain('npc perception');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders every tab for a fully-populated 4C entry - including a legacy-shaped snapshot entity missing visibility_network - without throwing', async () => {
    function makeSnapshotEntity(overrides: Partial<Entity> = {}): Entity {
      return {
        entity_id: 'npc_full',
        name: 'Full Roman',
        entity_type: 'individual',
        status: 'alive',
        location: 'Palatine Hill',
        relationships: {},
        memories: [{ turn: 2, event_description: 'Saw the thing.', emotional_impact: 'Notable', involved_entities: [] }],
        resources: { denarii: 10 },
        visibility_network: [],
        current_state_narrative: 'A Roman.',
        short_term_goals: ['Endure'],
        long_term_ambitions: [],
        ...overrides,
      };
    }
    const player = makeSnapshotEntity({ entity_id: 'player_1', name: 'Gaius Testus' });
    const fullNpc = makeSnapshotEntity();
    // Legacy shape: a snapshot written before visibility_network existed.
    // NpcPerceptionView must default it, not crash (its digest derivation
    // reads the field unconditionally for the network rule).
    const legacyNpc = { ...makeSnapshotEntity({ entity_id: 'npc_legacy', name: 'Legacy Roman', location: 'Praetorian Camp' }) } as Record<string, unknown>;
    delete legacyNpc.visibility_network;
    const distantA = makeSnapshotEntity({ entity_id: 'npc_distant_a', name: 'Distant A', location: 'Ravenna' });
    const distantB = makeSnapshotEntity({ entity_id: 'npc_distant_b', name: 'Distant B', location: 'Ravenna' });

    const entry: TurnHistoryEntry = {
      turnNumber: 2,
      playerIntent: 'Hold court',
      adjudication: {
        turn: 2,
        entityActions: [{ id: 'npc_full', intent: 'intrigue', target: 'player_1', notes: 'Moves quietly.' }],
        deltas: [
          // Forces the network-rule path (involved entities at neither
          // viewer's location) - the branch that reads visibility_network.
          { type: 'relation', key: 'npc_distant_a:npc_distant_b:trust_level', delta: 1, reason: 'A quiet accord.' },
          { type: 'resource', key: 'npc_full:denarii', delta: 5, reason: 'A purse arrives.' },
        ],
        headlines: ['The city murmurs.'],
        gm_private: ['[Director] a note', '[Mind] another note'],
      },
      narration: 'A tense week.',
      postTurnEntities: [player, fullNpc, legacyNpc as unknown as Entity, distantA, distantB],
      perceivingNpcIds: ['npc_full', 'npc_legacy'],
      npcIntents: [{ entity_id: 'npc_full', intent: 'Corner the grain supply', continuity: 'continue' }],
      npcMindResults: [{ entity_id: 'npc_full', chosen_action: 'Buy the docks', method: 'Through a proxy', private_reasoning: 'Mine alone.', scheme_adjustment: 'The docks come first now.' }],
      turnSeed: 123,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(GameMasterScreen, {
            history: [entry],
            onClose: () => {},
            interventionText: '',
            onSetIntervention: () => {},
            playerCharacterId: 'player_1',
            worldState,
            turnNumber: 3,
            npcIntents: entry.npcIntents,
          })
        );
      });

      // Click through EVERY tab - each must render without throwing.
      const tabs = Array.from(container.querySelectorAll('button[role="tab"]')) as HTMLButtonElement[];
      expect(tabs.length).toBeGreaterThan(0);
      for (const tab of tabs) {
        await act(async () => {
          tab.click();
        });
        // Campaign-wide tabs (truth ledger / player knowledge) render their
        // own views instead of the per-turn loop, so the shared assertion is
        // just "the screen is still standing".
        expect(container.textContent).toContain('Game Master Tools');
      }

      // The npc perception tab in particular: the legacy entity rendered
      // (defensive default, network shown as 'none') alongside the full one.
      const perceptionTab = tabs.find(t => t.textContent === 'npc perception')!;
      await act(async () => {
        perceptionTab.click();
      });
      expect(container.textContent).toContain('Full Roman');
      expect(container.textContent).toContain('Legacy Roman');
      expect(container.textContent).toContain('network: none');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders the raw private-scene ledger only in the GM partition without serializing prompt extras', async () => {
    const consumed: PrivateSceneRecord = {
      sceneId: 'gm-consumed-scene',
      macroTurn: 3,
      playerId: 'severus_alexander',
      npcId: 'maximinus_thrax',
      playerName: 'Severus Alexander',
      npcName: 'Maximinus Thrax',
      status: 'closed',
      transcript: [
        { sequence: 1, speaker: 'player', text: 'GM_PLAYER_TRANSCRIPT_SENTINEL' },
        { sequence: 2, speaker: 'npc', text: 'GM_NPC_TRANSCRIPT_SENTINEL' },
        { sequence: 3, speaker: 'player', text: 'GM_LAST_WORD_SENTINEL' },
      ],
      npcResponseCount: 1,
      speechActs: [{ speaker: 'npc', kind: 'claim', text: 'GM_SPEECH_ACT_SENTINEL', exchange: 1 }],
      npcPrivate: {
        sincerity: 'GM_SINCERITY_SENTINEL',
        hiddenIntent: 'GM_HIDDEN_INTENT_SENTINEL',
        plannedFollowThrough: ['GM_PLAN_ONE_SENTINEL', 'GM_PLAN_TWO_SENTINEL'],
      },
      closureReason: 'player_ended',
      lastWord: 'GM_LAST_WORD_SENTINEL',
      consequenceStatus: 'consumed',
      consumedByTurn: 4,
    };
    const withPromptPoison = {
      ...consumed,
      promptText: 'PROMPT_TEXT_MUST_NOT_RENDER',
    } as PrivateSceneRecord;
    const pending: PrivateSceneRecord = {
      ...consumed,
      sceneId: 'gm-pending-scene',
      npcId: 'gaius_pontius_magnus',
      npcName: 'Gaius Pontius Magnus',
      transcript: [{ sequence: 1, speaker: 'npc', text: 'GM_PENDING_TRANSCRIPT_SENTINEL' }],
      lastWord: undefined,
      consequenceStatus: 'pending',
      consumedByTurn: undefined,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(React.createElement(GameMasterScreen, {
          history: [],
          onClose: () => {},
          interventionText: '',
          onSetIntervention: () => {},
          playerCharacterId: 'severus_alexander',
          worldState,
          turnNumber: 5,
          privateScenes: [withPromptPoison, pending],
        }));
      });
      const privateTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .find(tab => tab.textContent === 'private');
      expect(privateTab).toBeDefined();
      await click(privateTab!);

      expect(container.textContent).toContain('NPC private intent — GM only');
      for (const visible of [
        'GM_PLAYER_TRANSCRIPT_SENTINEL', 'GM_NPC_TRANSCRIPT_SENTINEL', 'GM_PENDING_TRANSCRIPT_SENTINEL',
        'GM_SPEECH_ACT_SENTINEL', 'GM_SINCERITY_SENTINEL', 'GM_HIDDEN_INTENT_SENTINEL',
        'GM_PLAN_ONE_SENTINEL', 'GM_PLAN_TWO_SENTINEL', 'GM_LAST_WORD_SENTINEL',
        'pending', 'consumed', 'Consumed by turn 4',
      ]) {
        expect(container.textContent).toContain(visible);
      }
      expect(container.textContent).not.toContain('PROMPT_TEXT_MUST_NOT_RENDER');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('renders the complete parsed structured artifact in GM history without exposing the storage envelope', async () => {
    const submission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate'],
      messagesOrOrders: [{
        recipient: { kind: 'known_entity', entityId: 'lucius', displayName: 'Lucius' },
        command: 'Meet me at dusk',
      }],
      privateIntent: 'GM_PRIVATE_INTENT_SENTINEL',
      questionOrContext: 'Which benches are empty?',
    };
    const entry: TurnHistoryEntry = {
      turnNumber: 2,
      playerIntent: serializeTurnSubmission(submission),
      adjudication: {
        turn: 2,
        entityActions: [],
        deltas: [],
        headlines: [],
        gm_private: ['GM_ONLY_TRACE_SENTINEL'],
      },
      narration: 'A tense week.',
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(React.createElement(GameMasterScreen, {
          history: [entry],
          onClose: () => {},
          interventionText: '',
          onSetIntervention: () => {},
          playerCharacterId: 'severus_alexander',
          worldState,
          turnNumber: 3,
        }));
      });
      const actionsTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .find(tab => tab.textContent === 'actions');
      expect(actionsTab).toBeDefined();
      await click(actionsTab!);

      expect(container.textContent).not.toContain('GOR_TURN_SUBMISSION/1');
      for (const text of [
        'Actions', 'Address the Senate', 'Messages / Orders', 'Lucius', '[lucius]',
        'Meet me at dusk', 'Private Intent', 'GM_PRIVATE_INTENT_SENTINEL',
        'Question / Context', 'Which benches are empty?',
      ]) {
        expect(container.textContent).toContain(text);
      }
      const privateDetails = Array.from(container.querySelectorAll('details'))
        .find(details => details.textContent?.includes('GM_PRIVATE_INTENT_SENTINEL'));
      expect(privateDetails === undefined || privateDetails.open).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe('App turn-submission orchestration', () => {
  it('normalizes one multi-row structured artifact, exposes only safe recipients, and commits one matching message/history/save turn', async () => {
    const container = await mountAppFromSave();
    expect(container.textContent).not.toContain('HIDDEN_ACTOR_SENTINEL');

    await click(buttonNamed(container, 'Structured'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), 'Address the Senate');
    await click(buttonNamed(container, 'Add action row'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 2'), 'Inspect the grain ledgers');

    const recipientOne = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    const recipientLabels = Array.from(recipientOne.options).map(option => option.textContent);
    expect(recipientLabels).toContain('Maximinus Thrax');
    expect(recipientLabels).toContain('Known Faction');
    expect(recipientLabels).not.toContain('HIDDEN_ACTOR_SENTINEL');
    const knownOption = Array.from(recipientOne.options).find(option => option.textContent === 'Maximinus Thrax')!;
    await setValue(recipientOne, knownOption.value);
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1'), 'Meet me at dusk');

    await click(buttonNamed(container, 'Add message or order row'));
    const recipientTwo = byAriaLabel<HTMLSelectElement>(container, 'Recipient 2');
    const customOption = Array.from(recipientTwo.options).find(option => option.textContent?.startsWith('Someone else'))!;
    await setValue(recipientTwo, customOption.value);
    await setValue(byAriaLabel<HTMLInputElement>(container, 'Custom recipient 2'), 'HIDDEN_ACTOR_SENTINEL');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 2'), 'Keep the eastern gate open');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent'), 'Preserve room to bargain');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context'), 'Which benches are empty?');

    await click(buttonNamed(container, 'Submit turn'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    const expectedSubmission: TurnSubmission = {
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate', 'Inspect the grain ledgers'],
      messagesOrOrders: [
        {
          recipient: { kind: 'known_entity', entityId: 'maximinus_thrax', displayName: 'Maximinus Thrax' },
          command: 'Meet me at dusk',
        },
        {
          recipient: { kind: 'free_text', text: 'HIDDEN_ACTOR_SENTINEL' },
          command: 'Keep the eastern gate open',
        },
      ],
      privateIntent: 'Preserve room to bargain',
      questionOrContext: 'Which benches are empty?',
    };
    const canonical = serializeTurnSubmission(expectedSubmission);
    const saved = loadGame()!;
    expect(saved.version).toBe(1);
    expect(mockRunNewTurn).toHaveBeenCalledTimes(1);
    expect(mockRunNewTurn.mock.calls[0][0]).toEqual(expectedSubmission);
    expect(saved.state.turnNumber).toBe(3);
    expect(saved.state.turnHistory).toHaveLength(1);
    expect(saved.state.turnHistory[0].playerIntent).toBe(canonical);
    expect(saved.state.messages.filter(message => message.sender === 'player')).toEqual([
      { sender: 'player', text: canonical },
    ]);
    expect(saved.state.messages.find(message => message.sender === 'player')!.text)
      .toBe(saved.state.turnHistory[0].playerIntent);
    expect(JSON.stringify(saved.state.turnHistory[0])).not.toContain('"turnSubmission"');
    for (const forbidden of ['secret_truth', 'gm_private', 'mortalityTrace', 'roll', 'resolutionTrace']) {
      expect(canonical).not.toContain(forbidden);
    }
  });

  it('uses a synchronous guard before React can render processing and accepts only one in-flight submission', async () => {
    const container = await mountAppFromSave();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mockRunNewTurn.mockImplementation(async (...args) => {
      await gate;
      return defaultMockRunNewTurn(...args);
    });
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    await setValue(input, 'Guard this one artifact');
    const form = input.closest('form')!;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    const callsBeforeRelease = mockRunNewTurn.mock.calls.length;
    release();
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    expect(callsBeforeRelease).toBe(1);
    expect(mockRunNewTurn).toHaveBeenCalledTimes(1);
    expect(loadGame()!.state.turnHistory).toHaveLength(1);
    expect(loadGame()!.state.messages.filter(message => message.sender === 'player')).toHaveLength(1);
  });

  it('keeps a failed attempt outside committed state, restores the exact draft with one alert, and retries the same immutable submission once', async () => {
    const container = await mountAppFromSave();
    const original = '  Exact retry artifact\nwith authored whitespace  ';
    mockRunNewTurn.mockRejectedValueOnce(new AiServiceError(
      'transient', 'mockRunNewTurn', 'temporary provider failure', new Error('offline'),
    ));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    await setValue(input, original);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(original));

    const savedAfterFailure = loadGame()!;
    const log = container.querySelector('[role="log"]')!;
    expect(savedAfterFailure.state.turnNumber).toBe(2);
    expect(savedAfterFailure.state.turnHistory).toHaveLength(0);
    expect(savedAfterFailure.state.messages).toHaveLength(0);
    expect(log.textContent).not.toContain(original);
    expect(log.textContent).not.toContain('temporary provider failure');
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/send it again/i);

    const firstSubmission = mockRunNewTurn.mock.calls[0][0];
    await click(buttonNamed(container, 'Retry the last action'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    const secondSubmission = mockRunNewTurn.mock.calls[1][0];
    expect(secondSubmission).toBe(firstSubmission);
    expect(mockRunNewTurn).toHaveBeenCalledTimes(2);
    const savedAfterRetry = loadGame()!;
    expect(savedAfterRetry.state.turnHistory).toHaveLength(1);
    expect(savedAfterRetry.state.messages.map(message => message.sender)).toEqual([
      'player', 'gm', 'player_monologue', 'ribbon',
    ]);
    expect(savedAfterRetry.state.messages[0].text).toBe(savedAfterRetry.state.turnHistory[0].playerIntent);
    expect(JSON.stringify(savedAfterRetry)).not.toContain('temporary provider failure');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    errorSpy.mockRestore();
  });

  it('normalizes an edited restored draft as a fresh artifact instead of mutating the failed retry submission', async () => {
    const container = await mountAppFromSave();
    mockRunNewTurn.mockRejectedValueOnce(new AiServiceError(
      'transient', 'mockRunNewTurn', 'temporary provider failure', new Error('offline'),
    ));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    await setValue(input, 'Original authored draft');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe('Original authored draft'));
    const failedSubmission = mockRunNewTurn.mock.calls[0][0];

    input = byAriaLabel<HTMLTextAreaElement>(container, 'Chat input');
    await setValue(input, 'Edited authored draft');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));

    const editedSubmission = mockRunNewTurn.mock.calls[1][0];
    expect(editedSubmission).not.toBe(failedSubmission);
    expect(editedSubmission).toEqual({ version: 1, kind: 'freeform', text: 'Edited authored draft' });
    expect(failedSubmission).toEqual({ version: 1, kind: 'freeform', text: 'Original authored draft' });
    expect(loadGame()!.state.messages.filter(message => message.sender === 'player')).toHaveLength(1);
    expect(loadGame()!.state.turnHistory).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('rejects a legacy save whose player id is missing before AI, preserving bytes, state, and the exact draft', async () => {
    const container = await mountAppFromSave({ ...makeAppSave(), playerCharacterId: 'missing-player' });
    const before = localStorage.getItem('gloryOfRome:autosave');
    const original = '  Missing player draft\nwith exact whitespace  ';
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), original);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(original));

    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(2);
    expect(loadGame()!.state.turnHistory).toHaveLength(0);
    expect(loadGame()!.state.messages).toHaveLength(0);
    expect(container.querySelector('[role="log"]')!.textContent).not.toContain(original);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(mockRunNewTurn).not.toHaveBeenCalled();
  });

  it('rejects a keyless REAL-mode attempt before AI without mutating the legacy save', async () => {
    const priorKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const container = await mountAppFromSave();
      await click(buttonNamed(container, 'Open configuration menu'));
      await click(container.querySelector<HTMLInputElement>('#mock-toggle')!);
      expect(container.querySelector<HTMLInputElement>('#mock-toggle')!.checked).toBe(false);
      await click(buttonNamed(container, 'Close configuration menu'));
      const before = localStorage.getItem('gloryOfRome:autosave');
      const original = '  Keyless real-mode draft\nkeeps whitespace  ';
      await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), original);
      await click(buttonNamed(container, 'Send message'));
      await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(original));

      expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
      expect(loadGame()!.state.turnNumber).toBe(2);
      expect(loadGame()!.state.turnHistory).toHaveLength(0);
      expect(loadGame()!.state.messages).toHaveLength(0);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(mockRunNewTurn).not.toHaveBeenCalled();
    } finally {
      if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = priorKey;
    }
  });

  it('retries a detached frozen multi-row artifact byte-for-byte and commits one player message', async () => {
    const container = await mountAppFromSave();
    mockRunNewTurn.mockRejectedValueOnce(new AiServiceError('transient', 'mockRunNewTurn', 'provider failed', new Error('offline')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await click(buttonNamed(container, 'Structured'));
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Action 1'), 'Hold  the  forum');
    const recipient = byAriaLabel<HTMLSelectElement>(container, 'Recipient 1');
    await setValue(recipient, Array.from(recipient.options).find(option => option.textContent === 'Maximinus Thrax')!.value);
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 1'), 'Keep  the inner gate open');
    await click(buttonNamed(container, 'Add message or order row'));
    const recipientTwo = byAriaLabel<HTMLSelectElement>(container, 'Recipient 2');
    await setValue(recipientTwo, Array.from(recipientTwo.options).find(option => option.textContent?.startsWith('Someone else'))!.value);
    await setValue(byAriaLabel<HTMLInputElement>(container, 'Custom recipient 2'), '  A courier  ');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Message or order 2'), 'Deliver\nthis exact order');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Private Intent'), 'Keep leverage  private');
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Question / Context'), 'Who  is absent?');
    await click(buttonNamed(container, 'Submit turn'));
    await waitFor(() => expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1));
    const attempted = mockRunNewTurn.mock.calls[0][0] as TurnSubmission;
    const bytes = serializeTurnSubmission(attempted);
    expect(Object.isFrozen(attempted)).toBe(true);
    expect(Object.isFrozen((attempted as Extract<TurnSubmission, { kind: 'structured' }>).messagesOrOrders)).toBe(true);
    expect(loadGame()!.state.messages).toHaveLength(0);
    await click(buttonNamed(container, 'Retry the last action'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    expect(mockRunNewTurn.mock.calls[1][0]).toBe(attempted);
    expect(serializeTurnSubmission(mockRunNewTurn.mock.calls[1][0] as TurnSubmission)).toBe(bytes);
    const saved = loadGame()!;
    expect(saved.state.turnHistory[0].playerIntent).toBe(bytes);
    expect(saved.state.messages.filter(message => message.sender === 'player')).toEqual([{ sender: 'player', text: bytes }]);
    errorSpy.mockRestore();
  });

  it('rolls back a resolved turn when both autosave writes throw, leaves old bytes intact, and permits retry', async () => {
    const container = await mountAppFromSave();
    const before = localStorage.getItem('gloryOfRome:autosave');
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = '  Save failure draft\nexactly restored  ';
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), original);
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input').value).toBe(original));
    expect(storageSpy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(2);
    expect(loadGame()!.state.messages).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    storageSpy.mockRestore();
    await click(buttonNamed(container, 'Retry the last action'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    expect(mockRunNewTurn).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('closes the real GM modal through Header, hotkey, and availability transitions without remounting it', async () => {
    const container = await mountAppFromSave();
    await setValue(byAriaLabel<HTMLTextAreaElement>(container, 'Chat input'), 'Earn a GM Log');
    await click(buttonNamed(container, 'Send message'));
    await waitFor(() => expect(loadGame()?.state.turnNumber).toBe(3));
    // The GM console's runtime switch lives in the configuration menu's
    // Developer card now; the menu stays open through the transitions below
    // (the settings dialog and GM modal are independent overlay surfaces),
    // and the switch node remounts with each menu open, so it is re-queried
    // rather than captured once.
    const toggle = () => container.querySelector<HTMLInputElement>('#gm-console-toggle')!;
    await click(buttonNamed(container, 'Open configuration menu'));
    await click(toggle());
    await click(buttonNamed(container, 'GM Log'));
    await waitFor(() => expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).not.toBeNull());
    await click(container.querySelector<HTMLInputElement>('#settings-gm-console-enabled')!);
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    await click(byAriaLabel<HTMLButtonElement>(container, 'Close configuration menu'));
    await click(buttonNamed(container, 'Open configuration menu'));
    await click(container.querySelector<HTMLInputElement>('#settings-gm-console-enabled')!);
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    expect(toggle().getAttribute('aria-checked')).not.toBe('true');
    await click(toggle());
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    await click(buttonNamed(container, 'GM Log'));
    await waitFor(() => expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).not.toBeNull());
    await click(toggle());
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    await click(toggle());
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    await click(buttonNamed(container, 'GM Log'));
    await waitFor(() => expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).not.toBeNull());
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true, bubbles: true })));
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true, bubbles: true })));
    expect(container.querySelector('[role="dialog"][aria-labelledby="gm-screen-title"]')).toBeNull();
  });
});
