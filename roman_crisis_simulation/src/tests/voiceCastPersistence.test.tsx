/**
 * @vitest-environment jsdom
 *
 * tests/voiceCastPersistence.test.tsx
 *
 * The voice cast is kept with the campaign: the optional, additive
 * `voiceCast` save field (persistence/saveGame.ts), GAME_LOADED's
 * normalization, the in-place patch the casting uses
 * (`updateSavedVoiceCast`), the carry-forward in buildSaveState, and an
 * exported reign carrying it through import.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from './renderHook';
import { useCampaignTransactions } from '../hooks/useCampaignTransactions';
import { createInitialGameState, gameReducer, type GameAction, type GameDomainState } from '../state/gameReducer';
import { SAVE_KEY, importSaveBlob, loadGame, rawSaveBlob, saveGame, updateSavedVoiceCast } from '../persistence/saveGame';
import { deterministicCast, withMemberOverride, type VoiceCast } from '../narration/voiceCast';
import { makeAppSave, makeLegacySaveState } from './factories';

const CAST: VoiceCast = withMemberOverride(
  deterministicCast(
    [
      { entityId: 'julia_mamaea', name: 'Julia Mamaea', position: 'Regent', entityType: 'individual' },
      { entityId: 'maximinus_thrax', name: 'Maximinus Thrax', position: 'General of the Legions', entityType: 'individual' },
    ],
    { narratorId: 'senatorial-partner', voiceName: 'Enceladus' },
  ),
  'julia_mamaea',
  { style: 'icy and slow' },
);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the optional voiceCast save field', () => {
  it('an old save without it loads unchanged, byte for byte, and GAME_LOADED makes the cast null', () => {
    const old = { version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: makeLegacySaveState() };
    const text = JSON.stringify(old);
    localStorage.setItem(SAVE_KEY, text);
    const loaded = loadGame();
    expect(loaded).toEqual(old);
    expect(loaded?.state).not.toHaveProperty('voiceCast');
    expect(rawSaveBlob()).toBe(text);
    const state = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded!.state });
    expect(state.voiceCast).toBeNull();
  });

  it('a save with a cast loads it back, and GAME_LOADED restores it', () => {
    expect(saveGame(makeAppSave({ voiceCast: CAST })).ok).toBe(true);
    const loaded = loadGame();
    expect(loaded?.state.voiceCast).toEqual(CAST);
    const state = gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded!.state });
    expect(state.voiceCast).toEqual(CAST);
    expect(state.voiceCast?.members.julia_mamaea.override).toEqual({ style: 'icy and slow' });
  });

  it('a malformed cast never refuses the save; it loads as no cast', () => {
    const bad = { ...CAST, members: { julia_mamaea: { ...CAST.members.julia_mamaea, voiceName: 'Nobody' } } };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, savedAt: 'x', state: makeAppSave({ voiceCast: bad as VoiceCast }) }));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(gameReducer(createInitialGameState(), { type: 'GAME_LOADED', save: loaded!.state }).voiceCast).toBeNull();
  });

  it('an exported reign carries the cast through import', () => {
    saveGame(makeAppSave({ voiceCast: CAST }));
    const exported = rawSaveBlob()!;
    localStorage.clear();
    expect(importSaveBlob(exported)).toMatchObject({ ok: true });
    expect(loadGame()?.state.voiceCast).toEqual(CAST);
  });
});

describe('updateSavedVoiceCast', () => {
  it('patches only the cast into the stored save', () => {
    saveGame(makeAppSave({ turnNumber: 7 }));
    expect(updateSavedVoiceCast(CAST, 'severus_alexander')).toBe(true);
    const stored = loadGame()!.state;
    expect(stored.voiceCast).toEqual(CAST);
    expect(stored.turnNumber).toBe(7);
  });

  it('refuses another campaign\'s save, an older revision, and a missing save', () => {
    expect(updateSavedVoiceCast(CAST, 'severus_alexander')).toBe(false);
    saveGame(makeAppSave({ playerCharacterId: 'julia_mamaea' }));
    expect(updateSavedVoiceCast(CAST, 'severus_alexander')).toBe(false);
    expect(loadGame()!.state.voiceCast).toBeUndefined();
    saveGame(makeAppSave({ voiceCast: { ...CAST, revision: 9 } }));
    expect(updateSavedVoiceCast(CAST, 'severus_alexander')).toBe(false);
    expect(loadGame()!.state.voiceCast?.revision).toBe(9);
  });
});

describe('the cast in the game state', () => {
  it('VOICE_CAST_SET never replaces a newer cast; a new campaign starts uncast; a rollback leaves the cast', () => {
    let state = gameReducer(createInitialGameState(), { type: 'VOICE_CAST_SET', voiceCast: { ...CAST, revision: 5 } });
    expect(state.voiceCast?.revision).toBe(5);
    state = gameReducer(state, { type: 'VOICE_CAST_SET', voiceCast: { ...CAST, revision: 4 } });
    expect(state.voiceCast?.revision).toBe(5);
    const rolledBack = gameReducer(state, { type: 'TURN_ROLLED_BACK', snapshot: makeAppSave() } as GameAction);
    expect(rolledBack.voiceCast?.revision).toBe(5);
    const fresh = gameReducer(state, {
      type: 'GAME_STARTED', entities: [], playerCharacterId: 'x', introMessage: { sender: 'gm', text: 'Hi' }, suggestedActions: [],
    } as GameAction);
    expect(fresh.voiceCast).toBeNull();
  });

  it('buildSaveState carries a cast patched into the stored save forward over a stale in-memory one (same campaign only)', () => {
    const save = makeAppSave({ turnNumber: 3 });
    saveGame(save);
    updateSavedVoiceCast(CAST, 'severus_alexander');
    const state: GameDomainState = { ...createInitialGameState(), ...save, voiceCast: null, inferredAmbition: null, pendingIntelligenceFallout: [], privateScenes: [] } as GameDomainState;
    const hook = renderHook(({ s }: { s: GameDomainState }) => useCampaignTransactions(s, vi.fn()), { s: state });
    expect(hook.current.buildSaveState().voiceCast).toEqual(CAST);
    // An explicit override (a new campaign) is honored.
    expect(hook.current.buildSaveState({ voiceCast: null }).voiceCast).toBeNull();
    // Another campaign's stored cast is never carried.
    const other = { ...state, playerCharacterId: 'julia_mamaea' };
    hook.rerender({ s: other });
    expect(hook.current.buildSaveState().voiceCast).toBeNull();
    hook.unmount();
  });
});
