/**
 * @vitest-environment jsdom
 *
 * tests/campaignTransactionsHook.test.tsx — the transaction kernel extracted
 * from App.tsx (hooks/useCampaignTransactions.ts) and the private-scene
 * prompt builder (hooks/usePrivateSceneController.ts). The App-level
 * suites (appTransactionContracts, privateSceneTransaction) prove these
 * through the whole UI; this file pins the kernel's own mutex and
 * save-then-dispatch contracts at the hook boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHook } from './renderHook';
import { useCampaignTransactions } from '../hooks/useCampaignTransactions';
import { buildPrivateScenePrompt } from '../hooks/usePrivateSceneController';
import { isPrivateSceneInteractionLocked } from '../app/transactions';
import { createInitialGameState, type GameAction, type GameDomainState } from '../state/gameReducer';
import { loadGame, saveGame } from '../persistence/saveGame';
import type { DomainMutationContext } from '../state/domainMutation';
import { makeAppSave, makeEntity, makePrivateScene } from './factories';

type Props = { state: GameDomainState; dispatch: (action: GameAction) => void };
const useKernel = ({ state, dispatch }: Props) => useCampaignTransactions(state, dispatch);

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => localStorage.clear());

describe('runDomainMutation — the shared mutex', () => {
    it('refuses a second mutation while one holds the lease, then releases it', async () => {
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch: vi.fn() });
        const gate = deferred<string>();
        let first!: Promise<unknown>;
        act(() => { first = hook.current.runDomainMutation(() => gate.promise); });
        expect(hook.current.domainMutationInFlight).toBe(true);
        await expect(hook.current.runDomainMutation(() => 'second')).resolves.toEqual({ acquired: false });
        await act(async () => { gate.resolve('first'); await first; });
        await expect(first).resolves.toEqual({ acquired: true, value: 'first' });
        expect(hook.current.domainMutationInFlight).toBe(false);
        let third: unknown;
        await act(async () => { third = await hook.current.runDomainMutation(() => 'third'); });
        expect(third).toEqual({ acquired: true, value: 'third' });
        hook.unmount();
    });

    it('releases the lease even when the work throws', async () => {
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch: vi.fn() });
        await act(async () => {
            await expect(hook.current.runDomainMutation(() => { throw new Error('boom'); })).rejects.toThrow('boom');
        });
        expect(hook.current.domainMutationInFlight).toBe(false);
        let after: unknown;
        await act(async () => { after = await hook.current.runDomainMutation(() => 1); });
        expect(after).toEqual({ acquired: true, value: 1 });
        hook.unmount();
    });

    it('an open private scene refuses ordinary mutations but admits scene work', async () => {
        const state = { ...createInitialGameState(), privateScenes: [makePrivateScene({ status: 'active' })] };
        const hook = renderHook(useKernel, { state, dispatch: vi.fn() });
        expect(hook.current.privateSceneInteractionLocked).toBe(true);
        expect(hook.current.privateSceneLockRef.current).toBe(true);
        await expect(hook.current.runDomainMutation(() => 'turn')).resolves.toEqual({ acquired: false });
        let scene: unknown;
        await act(async () => {
            scene = await hook.current.runDomainMutation(() => 'scene', { allowDuringPrivateScene: true });
        });
        expect(scene).toEqual({ acquired: true, value: 'scene' });
        hook.unmount();
    });

    it('a lease stops being current once App unmounts', async () => {
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch: vi.fn() });
        const gate = deferred<void>();
        let context!: DomainMutationContext;
        act(() => {
            void hook.current.runDomainMutation(async ctx => { context = ctx; await gate.promise; });
        });
        expect(context.isCurrent()).toBe(true);
        const generation = hook.current.campaignGenerationRef.current;
        hook.unmount();
        expect(context.isCurrent()).toBe(false);
        // Unmount also invalidates any in-flight D8 ambition tail.
        expect(hook.current.campaignGenerationRef.current).toBe(generation + 1);
        gate.resolve();
    });
});

describe('commitDomainMutation — save, then dispatch (Task 7)', () => {
    it('writes durably, then runs beforeDispatch, dispatch, onCommitted in that order', () => {
        const order: string[] = [];
        const dispatch = vi.fn(() => order.push('dispatch'));
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch });
        const candidate = makeAppSave({ turnNumber: 5 });
        const ok = hook.current.commitDomainMutation({
            candidate,
            action: { type: 'GM_INTERVENTION_SET', text: 'x' },
            onSaveFailure: () => order.push('failure'),
            beforeDispatch: () => {
                // The bytes already exist when this runs.
                expect(loadGame()?.state.turnNumber).toBe(5);
                order.push('before');
            },
            onCommitted: () => order.push('committed'),
        });
        expect(ok).toBe(true);
        expect(order).toEqual(['before', 'dispatch', 'committed']);
        hook.unmount();
    });

    it('a write that will not land never reaches the reducer', () => {
        const dispatch = vi.fn();
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        const onSaveFailure = vi.fn();
        const beforeDispatch = vi.fn();
        try {
            expect(hook.current.commitDomainMutation({
                candidate: makeAppSave(),
                action: { type: 'GM_INTERVENTION_SET', text: 'x' },
                onSaveFailure,
                beforeDispatch,
            })).toBe(false);
        } finally {
            setItem.mockRestore();
        }
        expect(onSaveFailure).toHaveBeenCalledTimes(1);
        expect(beforeDispatch).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
        hook.unmount();
    });
});

describe('buildSaveState — D8 ambition carry-forward', () => {
    it('keeps a newer stored ambition from the same campaign over a stale in-memory one', () => {
        const save = makeAppSave({
            turnNumber: 6,
            inferredAmbition: { apparent_ambition: 'Stored, newer.', confidence: 'high', asOfTurn: 6 },
        });
        expect(saveGame(save).ok).toBe(true);
        const state: GameDomainState = {
            ...createInitialGameState(),
            ...save,
            inferredAmbition: { apparent_ambition: 'In memory, older.', confidence: 'low', asOfTurn: 3 },
        };
        const hook = renderHook(useKernel, { state, dispatch: vi.fn() });
        expect(hook.current.buildSaveState().inferredAmbition?.apparent_ambition).toBe('Stored, newer.');
        hook.unmount();
    });

    it('never carries an ambition across into a different campaign', () => {
        expect(saveGame(makeAppSave({
            playerCharacterId: 'someone_else',
            inferredAmbition: { apparent_ambition: 'OLD CAMPAIGN', confidence: 'high', asOfTurn: 9 },
        })).ok).toBe(true);
        const state: GameDomainState = { ...createInitialGameState(), ...makeAppSave() };
        const hook = renderHook(useKernel, { state, dispatch: vi.fn() });
        expect(hook.current.buildSaveState().inferredAmbition).toBeNull();
        // beginCampaignSession forgets the live ambition too.
        act(() => hook.current.beginCampaignSession());
        expect(hook.current.latestInferredAmbitionRef.current).toBeNull();
        hook.unmount();
    });

    it('applies overrides over the reducer state', () => {
        const hook = renderHook(useKernel, { state: createInitialGameState(), dispatch: vi.fn() });
        expect(hook.current.buildSaveState({ turnNumber: 42 }).turnNumber).toBe(42);
        hook.unmount();
    });
});

describe('isPrivateSceneInteractionLocked', () => {
    it('locks for an active scene or one awaiting its last word, never for a closed one', () => {
        expect(isPrivateSceneInteractionLocked([])).toBe(false);
        expect(isPrivateSceneInteractionLocked([makePrivateScene({ status: 'closed' })])).toBe(false);
        expect(isPrivateSceneInteractionLocked([makePrivateScene({ status: 'active' })])).toBe(true);
        expect(isPrivateSceneInteractionLocked([makePrivateScene({ status: 'awaiting_last_word' })])).toBe(true);
    });
});

describe('buildPrivateScenePrompt', () => {
    const player = makeEntity({ entity_id: 'severus_alexander', name: 'Severus Alexander', position: 'Emperor' });
    const many = (prefix: string) => Array.from({ length: 12 }, (_, i) => `${prefix} ${i}`);
    const npc = makeEntity({
        entity_id: 'maximinus_thrax',
        name: 'Maximinus Thrax',
        short_term_goals: many('goal'),
        beliefs: many('belief'),
        secrets: many('secret'),
        memories: many('memory').map((event_description, turn) => ({ turn, event_description, emotional_impact: 'none', involved_entities: [] })),
    });

    it('is an invitation on exchange 1 and an exchange after', () => {
        expect(buildPrivateScenePrompt(player, npc, [], 1).phase).toBe('invitation');
        expect(buildPrivateScenePrompt(player, npc, [], 2).phase).toBe('exchange');
    });

    it("bounds the NPC's mind: first eight goals/beliefs/secrets, LAST eight memories", () => {
        const prompt = buildPrivateScenePrompt(player, npc, [], 1);
        expect(prompt.npc.goals).toEqual(many('goal').slice(0, 8));
        expect(prompt.npc.beliefs).toEqual(many('belief').slice(0, 8));
        expect(prompt.npc.ownSecrets).toEqual(many('secret').slice(0, 8));
        expect(prompt.npc.memories).toEqual(many('memory').slice(-8));
        expect(prompt.npc.relationshipToPlayer).toBeUndefined();
    });

    it("carries only the player's public face and the bare transcript lines", () => {
        const prompt = buildPrivateScenePrompt(player, npc, [
            { sequence: 1, speaker: 'player', text: 'Speak plainly.' },
        ], 1);
        expect(prompt.player).toEqual({ entityId: 'severus_alexander', displayName: 'Severus Alexander', position: 'Emperor' });
        expect(prompt.transcript).toEqual([{ speaker: 'player', text: 'Speak plainly.' }]);
    });
});
