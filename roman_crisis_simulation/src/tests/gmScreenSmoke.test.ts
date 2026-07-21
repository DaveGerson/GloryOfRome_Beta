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
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GameMasterScreen from '../components/GameMasterScreen';
import type { WorldState } from '../types';

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

describe('components/GameMasterScreen - legacy-save smoke render', () => {
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
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
