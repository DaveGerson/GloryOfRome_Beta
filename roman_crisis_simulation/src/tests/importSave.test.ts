/**
 * @vitest-environment jsdom
 *
 * tests/importSave.test.ts — TDD (red-first) for the reign import route
 * (docs/superpowers/specs/2026-08-05-reign-export-import-design.md).
 *
 * `rawSaveBlob` restores the verbatim SAVE_KEY read that d8df778 removed —
 * per amended D45 the blob is shareable spoiler material, not private
 * material — and `importSaveBlob` is the route whose absence was the one
 * surviving reason the export stayed removed. Import acceptance and load
 * acceptance must be ONE code path (a shared validator loadGame delegates
 * to), so the rejection fixtures below deliberately mirror
 * persistence.test.ts's loadGame fixtures: whatever loadGame discards,
 * importSaveBlob refuses — with a reason, never a throw, and never a write.
 *
 * The consent ordering is the UI's job, not this module's: by the time
 * importSaveBlob runs the player has already confirmed any overwrite, so an
 * `ok` result means the slot HAS been written. On any failure the slot is
 * byte-for-byte untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveGame,
  loadGame,
  clearSave,
  hasSave,
  rawSaveBlob,
  importSaveBlob,
  SAVE_VERSION,
  type SaveGameState,
} from '../persistence/saveGame';
import type { Memory } from '../types';

const SAVE_KEY = 'gloryOfRome:autosave';

/**
 * The reigning character, present in the entities list so an `ok` import can
 * name who was restored — importSaveBlob derives `characterName` the same way
 * App.tsx's loadSavedGameSummary does: the entity whose entity_id matches
 * `playerCharacterId`.
 */
function makePlayerEntity() {
  return {
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    entity_type: 'individual' as const,
    status: 'alive' as const,
    location: 'Rome',
    relationships: {},
    memories: [] as Memory[],
    resources: {},
    visibility_network: [] as string[],
    current_state_narrative: 'The young emperor holds a fraying court.',
    short_term_goals: [] as string[],
    long_term_ambitions: [] as string[],
  };
}

function makeState(overrides: Partial<SaveGameState> = {}): SaveGameState {
  return {
    entities: [makePlayerEntity()],
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

describe('persistence/saveGame — rawSaveBlob and importSaveBlob', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a reign: saveGame → rawSaveBlob → clearSave → importSaveBlob → loadGame', () => {
    const state = makeState({ turnNumber: 7 });
    expect(saveGame(state)).toEqual({ ok: true });

    const blob = rawSaveBlob();
    expect(blob).not.toBeNull();

    expect(clearSave()).toEqual({ ok: true });
    expect(hasSave()).toBe(false);

    expect(importSaveBlob(blob!).ok).toBe(true);

    // Import acceptance and load acceptance are the same code path, so the
    // reign that comes back is exactly the reign that went out.
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
  });

  it('refuses garbage text as unreadable and leaves the pre-existing save untouched', () => {
    // The rejection may warn, the way loadGame's does; the reason string is
    // the contract, the console is not.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveGame(makeState({ turnNumber: 9 }));
    const before = localStorage.getItem(SAVE_KEY);

    const result = importSaveBlob('{not valid json!!!');

    expect(result).toEqual({ ok: false, reason: 'unreadable' });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(9);
  });

  it('refuses well-formed JSON of the wrong shape as not_a_reign, slot untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveGame(makeState({ turnNumber: 9 }));
    const before = localStorage.getItem(SAVE_KEY);

    const result = importSaveBlob(JSON.stringify({ hello: 'world' }));

    expect(result).toEqual({ ok: false, reason: 'not_a_reign' });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(9);
  });

  it('refuses a copy written for another age as version_mismatch, slot untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveGame(makeState({ turnNumber: 9 }));
    const before = localStorage.getItem(SAVE_KEY);

    // Structurally a perfect envelope — only the version disagrees. Same
    // equality-only check the loader applies; no cross-version migration.
    const otherAge = JSON.stringify({
      version: SAVE_VERSION + 1,
      savedAt: new Date().toISOString(),
      state: makeState({ turnNumber: 2 }),
    });
    const result = importSaveBlob(otherAge);

    expect(result).toEqual({ ok: false, reason: 'version_mismatch' });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(9);
  });

  it('rawSaveBlob is null with no save and byte-identical to the slot with one', () => {
    expect(rawSaveBlob()).toBeNull();

    saveGame(makeState({ turnNumber: 3 }));

    // Verbatim SAVE_KEY read — no re-serialization, no massaging. What the
    // player downloads IS the slot.
    expect(rawSaveBlob()).toBe(localStorage.getItem(SAVE_KEY));
  });

  it('carries the imported turnNumber and characterName on ok, for notices and future confirm copy', () => {
    saveGame(makeState({ turnNumber: 11 }));
    const blob = rawSaveBlob()!;
    clearSave();

    const result = importSaveBlob(blob);

    expect(result).toEqual({ ok: true, turnNumber: 11, characterName: 'Severus Alexander' });
  });

  it('reports storage_failed without throwing when the device will not take the writing down', () => {
    // Not in the spec's numbered test list, but the reason string is in its
    // ImportResult type and the copy table names its notice — so the failure
    // mode is pinned here with the rest.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveGame(makeState({ turnNumber: 5 }));
    const blob = rawSaveBlob()!;
    clearSave();
    saveGame(makeState({ turnNumber: 2 }));
    const before = localStorage.getItem(SAVE_KEY);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    let result: ReturnType<typeof importSaveBlob> | undefined;
    expect(() => {
      result = importSaveBlob(blob);
    }).not.toThrow();

    expect(result).toEqual({ ok: false, reason: 'storage_failed' });
    vi.restoreAllMocks();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(loadGame()!.state.turnNumber).toBe(2);
  });
});
