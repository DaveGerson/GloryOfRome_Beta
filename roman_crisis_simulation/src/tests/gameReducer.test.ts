/**
 * Pure unit tests for state/gameReducer.ts - no DOM, no React harness (this
 * repo has no react-testing-library). Each action is a single atomic commit
 * point, so the assertions check both the landed values and the fields a
 * given action must NOT touch.
 */
import { describe, it, expect } from 'vitest';
import {
  gameReducer,
  createInitialGameState,
  GameDomainState,
  GameAction,
  KEEP_FULL_SNAPSHOTS,
  withOldSnapshotsDropped,
} from '../state/gameReducer';
import { GameState, Message, TurnHistoryEntry, GameEvent } from '../types';
import type { SaveGameState } from '../persistence/saveGame';
import type { KnowledgeClaim } from '../knowledge/store';
import type { PrivateSceneRecord } from '../privateScene/model';
import { getMockInitialState } from './mockData';

const PLAYER_ID = 'severus_alexander';
type TurnCommitWithPlayerMessage = Extract<GameAction, { type: 'TURN_COMMITTED' }> & {
  playerMessage: Message;
};

function makeHistoryEntry(turnNumber: number): TurnHistoryEntry {
  return {
    turnNumber,
    playerIntent: `intent ${turnNumber}`,
    adjudication: {
      turn: turnNumber,
      entityActions: [],
      deltas: [],
      headlines: [`Headline ${turnNumber}`],
      gm_private: [],
    },
    narration: `Narration ${turnNumber}`,
    postTurnEntities: [],
    perceivingNpcIds: ['maximinus_thrax'],
  };
}

/** A mid-campaign state with the mock scenario's entities and the player set. */
function makePlayingState(overrides: Partial<GameDomainState> = {}): GameDomainState {
  const { entities, worldState } = getMockInitialState();
  return {
    ...createInitialGameState(),
    gameState: GameState.AWAITING_PLAYER_INPUT,
    entities,
    worldState,
    playerCharacterId: PLAYER_ID,
    turnNumber: 3,
    turnHistory: [makeHistoryEntry(1), makeHistoryEntry(2)],
    messages: [
      { sender: 'gm', text: 'Welcome.' },
      { sender: 'player', text: 'I scheme.' },
    ],
    suggestedActions: ['Old pill'],
    currentEvents: ['Old headline'],
    pendingIntelligenceFallout: ['An agent was spotted.'],
    gmInterventionText: 'A comet is seen over Rome.',
    ...overrides,
  };
}

/** The same entity roster with the player marked dead. */
function withDeadPlayer(state: GameDomainState): GameDomainState['entities'] {
  return state.entities.map(e => (e.entity_id === PLAYER_ID ? { ...e, status: 'dead' as const } : e));
}

/** A minimal knowledge-store claim (D21) for slice-flow assertions. */
function makeKnowledgeClaim(id: string, turn: number): KnowledgeClaim {
  return {
    id,
    subject: 'maximinus_thrax',
    claim: 'Thrax courts the Rhine legions',
    claimKey: `report:maximinus_thrax:rumor:${id}`,
    firstLearnedTurn: turn,
    updates: [{ turn, source: 'rumor', text: 'Thrax courts the Rhine legions', credibility: 0.6 }],
  };
}

function makePrivateScene(overrides: Partial<PrivateSceneRecord> = {}): PrivateSceneRecord {
  return {
    sceneId: 'scene_3_1', macroTurn: 3, playerId: PLAYER_ID, npcId: 'maximinus_thrax',
    playerName: 'Severus Alexander', npcName: 'Maximinus Thrax', status: 'closed',
    transcript: [{ sequence: 1, speaker: 'player', text: 'Speak.' }, { sequence: 2, speaker: 'npc', text: 'I hear you.' }],
    npcResponseCount: 1,
    speechActs: [{ speaker: 'npc', kind: 'claim', text: 'I hear you.', exchange: 1 }],
    npcPrivate: { sincerity: 'Guarded.', hiddenIntent: 'Assess the offer.', plannedFollowThrough: ['Consult allies.'] },
    closureReason: 'player_ended', consequenceStatus: 'pending',
    ...overrides,
  };
}

