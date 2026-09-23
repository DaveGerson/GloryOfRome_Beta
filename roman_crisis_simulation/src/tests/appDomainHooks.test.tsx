/**
 * @vitest-environment jsdom
 *
 * tests/appDomainHooks.test.tsx — the player-facing hooks extracted from
 * App.tsx: the perception derivations (hooks/usePlayerPerception.ts), the
 * onboarding flag (hooks/useOnboarding.ts), and the composer's submit gate
 * (hooks/useTurnFlow.ts). The turn transaction itself stays proved by the
 * App-level suites; here executeTurn is a spy, so what is pinned is exactly
 * what useTurnFlow decides before it hands a submission over.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHook } from './renderHook';
import { lastGmNarrationOf, pulsingTabsFor } from '../hooks/usePlayerPerception';
import { useOnboarding } from '../hooks/useOnboarding';
import { hasSeenOnboarding } from '../persistence/onboarding';
import { GameState, type KnownRecipientOption, type StructuredTurnDraft, type TurnSubmission } from '../types';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { makeKnowledgeClaim, makePerceivedChange, makeTurnHistoryEntry } from './factories';

const executeTurn = vi.fn<(submission: TurnSubmission, draft: string | StructuredTurnDraft) => Promise<boolean>>(
    async () => true,
);
vi.mock('../hooks/useExecuteTurn', () => ({ useExecuteTurn: () => executeTurn }));

// Imported after the mock so useTurnFlow binds the spy.
const { useTurnFlow } = await import('../hooks/useTurnFlow');
type TurnFlowDeps = Parameters<typeof useTurnFlow>[0];

beforeEach(() => {
    localStorage.clear();
    executeTurn.mockClear();
});

describe('lastGmNarrationOf', () => {
    it("is the newest 'gm' line, skipping the player's own", () => {
        expect(lastGmNarrationOf([])).toBe('');
        expect(lastGmNarrationOf([
            { sender: 'gm', text: 'First.' },
            { sender: 'gm', text: 'The blade falls.' },
            { sender: 'player', text: 'I flee.' },
        ])).toBe('The blade falls.');
    });
});

describe('pulsingTabsFor', () => {
    const lastTurn = makeTurnHistoryEntry({ turnNumber: 5 });

    it('pulses exactly the tabs the perceived changes name', () => {
        const tabs = pulsingTabsFor([
            makePerceivedChange({ tabs: ['resources'] }),
            makePerceivedChange({ tabs: ['reports', 'world_state'] }),
        ], [], lastTurn);
        expect([...tabs].sort()).toEqual(['reports', 'resources', 'world_state']);
    });

    it('never pulses Dramatis Personae from a perceived change alone', () => {
        const tabs = pulsingTabsFor([makePerceivedChange({ tabs: ['dramatis_personae'] })], [], lastTurn);
        expect(tabs.has('dramatis_personae')).toBe(false);
    });

    it('pulses Dramatis Personae for a relationship observation learned on the last turn only', () => {
        const observation = { evidenceId: 'e1', participantIds: ['a', 'b'] };
        const fresh = makeKnowledgeClaim({ firstLearnedTurn: 5, relationshipObservation: observation });
        const stale = makeKnowledgeClaim({ firstLearnedTurn: 4, relationshipObservation: observation });
        const plain = makeKnowledgeClaim({ firstLearnedTurn: 5 });
        expect(pulsingTabsFor([], [fresh], lastTurn).has('dramatis_personae')).toBe(true);
        expect(pulsingTabsFor([], [stale, plain], lastTurn).has('dramatis_personae')).toBe(false);
        expect(pulsingTabsFor([], [fresh], null).size).toBe(0);
    });
});

describe('useOnboarding', () => {
    it('offers the overlay once on a device that has not seen it, and closing marks it seen', () => {
        const hook = renderHook(useOnboarding, undefined);
        expect(hook.current.showOnboarding).toBe(false);
        act(() => hook.current.offerOnboarding());
        expect(hook.current.showOnboarding).toBe(true);
        act(() => hook.current.handleCloseOnboarding());
        expect(hook.current.showOnboarding).toBe(false);
        expect(hasSeenOnboarding()).toBe(true);
        act(() => hook.current.offerOnboarding());
        expect(hook.current.showOnboarding).toBe(false);
        hook.unmount();
    });
});

describe('useTurnFlow — the submit gate', () => {
    const recipients: KnownRecipientOption[] = [{ entityId: 'maximinus_thrax', displayName: 'Maximinus Thrax' }];
    // Only the gate's own inputs matter: executeTurn is the spy above, so
    // the pass-through deps are never read.
    const deps = (overrides: Partial<TurnFlowDeps> = {}): TurnFlowDeps => ({
        gameState: GameState.AWAITING_PLAYER_INPUT,
        privateSceneInteractionLocked: false,
        recipientOptions: recipients,
        ...overrides,
    } as TurnFlowDeps);

    it('wraps free text as a v1 freeform submission, frozen, with the draft to restore', () => {
        const hook = renderHook(useTurnFlow, deps());
        act(() => hook.current.handleComposerSubmit('Summon the Senate.'));
        expect(executeTurn).toHaveBeenCalledTimes(1);
        const [submission, draft] = executeTurn.mock.calls[0];
        expect(submission).toMatchObject({ version: 1, kind: 'freeform', text: 'Summon the Senate.' });
        expect(Object.isFrozen(submission)).toBe(true);
        expect(draft).toBe('Summon the Senate.');
        hook.unmount();
    });

    it('holds the send outside AWAITING_PLAYER_INPUT and while a private scene holds the table', () => {
        const processing = renderHook(useTurnFlow, deps({ gameState: GameState.PROCESSING }));
        act(() => processing.current.handleComposerSubmit('Too soon.'));
        processing.unmount();
        const locked = renderHook(useTurnFlow, deps({ privateSceneInteractionLocked: true }));
        act(() => locked.current.handleComposerSubmit('Not now.'));
        locked.unmount();
        expect(executeTurn).not.toHaveBeenCalled();
    });

    it('drops a draft that does not validate (an empty structured tablet)', () => {
        const hook = renderHook(useTurnFlow, deps());
        act(() => hook.current.handleComposerSubmit(emptyStructuredDraft()));
        expect(executeTurn).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('starts with empty drafts, no failure, and nothing to retry', () => {
        const hook = renderHook(useTurnFlow, deps());
        expect(hook.current.chatDraft).toBe('');
        expect(hook.current.structuredDraft).toEqual(emptyStructuredDraft());
        expect(hook.current.turnFailure).toBeNull();
        expect(hook.current.canRetry).toBe(false);
        act(() => hook.current.retryLastTurn());
        expect(executeTurn).not.toHaveBeenCalled();
        hook.unmount();
    });
});
