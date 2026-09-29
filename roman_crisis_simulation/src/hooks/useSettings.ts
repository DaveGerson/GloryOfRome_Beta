/**
 * hooks/useSettings.ts
 *
 * The configuration menu's device-level state (D31): its open flag, the
 * bring-your-own-key and the AI client built from it (D34), the Fates
 * pacing posture (D23), the LVX/NOX lighting, and Mock Mode. Moved verbatim
 * out of App.tsx (2026-09-23). Every value here is presentation or device
 * preference - none of it is ever part of the save bundle (D17).
 *
 * The GM console's availability switches live beside it in
 * hooks/useGmConsole.ts: they share the menu, not the concern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { PacingPosture } from '../types';
import { getPacingPosture, setPacingPosture } from '../persistence/settings';
import { getApiKey, setApiKey, clearApiKey, resolveApiKey } from '../persistence/apiKey';
import nocturneUrl from '../design/nocturne.css?url';
import { readDevApiKey } from '../app/transactions';

export type Lighting = 'nox' | 'lux';

/** The lighting this device explicitly chose, or null when it never chose. */
export function storedLighting(): Lighting | null {
    try {
        const stored = localStorage.getItem('gor-theme');
        return stored === 'nox' || stored === 'lux' ? stored : null;
    } catch {
        return null;
    }
}

/** True when the system asks for a light appearance; false when dark or unknown. */
export function systemPrefersLight(): boolean {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch {
        return false;
    }
}

/**
 * The lighting to show: an explicit choice always wins; otherwise the
 * system's appearance - light for a light system, NOX (the house lighting)
 * for a dark one or one that does not say.
 */
export function resolveLighting(stored: Lighting | null, systemLight: boolean): Lighting {
    if (stored) return stored;
    return systemLight ? 'lux' : 'nox';
}

export function useSettings() {
    // D31 - the configuration menu's own open/closed flag. Purely transient
    // UI state, never part of the save bundle.
    const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
    const openSettings = useCallback(() => setIsSettingsMenuOpen(true), []);
    const closeSettings = useCallback(() => setIsSettingsMenuOpen(false), []);
    const [isMockMode, setIsMockMode] = useState(false);

    // LVX/NOX lighting. Nox Romae (design/nocturne.css) is an override
    // stylesheet loaded after styles.css; toggling swaps the whole client
    // between marble day and the torchlit night skin. Presentation-only -
    // never part of the save. Two inputs, one answer (resolveLighting): the
    // player's explicit choice, stored, which always wins; and, until there
    // is one, the system's appearance, followed live. "Device" in the menu
    // clears the choice and hands the room back to the system. index.html
    // resolves the same way before first paint.
    const [lightingChoice, setLightingChoiceState] = useState<Lighting | null>(() => storedLighting());
    const [systemLight, setSystemLight] = useState<boolean>(() => systemPrefersLight());
    const isNox = resolveLighting(lightingChoice, systemLight) === 'nox';

    useEffect(() => {
        let link = document.getElementById('nox-css') as HTMLLinkElement | null;
        if (!link && isNox) {
            link = document.createElement('link');
            link.id = 'nox-css';
            link.rel = 'stylesheet';
            link.href = nocturneUrl;
            document.head.appendChild(link);
        } else if (link) {
            link.disabled = !isNox;
        }
        // index.html's basalt first-frame ground follows the lighting too,
        // so a switch to LVX leaves no night behind the page.
        document.documentElement.toggleAttribute('data-gor-dusk', isNox);
    }, [isNox]);

    // The player's choice: LVX or NOX is stored and from then on wins; null
    // ("Device") clears it, so the system's appearance decides again.
    const setLightingChoice = useCallback((choice: Lighting | null) => {
        setLightingChoiceState(choice);
        try {
            if (choice) localStorage.setItem('gor-theme', choice);
            else localStorage.removeItem('gor-theme');
        } catch { /* private mode */ }
    }, []);
    const setIsNox = useCallback((nox: boolean) => setLightingChoice(nox ? 'nox' : 'lux'), [setLightingChoice]);

    // The system's appearance, followed as it changes (a device that turns
    // dark at dusk takes the game with it - unless the player has chosen).
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(prefers-color-scheme: light)');
        const follow = (event: MediaQueryListEvent) => setSystemLight(event.matches);
        query.addEventListener?.('change', follow);
        return () => query.removeEventListener?.('change', follow);
    }, []);

    // The Fates pacing posture (ROADMAP_PHASE_4.md 4D item 1, D23) - a
    // device-level USER PREFERENCE beside the theme/onboarding keys
    // (persistence/settings.ts), never part of the save bundle. This local
    // state only mirrors localStorage for the selector's rendering:
    // executeTurn re-reads the STORED value fresh at each turn's start, so
    // a change takes effect on the next turn without touching executeTurn's
    // dependency array.
    const [pacingPosture, setPacingPostureState] = useState<PacingPosture>(() => getPacingPosture());
    const handleSetPacingPosture = useCallback((posture: PacingPosture) => {
        setPacingPostureState(posture);
        setPacingPosture(posture);
    }, []);

    // DESIGN_DECISIONS.md D34 - bring-your-own-key. The player's own key
    // (persistence/apiKey.ts, entered via SettingsMenu) takes priority over
    // the dev-mode `.env` convenience (readDevApiKey, app/transactions.ts);
    // resolveApiKey returns null when neither is set. Mirrors localStorage
    // in local state exactly like `pacingPosture` above, so saving/clearing
    // a key in the menu re-renders with the fresh value.
    const [userApiKey, setUserApiKeyState] = useState<string | null>(() => getApiKey());
    const resolvedApiKey = useMemo(() => resolveApiKey(userApiKey, readDevApiKey()), [userApiKey]);
    const handleSaveApiKey = useCallback((key: string) => {
        setApiKey(key);
        setUserApiKeyState(key);
    }, []);
    const handleClearApiKey = useCallback(() => {
        clearApiKey();
        setUserApiKeyState(null);
    }, []);
    // A real key is required only for REAL turns. The SDK constructor throws
    // in a browser when the key is unset, which would crash the app before
    // character select even in Mock Mode (which exists precisely to run
    // keyless). Fall back to a sentinel so the app always boots; Mock Mode
    // never calls the API, and executeTurn (hooks/useExecuteTurn.ts)
    // short-circuits a real turn with no key at all before ever reaching the
    // network (see its resolvedApiKey guard) rather than letting the
    // sentinel hit an auth error. Rebuilt (not a stable ref) whenever the
    // resolved key changes, so saving a new key in the configuration menu
    // takes effect on the very next AI call - an in-flight turn already
    // holds the OLD client in its own closure and simply finishes on it,
    // which is fine.
    const ai = useMemo(
        () => new GoogleGenAI({ apiKey: resolvedApiKey || 'NO_API_KEY_SET' }),
        [resolvedApiKey]
    );

    return {
        isSettingsMenuOpen, openSettings, closeSettings,
        isMockMode, setIsMockMode,
        isNox, setIsNox,
        lightingChoice, setLightingChoice,
        pacingPosture, handleSetPacingPosture,
        userApiKey, resolvedApiKey, handleSaveApiKey, handleClearApiKey,
        ai,
    };
}
