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
import type { Entity, TurnHistoryEntry, WorldState } from '../types';

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
      // The per-turn npc perception tab exists even for a legacy history
      // whose entries carry no perceivingNpcIds.
      expect(container.textContent).toContain('npc perception');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders every tab for a fully-populated 4C entry - including a legacy-shaped snapshot entity missing visibility_network - without throwing', async () => {
    function makeSnapshotEntity(overrides: Partial<Entity> = {}): Entity {
      return {
        entity_id: 'npc_full',
        name: 'Full Roman',
        entity_type: 'individual',
        status: 'alive',
        location: 'Palatine Hill',
        relationships: {},
        memories: [{ turn: 2, event_description: 'Saw the thing.', emotional_impact: 'Notable', involved_entities: [] }],
        resources: { denarii: 10 },
        visibility_network: [],
        current_state_narrative: 'A Roman.',
        short_term_goals: ['Endure'],
        long_term_ambitions: [],
        ...overrides,
      };
    }
    const player = makeSnapshotEntity({ entity_id: 'player_1', name: 'Gaius Testus' });
    const fullNpc = makeSnapshotEntity();
    // Legacy shape: a snapshot written before visibility_network existed.
    // NpcPerceptionView must default it, not crash (its digest derivation
    // reads the field unconditionally for the network rule).
    const legacyNpc = { ...makeSnapshotEntity({ entity_id: 'npc_legacy', name: 'Legacy Roman', location: 'Praetorian Camp' }) } as Record<string, unknown>;
    delete legacyNpc.visibility_network;
    const distantA = makeSnapshotEntity({ entity_id: 'npc_distant_a', name: 'Distant A', location: 'Ravenna' });
    const distantB = makeSnapshotEntity({ entity_id: 'npc_distant_b', name: 'Distant B', location: 'Ravenna' });

    const entry: TurnHistoryEntry = {
      turnNumber: 2,
      playerIntent: 'Hold court',
      adjudication: {
        turn: 2,
        entityActions: [{ id: 'npc_full', intent: 'intrigue', target: 'player_1', notes: 'Moves quietly.' }],
        deltas: [
          // Forces the network-rule path (involved entities at neither
          // viewer's location) - the branch that reads visibility_network.
          { type: 'relation', key: 'npc_distant_a:npc_distant_b:trust_level', delta: 1, reason: 'A quiet accord.' },
          { type: 'resource', key: 'npc_full:denarii', delta: 5, reason: 'A purse arrives.' },
        ],
        headlines: ['The city murmurs.'],
        gm_private: ['[Director] a note', '[Mind] another note'],
      },
      narration: 'A tense week.',
      postTurnEntities: [player, fullNpc, legacyNpc as unknown as Entity, distantA, distantB],
      perceivingNpcIds: ['npc_full', 'npc_legacy'],
      npcIntents: [{ entity_id: 'npc_full', intent: 'Corner the grain supply', continuity: 'continue' }],
      npcMindResults: [{ entity_id: 'npc_full', chosen_action: 'Buy the docks', method: 'Through a proxy', private_reasoning: 'Mine alone.', scheme_adjustment: 'The docks come first now.' }],
      turnSeed: 123,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(GameMasterScreen, {
            history: [entry],
            onClose: () => {},
            interventionText: '',
            onSetIntervention: () => {},
            playerCharacterId: 'player_1',
            worldState,
            turnNumber: 3,
            npcIntents: entry.npcIntents,
          })
        );
      });

      // Click through EVERY tab - each must render without throwing.
      const tabs = Array.from(container.querySelectorAll('button[role="tab"]')) as HTMLButtonElement[];
      expect(tabs.length).toBeGreaterThan(0);
      for (const tab of tabs) {
        await act(async () => {
          tab.click();
        });
        // Campaign-wide tabs (truth ledger / player knowledge) render their
        // own views instead of the per-turn loop, so the shared assertion is
        // just "the screen is still standing".
        expect(container.textContent).toContain('Game Master Tools');
      }

      // The npc perception tab in particular: the legacy entity rendered
      // (defensive default, network shown as 'none') alongside the full one.
      const perceptionTab = tabs.find(t => t.textContent === 'npc perception')!;
      await act(async () => {
        perceptionTab.click();
      });
      expect(container.textContent).toContain('Full Roman');
      expect(container.textContent).toContain('Legacy Roman');
      expect(container.textContent).toContain('network: none');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
