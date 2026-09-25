/**
 * @vitest-environment jsdom
 *
 * tests/appTransactions.test.ts — the pure transaction vocabulary App.tsx's
 * handlers share (app/transactions.ts). These helpers were App-local
 * closures with no direct test; they are exercised end to end by
 * appTransactionContracts.test.ts, and pinned here in isolation so a change
 * to one of them fails next to its own name.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    newestInferredAmbition,
    isSameCampaignPrefix,
    privateScenesFingerprint,
    pickSaveState,
    loadSavedGameSummary,
} from '../app/transactions';
import { createInitialGameState } from '../state/gameReducer';
import { saveGame, type InferredAmbitionState } from '../persistence/saveGame';
import { makeAppSave, makeEntity, makePrivateScene, makeTurnHistoryEntry } from './factories';

function ambition(asOfTurn: number, apparent_ambition = `as of ${asOfTurn}`): InferredAmbitionState {
    return { apparent_ambition, confidence: 'medium', asOfTurn };
}

describe('newestInferredAmbition (D8)', () => {
    it('returns null when every candidate is absent', () => {
        expect(newestInferredAmbition()).toBeNull();
        expect(newestInferredAmbition(null, undefined, null)).toBeNull();
    });

    it('picks the highest asOfTurn regardless of argument position', () => {
        const old = ambition(3);
        const fresh = ambition(9);
        expect(newestInferredAmbition(fresh, old)).toBe(fresh);
        expect(newestInferredAmbition(old, null, fresh, undefined)).toBe(fresh);
    });

    it('breaks a tie in favour of the LATER argument', () => {
        const stored = ambition(6, 'stored');
        const live = ambition(6, 'live');
        expect(newestInferredAmbition(stored, live)).toBe(live);
        expect(newestInferredAmbition(live, stored)).toBe(stored);
    });
});

describe('isSameCampaignPrefix', () => {
    const history = [
        makeTurnHistoryEntry({ turnNumber: 1, playerIntent: 'Court the Senate.' }),
        makeTurnHistoryEntry({ turnNumber: 2, playerIntent: 'Pay the legions.' }),
    ];
    const candidate = makeAppSave({ turnNumber: 3, turnHistory: history });

    it('accepts the identical state and any earlier prefix of it', () => {
        expect(isSameCampaignPrefix(candidate, candidate)).toBe(true);
        expect(isSameCampaignPrefix(candidate, { ...candidate, turnNumber: 2, turnHistory: history.slice(0, 1) })).toBe(true);
        expect(isSameCampaignPrefix(candidate, { ...candidate, turnNumber: 1, turnHistory: [] })).toBe(true);
    });

    it('rejects a different player or a different premise', () => {
        expect(isSameCampaignPrefix(candidate, { ...candidate, playerCharacterId: 'someone_else' })).toBe(false);
        expect(isSameCampaignPrefix(candidate, { ...candidate, metaNarrative: 'Another world.' })).toBe(false);
    });

    it('rejects a stored state that is AHEAD of the candidate', () => {
        expect(isSameCampaignPrefix(candidate, { ...candidate, turnNumber: 4 })).toBe(false);
        expect(isSameCampaignPrefix(
            { ...candidate, turnHistory: history.slice(0, 1) },
            candidate,
        )).toBe(false);
    });

    it('rejects a history that diverged at any entry', () => {
        const diverged = [history[0], { ...history[1], playerIntent: 'Flee to Antioch.' }];
        expect(isSameCampaignPrefix(candidate, { ...candidate, turnHistory: diverged })).toBe(false);
    });
});

describe('privateScenesFingerprint', () => {
    it('is equal for structurally equal lists and differs on any change', () => {
        const scene = makePrivateScene();
        expect(privateScenesFingerprint([scene])).toBe(privateScenesFingerprint([{ ...scene }]));
        expect(privateScenesFingerprint([scene])).not.toBe(privateScenesFingerprint([]));
        expect(privateScenesFingerprint([scene])).not.toBe(
            privateScenesFingerprint([{ ...scene, npcResponseCount: scene.npcResponseCount + 1 }]),
        );
    });
});

describe('pickSaveState (D17)', () => {
    it('carries every persisted slice by identity and nothing transient', () => {
        const state = createInitialGameState();
        const picked = pickSaveState(state);
        for (const [key, value] of Object.entries(picked)) {
            expect(value, key).toBe(state[key as keyof typeof state]);
        }
        // Transient reducer fields never reach the save bundle.
        expect(picked).not.toHaveProperty('gameState');
        expect(picked).not.toHaveProperty('activeEvent');
        // The full persisted field list, pinned: adding a slice to the save
        // is a deliberate act that updates this list alongside it.
        expect(Object.keys(picked).sort()).toEqual([
            'currentEvents', 'entities', 'eventFirings', 'eventHistory', 'gmInterventionText',
            'inferredAmbition', 'knowledge', 'messages', 'metaNarrative', 'npcIntents',
            'pendingIntelligenceFallout', 'playerCharacterId', 'privateScenes', 'reports',
            'simulationState', 'suggestedActions', 'triggeredEventIds', 'truthLedger',
            'turnHistory', 'turnNumber', 'voiceCast', 'worldState',
        ]);
    });
});

describe('loadSavedGameSummary', () => {
    beforeEach(() => localStorage.clear());

    it('is null with no save on the device', () => {
        expect(loadSavedGameSummary()).toBeNull();
    });

    it('names the reigning character and the week from the save', () => {
        expect(saveGame(makeAppSave({ turnNumber: 7 })).ok).toBe(true);
        const summary = loadSavedGameSummary();
        expect(summary?.turnNumber).toBe(7);
        expect(summary?.characterName).toBe(
            makeAppSave().entities.find(entity => entity.entity_id === 'severus_alexander')?.name,
        );
        expect(typeof summary?.savedAt).toBe('string');
    });

    it("says 'Unknown' rather than coercing a non-string name (B7a 1a)", () => {
        const player = makeEntity({ entity_id: 'severus_alexander', name: 5 as unknown as string });
        expect(saveGame(makeAppSave({ entities: [player] })).ok).toBe(true);
        expect(loadSavedGameSummary()?.characterName).toBe('Unknown');
    });
});
