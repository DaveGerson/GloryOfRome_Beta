/**
 * hooks/useShellEffects.ts
 *
 * The composition root's stateless window-level effects, moved verbatim out
 * of App.tsx (2026-09-23). None of them owns state; each is a named hook so
 * App reads as a list of what the shell does rather than anonymous effect
 * bodies. (The third, `useScrollToLatest`, grew state - whether the reader
 * is at the foot of the log - and became hooks/useChatFollow.ts.)
 */

import { useCallback, useEffect, useState } from 'react';
import { GameState } from '../types';
import { runSmokeTest } from '../tests/smokeTest';
import { subscribeToForeignSaveWrites, type ForeignSaveWrite } from '../persistence/crossTab';

/**
 * Run a "smoke test" on startup to validate that all mock functions are
 * working as expected after any system changes. Dev-only scaffolding: never
 * runs (and never alerts) in a production build — players should never see
 * a blocking alert() on load. (`import.meta.env.DEV` inlines to `false` in
 * a build, so the bundler drops runSmokeTest entirely.)
 */
export function useDevSmokeTest(): void {
    useEffect(() => {
        if (!import.meta.env.DEV) return;

        const performSmokeTest = async () => {
            try {
                await runSmokeTest();
            } catch (error) {
                // Display the error prominently to the developer.
                console.error(error);
                alert((error as Error).message);
            }
        };

        // This test runs on every startup (in dev only) to ensure build validity.
        performSmokeTest();
    }, []); // Empty dependency array ensures this runs only once on mount.
}

/**
 * Now that every turn/event-choice/resource-spend autosaves, the only
 * window with genuinely unsaved changes is while a turn is in flight
 * (PROCESSING) - the pre-turn snapshot was already saved, but this turn's
 * outcome hasn't committed yet. A committed-and-saved state doesn't need
 * the scare dialog.
 *
 * A fate awaiting its choice (AWAITING_EVENT_CHOICE) is guarded only when
 * it failed to reach disk (`openFateUnsaved`, hooks/useEventFlow.ts). It is
 * written into the save when it fires (persistence/saveGame.ts's
 * updateSavedPendingEvent) and a reload reopens it, so normally nothing is
 * at risk - and a prompt with nothing at risk teaches players to dismiss
 * it. When that best-effort write did not land, the fate's dialog has no
 * close control by design, so leaving must not be a quiet way out of it.
 */
export function useUnloadGuardWhileProcessing(gameState: GameState, openFateUnsaved: boolean, unsavedChanges = false): void {
    const guarded = gameState === GameState.PROCESSING
        || (gameState === GameState.AWAITING_EVENT_CHOICE && openFateUnsaved)
        || unsavedChanges;
    useEffect(() => {
        if (!guarded) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [guarded]);
}

/**
 * Watches the browser's `storage` event for writes or clears from another tab
 * sharing the same profile. Exposes the latest conflict together with explicit
 * user choices: reload to adopt the newer save, or dismiss and keep this tab.
 */
export function useCrossTabConflict(active: boolean) {
    const [rawConflict, setRawConflict] = useState<ForeignSaveWrite | null>(null);
    const [prevActive, setPrevActive] = useState(active);
    if (prevActive !== active) {
        setPrevActive(active);
        if (!active && rawConflict !== null) {
            setRawConflict(null);
        }
    }
    useEffect(() => {
        if (!active) return;
        return subscribeToForeignSaveWrites(write => setRawConflict(write));
    }, [active]);
    const conflict = active ? rawConflict : null;
    const dismissConflict = useCallback(() => setRawConflict(null), []);
    const reloadFromOtherTab = useCallback(() => {
        if (typeof window !== 'undefined') window.location.reload();
    }, []);
    return { conflict, dismissConflict, reloadFromOtherTab };
}
