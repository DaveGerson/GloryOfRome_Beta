/**
 * hooks/useCampaignTransactions.ts
 *
 * The transaction kernel every durable handler in the app runs on, moved
 * verbatim out of App.tsx (2026-09-23):
 *
 *   - runDomainMutation: the shared synchronous mutex (a lease) that keeps
 *     two game-domain mutations - a turn, an investigation, an event choice,
 *     a scene exchange - from ever interleaving;
 *   - commitDomainMutation: save-then-dispatch (Task 7) - the durable bytes
 *     exist before the reducer ever moves;
 *   - buildSaveState: the full persistable bundle, with D8's newest-ambition
 *     carry-forward;
 *   - beginCampaignSession: the campaign boundary (generation bump,
 *     ambition reset, session call-log reset).
 *
 * It also owns the refs those four share with executeTurn and the
 * private-scene controller. The refs cross hook boundaries as plain values;
 * every one is a stable useRef object for the life of the App mount.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { GameAction, GameDomainState } from '../state/gameReducer';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import { saveGame, loadGame } from '../persistence/saveGame';
import type { SaveGameState, InferredAmbitionState } from '../persistence/saveGame';
import type { PrivateSceneRecord } from '../privateScene/model';
import { resetSessionCallLog } from '../ai/core/geminiService';
import {
    type DomainCommit,
    isPrivateSceneInteractionLocked,
    isSameCampaignPrefix,
    newestInferredAmbition,
    pickSaveState,
} from '../app/transactions';

export function useCampaignTransactions(state: GameDomainState, dispatch: Dispatch<GameAction>) {
    const { inferredAmbition } = state;
    const [domainMutationInFlight, setDomainMutationInFlight] = useState(false);

    // Snapshot of the committed game state taken right before a turn's AI
    // calls kick off, so a mid-turn failure can be rolled back to explicitly
    // rather than relying on "we just never committed" (P0.2/P0.4 - a
    // future refactor of the commit logic shouldn't silently break this).
    const preTurnSnapshotRef = useRef<SaveGameState | null>(null);
    const domainMutationLeaseRef = useRef<symbol | null>(null);
    const privateSceneLockRef = useRef(false);
    const privateScenesRef = useRef<PrivateSceneRecord[]>(state.privateScenes);
    const appMountedRef = useRef(true);
    const campaignGenerationRef = useRef(0);
    const latestInferredAmbitionRef = useRef<InferredAmbitionState | null>(inferredAmbition);

    useEffect(() => {
        appMountedRef.current = true;
        return () => {
            appMountedRef.current = false;
            campaignGenerationRef.current += 1;
            domainMutationLeaseRef.current = null;
        };
    }, []);

    useEffect(() => {
        latestInferredAmbitionRef.current = newestInferredAmbition(
            latestInferredAmbitionRef.current,
            inferredAmbition,
        );
    }, [inferredAmbition]);

    // While a private scene is open (or awaiting its last word) every
    // ordinary mutation is refused - see runDomainMutation's
    // allowDuringPrivateScene. A layout effect runs after React commits the
    // matching controls but before the browser can dispatch another user
    // event. Successful scene commits (hooks/usePrivateSceneController.ts's
    // commitPrivateScene) also set these refs synchronously before dispatch,
    // closing the transaction-to-render interval without mutating a ref
    // during render.
    const privateSceneInteractionLocked = isPrivateSceneInteractionLocked(state.privateScenes);
    useLayoutEffect(() => {
        privateSceneLockRef.current = privateSceneInteractionLocked;
        privateScenesRef.current = state.privateScenes;
    }, [privateSceneInteractionLocked, state.privateScenes]);

    const runDomainMutation = useCallback<RunDomainMutation>(async <T,>(work: (context: DomainMutationContext) => T | Promise<T>, options: { allowDuringPrivateScene?: boolean } = {}) => {
        if (domainMutationLeaseRef.current || (privateSceneLockRef.current && !options.allowDuringPrivateScene)) {
            return { acquired: false };
        }
        const lease = Symbol('domain-mutation');
        domainMutationLeaseRef.current = lease;
        if (appMountedRef.current) setDomainMutationInFlight(true);
        const context: DomainMutationContext = {
            isCurrent: () => appMountedRef.current && domainMutationLeaseRef.current === lease,
        };
        try {
            return { acquired: true, value: await work(context) };
        } finally {
            if (domainMutationLeaseRef.current === lease) {
                domainMutationLeaseRef.current = null;
                if (appMountedRef.current) setDomainMutationInFlight(false);
            }
        }
    }, []);

    const beginCampaignSession = useCallback(() => {
        campaignGenerationRef.current += 1;
        latestInferredAmbitionRef.current = null;
        resetSessionCallLog();
    }, []);

    // Builds the full persistable game-state bundle from current state,
    // optionally overriding fields with just-computed values (a dispatch
    // doesn't change this render's state object, so a caller that just
    // committed new values must pass them explicitly rather than reading
    // the stale closure). See persistence/saveGame.ts for exactly which
    // game state this does (and doesn't) include, and why.
    const buildSaveState = useCallback((overrides: Partial<SaveGameState> = {}): SaveGameState => {
        const candidate: SaveGameState = { ...pickSaveState(state), ...overrides };
        const stored = loadGame()?.state;
        const storedAmbition = stored && isSameCampaignPrefix(candidate, stored)
            ? stored.inferredAmbition
            : null;
        candidate.inferredAmbition = newestInferredAmbition(
            storedAmbition,
            candidate.inferredAmbition,
            latestInferredAmbitionRef.current,
        );
        latestInferredAmbitionRef.current = candidate.inferredAmbition ?? null;
        return candidate;
    }, [state]);

    const commitDomainMutation = useCallback(({ candidate, action, onSaveFailure, beforeDispatch, onCommitted }: DomainCommit): boolean => {
        if (!saveGame(candidate).ok) { onSaveFailure(); return false; }
        beforeDispatch?.();
        dispatch(action);
        onCommitted?.();
        return true;
    }, [dispatch]);

    return {
        domainMutationInFlight,
        privateSceneInteractionLocked,
        runDomainMutation,
        commitDomainMutation,
        buildSaveState,
        beginCampaignSession,
        preTurnSnapshotRef,
        privateSceneLockRef,
        privateScenesRef,
        appMountedRef,
        campaignGenerationRef,
        latestInferredAmbitionRef,
    };
}
