
import React from 'react';

/**
 * A prominent, full-width banner surfacing `simulationState.major_ongoing_crisis`.
 * Rendered between the Header and the main panes so an active crisis is
 * impossible to miss.
 */
const CrisisBanner: React.FC<{ crisis: string | null }> = ({ crisis }) => {
    if (!crisis) return null;

    return (
        <div
            role="alert"
            className="w-full bg-gradient-to-r from-red-950 via-red-900 to-red-950 text-amber-100 border-y-4 border-double border-amber-700/60 px-4 py-3 shadow-lg animate-fade-in"
        >
            <div className="flex items-center justify-center gap-3 text-center">
                <span className="text-amber-400 text-xl" aria-hidden="true">⚠</span>
                <span className="font-decorative uppercase tracking-[0.2em] text-xs sm:text-sm text-amber-400/90">
                    Ongoing Crisis
                </span>
                <span className="font-bold text-base sm:text-lg roman-inset-text">{crisis}</span>
                <span className="text-amber-400 text-xl" aria-hidden="true">⚠</span>
            </div>
        </div>
    );
};

export default CrisisBanner;
