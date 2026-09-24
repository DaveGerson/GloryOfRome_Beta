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

/**
 * Which sub-register a panel tab was last left on (audit items 34-37) -
 * Assets, Reports, Empire and Chronicle each carry a small register switch,
 * and it should still be where the player left it after a reload. A device
 * preference in exactly the same mold as the composer mode above: never save
 * state, never campaign data.
 *
 * The valid registers differ per tab and change with the design, so the
 * CALLER supplies its own allowed list and the stored value is only returned
 * when it is still one of them; anything else falls back to the caller's
 * default. That keeps a stale value from a previous build harmless.
 */
const TAB_REGISTER_KEY_PREFIX = 'gloryOfRome:tabRegister:';

export function getTabRegister<T extends string>(tabId: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(`${TAB_REGISTER_KEY_PREFIX}${tabId}`);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  } catch (e) {
    console.warn(`getTabRegister(${tabId}): localStorage.getItem failed`, e);
    return fallback;
  }
}

export function setTabRegister(tabId: string, register: string): void {
  try {
    localStorage.setItem(`${TAB_REGISTER_KEY_PREFIX}${tabId}`, register);
  } catch (e) {
    console.warn(`setTabRegister(${tabId}): localStorage.setItem failed`, e);
  }
}

/**
 * The narration voice ("hear it performed", hooks/useNarrationVoice.ts): a
 * device preference in the same mold as the composer mode above, never
 * save state. `'off'` is the default and the fallback for anything stored
 * that is not one of the three modes, because every clip is a paid API
 * call on the player's own key (D34) - nobody should start paying for audio
 * without having chosen to.
 *
 *  - `'off'`       - no control on any narration.
 *  - `'on_demand'` - a play/stop control on each committed GM narration.
 *  - `'auto'`      - that control, plus the newest narration plays by itself
 *                    once a turn commits (never mid-stream, never a
 *                    narration restored from a save).
 */
export type NarrationVoiceMode = 'off' | 'on_demand' | 'auto';
export const NARRATION_VOICE_MODES: readonly NarrationVoiceMode[] = ['off', 'on_demand', 'auto'];
const NARRATION_VOICE_MODE_KEY = 'gloryOfRome:narrationVoiceMode';
const DEFAULT_NARRATION_VOICE_MODE: NarrationVoiceMode = 'off';

export function getNarrationVoiceMode(): NarrationVoiceMode {
  try {
    const stored = localStorage.getItem(NARRATION_VOICE_MODE_KEY);
    return NARRATION_VOICE_MODES.includes(stored as NarrationVoiceMode) ? (stored as NarrationVoiceMode) : DEFAULT_NARRATION_VOICE_MODE;
  } catch (e) {
    console.warn('getNarrationVoiceMode: localStorage.getItem failed', e);
    return DEFAULT_NARRATION_VOICE_MODE;
  }
}

export function setNarrationVoiceMode(mode: NarrationVoiceMode): void {
  try {
    localStorage.setItem(NARRATION_VOICE_MODE_KEY, mode);
  } catch (e) {
    console.warn('setNarrationVoiceMode: localStorage.setItem failed', e);
  }
}
