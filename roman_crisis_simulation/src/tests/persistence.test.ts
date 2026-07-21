/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveGame,
  loadGame,
  clearSave,
  hasSave,
  updateSavedAmbition,
  SAVE_VERSION,
  type SaveGameState,
  type InferredAmbitionState,
} from '../persistence/saveGame';
import type { TurnHistoryEntry, RawCallRecord } from '../types';

function makeState(overrides: Partial<SaveGameState> = {}): SaveGameState {
  return {
    entities: [],
    worldState: {
      year: 235,
      week: 3,
      economic_stability: 'stable',
      political_climate: 'tense',
      regions: {},
    },
    simulationState: {
      imperial_status: 'Stable',
      senate_status: 'Functional',
      military_status: 'Loyal',
      plebeian_mood: 'Uneasy',
      major_ongoing_crisis: null,
    },
    reports: [],
    turnNumber: 4,
    playerCharacterId: 'severus_alexander',
    turnHistory: [],
    eventHistory: [],
    metaNarrative: 'A crisis of succession.',
    messages: [{ sender: 'gm', text: 'Welcome.' }],
    triggeredEventIds: [],
    suggestedActions: [],
    currentEvents: [],
    gmInterventionText: '',
    ...overrides,
  };
}

function makeRawCall(callName: string): RawCallRecord {
  return {
    callName,
    model: 'gemini-3-pro-preview',
    latencyMs: 100,
    attempts: 1,
    promptChars: 1000,
    rawResponse: 'x'.repeat(1000),
    validated: true,
  };
}

function makeHistoryEntry(turnNumber: number, withRawCalls: boolean): TurnHistoryEntry {
  return {
    turnNumber,
    playerIntent: `do thing ${turnNumber}`,
    adjudication: {
      turn: turnNumber,
      entityActions: [],
      deltas: [],
      headlines: [`Headline ${turnNumber}`],
      gm_private: [],
    },
    narration: `Narration for turn ${turnNumber}`,
    postTurnEntities: [],
    rawCalls: withRawCalls ? [makeRawCall('adjudication'), makeRawCall('narration')] : undefined,
  };
}

describe('persistence/saveGame', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a save through save/load', () => {
    const state = makeState({ turnNumber: 7 });
    saveGame(state);

    expect(hasSave()).toBe(true);

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(SAVE_VERSION);
    expect(typeof loaded!.savedAt).toBe('string');
    expect(() => new Date(loaded!.savedAt).toISOString()).not.toThrow();
    expect(loaded!.state).toEqual(state);
  });

  it('hasSave returns false when nothing has been saved', () => {
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  describe('updateSavedAmbition (stale-autosave race guard)', () => {
    const ambition: InferredAmbitionState = {
      apparent_ambition: 'Seize the purple by courting the Rhine legions',
      confidence: 'medium',
      asOfTurn: 3,
    };

    it('patches ONLY the ambition field into the newest stored save', () => {
      // Simulate the race: turn 3 autosaves, then turn 4 autosaves a NEWER
      // state, and only THEN does the (stale) ambition callback resolve.
      saveGame(makeState({ turnNumber: 3 }));
      const newerState = makeState({ turnNumber: 4 });
      saveGame(newerState);

      updateSavedAmbition(ambition);

      const loaded = loadGame();
      expect(loaded).not.toBeNull();
      // The newer turn's state survives untouched...
      expect(loaded!.state.turnNumber).toBe(4);
      expect({ ...loaded!.state, inferredAmbition: undefined }).toEqual({ ...newerState, inferredAmbition: undefined });
      // ...and the ambition landed on top of it.
      expect(loaded!.state.inferredAmbition).toEqual(ambition);
    });

    it('no-ops safely when no save exists', () => {
      expect(() => updateSavedAmbition(ambition)).not.toThrow();
      expect(hasSave()).toBe(false);
    });

    it('tolerates a storage write failure without throwing', () => {
      saveGame(makeState({ turnNumber: 2 }));
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      expect(() => updateSavedAmbition(ambition)).not.toThrow();
    });
  });

  it('clearSave removes the autosave', () => {
    saveGame(makeState());
    expect(hasSave()).toBe(true);

    clearSave();

    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('returns null and warns on a version mismatch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const envelope = {
      version: SAVE_VERSION + 1,
      savedAt: new Date().toISOString(),
      state: makeState(),
    };
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

    const loaded = loadGame();

    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null and warns on corrupted JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('gloryOfRome:autosave', '{not valid json!!!');

    const loaded = loadGame();

    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null for a well-formed but unrecognized shape', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify({ hello: 'world' }));

    const loaded = loadGame();

    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when localStorage.setItem always throws quota exceeded', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      throw err;
    });

    expect(() => saveGame(makeState())).not.toThrow();
    // Both the initial attempt and the stripped retry failed, so nothing
    // should have been persisted.
    expect(warnSpy).toHaveBeenCalledTimes(2);

    setItemSpy.mockRestore();
  });

  it('never throws when localStorage.getItem throws (e.g. private mode SecurityError)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });

    expect(() => loadGame()).not.toThrow();
    expect(loadGame()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('retries once with older rawCalls stripped when the full save is oversize', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First call (the "oversize" write) throws; every subsequent call
    // succeeds via the real Storage.prototype implementation.
    let calls = 0;
    const realSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        calls++;
        if (calls === 1) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return realSetItem.call(this, key, value);
      });

    const turnHistory = [
      makeHistoryEntry(1, true),
      makeHistoryEntry(2, true),
      makeHistoryEntry(3, true),
    ];
    const state = makeState({ turnNumber: 4, turnHistory });

    saveGame(state);

    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1); // one warning for the failed first attempt

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    // Older entries lost their rawCalls...
    expect(loaded!.state.turnHistory[0].rawCalls).toBeUndefined();
    expect(loaded!.state.turnHistory[1].rawCalls).toBeUndefined();
    // ...but the most recent entry's rawCalls survive.
    expect(loaded!.state.turnHistory[2].rawCalls).toBeDefined();
    expect(loaded!.state.turnHistory[2].rawCalls?.length).toBe(2);
    // Everything else about each entry is untouched.
    expect(loaded!.state.turnHistory[0].narration).toBe('Narration for turn 1');
    expect(loaded!.state.turnHistory[0].adjudication.headlines).toEqual(['Headline 1']);

    setItemSpy.mockRestore();
  });

  it('gives up gracefully if the stripped retry is still too big', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    const state = makeState({ turnHistory: [makeHistoryEntry(1, true), makeHistoryEntry(2, true)] });

    expect(() => saveGame(state)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(hasSave()).toBe(false);
  });
});
