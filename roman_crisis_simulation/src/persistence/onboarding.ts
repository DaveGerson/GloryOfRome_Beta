/**
 * persistence/onboarding.ts
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - tracks whether this device/
 * browser has ever dismissed the first-turn OnboardingOverlay
 * (components/OnboardingOverlay.tsx). Deliberately kept OUT of
 * `SaveGameState` (persistence/saveGame.ts): this is a device preference
 * ("has this human seen the intro"), not campaign state. It must survive
 * `clearSave()`/`Start Anew` and a brand-new campaign on the same
 * device/browser should NOT show the intro again; conversely, loading the
 * SAME save on a different browser/device intentionally shows it once more.
 *
 * Guarded exactly like persistence/saveGame.ts's storage access: any
 * localStorage call can throw (private/incognito `SecurityError`, storage
 * disabled entirely, quota edge cases) and must never crash the game -
 * worst case the intro is shown again (or not persisted), which is
 * harmless.
 */

const ONBOARDING_SEEN_KEY = 'gloryOfRome:onboardingSeen';

/** True if this device has ever dismissed/completed the onboarding overlay. */
export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch (e) {
    console.warn('hasSeenOnboarding: localStorage.getItem failed', e);
    return false;
  }
}

/**
 * Marks the onboarding overlay as seen so it never shows again on this
 * device/browser. Idempotent - safe to call every time the overlay closes,
 * regardless of how (X, Escape, or finishing the final step).
 */
export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch (e) {
    console.warn('markOnboardingSeen: localStorage.setItem failed', e);
  }
}
