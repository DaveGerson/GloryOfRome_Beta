/**
 * hooks/useOnboarding.ts
 *
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - the first-turn onboarding
 * intro. Moved verbatim out of App.tsx (2026-09-23). Purely transient UI
 * state (never part of the save bundle): whether it's EVER been dismissed
 * on this device lives in persistence/onboarding.ts, a dedicated
 * localStorage key outside the save blob (it's a device preference, not
 * campaign state).
 */

import { useCallback, useState } from 'react';
import { hasSeenOnboarding, markOnboardingSeen } from '../persistence/onboarding';

export function useOnboarding() {
    // Only ever set true from `offerOnboarding` - called by
    // hooks/useCampaignLifecycle.ts's startGameWithCharacter (a brand-new
    // campaign, whether from a preset or a custom-created character) -
    // never from `handleContinue`, so resuming an existing save never
    // shows it.
    const [showOnboarding, setShowOnboarding] = useState(false);

    // Show the first-turn onboarding overlay exactly once ever, on
    // whichever device/browser hasn't dismissed it yet.
    const offerOnboarding = useCallback(() => {
        if (!hasSeenOnboarding()) {
            setShowOnboarding(true);
        }
    }, []);

    // Fires on X, Escape, or finishing the final step alike (see
    // OnboardingOverlay's onClose) - marks the device-level seen-flag so it
    // never shows again, then hides the overlay.
    const handleCloseOnboarding = useCallback(() => {
        markOnboardingSeen();
        setShowOnboarding(false);
    }, []);

    return { showOnboarding, offerOnboarding, handleCloseOnboarding };
}
