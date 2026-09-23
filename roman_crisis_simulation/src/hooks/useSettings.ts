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

export function useSettings() {
    // D31 - the configuration menu's own open/closed flag. Purely transient
    // UI state, never part of the save bundle.
    const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
    const openSettings = useCallback(() => setIsSettingsMenuOpen(true), []);
    const closeSettings = useCallback(() => setIsSettingsMenuOpen(false), []);
    const [isMockMode, setIsMockMode] = useState(false);

    // LVX/NOX lighting. Nox Romae (design/nocturne.css) is an override
    // stylesheet loaded after styles.css; toggling swaps the whole client
    // between marble day and the torchlit night skin. Persisted so the
    // choice survives reloads. Presentation-only - never part of the save.
    const [isNox, setIsNox] = useState<boolean>(() => {
        try { return localStorage.getItem('gor-theme') === 'nox'; } catch { return false; }
    });

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
        try { localStorage.setItem('gor-theme', isNox ? 'nox' : 'lux'); } catch { /* private mode */ }
    }, [isNox]);

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
        pacingPosture, handleSetPacingPosture,
        userApiKey, resolvedApiKey, handleSaveApiKey, handleClearApiKey,
        ai,
    };
}
