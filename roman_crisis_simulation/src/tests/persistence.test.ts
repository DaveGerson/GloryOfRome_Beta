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
import type { TurnHistoryEntry, RawCallRecord, Memory } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import { serializeTurnSubmission } from '../playerInput/turnSubmission';

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
    promptText: `full prompt for ${callName}: ${'p'.repeat(500)}`,
    systemInstruction: `system instruction for ${callName}`,
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

  it('keeps legacy and canonical structured submissions in the single v1 plaintext history/message field', () => {
    const legacy = makeHistoryEntry(1, false);
    legacy.playerIntent = 'Hold court and hear the petitioners.';
    const canonical = serializeTurnSubmission({
      version: 1,
      kind: 'structured',
      actions: ['Address the Senate'],
      messagesOrOrders: [{
        recipient: { kind: 'free_text', text: 'the night watch' },
        command: 'Keep the eastern gate open',
      }],
      privateIntent: 'Preserve room to bargain',
      questionOrContext: 'Which benches are empty?',
    });
    const structured = { ...makeHistoryEntry(2, false), playerIntent: canonical };

    saveGame(makeState({
      turnNumber: 3,
      turnHistory: [legacy, structured],
      messages: [
        { sender: 'player', text: legacy.playerIntent },
        { sender: 'player', text: canonical },
      ],
    }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.state.turnHistory.map(entry => entry.playerIntent)).toEqual([
      legacy.playerIntent,
      canonical,
    ]);
    expect(loaded!.state.messages.map(message => message.text)).toEqual([
      legacy.playerIntent,
      canonical,
    ]);
    expect(JSON.stringify(loaded)).not.toContain('"turnSubmission"');
    expect(Object.keys(loaded!.state.turnHistory[1])).not.toContain('submission');
  });

  it('hasSave returns false when nothing has been saved', () => {
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('round-trips the optional turnSeed on history entries, alongside entries that lack it', () => {
    const seeded: TurnHistoryEntry = { ...makeHistoryEntry(1, false), turnSeed: 123456789 };
    const unseeded = makeHistoryEntry(2, false); // no turnSeed - same shape older entries have
    saveGame(makeState({ turnNumber: 3, turnHistory: [seeded, unseeded] }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory[0].turnSeed).toBe(123456789);
    expect(loaded!.state.turnHistory[1].turnSeed).toBeUndefined();
    // Everything else about the seedless entry is untouched.
    expect(loaded!.state.turnHistory[1].narration).toBe('Narration for turn 2');
    expect(loaded!.state.turnHistory[1].adjudication.headlines).toEqual(['Headline 2']);
  });

  it('round-trips the optional GM-private truth ledger (D11), including origin/assumed markers', () => {
    const truthLedger = [
      { id: 'truth_2_1', turn: 2, claim: 'The Emperor plans tribute', aboutId: 'severus_alexander', originId: 'maximinus_thrax', isTrue: false, reportId: 'report_2_1' },
      { id: 'truth_3_1', turn: 3, claim: 'Grain stores run low', aboutId: 'The Suburra', isTrue: true, reportId: 'report_3_1', assumed: true },
    ];
    saveGame(makeState({ turnNumber: 4, truthLedger }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.truthLedger).toEqual(truthLedger);
  });

  it('round-trips the optional player knowledge store (D21), including update timelines', () => {
    const knowledge = [
      {
        id: 'claim_2_report:maximinus_thrax:rumor',
        subject: 'maximinus_thrax',
        claim: 'Thrax courts the Rhine legions',
        claimKey: 'report:maximinus_thrax:rumor',
        firstLearnedTurn: 2,
        updates: [
          { turn: 2, source: 'rumor' as const, text: 'Thrax courts the Rhine legions', credibility: 0.6 },
          { turn: 4, source: 'rumor' as const, text: 'The legions now openly cheer Thrax', credibility: 0.8 },
        ],
      },
      {
        id: 'claim_3_digest:resource:severus_alexander:denarii',
        subject: 'severus_alexander',
        claim: 'Your denarii dwindles.',
        claimKey: 'digest:resource:severus_alexander:denarii',
        firstLearnedTurn: 3,
        updates: [{ turn: 3, source: 'self' as const, text: 'Your denarii dwindles.' }],
      },
    ];
    saveGame(makeState({ turnNumber: 5, knowledge }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.knowledge).toEqual(knowledge);
  });

  it('round-trips optional relationship observation markers while retaining legacy claims under save version 1', () => {
    const legacy: KnowledgeClaim = {
      id: 'claim_1_report:lucius:general:rumor',
      subject: 'lucius',
      claim: 'A legacy report about Lucius.',
      claimKey: 'report:lucius:general:rumor',
      firstLearnedTurn: 1,
      updates: [{ turn: 1, source: 'rumor', text: 'A legacy report about Lucius.' }],
    };
    const observation: KnowledgeClaim = {
      id: 'claim_7_relationship-observation:7:0',
      subject: 'severus_alexander',
      claim: 'Senator Lucius said, "I stand with Severus."',
      claimKey: 'relationship-observation:7:0',
      firstLearnedTurn: 7,
      updates: [{
        turn: 7,
        source: 'witnessed',
        text: 'Senator Lucius said, "I stand with Severus."',
      }],
      relationshipObservation: {
        evidenceId: 'direct_7_1',
        participantIds: ['severus_alexander', 'lucius'],
        quote: { speakerId: 'lucius', text: 'I stand with Severus.' },
      },
    };

    saveGame(makeState({ turnNumber: 7, knowledge: [legacy, observation] }));
    const loaded = loadGame();

    expect(loaded?.version).toBe(1);
    expect(loaded?.state.knowledge).toEqual([legacy, observation]);
    expect(loaded?.state.knowledge?.[0].relationshipObservation).toBeUndefined();
  });

  it('round-trips the optional Director intents slice (4C.3), and their absence on a pre-Director save', () => {
    const npcIntents = [
      { entity_id: 'maximinus_thrax', intent: 'Court the Rhine legions for a march on Rome', continuity: 'continue' as const },
      { entity_id: 'praetorian_guard', intent: 'Extract the donative before pledging swords', continuity: 'new' as const },
    ];
    saveGame(makeState({ turnNumber: 6, npcIntents }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.npcIntents).toEqual(npcIntents);

    // A save written without the field (pre-Director campaign) loads with it
    // simply absent - GAME_LOADED normalizes absent -> [] downstream.
    localStorage.clear();
    saveGame(makeState({ turnNumber: 2 }));
    const legacy = loadGame();
    expect(legacy).not.toBeNull();
    expect(legacy!.state.npcIntents).toBeUndefined();
  });

  it('round-trips the optional voice/epithet on entities (4C.5), alongside legacy entities that lack them', () => {
    const baseEntity = {
      entity_id: 'maximinus_thrax',
      name: 'Maximinus Thrax',
      entity_type: 'individual' as const,
      status: 'alive' as const,
      location: 'Praetorian Camp',
      relationships: {},
      memories: [] as Memory[],
      resources: {},
      visibility_network: [] as string[],
      current_state_narrative: 'A giant of a man.',
      short_term_goals: [] as string[],
      long_term_ambitions: [] as string[],
    };
    const flavored = {
      ...baseEntity,
      voice: "clipped soldier's Latin, contempt for senatorial flourish",
      epithet: 'the Thracian',
    };
    const legacy = { ...baseEntity, entity_id: 'severus_alexander', name: 'Severus Alexander' }; // pre-4C.5 entity shape
    saveGame(makeState({ turnNumber: 3, entities: [flavored, legacy] }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.entities[0].voice).toBe("clipped soldier's Latin, contempt for senatorial flourish");
    expect(loaded!.state.entities[0].epithet).toBe('the Thracian');
    expect(loaded!.state.entities[1].voice).toBeUndefined();
    expect(loaded!.state.entities[1].epithet).toBeUndefined();
  });

  it('round-trips the optional npcIntents on history entries, alongside entries that lack it', () => {
    const withIntents: TurnHistoryEntry = {
      ...makeHistoryEntry(1, false),
      npcIntents: [{ entity_id: 'maximinus_thrax', intent: 'March on Rome', continuity: 'pivot' }],
    };
    const withoutIntents = makeHistoryEntry(2, false); // pre-Director entry shape
    saveGame(makeState({ turnNumber: 3, turnHistory: [withIntents, withoutIntents] }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory[0].npcIntents).toEqual(withIntents.npcIntents);
    expect(loaded!.state.turnHistory[1].npcIntents).toBeUndefined();
  });

  it('round-trips the optional npcMindResults on history entries (4C.4), alongside entries that lack it', () => {
    const withMinds: TurnHistoryEntry = {
      ...makeHistoryEntry(1, false),
      npcMindResults: [
        {
          entity_id: 'maximinus_thrax',
          chosen_action: 'Muster the Rhine veterans and march.',
          method: 'Night marches, paid scouts.',
          private_reasoning: 'The purple is within reach - and my own men must never see me hesitate.',
          scheme_adjustment: 'Recruitment complete; the march begins.',
        },
      ],
    };
    const withoutMinds = makeHistoryEntry(2, false); // pre-minds entry shape
    saveGame(makeState({ turnNumber: 3, turnHistory: [withMinds, withoutMinds] }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory[0].npcMindResults).toEqual(withMinds.npcMindResults);
    expect(loaded!.state.turnHistory[1].npcMindResults).toBeUndefined();
    // The legacy-shaped entry is otherwise untouched.
    expect(loaded!.state.turnHistory[1].narration).toBe('Narration for turn 2');
  });

  it('round-trips the optional event-firing bookkeeping (4D.2) beside the legacy triggeredEventIds, and its absence on a legacy save', () => {
    const eventFirings = [
      { eventId: 'grain_shortage', lastFiredTurn: 3, timesFired: 2 },
      { eventId: 'gordian_stirrings', lastFiredTurn: 5, timesFired: 1 },
    ];
    saveGame(makeState({ turnNumber: 6, triggeredEventIds: ['grain_shortage', 'gordian_stirrings'], eventFirings }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.eventFirings).toEqual(eventFirings);
    // The legacy string set is still written in lockstep, deduped.
    expect(loaded!.state.triggeredEventIds).toEqual(['grain_shortage', 'gordian_stirrings']);

    // A save written without the field (pre-4D.2 campaign) loads with it
    // simply absent - GAME_LOADED normalizes it from triggeredEventIds
    // downstream (events/engine.ts::normalizeEventFirings).
    localStorage.clear();
    saveGame(makeState({ turnNumber: 2, triggeredEventIds: ['grain_shortage'] }));
    const legacy = loadGame();
    expect(legacy).not.toBeNull();
    expect(legacy!.state.eventFirings).toBeUndefined();
    expect(legacy!.state.triggeredEventIds).toEqual(['grain_shortage']);
  });

  it('loads a stored v1 envelope that predates the knowledge store (field simply absent)', () => {
    // Written directly to storage, bypassing saveGame, to mirror a blob
    // persisted before the field existed.
    const envelope = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: makeState({ turnNumber: 2 }),
    };
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.knowledge).toBeUndefined();
    expect(loaded!.state.turnNumber).toBe(2);
  });

  it('loads a stored v1 envelope that predates the truth ledger (field simply absent)', () => {
    // Written directly to storage, bypassing saveGame, to mirror a blob
    // persisted before the field existed.
    const envelope = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: makeState({ turnNumber: 2 }),
    };
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.truthLedger).toBeUndefined();
    expect(loaded!.state.turnNumber).toBe(2);
  });

  it('round-trips history entries with and without the optional postTurnEntities snapshot', () => {
    const { postTurnEntities, ...withoutSnapshot } = makeHistoryEntry(1, false);
    const withSnapshot: TurnHistoryEntry = { ...makeHistoryEntry(2, false), postTurnEntities: [] };
    saveGame(makeState({ turnNumber: 3, turnHistory: [withoutSnapshot, withSnapshot] }));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory[0].postTurnEntities).toBeUndefined();
    expect(loaded!.state.turnHistory[1].postTurnEntities).toEqual([]);
    // Everything else about the snapshotless entry is untouched.
    expect(loaded!.state.turnHistory[0].narration).toBe('Narration for turn 1');
    expect(loaded!.state.turnHistory[0].adjudication.headlines).toEqual(['Headline 1']);
  });

  it('loads a stored v1 envelope whose history entries all carry full snapshots (pre-optional shape)', () => {
    // Written directly to storage, bypassing saveGame, to mirror a blob
    // persisted while the field was required on every entry.
    const envelope = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: makeState({
        turnNumber: 3,
        turnHistory: [makeHistoryEntry(1, false), makeHistoryEntry(2, false)],
      }),
    };
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory).toHaveLength(2);
    expect(loaded!.state.turnHistory[0].postTurnEntities).toEqual([]);
    expect(loaded!.state.turnHistory[1].postTurnEntities).toEqual([]);
  });

  it('loads a stored v1 envelope whose history entries predate turnSeed', () => {
    // Written directly to storage, bypassing saveGame, to mirror a blob
    // persisted before the field existed.
    const envelope = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: makeState({ turnNumber: 2, turnHistory: [makeHistoryEntry(1, false)] }),
    };
    localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.turnHistory).toHaveLength(1);
    expect(loaded!.state.turnHistory[0].turnSeed).toBeUndefined();
    expect(loaded!.state.turnHistory[0].playerIntent).toBe('do thing 1');
  });

  describe('lean saves - captured prompt text never persisted', () => {
    it('strips promptText/systemInstruction from every persisted rawCall, keeping rawResponse and metadata', () => {
      const turnHistory = [makeHistoryEntry(1, true), makeHistoryEntry(2, true)];
      const state = makeState({ turnNumber: 3, turnHistory });

      saveGame(state);

      // The serialized blob carries no captured prompt text anywhere.
      const raw = localStorage.getItem('gloryOfRome:autosave')!;
      expect(raw).not.toContain('promptText');
      expect(raw).not.toContain('systemInstruction');
      expect(raw).not.toContain('full prompt for');

      // rawResponse persistence is unchanged: EVERY entry keeps its rawCalls.
      const loaded = loadGame();
      expect(loaded).not.toBeNull();
      for (const entry of loaded!.state.turnHistory) {
        expect(entry.rawCalls).toHaveLength(2);
        for (const call of entry.rawCalls!) {
          expect(call.promptText).toBeUndefined();
          expect(call.systemInstruction).toBeUndefined();
          expect(call.rawResponse).toBe('x'.repeat(1000));
          expect(call.promptChars).toBe(1000);
        }
      }

      // The in-memory records the caller handed in keep their full text.
      expect(state.turnHistory[0].rawCalls![0].promptText).toContain('full prompt for');
      expect(state.turnHistory[0].rawCalls![0].systemInstruction).toContain('system instruction for');
    });

    it('keeps the prompt text out of the blob on the oversize-retry path too', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let calls = 0;
      const realSetItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ) {
        calls++;
        if (calls === 1) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return realSetItem.call(this, key, value);
      });

      saveGame(makeState({ turnNumber: 3, turnHistory: [makeHistoryEntry(1, true), makeHistoryEntry(2, true)] }));

      const raw = localStorage.getItem('gloryOfRome:autosave')!;
      expect(raw).not.toContain('promptText');
      expect(raw).not.toContain('systemInstruction');
      // The retry's existing behavior is intact: only the newest entry keeps rawCalls.
      const loaded = loadGame();
      expect(loaded!.state.turnHistory[0].rawCalls).toBeUndefined();
      expect(loaded!.state.turnHistory[1].rawCalls).toHaveLength(2);
    });

    it('loads a stored v1 envelope whose rawCalls predate promptText/systemInstruction', () => {
      // Written directly to storage, bypassing saveGame, to mirror a blob
      // persisted before the fields existed.
      const legacyCall = {
        callName: 'adjudication',
        model: 'gemini-3-pro-preview',
        latencyMs: 100,
        attempts: 1,
        promptChars: 1000,
        rawResponse: 'x'.repeat(1000),
        validated: true,
      };
      const envelope = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        state: makeState({
          turnNumber: 2,
          turnHistory: [{ ...makeHistoryEntry(1, false), rawCalls: [legacyCall] }],
        }),
      };
      localStorage.setItem('gloryOfRome:autosave', JSON.stringify(envelope));

      const loaded = loadGame();
      expect(loaded).not.toBeNull();
      expect(loaded!.state.turnHistory[0].rawCalls).toHaveLength(1);
      expect(loaded!.state.turnHistory[0].rawCalls![0]).toEqual(legacyCall);
      expect(loaded!.state.turnHistory[0].rawCalls![0].promptText).toBeUndefined();
    });
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

    it('does not let an older async result overwrite a newer stored ambition', () => {
      const newer: InferredAmbitionState = {
        apparent_ambition: 'Command the Rhine legions and dictate terms to Rome',
        confidence: 'high',
        asOfTurn: 6,
      };
      saveGame(makeState({ turnNumber: 7, inferredAmbition: newer }));
      const before = localStorage.getItem('gloryOfRome:autosave');

      updateSavedAmbition(ambition);

      expect(localStorage.getItem('gloryOfRome:autosave')).toBe(before);
      expect(loadGame()!.state.inferredAmbition).toEqual(newer);
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

    expect(saveGame(makeState())).toEqual({ ok: false });
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
