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
import { lastGmNarrationOf, tabChangeCountsFor } from '../hooks/usePlayerPerception';
import { useOnboarding } from '../hooks/useOnboarding';
import { hasSeenOnboarding } from '../persistence/onboarding';
import { GameState, type KnownRecipientOption, type Report, type StructuredTurnDraft, type TurnSubmission } from '../types';
import { emptyStructuredDraft } from '../playerInput/composerState';
import { computeTurnKnowledge, narrationSignsSeen } from '../knowledge/commit';
import { ingestSignsSeen } from '../knowledge/store';
import { makeEntity, makeKnowledgeClaim, makePerceivedChange, makeTurnHistoryEntry } from './factories';

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

// The tabs that pulse are the tabs with an unseen count (hooks/useSeenRegisters.ts's
// unseenTabs), so these counts are also what pulses.
describe('tabChangeCountsFor', () => {
    const lastTurn = makeTurnHistoryEntry({ turnNumber: 5 });
    const observation = { evidenceId: 'e1', participantIds: ['a', 'b'] };

    it('counts each perceived change once per tab it names', () => {
        const counts = tabChangeCountsFor([
            makePerceivedChange({ tabs: ['reports'] }),
            makePerceivedChange({ tabs: ['reports', 'world_state'] }),
            makePerceivedChange({ tabs: ['resources', 'resources'] }),
        ], [], lastTurn);
        expect(Object.fromEntries(counts)).toEqual({ reports: 2, world_state: 1, resources: 1 });
    });

    it('counts relationship observations on Dramatis Personae only when first learned on the last turn, and no other line', () => {
        const counts = tabChangeCountsFor([makePerceivedChange({ tabs: ['dramatis_personae'] })], [
            makeKnowledgeClaim({ firstLearnedTurn: 5, relationshipObservation: observation }),
            makeKnowledgeClaim({ firstLearnedTurn: 5, relationshipObservation: { ...observation, evidenceId: 'e2' } }),
            makeKnowledgeClaim({ firstLearnedTurn: 4, relationshipObservation: observation }),
            makeKnowledgeClaim({ firstLearnedTurn: 5 }),
        ], lastTurn);
        expect(counts.get('dramatis_personae')).toBe(2);
        expect(tabChangeCountsFor([], [makeKnowledgeClaim({ firstLearnedTurn: 5, relationshipObservation: observation })], null).size).toBe(0);
    });

    it('counts the player\'s own treasury notices on Reports, one per notice the week brought, and never a rumor twice', () => {
        const player = makeEntity({ entity_id: 'player_1', name: 'Gaius Testus' });
        const notice = (id: string, turn: number, claim: string): Report => ({
            id, turn, source: 'merchant', about: player.entity_id, claim, credibility: 1,
        });
        const rumor: Report = { id: 'r_rumor', turn: 5, source: 'rumor', about: 'npc_thrax', claim: 'Thrax is said to be ill.', credibility: 0.5, topic: 'health' };
        // An older notice, then this week's: the same claim restated, plus a rumor.
        const before = computeTurnKnowledge({
            prev: [], perceivedChanges: [], reportsBefore: [],
            reportsAfter: [notice('r_low_3', 3, 'Your treasury has fallen low.')], turnNumber: 3,
        });
        const reportsBefore = [notice('r_low_3', 3, 'Your treasury has fallen low.')];
        const knowledge = computeTurnKnowledge({
            prev: before, perceivedChanges: [], reportsBefore,
            reportsAfter: [...reportsBefore, notice('r_debt_5', 5, 'Your coffers run dry.'), notice('r_low_5', 5, 'Your treasury has fallen low.'), rumor],
            turnNumber: 5,
        });
        // The rumor reaches Reports through the digest's own line; the merchant notices never do.
        const rumorLine = makePerceivedChange({ deltaType: 'rumor', tabs: ['reports'] });

        expect(tabChangeCountsFor([rumorLine], knowledge, lastTurn).get('reports')).toBe(3);
        expect(tabChangeCountsFor([], knowledge, lastTurn).get('reports')).toBe(2);
        // A week that brought no notice leaves the older one uncounted.
        expect(tabChangeCountsFor([], before, lastTurn).has('reports')).toBe(false);
        expect(tabChangeCountsFor([], knowledge, null).size).toBe(0);
    });

    // D48/D49: a mark or tie the week let the player see on another figure.
    const markSeen = (subject: string, id: string, gone = false) => makePerceivedChange({
        deltaType: 'condition', subject, deltaKey: `${subject}:${id}`, text: `A mark on ${subject}.`,
        tabs: subject === 'severus_alexander' ? [] : ['dramatis_personae'],
        perceivedCondition: { id, name: id, description: '', severity: 'light', outward: true, gone },
    });
    const tieSeen = (subject: string, id: string, member = true) => makePerceivedChange({
        deltaType: 'affiliation', subject, deltaKey: `${subject}:${id}`, text: `A tie of ${subject}.`, tabs: ['dramatis_personae'],
        perceivedAffiliation: { id, name: id, kind: 'cult', public: false, member },
    });

    it('counts each mark and tie newly seen on another figure once, and only what the card now shows (D48/D49)', () => {
        const counts = tabChangeCountsFor([
            markSeen('maximinus_thrax', 'scarred_face'), markSeen('maximinus_thrax', 'scarred_face'), // one mark, two lines
            markSeen('julia_mamaea', 'burned_hand'), markSeen('julia_mamaea', 'burned_hand', true), // seen, then seen healed
            tieSeen('julia_mamaea', 'circle_of_origen'),
            tieSeen('maximinus_thrax', 'mithras', false), // seen given up
            markSeen('severus_alexander', 'limp'), // the player's own: their status panel, not Personae
            makePerceivedChange({ deltaType: 'status', subject: 'maximinus_thrax', tabs: ['dramatis_personae'] }), // still not a Personae count
        ], [], lastTurn);
        expect(counts.get('dramatis_personae')).toBe(2);
        expect(tabChangeCountsFor([tieSeen('julia_mamaea', 'circle_of_origen')], [], null).get('dramatis_personae')).toBe(1);
    });

    it('does not point Personae at a mark on a figure the player now believes gone', () => {
        const seenDead = makeKnowledgeClaim({
            claimKey: 'digest:status:maximinus_thrax', subject: 'maximinus_thrax', firstLearnedTurn: 5,
            updates: [{ turn: 5, source: 'witnessed', text: 'Maximinus Thrax falls.', status: 'dead' }],
        });
        expect(tabChangeCountsFor([markSeen('maximinus_thrax', 'scarred_face')], [seenDead], lastTurn).has('dramatis_personae')).toBe(false);
        expect(tabChangeCountsFor([markSeen('julia_mamaea', 'burned_hand')], [seenDead], lastTurn).get('dramatis_personae')).toBe(1);
    });

    it('counts a sign caught in a private scene as the scene commits it, and never again when the week lands (D50)', () => {
        const sign = { entityId: 'julia_mamaea', sign: 'Her hand went to her throat.' };
        // The interlude after week 5: the scene's sign is stamped with the week in hand, 6.
        const afterScene = ingestSignsSeen([], [sign], 6);
        expect(tabChangeCountsFor([], afterScene, lastTurn).get('dramatis_personae')).toBe(1);
        // Week 6 lands with nothing on Personae of its own: the scene's sign was read already.
        expect(tabChangeCountsFor([], afterScene, makeTurnHistoryEntry({ turnNumber: 6 })).has('dramatis_personae')).toBe(false);
        // Week 6's narration lets the player catch a sign too: that one alone counts.
        const narrated = makeTurnHistoryEntry({ turnNumber: 6, composureSigns: [{ entityId: 'julia_mamaea', subject: 'mark:grief', sign: 'Her voice caught.' }] });
        const landed = ingestSignsSeen(afterScene, narrationSignsSeen(narrated), 6);
        expect(tabChangeCountsFor([], landed, narrated).get('dramatis_personae')).toBe(1);
        // A scene before the first week counts as well.
        expect(tabChangeCountsFor([], ingestSignsSeen([], [sign], 1), null).get('dramatis_personae')).toBe(1);
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