function makeTurnCommit(state: GameDomainState, entities = state.entities): TurnCommitWithPlayerMessage {
  return {
    type: 'TURN_COMMITTED',
    playerMessage: { sender: 'player', text: 'GOR_TURN_SUBMISSION/1\n{"version":1,"kind":"structured","actions":["Address the Senate"]}' },
    entities,
    worldState: { ...state.worldState, week: state.worldState.week + 1 },
    simulationState: createInitialGameState().simulationState,
    reports: [],
    truthLedger: [
      { id: 'truth_1_1', turn: state.turnNumber, claim: 'A whispered lie', aboutId: 'severus_alexander', isTrue: false, reportId: 'report_1_1' },
    ],
    knowledge: [makeKnowledgeClaim('claim_commit', state.turnNumber)],
    npcIntents: [
      { entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions for a march on Rome', continuity: 'new' },
    ],
    privateScenes: state.privateScenes,
    turnNumber: state.turnNumber + 1,
    turnHistory: [...state.turnHistory, makeHistoryEntry(state.turnNumber)],
    gmMessage: { sender: 'gm', text: 'The die is cast.' },
    monologueMessage: { sender: 'player_monologue', text: 'What have I done?' },
    ribbonMessage: { sender: 'ribbon', text: 'Week II' },
    suggestedActions: ['New pill'],
    currentEvents: ['New headline'],
  } as TurnCommitWithPlayerMessage;
}

function makeSaveState(overrides: Partial<SaveGameState> = {}): SaveGameState {
  const { entities, worldState } = getMockInitialState();
  return {
    entities,
    worldState,
    simulationState: createInitialGameState().simulationState,
    reports: [],
    turnNumber: 7,
    playerCharacterId: PLAYER_ID,
    turnHistory: [makeHistoryEntry(6)],
    eventHistory: [{ eventId: 'ev1', eventTitle: 'The Omen', choiceText: 'Ignore it', turnNumber: 4 }],
    metaNarrative: 'A loaded crisis.',
    messages: [{ sender: 'gm', text: 'Loaded.' }],
    triggeredEventIds: ['ev1'],
    suggestedActions: ['Loaded pill'],
    currentEvents: ['Loaded headline'],
    gmInterventionText: 'Loaded intervention',
    ...overrides,
  };
}

describe('state/gameReducer', () => {
  describe('unknown action', () => {
    it('returns the state unchanged, as the SAME reference', () => {
      const state = makePlayingState();
      const result = gameReducer(state, { type: 'NOT_A_REAL_ACTION' } as unknown as GameAction);
      expect(result).toBe(state);
    });
  });

  describe('TURN_STARTED', () => {
    it('enters PROCESSING without changing any committed domain slice', () => {
      const state = makePlayingState();
      const playerMessage: Message = { sender: 'player', text: 'I address the Senate.' };
      const result = gameReducer(state, { type: 'TURN_STARTED', playerMessage });

      expect(result.gameState).toBe(GameState.PROCESSING);
      expect(result.suggestedActions).toBe(state.suggestedActions);
      expect(result.messages).toBe(state.messages);
      // Nothing else may change - the submitted artifact is only an
      // in-flight UI projection until TURN_COMMITTED lands atomically.
      expect(result.entities).toBe(state.entities);
      expect(result.worldState).toBe(state.worldState);
      expect(result.turnNumber).toBe(state.turnNumber);
      expect(result.pendingIntelligenceFallout).toBe(state.pendingIntelligenceFallout);
      expect(result.gmInterventionText).toBe(state.gmInterventionText);
    });
  });

  describe('TURN_COMMITTED', () => {
    it('lands the whole commit atomically and consumes the fallout queue and intervention text', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const action = makeTurnCommit(state);
      const result = gameReducer(state, action);

      expect(result.entities).toBe(action.entities);
      expect(result.worldState).toBe(action.worldState);
      expect(result.simulationState).toBe(action.simulationState);
      expect(result.reports).toBe(action.reports);
      expect(result.truthLedger).toBe(action.truthLedger);
      expect(result.knowledge).toBe(action.knowledge);
      expect(result.turnNumber).toBe(action.turnNumber);
      expect(result.turnHistory).toBe(action.turnHistory);
      expect(result.suggestedActions).toEqual(['New pill']);
      expect(result.currentEvents).toEqual(['New headline']);
      expect(result.messages).toEqual([
        ...state.messages,
        action.playerMessage,
        action.gmMessage,
        action.monologueMessage,
        action.ribbonMessage,
      ]);
      expect(result.pendingIntelligenceFallout).toEqual([]);
      expect(result.gmInterventionText).toBe('');
    });

    it('omits the Inner Thoughts message entirely when the committed turn has no monologue', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const action = {
        ...makeTurnCommit(state),
        monologueMessage: null,
      } as unknown as Extract<GameAction, { type: 'TURN_COMMITTED' }>;

      const result = gameReducer(state, action);

      expect(result.messages).toEqual([
        ...state.messages,
        action.playerMessage,
        action.gmMessage,
        action.ribbonMessage,
      ]);
      expect(result.messages.some(message => message?.sender === 'player_monologue')).toBe(false);
    });

    it('keeps the phase as-is while the player lives (the event-trigger check resolves it)', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const result = gameReducer(state, makeTurnCommit(state));
      expect(result.gameState).toBe(GameState.PROCESSING);
    });

    it('replaces the Director intents slice wholesale with the commit\'s npcIntents (4C.3)', () => {
      const state = makePlayingState({
        gameState: GameState.PROCESSING,
        npcIntents: [{ entity_id: 'praetorian_guard', intent: 'A stale prior direction', continuity: 'new' }],
      });
      const action = makeTurnCommit(state);
      const result = gameReducer(state, action);
      // Wholesale replacement - the prior slice never merges in.
      expect(result.npcIntents).toBe(action.npcIntents);

      // An empty Director turn clears the slice the same way.
      const cleared = gameReducer(state, { ...makeTurnCommit(state), npcIntents: [] });
      expect(cleared.npcIntents).toEqual([]);
    });

    it('commits the supplied private scenes alongside the turn without mutating any other committed slice', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING, privateScenes: [makePrivateScene({ sceneId: 'old' })] });
      const privateScenes = [makePrivateScene({ consequenceStatus: 'consumed', consumedByTurn: 4 })];
      const action = { ...makeTurnCommit(state), privateScenes };
      const result = gameReducer(state, action);

      expect(result.privateScenes).toBe(privateScenes);
      expect(result.entities).toBe(action.entities);
      expect(result.worldState).toBe(action.worldState);
      expect(result.reports).toBe(action.reports);
      expect(result.knowledge).toBe(action.knowledge);
    });

    it('resolves the phase to GAME_OVER when the committed entities show the player dead (D1)', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const result = gameReducer(state, makeTurnCommit(state, withDeadPlayer(state)));
      expect(result.gameState).toBe(GameState.GAME_OVER);
    });

    it('does NOT end the run for a merely exiled player (D1 - only death is terminal)', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const exiled = state.entities.map(e =>
        e.entity_id === PLAYER_ID ? { ...e, status: 'exiled' as const } : e
      );
      const result = gameReducer(state, makeTurnCommit(state, exiled));
      expect(result.gameState).toBe(GameState.PROCESSING);
    });

    describe('postTurnEntities snapshot window', () => {
      it(`keeps full snapshots only on the most recent KEEP_FULL_SNAPSHOTS (${KEEP_FULL_SNAPSHOTS}) entries, dropping the field from older ones`, () => {
        const state = makePlayingState({ gameState: GameState.PROCESSING });
        const overflow = 3;
        const longHistory = Array.from(
          { length: KEEP_FULL_SNAPSHOTS + overflow },
          (_, i) => makeHistoryEntry(i + 1)
        );
        const action = { ...makeTurnCommit(state), turnHistory: longHistory };
        const result = gameReducer(state, action);

        expect(result.turnHistory).toHaveLength(KEEP_FULL_SNAPSHOTS + overflow);
        result.turnHistory.forEach((entry, index) => {
          if (index < overflow) {
            expect(entry.postTurnEntities).toBeUndefined();
          } else {
            expect(entry.postTurnEntities).toBeDefined();
          }
        });
        // Only the snapshot field is dropped - everything else survives.
        expect(result.turnHistory[0].turnNumber).toBe(1);
        expect(result.turnHistory[0].playerIntent).toBe('intent 1');
        expect(result.turnHistory[0].narration).toBe('Narration 1');
        expect(result.turnHistory[0].adjudication.headlines).toEqual(['Headline 1']);
      });

      it('keeps every snapshot when the history is exactly KEEP_FULL_SNAPSHOTS long', () => {
        const state = makePlayingState({ gameState: GameState.PROCESSING });
        const exactHistory = Array.from(
          { length: KEEP_FULL_SNAPSHOTS },
          (_, i) => makeHistoryEntry(i + 1)
        );
        const action = { ...makeTurnCommit(state), turnHistory: exactHistory };
        const result = gameReducer(state, action);

        expect(result.turnHistory).toBe(exactHistory);
        result.turnHistory.forEach(entry => expect(entry.postTurnEntities).toBeDefined());
      });

      it('tolerates entries already lacking the snapshot (older-save shape) and keeps the array identity when nothing needs dropping', () => {
        const state = makePlayingState({ gameState: GameState.PROCESSING });
        const alreadyTrimmed = Array.from(
          { length: KEEP_FULL_SNAPSHOTS + 2 },
          (_, i) => {
            const { postTurnEntities, perceivingNpcIds, ...rest } = makeHistoryEntry(i + 1);
            return i < 2 ? rest : { ...rest, postTurnEntities, perceivingNpcIds };
          }
        );
        const action = { ...makeTurnCommit(state), turnHistory: alreadyTrimmed };
        const result = gameReducer(state, action);

        expect(result.turnHistory).toBe(alreadyTrimmed);
      });
    });
  });

  // App.tsx applies this same function to the commit's history array BEFORE
  // the TURN_COMMITTED dispatch AND the autosave, so what the reducer trims
  // and what localStorage persists are the identical bounded array. These
  // direct tests pin the two properties that contract leans on.
  describe('withOldSnapshotsDropped (direct)', () => {
    it('trims a legacy-shaped array (snapshot on every entry, far past the window) to the window in ONE pass', () => {
      const overflow = 20;
      const legacy = Array.from(
        { length: KEEP_FULL_SNAPSHOTS + overflow },
        (_, i) => makeHistoryEntry(i + 1)
      );
      legacy.forEach(entry => expect(entry.postTurnEntities).toBeDefined());

      const trimmed = withOldSnapshotsDropped(legacy);

      expect(trimmed).toHaveLength(KEEP_FULL_SNAPSHOTS + overflow);
      trimmed.forEach((entry, index) => {
        if (index < overflow) {
          // The fields are truly absent, not just undefined - the trimmed
          // entry must not re-persist a snapshot key on the next save. The
          // perceiving-id list goes with the snapshot: the GM console's
          // per-NPC perception derivation needs the snapshot, so the ids
          // alone would be dead save weight.
          expect('postTurnEntities' in entry).toBe(false);
          expect('perceivingNpcIds' in entry).toBe(false);
        } else {
          expect(entry.postTurnEntities).toBeDefined();
          expect(entry.perceivingNpcIds).toBeDefined();
        }
      });
      // Everything else survives on trimmed entries.
      expect(trimmed[0].playerIntent).toBe('intent 1');
      expect(trimmed[0].narration).toBe('Narration 1');
    });

    it('is idempotent: re-applying to an already-trimmed array returns the SAME reference', () => {
      const legacy = Array.from(
        { length: KEEP_FULL_SNAPSHOTS + 5 },
        (_, i) => makeHistoryEntry(i + 1)
      );
      const once = withOldSnapshotsDropped(legacy);
      const twice = withOldSnapshotsDropped(once);

      expect(once).not.toBe(legacy);
      expect(twice).toBe(once);
    });

    it('returns the input reference untouched when the array fits inside the window', () => {
      const short = Array.from({ length: KEEP_FULL_SNAPSHOTS }, (_, i) => makeHistoryEntry(i + 1));
      expect(withOldSnapshotsDropped(short)).toBe(short);
    });
  });

  describe('TURN_ROLLED_BACK', () => {
    it('restores every persisted slice including the exact pre-turn chat log', () => {
      const preTurn = makePlayingState();
      const snapshot = makeSaveState({
        turnNumber: preTurn.turnNumber,
        pendingIntelligenceFallout: ['An agent was spotted.'],
      });
      // Simulate a future accidental partial write. Rollback must remove all
      // attempted transcript artifacts; the retry notice belongs to App UI,
      // outside committed messages and save state.
      const midFailure: GameDomainState = {
        ...preTurn,
        gameState: GameState.PROCESSING,
        messages: [
          ...preTurn.messages,
          { sender: 'player', text: 'Doomed action' },
          { sender: 'gm', text: 'A fateful error has occurred' },
        ],
      };

      const result = gameReducer(midFailure, { type: 'TURN_ROLLED_BACK', snapshot });

      expect(result.entities).toBe(snapshot.entities);
      expect(result.worldState).toBe(snapshot.worldState);
      expect(result.simulationState).toBe(snapshot.simulationState);
      expect(result.reports).toBe(snapshot.reports);
      expect(result.turnNumber).toBe(snapshot.turnNumber);
      expect(result.turnHistory).toBe(snapshot.turnHistory);
      expect(result.eventHistory).toBe(snapshot.eventHistory);
      expect(result.triggeredEventIds).toBe(snapshot.triggeredEventIds);
      expect(result.suggestedActions).toBe(snapshot.suggestedActions);
      expect(result.currentEvents).toBe(snapshot.currentEvents);
      expect(result.gmInterventionText).toBe(snapshot.gmInterventionText);
      expect(result.pendingIntelligenceFallout).toEqual(['An agent was spotted.']);
      expect(result.messages).toBe(snapshot.messages);
      expect(result.privateScenes).toEqual(snapshot.privateScenes ?? []);
      // Fields never touched mid-turn are not part of the rollback.
      expect(result.playerCharacterId).toBe(midFailure.playerCharacterId);
      expect(result.metaNarrative).toBe(midFailure.metaNarrative);
      expect(result.inferredAmbition).toBe(midFailure.inferredAmbition);
      // The phase transition is a separate GAME_STATE_SET, not part of this action.
      expect(result.gameState).toBe(GameState.PROCESSING);
    });

    it('restores private scenes from the snapshot and normalizes a legacy snapshot to an empty list', () => {
      const state = makePlayingState({ privateScenes: [makePrivateScene({ sceneId: 'mid-turn' })] });
      const snapshot = makeSaveState({ privateScenes: [makePrivateScene({ sceneId: 'pre-turn' })] });
      expect(gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot }).privateScenes).toEqual(snapshot.privateScenes);

      const legacy = makeSaveState();
      delete legacy.privateScenes;
      expect(gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: legacy }).privateScenes).toEqual([]);
    });

    it('normalizes a corrupted non-array private-scenes snapshot to an empty list without changing other rollback fields', () => {
      const state = makePlayingState({ privateScenes: [makePrivateScene({ sceneId: 'mid-turn' })] });
      for (const corrupt of [{}, 'not-a-scene-list']) {
        const snapshot = makeSaveState({
          turnNumber: 9,
          messages: [{ sender: 'gm', text: 'Rollback sentinel.' }],
          privateScenes: corrupt as unknown as PrivateSceneRecord[],
        });
        const result = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot });
        expect(result.privateScenes).toEqual([]);
        expect(result.turnNumber).toBe(9);
        expect(result.messages).toBe(snapshot.messages);
      }
    });

    it('normalizes a snapshot without the optional fallout field to an empty queue', () => {
      const state = makePlayingState();
      const snapshot = makeSaveState();
      delete snapshot.pendingIntelligenceFallout;
      const result = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot });
      expect(result.pendingIntelligenceFallout).toEqual([]);
    });

    it('restores the truth ledger from the snapshot, normalizing an absent field to an empty ledger (D11)', () => {
      const state = makePlayingState({
        truthLedger: [{ id: 'truth_mid', turn: 3, claim: 'Mid-turn lie', aboutId: 'x', isTrue: false, reportId: 'r_mid' }],
      });
      const withLedger = makeSaveState({
        truthLedger: [{ id: 'truth_pre', turn: 2, claim: 'Pre-turn claim', aboutId: 'y', isTrue: true, reportId: 'r_pre' }],
      });
      const restored = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withLedger });
      expect(restored.truthLedger).toEqual(withLedger.truthLedger);

      const withoutLedger = makeSaveState();
      delete withoutLedger.truthLedger;
      const normalized = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withoutLedger });
      expect(normalized.truthLedger).toEqual([]);
    });

    it('restores the Director intents from the snapshot, normalizing an absent field to an empty list (4C.3)', () => {
      const state = makePlayingState({
        npcIntents: [{ entity_id: 'maximinus_thrax', intent: 'A mid-turn direction', continuity: 'pivot' }],
      });
      const snapshotIntents = [{ entity_id: 'praetorian_guard', intent: 'The pre-turn direction', continuity: 'continue' as const }];

      const withIntents = makeSaveState({ npcIntents: snapshotIntents });
      const restored = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withIntents });
      expect(restored.npcIntents).toEqual(snapshotIntents);

      const withoutIntents = makeSaveState();
      delete withoutIntents.npcIntents;
      const normalized = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withoutIntents });
      expect(normalized.npcIntents).toEqual([]);
    });

    it('restores the knowledge store from the snapshot, normalizing an absent field to an empty store (D21)', () => {
      const state = makePlayingState({
        knowledge: [makeKnowledgeClaim('claim_mid', 3)],
      });
      const withKnowledge = makeSaveState({
        knowledge: [makeKnowledgeClaim('claim_pre', 2)],
      });
      const restored = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withKnowledge });
      expect(restored.knowledge).toEqual(withKnowledge.knowledge);

      const withoutKnowledge = makeSaveState();
      delete withoutKnowledge.knowledge;
      const normalized = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: withoutKnowledge });
      expect(normalized.knowledge).toEqual([]);
    });
  });

  describe('EVENT_TRIGGERED', () => {
    it('opens the event modal and awaits the choice', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const event = { id: 'ev2', title: 'The Mutiny' } as GameEvent;
      const result = gameReducer(state, { type: 'EVENT_TRIGGERED', event });
      expect(result.activeEvent).toBe(event);
      expect(result.gameState).toBe(GameState.AWAITING_EVENT_CHOICE);
    });
  });

  describe('EVENT_CHOICE_APPLIED', () => {
    function makeChoiceAction(state: GameDomainState, entities = state.entities): Extract<GameAction, { type: 'EVENT_CHOICE_APPLIED' }> {
      return {
        type: 'EVENT_CHOICE_APPLIED',
        entities,
        worldState: { ...state.worldState, political_climate: 'Explosive' },
        eventMessage: { sender: 'gm', text: '**Event: The Mutiny**\nYou chose to: *Pay the legions*' },
        eventHistory: [
          ...state.eventHistory,
          { eventId: 'ev2', eventTitle: 'The Mutiny', choiceText: 'Pay the legions', turnNumber: state.turnNumber },
        ],
        triggeredEventIds: [...state.triggeredEventIds, 'ev2'],
        // 4D.2 - both bookkeeping shapes land together (see recordEventFiring).
        eventFirings: [...state.eventFirings, { eventId: 'ev2', lastFiredTurn: state.turnNumber, timesFired: 1 }],
      };
    }

    it('applies the choice atomically, closes the modal, and returns to input', () => {
      const event = { id: 'ev2', title: 'The Mutiny' } as GameEvent;
      const state = makePlayingState({
        gameState: GameState.AWAITING_EVENT_CHOICE,
        activeEvent: event,
      });
      const action = makeChoiceAction(state);
      const result = gameReducer(state, action);

      expect(result.entities).toBe(action.entities);
      expect(result.worldState).toBe(action.worldState);
      expect(result.messages).toEqual([...state.messages, action.eventMessage]);
      expect(result.eventHistory).toBe(action.eventHistory);
      expect(result.triggeredEventIds).toBe(action.triggeredEventIds);
      expect(result.eventFirings).toBe(action.eventFirings);
      expect(result.activeEvent).toBeNull();
      expect(result.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);
      // An event choice never touches the turn pipeline's slices.
      expect(result.turnNumber).toBe(state.turnNumber);
      expect(result.turnHistory).toBe(state.turnHistory);
      expect(result.pendingIntelligenceFallout).toBe(state.pendingIntelligenceFallout);
      expect(result.gmInterventionText).toBe(state.gmInterventionText);
    });

    it('resolves to GAME_OVER when the choice deltas killed the player (D1)', () => {
      const event = { id: 'ev2', title: 'The Mutiny' } as GameEvent;
      const state = makePlayingState({
        gameState: GameState.AWAITING_EVENT_CHOICE,
        activeEvent: event,
      });
      const result = gameReducer(state, makeChoiceAction(state, withDeadPlayer(state)));
      expect(result.activeEvent).toBeNull();
      expect(result.gameState).toBe(GameState.GAME_OVER);
    });
  });

  describe('GAME_LOADED', () => {
    it('restores every persisted field from the save', () => {
      const state = createInitialGameState();
      const save = makeSaveState({
        inferredAmbition: { apparent_ambition: 'Appears intent on seizing the purple.', confidence: 'high', asOfTurn: 6 },
        pendingIntelligenceFallout: ['Old fallout'],
        truthLedger: [{ id: 'truth_5_1', turn: 5, claim: 'A persisted lie', aboutId: 'severus_alexander', originId: 'maximinus_thrax', isTrue: false, reportId: 'report_5_1' }],
        knowledge: [makeKnowledgeClaim('claim_loaded', 5)],
        npcIntents: [{ entity_id: 'maximinus_thrax', intent: 'A persisted direction', continuity: 'continue' }],
      });
      const result = gameReducer(state, { type: 'GAME_LOADED', save });

      expect(result.entities).toBe(save.entities);
      expect(result.worldState).toBe(save.worldState);
      expect(result.simulationState).toBe(save.simulationState);
      expect(result.reports).toBe(save.reports);
      expect(result.turnNumber).toBe(save.turnNumber);
      expect(result.playerCharacterId).toBe(save.playerCharacterId);
      expect(result.turnHistory).toBe(save.turnHistory);
      expect(result.eventHistory).toBe(save.eventHistory);
      expect(result.metaNarrative).toBe(save.metaNarrative);
      expect(result.messages).toBe(save.messages);
      expect(result.triggeredEventIds).toBe(save.triggeredEventIds);
      expect(result.suggestedActions).toBe(save.suggestedActions);
      expect(result.currentEvents).toBe(save.currentEvents);
      expect(result.gmInterventionText).toBe(save.gmInterventionText);
      expect(result.inferredAmbition).toEqual(save.inferredAmbition);
      expect(result.pendingIntelligenceFallout).toEqual(['Old fallout']);
      expect(result.truthLedger).toEqual(save.truthLedger);
      expect(result.knowledge).toEqual(save.knowledge);
      expect(result.npcIntents).toEqual(save.npcIntents);
      expect(result.privateScenes).toEqual(save.privateScenes ?? []);
      expect(result.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);
    });

    it('normalizes the optional fields absent on older saves', () => {
      const save = makeSaveState();
      delete save.inferredAmbition;
      delete save.pendingIntelligenceFallout;
      delete save.truthLedger;
      delete save.knowledge;
      delete save.npcIntents;
      delete save.privateScenes;
      const result = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save });
      expect(result.inferredAmbition).toBeNull();
      expect(result.pendingIntelligenceFallout).toEqual([]);
      // D11 - a legacy (pre-ledger) save starts with an empty truth ledger.
      expect(result.truthLedger).toEqual([]);
      // D21 - a legacy (pre-knowledge-store) save starts with an empty store.
      expect(result.knowledge).toEqual([]);
      // 4C.3 - a legacy (pre-Director) save starts with no intents; the
      // next Director run rules everything 'new'.
      expect(result.npcIntents).toEqual([]);
      expect(result.privateScenes).toEqual([]);
    });

    it('normalizes present-but-non-array private scenes to an empty list without disturbing the loaded campaign', () => {
      for (const corrupt of [{}, 'not-a-scene-list']) {
        const save = makeSaveState({
          turnNumber: 11,
          metaNarrative: 'Corruption sentinel.',
          privateScenes: corrupt as unknown as PrivateSceneRecord[],
        });
        const result = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save });
        expect(result.privateScenes).toEqual([]);
        expect(result.turnNumber).toBe(11);
        expect(result.metaNarrative).toBe('Corruption sentinel.');
      }
    });

    it('re-derives GAME_OVER from a save whose player is dead (D1 - GAME_OVER itself is never persisted)', () => {
      const base = makeSaveState();
      const save = makeSaveState({
        entities: base.entities.map(e =>
          e.entity_id === PLAYER_ID ? { ...e, status: 'dead' as const } : e
        ),
      });
      const result = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save });
      expect(result.gameState).toBe(GameState.GAME_OVER);
    });
  });

  describe('GAME_STARTED', () => {
    it('starts a campaign in the default world when no custom world is provided', () => {
      const state = { ...createInitialGameState(), privateScenes: [makePrivateScene()] };
      const { entities } = getMockInitialState();
      const introMessage: Message = { sender: 'gm', text: 'You have chosen.' };
      const result = gameReducer(state, {
        type: 'GAME_STARTED',
        entities,
        playerCharacterId: PLAYER_ID,
        introMessage,
        suggestedActions: ['First move'],
      });

      expect(result.entities).toBe(entities);
      expect(result.playerCharacterId).toBe(PLAYER_ID);
      expect(result.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);
      expect(result.messages).toEqual([introMessage]);
      expect(result.suggestedActions).toEqual(['First move']);
      expect(result.privateScenes).toEqual([]);
      // The defaults stand when the campaign isn't a custom world.
      expect(result.worldState).toBe(state.worldState);
      expect(result.metaNarrative).toBe(state.metaNarrative);
    });

    it('adopts the provided world and meta-narrative for a custom world', () => {
      const state = createInitialGameState();
      const { entities, worldState } = getMockInitialState();
      const result = gameReducer(state, {
        type: 'GAME_STARTED',
        entities,
        playerCharacterId: PLAYER_ID,
        introMessage: { sender: 'gm', text: 'A new world.' },
        suggestedActions: [],
        worldState,
        metaNarrative: 'A custom crisis.',
      });
      expect(result.worldState).toBe(worldState);
      expect(result.metaNarrative).toBe('A custom crisis.');
    });
  });

  describe('INVESTIGATION_COMMITTED', () => {
    it('lands the spend, the fallout append, and the knowledge ingestion in one transition', () => {
      const state = makePlayingState({ pendingIntelligenceFallout: [], knowledge: [] });
      const spent = state.entities.map(e =>
        e.entity_id === PLAYER_ID ? { ...e, resources: { ...e.resources, investigations: 0 } } : e
      );
      const nextKnowledge = [makeKnowledgeClaim('claim_reveal', state.turnNumber)];
      const result = gameReducer(state, {
        type: 'INVESTIGATION_COMMITTED',
        entities: spent,
        pendingIntelligenceFallout: ['The agent was seen.'],
        knowledge: nextKnowledge,
      });
      expect(result.entities).toBe(spent);
      expect(result.pendingIntelligenceFallout).toEqual(['The agent was seen.']);
      // D14/D21 - the bought reveal persists in the knowledge store slice.
      expect(result.knowledge).toBe(nextKnowledge);
    });
  });

  describe('PRIVATE_SCENES_COMMITTED', () => {
    it('replaces only the scene slice, preserving every world, numeric, and relationship reference', () => {
      const state = makePlayingState({ privateScenes: [makePrivateScene({ sceneId: 'before' })] });
      const privateScenes = [makePrivateScene({ sceneId: 'after', status: 'awaiting_last_word', closureReason: 'refused' })];

      const result = gameReducer(state, { type: 'PRIVATE_SCENES_COMMITTED', privateScenes });

      expect(result.privateScenes).toBe(privateScenes);
      expect(result.entities).toBe(state.entities);
      expect(result.entities[0].relationships).toBe(state.entities[0].relationships);
      expect(result.worldState).toBe(state.worldState);
      expect(result.simulationState).toBe(state.simulationState);
      expect(result.reports).toBe(state.reports);
      expect(result.turnNumber).toBe(state.turnNumber);
      expect(result.knowledge).toBe(state.knowledge);
      expect(result.messages).toBe(state.messages);
      expect(result.turnHistory).toBe(state.turnHistory);
    });
  });

  describe('simple field actions', () => {
    it('MESSAGE_ADDED appends to the chat log', () => {
      const state = makePlayingState();
      const message: Message = { sender: 'gm', text: 'A courier arrives.' };
      const result = gameReducer(state, { type: 'MESSAGE_ADDED', message });
      expect(result.messages).toEqual([...state.messages, message]);
    });

    it('GAME_STATE_SET changes only the phase', () => {
      const state = makePlayingState({ gameState: GameState.PROCESSING });
      const result = gameReducer(state, { type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
      expect(result.gameState).toBe(GameState.AWAITING_PLAYER_INPUT);
      expect(result.messages).toBe(state.messages);
      expect(result.entities).toBe(state.entities);
    });

    it('GM_INTERVENTION_SET stores the operator text', () => {
      const result = gameReducer(makePlayingState(), { type: 'GM_INTERVENTION_SET', text: 'Vesuvius stirs.' });
      expect(result.gmInterventionText).toBe('Vesuvius stirs.');
    });

    it('AMBITION_INFERRED stores the reading', () => {
      const inferredAmbition = { apparent_ambition: 'Appears set on ruling Rome.', confidence: 'low' as const, asOfTurn: 3 };
      const result = gameReducer(makePlayingState(), { type: 'AMBITION_INFERRED', inferredAmbition });
      expect(result.inferredAmbition).toBe(inferredAmbition);
    });

    it('AMBITION_INFERRED cannot replace a newer reading with an older async result', () => {
      const newer = { apparent_ambition: 'Commands the Rhine legions.', confidence: 'high' as const, asOfTurn: 6 };
      const older = { apparent_ambition: 'Courts a few senators.', confidence: 'low' as const, asOfTurn: 3 };
      const state = makePlayingState({ inferredAmbition: newer });

      const result = gameReducer(state, { type: 'AMBITION_INFERRED', inferredAmbition: older });

      expect(result).toBe(state);
      expect(result.inferredAmbition).toBe(newer);
    });

    it('RESOURCE_SPENT replaces the entity roster', () => {
      const state = makePlayingState();
      const spent = state.entities.map(e =>
        e.entity_id === PLAYER_ID ? { ...e, resources: { ...e.resources, deep_analyses: 3 } } : e
      );
      const result = gameReducer(state, { type: 'RESOURCE_SPENT', entities: spent });
      expect(result.entities).toBe(spent);
    });
  });
});
