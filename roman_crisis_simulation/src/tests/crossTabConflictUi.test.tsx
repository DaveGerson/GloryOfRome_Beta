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
  it('renders CrossTabConflictNotice with Reload newest and Keep this tab actions', () => {
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
    expect(alert!.textContent).toContain('Week VII');
    expect(alert!.textContent).toContain('Autosave is paused');

    const buttons = Array.from(container.querySelectorAll('button'));
    const reloadBtn = buttons.find(b => b.textContent === 'Reload newest')!;
    const keepBtn = buttons.find(b => b.textContent === 'Keep this tab')!;
    act(() => reloadBtn.click());
    act(() => keepBtn.click());
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onKeepThisTab).toHaveBeenCalledTimes(1);
  });

  it('useCrossTabConflict listens to foreign storage writes when active and clears on dismissConflict', () => {
    const hook = renderHook(useCrossTabConflict, true);
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
    hook.unmount();
  });

  it('useCampaignTransactions pauses localStorage writes while autosavePaused is true', () => {
    const foreignSave = makeAppSave({
      turnNumber: 9,
      entities: [makeEntity({ entity_id: 'player_1', name: 'Foreign Tab Ruler' })],
      playerCharacterId: 'player_1',
    });
    saveGame(foreignSave);

    const localState = {
      ...createInitialGameState(),
      turnNumber: 4,
      playerCharacterId: 'player_1',
      entities: [makeEntity({ entity_id: 'player_1', name: 'Local Tab Ruler' })],
    };
    const dispatch = vi.fn();

    const paused = renderHook(
      ({ s, d, opts }) => useCampaignTransactions(s, d, opts),
      { s: localState, d: dispatch, opts: { autosavePaused: true } },
    );

    const onSaveFailure = vi.fn();
    let ok = false;
    act(() => {
      ok = paused.current.commitDomainMutation({
        candidate: paused.current.buildSaveState({ turnNumber: 5 }),
        action: { type: 'GAME_STATE_SET', gameState: gameReducer(localState, { type: 'GAME_STATE_SET', gameState: localState.gameState }).gameState },
        onSaveFailure,
      });
    });

    expect(ok).toBe(true);
    expect(onSaveFailure).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Foreign save in localStorage was NOT overwritten while autosavePaused was true.
    expect(loadGame()?.state.turnNumber).toBe(9);
    paused.unmount();

    // Resuming (autosavePaused: false) allows localStorage writes again.
    const active = renderHook(
      ({ s, d, opts }) => useCampaignTransactions(s, d, opts),
      { s: localState, d: dispatch, opts: { autosavePaused: false } },
    );
    act(() => {
      ok = active.current.commitDomainMutation({
        candidate: active.current.buildSaveState({ turnNumber: 5 }),
        action: { type: 'GAME_STATE_SET', gameState: localState.gameState },
        onSaveFailure,
      });
    });
    expect(ok).toBe(true);
    expect(loadGame()?.state.turnNumber).toBe(5);
    active.unmount();
  });
});
