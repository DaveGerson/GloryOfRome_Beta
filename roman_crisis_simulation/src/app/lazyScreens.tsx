/**
 * app/lazyScreens.tsx
 *
 * The four screens most sessions never open - or open once - split out of
 * the main chunk (bundle-triage.md's lazy-load follow-up to Task 4b):
 *
 *   GameMasterScreen  - D7: hidden by default, and it drags in every
 *                       components/gm/* view plus the eval-corpus export
 *   EpilogueScreen    - D1: only death ends a run
 *   SettingsMenu      - D31: opened on demand
 *   OnboardingOverlay - once per device, ever
 *
 * Each is a React.lazy boundary with a `preload()`; App preloads all four
 * once it has mounted (preloadLazyScreens), so by the time a player can
 * click anything the module is almost always already in hand. A screen
 * whose module has loaded renders the REAL component on its very first
 * frame - no Suspense round-trip, no fallback flash - and only a screen
 * opened before its module arrives goes through the lazy path. Which of
 * the two a mounted instance uses is fixed for that instance's lifetime,
 * so a preload that lands mid-session can never swap the element type
 * under an open screen and remount it (losing, say, the GM screen's tab).
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { ComponentType } from 'react';

export interface PreloadableScreen<P extends object> {
    (props: P): React.ReactElement;
    preload: () => Promise<unknown>;
}

export function lazyScreen<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): PreloadableScreen<P> {
    let loaded: ComponentType<P> | null = null;
    let pending: Promise<{ default: ComponentType<P> }> | null = null;
    const preload = () => {
        pending ??= load().then(
            module => {
                loaded = module.default;
                return module;
            },
            error => {
                // Forget the failure so the next attempt (the lazy path
                // on open) re-requests the module instead of replaying it.
                pending = null;
                throw error;
            },
        );
        return pending;
    };
    const Lazy = lazy(preload);
    const Screen = (props: P) => {
        // Chosen once per mount - see the file header.
        const [Resolved] = useState<ComponentType<P> | null>(() => loaded);
        if (Resolved) return <Resolved {...props} />;
        return (
            <Suspense fallback={null}>
                <Lazy {...props} />
            </Suspense>
        );
    };
    return Object.assign(Screen, { preload });
}

export const GameMasterScreen = lazyScreen(() => import('../components/GameMasterScreen'));
export const EpilogueScreen = lazyScreen(() => import('../components/EpilogueScreen'));
export const SettingsMenu = lazyScreen(() => import('../components/SettingsMenu'));
export const OnboardingOverlay = lazyScreen(() => import('../components/OnboardingOverlay'));

const LAZY_SCREENS = [GameMasterScreen, EpilogueScreen, SettingsMenu, OnboardingOverlay];

/**
 * Resolves once every lazy screen's module is in hand (idempotent: each
 * module is requested at most once). The App-level test suites await this
 * right after mounting App - the same warm-up App performs itself - so a
 * click that opens a screen renders it synchronously, as before the split.
 */
export function whenLazyScreensReady(): Promise<void> {
    return Promise.all(LAZY_SCREENS.map(screen => screen.preload())).then(() => undefined);
}

/**
 * Warm every lazy screen. A failed preload is swallowed here - the lazy
 * path simply retries the import when the screen is actually opened, and
 * an error there reaches the ErrorBoundary like any other render failure.
 */
export function preloadLazyScreens(): void {
    for (const screen of LAZY_SCREENS) {
        screen.preload().catch(() => { /* retried on open */ });
    }
}

/**
 * App's mount-time warm-up. Runs once, right after the first commit, so
 * the requests never compete with the main chunk's own parse and the
 * first paint.
 */
export function usePreloadLazyScreens(): void {
    useEffect(() => { preloadLazyScreens(); }, []);
}
