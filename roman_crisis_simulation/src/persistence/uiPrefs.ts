/**
 * persistence/uiPrefs.ts
 *
 * DESIGN_DECISIONS.md D31/D32/D33 - the configuration menu's two toggles
 * beyond the D23 pacing posture and the D34 API key: whether the GM
 * console (Ctrl+Shift+G, D33) and GM Intervention (D32) are available at
 * all. Both are device/browser preferences in the exact same mold as
 * persistence/settings.ts / persistence/onboarding.ts - deliberately OUT
 * of `SaveGameState` (persistence/saveGame.ts is untouched here).
 *
 * Both default to TRUE ("available") per D32/D33's own wording, so a
 * fresh device/browser - and every existing test that never touches these
 * keys - sees ZERO behavior change from before this module existed.
 *
 * Guarded exactly like the siblings above: any localStorage call can throw
 * (private/incognito `SecurityError`, storage disabled entirely, quota
 * edge cases) and must never crash the game - worst case a toggle reads
 * back at its TRUE default (still "available"), or a change silently
 * doesn't persist, both harmless.
 */

const GM_CONSOLE_ENABLED_KEY = 'gloryOfRome:gmConsoleEnabled';
const GM_INTERVENTION_ENABLED_KEY = 'gloryOfRome:gmInterventionEnabled';
const COMPOSER_MODE_KEY = 'gloryOfRome:composerMode';

/** Default for both toggles below - "available", i.e. today's behavior. */
const DEFAULT_ENABLED = true;

function getBoolPref(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === '1') return true;
    if (stored === '0') return false;
    // Unset, or a corrupted/future-version value outside '0'/'1' - fall
    // back to the default rather than trusting an arbitrary stored string.
    return DEFAULT_ENABLED;
  } catch (e) {
    console.warn(`getBoolPref(${key}): localStorage.getItem failed`, e);
    return DEFAULT_ENABLED;
  }
}

function setBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch (e) {
    console.warn(`setBoolPref(${key}): localStorage.setItem failed`, e);
  }
}

/** D33 - whether the GM console (Ctrl+Shift+G / the GM Log affordance) is available at all. Defaults TRUE. */
export function getGmConsoleEnabled(): boolean {
  return getBoolPref(GM_CONSOLE_ENABLED_KEY);
}

/** Persists the D33 GM-console-availability toggle (the configuration menu). */
export function setGmConsoleEnabled(enabled: boolean): void {
  setBoolPref(GM_CONSOLE_ENABLED_KEY, enabled);
}

/** D32 - whether GM Intervention's free-text input is available at all. Defaults TRUE. */
export function getGmInterventionEnabled(): boolean {
  return getBoolPref(GM_INTERVENTION_ENABLED_KEY);
}

/** Persists the D32 GM-Intervention-availability toggle (the configuration menu). */
export function setGmInterventionEnabled(enabled: boolean): void {
  setBoolPref(GM_INTERVENTION_ENABLED_KEY, enabled);
}

/** The input surface is a browser preference, not campaign state. */
export function getComposerMode(): 'chat' | 'structured' {
  try {
    const stored = localStorage.getItem(COMPOSER_MODE_KEY);
    return stored === 'structured' || stored === 'chat' ? stored : 'chat';
  } catch (e) {
    console.warn('getComposerMode: localStorage.getItem failed', e);
    return 'chat';
  }
}

/** Persists only the selected input surface; drafts never enter localStorage. */
export function setComposerMode(mode: 'chat' | 'structured'): void {
  try {
    localStorage.setItem(COMPOSER_MODE_KEY, mode);
  } catch (e) {
    console.warn('setComposerMode: localStorage.setItem failed', e);
  }
}
