import React from 'react';

/**
 * A prominent, full-width banner surfacing `simulationState.major_ongoing_crisis`.
 * Rendered between the Header and the main panes so an active crisis is
 * impossible to miss. Design-system `gor-crisis` — crimson metal with a gold
 * dentil cornice; the warning glyphs ember, and under Nox Romae it smolders.
 */
const CrisisBanner: React.FC<{ crisis: string | null }> = ({ crisis }) => {
    if (!crisis) return null;

    return (
        <div className="gor-crisis" role="alert">
            <span className="gor-crisis-glyph" aria-hidden="true">⚠</span>
            <span className="gor-crisis-label">Ongoing Crisis</span>
            <span className="gor-crisis-text">{crisis}</span>
            <span className="gor-crisis-glyph" aria-hidden="true">⚠</span>
        </div>
    );
};

export default CrisisBanner;
