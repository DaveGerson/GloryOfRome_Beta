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

import React, { createContext, useContext, useMemo, useReducer } from 'react';
import { gameReducer, createInitialGameState, GameDomainState, GameAction } from './gameReducer';

export interface GameContextValue {
  state: GameDomainState;
  dispatch: React.Dispatch<GameAction>;
}

const GameContext = createContext<GameContextValue | null>(null);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialGameState);
  // `dispatch` is stable; the memo keeps the context value's identity tied
  // to the state object itself, so consumers re-render exactly when a
  // dispatch produced a new state and never because the provider re-rendered.
  const value = useMemo<GameContextValue>(() => ({ state, dispatch }), [state]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return ctx;
}
