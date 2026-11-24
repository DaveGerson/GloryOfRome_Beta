/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CrossTabConflictNotice } from '../components/ui/FailureNotices';
import { useCrossTabConflict } from '../hooks/useShellEffects';
import { useCampaignTransactions } from '../hooks/useCampaignTransactions';
import { createInitialGameState, gameReducer } from '../state/gameReducer';
import { loadGame, SAVE_KEY, saveGame } from '../persistence/saveGame';
import { renderHook } from './renderHook';
import { makeEntity, makeAppSave } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  while (mounted.length) {
    const instance = mounted.pop()!;
    await act(async () => instance.root.unmount());
    instance.container.remove();
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

describe('1D: Cross-Tab Save Conflict Notice & Autosave Pause', () => {
  it('renders CrossTabConflictNotice with D44 Turn wording and Reload/Keep actions for written and cleared conflicts', () => {
    const onReload = vi.fn();
    const onKeepThisTab = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    act(() => {
      root.render(
        <CrossTabConflictNotice
          conflict={{ kind: 'written', savedAt: '2026-11-23T12:00:00Z', turnNumber: 7 }}
          onReload={onReload}
          onKeepThisTab={onKeepThisTab}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Turn VII');
    expect(alert!.textContent).not.toContain('Week VII');
    expect(alert!.textContent).toContain('Autosave is paused');

    let buttons = Array.from(container.querySelectorAll('button'));
    const reloadBtn = buttons.find(b => b.textContent === "Reload that tab's reign")!;
    const keepBtn = buttons.find(b => b.textContent === "Keep this tab's reign")!;
    act(() => reloadBtn.click());
    act(() => keepBtn.click());
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onKeepThisTab).toHaveBeenCalledTimes(1);

    // turnNumber: 0 omits the Turn suffix, and cleared conflict makes "Keep this tab's reign" primary.
    act(() => {
      root.render(
        <CrossTabConflictNotice
          conflict={{ kind: 'cleared', savedAt: null, turnNumber: 0 }}
          onReload={onReload}
          onKeepThisTab={onKeepThisTab}
        />,
      );
    });
    expect(container.textContent).not.toContain('Turn I');
    buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons[0]?.textContent).toBe("Keep this tab's reign");
    expect(buttons[1]?.textContent).toBe('Reload cleared device');
  });

  it('useCrossTabConflict listens to foreign storage writes when active and clears on deactivate or dismissConflict', () => {
    const hook = renderHook(active => useCrossTabConflict(active), true);
    expect(hook.current.conflict).toBeNull();

    const foreignPayload = JSON.stringify({
      version: 1,
      savedAt: '2026-11-23T13:00:00Z',
      state: makeAppSave({ turnNumber: 9 }),
    });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: SAVE_KEY,
        newValue: foreignPayload,
        storageArea: localStorage,
      }));
    });

    expect(hook.current.conflict).toEqual({
      kind: 'written',
      savedAt: '2026-11-23T13:00:00Z',
      turnNumber: 9,
    });

    act(() => hook.current.dismissConflict());
    expect(hook.current.conflict).toBeNull();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: SAVE_KEY,
        newValue: foreignPayload,
        storageArea: localStorage,
      }));
    });
    expect(hook.current.conflict).not.toBeNull();
    hook.rerender(false);
    expect(hook.current.conflict).toBeNull();
    hook.rerender(true);
    expect(hook.current.conflict).toBeNull();
    hook.unmount();
  });

  it('pauses saves even through an already-captured commitDomainMutation closure and skips foreign stored merge on skipStoredMerge', () => {
    const foreignSave = makeAppSave({
      turnNumber: 9,
      entities: [makeEntity({ entity_id: 'player_1', name: 'Local Tab Ruler' })],
      playerCharacterId: 'player_1',
      inferredAmbition: { apparent_ambition: 'Foreign ambition', confidence: 'high' as const, summary: 'Foreign ambition', evidence: ['Secret plot'], asOfTurn: 9 },
    });
    saveGame(foreignSave);

    const localState = {
      ...createInitialGameState(),
      turnNumber: 4,
      playerCharacterId: 'player_1',
      entities: [makeEntity({ entity_id: 'player_1', name: 'Local Tab Ruler' })],
      inferredAmbition: { apparent_ambition: 'Local ambition', confidence: 'medium' as const, summary: 'Local ambition', evidence: ['Stay loyal'], asOfTurn: 3 },
    };
    const dispatch = vi.fn();

    const hook = renderHook(
      ({ s, d, opts }) => useCampaignTransactions(s, d, opts),
      { s: localState, d: dispatch, opts: { autosavePaused: false } },
    );

    // Capture commitDomainMutation BEFORE cross-tab conflict triggers (simulates an in-flight turn).
    const capturedCommit = hook.current.commitDomainMutation;
    hook.rerender({ s: localState, d: dispatch, opts: { autosavePaused: true } });

    const onSaveFailure = vi.fn();
    let ok = false;
    act(() => {
      ok = capturedCommit({
        candidate: hook.current.buildSaveState({ turnNumber: 5 }),
        action: { type: 'GAME_STATE_SET', gameState: gameReducer(localState, { type: 'GAME_STATE_SET', gameState: localState.gameState }).gameState },
        onSaveFailure,
      });
    });

    expect(ok).toBe(true);
    expect(onSaveFailure).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(hook.current.unsavedWhilePaused).toBe(true);
    // Foreign save in localStorage was NOT overwritten by the stale captured closure.
    expect(loadGame()?.state.turnNumber).toBe(9);

    // skipStoredMerge preserves local ambition rather than importing the foreign tab's ambition.
    const cleanKeepCandidate = hook.current.buildSaveState({}, { skipStoredMerge: true });
    expect(cleanKeepCandidate.inferredAmbition?.summary).toBe('Local ambition');

    // Resuming (autosavePaused: false) allows localStorage writes again.
    hook.rerender({ s: localState, d: dispatch, opts: { autosavePaused: false } });
    act(() => {
      ok = hook.current.commitDomainMutation({
        candidate: hook.current.buildSaveState({ turnNumber: 5 }, { skipStoredMerge: true }),
        action: { type: 'GAME_STATE_SET', gameState: localState.gameState },
        onSaveFailure,
      });
    });
    expect(ok).toBe(true);
    expect(loadGame()?.state.turnNumber).toBe(5);
    hook.unmount();
  });
});
