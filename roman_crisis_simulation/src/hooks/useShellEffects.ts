/**
 * hooks/useShellEffects.ts
 *
 * The composition root's three stateless window-level effects, moved
 * verbatim out of App.tsx (2026-09-23). None of them owns state; each is a
 * named hook so App reads as a list of what the shell does rather than
 * three anonymous effect bodies.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { GameState } from '../types';
import { runSmokeTest } from '../tests/smokeTest';

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
 */
export function useUnloadGuardWhileProcessing(gameState: GameState): void {
    useEffect(() => {
        if (gameState !== GameState.PROCESSING) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [gameState]);
}

/**
 * Keeps the chat log pinned to its newest line: returns the ref for the
 * sentinel div at the log's foot, scrolled into view whenever the messages
 * or the game phase change.
 */
export function useScrollToLatest(messages: unknown, gameState: GameState): RefObject<HTMLDivElement | null> {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, gameState]);
    return messagesEndRef;
}
