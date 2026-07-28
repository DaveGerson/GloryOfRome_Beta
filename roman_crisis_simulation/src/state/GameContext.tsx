/**
 * state/GameContext.tsx
 *
 * React context owning the game-domain reducer (state/gameReducer.ts,
 * DESIGN_DECISIONS.md D17). App.tsx is the composition root and the sole
 * consumer: it reads state via `useGame()` and passes plain props down to
 * every child component - children must NOT reach into this context
 * directly. All persistence stays in App.tsx's handlers (the provider
 * never touches saveGame/loadGame).
 */

import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import { gameReducer, createInitialGameState, GameDomainState, GameAction } from './gameReducer';

export interface GameContextValue {
  state: GameDomainState;
  dispatch: React.Dispatch<GameAction>;
  /** Monotonic token invalidated synchronously before any whole-state replacement dispatch. */
  getStateGeneration: () => number;
}

const GameContext = createContext<GameContextValue | null>(null);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, reducerDispatch] = useReducer(gameReducer, undefined, createInitialGameState);
  const stateGenerationRef = useRef(0);
  const dispatch = useCallback<React.Dispatch<GameAction>>(action => {
    // These actions replace the campaign/domain snapshot wholesale. Advance
    // the token before React schedules the reducer so retained async work can
    // observe invalidation immediately, even when the replacement happens to
    // contain byte-identical private-scene state.
    if (action.type === 'GAME_LOADED'
      || action.type === 'GAME_STARTED'
      || action.type === 'TURN_ROLLED_BACK') {
      stateGenerationRef.current += 1;
    }
    reducerDispatch(action);
  }, []);
  const getStateGeneration = useCallback(() => stateGenerationRef.current, []);
  // `dispatch` is stable; the memo keeps the context value's identity tied
  // to the state object itself, so consumers re-render exactly when a
  // dispatch produced a new state and never because the provider re-rendered.
  const value = useMemo<GameContextValue>(
    () => ({ state, dispatch, getStateGeneration }),
    [dispatch, getStateGeneration, state],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return ctx;
}
