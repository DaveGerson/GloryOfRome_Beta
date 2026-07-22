/**
 * persistence/apiKey.ts
 *
 * DESIGN_DECISIONS.md D34 - bring-your-own-key is the default interaction
 * path. The player's OWN Gemini API key, entered in the configuration menu
 * (components/SettingsMenu.tsx), lives HERE and only here: device-side
 * localStorage, never bundled into the build (vite.config.ts's define
 * block is dev-server-only now), never written into the save blob
 * (persistence/saveGame.ts is untouched by this module and stays that
 * way), never included in any export (GameMasterScreen's eval-corpus
 * download, `RawCallRecord`), and never passed to `console.log`.
 *
 * Guarded exactly like the device-preference siblings
 * (persistence/settings.ts / persistence/onboarding.ts): any localStorage
 * call can throw (private/incognito `SecurityError`, storage disabled
 * entirely, quota edge cases) and must never crash the game - worst case
 * the key reads back as absent (or a save of it silently fails), which
 * just re-prompts the player toward the configuration menu.
 */

const API_KEY_STORAGE_KEY = 'gloryOfRome:apiKey';

/**
 * The device's stored Gemini API key. `null` when unset, unreadable, or
 * holding only whitespace (a corrupted/emptied value must never leak an
 * empty string past this point - see `resolveApiKey`, which treats "unset"
 * and "empty" identically).
 */
export function getApiKey(): string | null {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    return stored !== null && stored.trim().length > 0 ? stored : null;
  } catch (e) {
    console.warn('getApiKey: localStorage.getItem failed', e);
    return null;
  }
}

/** Persists the player's own Gemini API key for this device/browser (the configuration menu's "Save"). */
export function setApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch (e) {
    console.warn('setApiKey: localStorage.setItem failed', e);
  }
}

/** Removes the stored key (the configuration menu's "Clear"). */
export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch (e) {
    console.warn('clearApiKey: localStorage.removeItem failed', e);
  }
}

/**
 * Resolves which Gemini API key a real turn should use, in priority order:
 *
 *  1. The player's own key (entered in the configuration menu) - D34's
 *     default path.
 *  2. The dev-mode `.env` convenience key (App.tsx reads this only under
 *     `import.meta.env.DEV`; see vite.config.ts's now dev-server-only
 *     define block) - the owner's local-dev seam, never present in a
 *     production build.
 *  3. `null` - neither is set. The caller (App.tsx) keeps booting keyless
 *     exactly like commit 894f469 ("Boot without an API key") and, on a
 *     real turn attempt, points the player at the configuration menu
 *     instead of letting an auth error hit the network.
 *
 * A whitespace-only user key is treated as absent rather than as a
 * malformed key that would otherwise shadow a perfectly usable dev key -
 * pure and total, never throws.
 */
export function resolveApiKey(
  userKey: string | null | undefined,
  devKey: string | null | undefined
): string | null {
  const trimmedUser = typeof userKey === 'string' ? userKey.trim() : '';
  if (trimmedUser) return trimmedUser;
  const trimmedDev = typeof devKey === 'string' ? devKey.trim() : '';
  return trimmedDev.length > 0 ? trimmedDev : null;
}
