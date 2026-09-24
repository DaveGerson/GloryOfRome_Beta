/**
 * hooks/useGmConsole.ts
 *
 * The GM console's three layers of "on", moved verbatim out of App.tsx
 * (2026-09-23):
 *   - AVAILABLE (D33): a device preference - may the console exist at all?
 *   - ENABLED (D7): this session's runtime toggle - does the GM LOG button
 *     show? Flipped by Ctrl+Shift+G or the menu's Developer card.
 *   - VISIBLE: is the GameMasterScreen overlay open right now?
 * Each layer can only be on when the one above it is, and turning a layer
 * off turns every layer below it off with it. Plus D32's GM Intervention
 * availability, the same device-preference mold, which GameMasterScreen
 * gates on.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getGmConsoleEnabled, setGmConsoleEnabled,
    getGmInterventionEnabled, setGmInterventionEnabled,
} from '../persistence/uiPrefs';
import { shouldToggleGmConsole } from '../components/ui/gmConsoleHotkey';

export function useGmConsole() {
    const [isGmScreenVisible, setIsGmScreenVisible] = useState(false);
    const openGmScreen = useCallback(() => setIsGmScreenVisible(true), []);
    const closeGmScreen = useCallback(() => setIsGmScreenVisible(false), []);
    // D7 - the GM console (log/debugger) stays in the codebase permanently
    // but is hidden by default for a clean player view. This is the runtime
    // toggle that governs whether the GM LOG button even appears; Ctrl+Shift+G
    // (see the effect below) and, in dev builds, the configuration menu's
    // Developer-card switch both flip it. Deliberately not persisted - every
    // fresh session starts hidden.
    const [isGmConsoleEnabled, setIsGmConsoleEnabled] = useState(false);
    const updateGmConsoleEnabled = useCallback((enabled: boolean) => {
        if (!enabled) setIsGmScreenVisible(false);
        setIsGmConsoleEnabled(enabled);
    }, []);
    // DESIGN_DECISIONS.md D33 - whether the GM console is available AT ALL,
    // a device preference (persistence/uiPrefs.ts) distinct from
    // `isGmConsoleEnabled` above (whether it's currently toggled ON for
    // this session). Defaults true ("available"), so out of the box
    // nothing about the Ctrl+Shift+G/dev-switch behavior above changes.
    // When false, the effect below turns the hotkey into a no-op and this
    // also forces `isGmConsoleEnabled` off (see handleSetGmConsoleAvailable).
    const [gmConsoleAvailable, setGmConsoleAvailableState] = useState<boolean>(() => getGmConsoleEnabled());
    const handleSetGmConsoleAvailable = useCallback((enabled: boolean) => {
        setGmConsoleAvailableState(enabled);
        setGmConsoleEnabled(enabled);
        if (!enabled) {
            updateGmConsoleEnabled(false);
        }
    }, [updateGmConsoleEnabled]);
    // The configuration menu's "console open" switch: a no-op while the
    // console is unavailable (D33), exactly like the hotkey below.
    const handleSetGmConsoleOpen = useCallback((enabled: boolean) => {
        if (gmConsoleAvailable) {
            updateGmConsoleEnabled(enabled);
        }
    }, [gmConsoleAvailable, updateGmConsoleEnabled]);
    // DESIGN_DECISIONS.md D32 - whether GM Intervention's free-text input is
    // available at all (persistence/uiPrefs.ts), same device-preference
    // mold as above. Defaults true; passed straight through to
    // GameMasterScreen, which does the actual UI gating.
    const [gmInterventionAvailable, setGmInterventionAvailableState] = useState<boolean>(() => getGmInterventionEnabled());
    const handleSetGmInterventionAvailable = useCallback((enabled: boolean) => {
        setGmInterventionAvailableState(enabled);
        setGmInterventionEnabled(enabled);
    }, []);

    // D7 - Ctrl+Shift+G is the primary runtime toggle for the GM console's
    // availability (separate from whether the screen is currently open -
    // see isGmScreenVisible). Works in every build, not just dev, since the
    // console itself is meant to stay reachable for tuning, just hidden by
    // default. D33 - a no-op entirely when `gmConsoleAvailable` (the
    // configuration menu's toggle) is false - including not preventing the
    // browser's default handling of the chord (see shouldToggleGmConsole).
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!shouldToggleGmConsole(event, gmConsoleAvailable)) return;
            event.preventDefault();
            updateGmConsoleEnabled(!isGmConsoleEnabled);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [gmConsoleAvailable, isGmConsoleEnabled, updateGmConsoleEnabled]);

    return {
        isGmScreenVisible, openGmScreen, closeGmScreen,
        isGmConsoleEnabled, handleSetGmConsoleOpen,
        gmConsoleAvailable, handleSetGmConsoleAvailable,
        gmInterventionAvailable, handleSetGmInterventionAvailable,
    };
}
