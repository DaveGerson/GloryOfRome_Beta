/**
 * @vitest-environment jsdom
 *
 * tests/appShellHooks.test.tsx — the device-preference and shell hooks
 * extracted from App.tsx (hooks/useSettings.ts, hooks/useGmConsole.ts,
 * hooks/useWeekBeat.ts). App-level suites (gmScreenSmoke,
 * appTransactionContracts) exercise these through the real UI; this file
 * pins each hook's own contract in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHook } from './renderHook';
import { useGmConsole } from '../hooks/useGmConsole';
import { useSettings } from '../hooks/useSettings';
import { useWeekBeat, WEEK_BEAT_MS } from '../hooks/useWeekBeat';
import { getGmConsoleEnabled, getGmInterventionEnabled } from '../persistence/uiPrefs';
import { getApiKey } from '../persistence/apiKey';
import { getPacingPosture } from '../persistence/settings';

function pressCtrlShiftG(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    return event;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
    document.getElementById('nox-css')?.remove();
    vi.useRealTimers();
});

describe('useGmConsole (D7/D32/D33)', () => {
    it('starts hidden every session; Ctrl+Shift+G toggles the console on and off', () => {
        const hook = renderHook(useGmConsole, undefined);
        expect(hook.current.isGmConsoleEnabled).toBe(false);
        expect(pressCtrlShiftG().defaultPrevented).toBe(true);
        expect(hook.current.isGmConsoleEnabled).toBe(true);
        pressCtrlShiftG();
        expect(hook.current.isGmConsoleEnabled).toBe(false);
        hook.unmount();
    });

    it('turning the console off also closes an open GM screen', () => {
        const hook = renderHook(useGmConsole, undefined);
        act(() => hook.current.handleSetGmConsoleOpen(true));
        act(() => hook.current.openGmScreen());
        expect(hook.current.isGmScreenVisible).toBe(true);
        act(() => hook.current.handleSetGmConsoleOpen(false));
        expect(hook.current.isGmConsoleEnabled).toBe(false);
        expect(hook.current.isGmScreenVisible).toBe(false);
        hook.unmount();
    });

    it('D33: an unavailable console forces every layer off and makes the hotkey and menu switch no-ops', () => {
        const hook = renderHook(useGmConsole, undefined);
        act(() => hook.current.handleSetGmConsoleOpen(true));
        act(() => hook.current.openGmScreen());
        act(() => hook.current.handleSetGmConsoleAvailable(false));
        expect(getGmConsoleEnabled()).toBe(false);
        expect(hook.current.gmConsoleAvailable).toBe(false);
        expect(hook.current.isGmConsoleEnabled).toBe(false);
        expect(hook.current.isGmScreenVisible).toBe(false);
        // The chord is left entirely to the browser.
        expect(pressCtrlShiftG().defaultPrevented).toBe(false);
        act(() => hook.current.handleSetGmConsoleOpen(true));
        expect(hook.current.isGmConsoleEnabled).toBe(false);
        hook.unmount();
    });

    it('D32: GM Intervention availability persists as a device preference', () => {
        const hook = renderHook(useGmConsole, undefined);
        expect(hook.current.gmInterventionAvailable).toBe(true);
        act(() => hook.current.handleSetGmInterventionAvailable(false));
        expect(hook.current.gmInterventionAvailable).toBe(false);
        expect(getGmInterventionEnabled()).toBe(false);
        hook.unmount();
    });

    it('stops listening once unmounted', () => {
        const hook = renderHook(useGmConsole, undefined);
        hook.unmount();
        expect(pressCtrlShiftG().defaultPrevented).toBe(false);
    });
});

describe('useSettings (D23/D31/D34)', () => {
    it("the player's own key outranks the dev key, and clearing it falls back", () => {
        const hook = renderHook(useSettings, undefined);
        // tests/vitest.setup.ts seeds the fake dev key.
        expect(hook.current.userApiKey).toBeNull();
        expect(hook.current.resolvedApiKey).toBe('gor-vitest-fake-key');
        const devClient = hook.current.ai;
        act(() => hook.current.handleSaveApiKey('player-key'));
        expect(getApiKey()).toBe('player-key');
        expect(hook.current.resolvedApiKey).toBe('player-key');
        // A new key rebuilds the client, so the very next AI call uses it.
        expect(hook.current.ai).not.toBe(devClient);
        act(() => hook.current.handleClearApiKey());
        expect(getApiKey()).toBeNull();
        expect(hook.current.resolvedApiKey).toBe('gor-vitest-fake-key');
        hook.unmount();
    });

    it('pacing posture mirrors and writes the stored preference', () => {
        const hook = renderHook(useSettings, undefined);
        act(() => hook.current.handleSetPacingPosture('dramatic'));
        expect(hook.current.pacingPosture).toBe('dramatic');
        expect(getPacingPosture()).toBe('dramatic');
        hook.unmount();
    });

    it('NOX loads the nocturne stylesheet once and LVX disables it, persisting the choice', () => {
        const hook = renderHook(useSettings, undefined);
        expect(document.getElementById('nox-css')).toBeNull();
        act(() => hook.current.setIsNox(true));
        const link = document.getElementById('nox-css') as HTMLLinkElement;
        expect(link).not.toBeNull();
        expect(localStorage.getItem('gor-theme')).toBe('nox');
        act(() => hook.current.setIsNox(false));
        expect(document.getElementById('nox-css')).toBe(link);
        expect(link.disabled).toBe(true);
        expect(localStorage.getItem('gor-theme')).toBe('lux');
        hook.unmount();
    });

    it('the menu flag and Mock Mode are transient session state', () => {
        const hook = renderHook(useSettings, undefined);
        expect(hook.current.isSettingsMenuOpen).toBe(false);
        act(() => hook.current.openSettings());
        expect(hook.current.isSettingsMenuOpen).toBe(true);
        act(() => hook.current.closeSettings());
        expect(hook.current.isSettingsMenuOpen).toBe(false);
        act(() => hook.current.setIsMockMode(true));
        expect(hook.current.isMockMode).toBe(true);
        hook.unmount();
    });
});

describe('useWeekBeat (audit item 18)', () => {
    it('washes for WEEK_BEAT_MS, and a second strike restarts the window', () => {
        vi.useFakeTimers();
        const hook = renderHook(useWeekBeat, undefined);
        act(() => hook.current.strikeWeekBeat());
        expect(hook.current.weekBeat).toBe(true);
        act(() => { vi.advanceTimersByTime(WEEK_BEAT_MS - 20); });
        act(() => hook.current.strikeWeekBeat());
        act(() => { vi.advanceTimersByTime(WEEK_BEAT_MS - 20); });
        expect(hook.current.weekBeat).toBe(true);
        act(() => { vi.advanceTimersByTime(20); });
        expect(hook.current.weekBeat).toBe(false);
        hook.unmount();
    });

    it('clears a pending timer on unmount', () => {
        vi.useFakeTimers();
        const hook = renderHook(useWeekBeat, undefined);
        act(() => hook.current.strikeWeekBeat());
        hook.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
