import React from 'react';
import type { CrisisGrade } from './crisisGrade';

/**
 * A prominent, full-width banner surfacing `simulationState.major_ongoing_crisis`.
 * Rendered between the Header and the main panes so an active crisis is
 * impossible to miss. Design-system `gor-crisis` — crimson metal with a gold
 * dentil cornice; the warning glyphs ember, and under Nox Romae it smolders.
 *
 * Three volumes (audit item 15), graded by `components/crisisGrade.ts` from
 * the simulation's own macro enums — a grain shortage and the Praetorians at
 * the door no longer share a voice:
 *
 *  - `murmur`      — bronze hairline, no metal and no glyph
 *  - `crisis`      — the banner exactly as shipped
 *  - `at_the_door` — doubled dentil and an outward ember bloom
 */
const GRADE_LABEL: Record<CrisisGrade, string> = {
    murmur: 'A murmur',
    crisis: 'Ongoing Crisis',
    at_the_door: 'At the door',
};

const GRADE_CLASS: Record<CrisisGrade, string> = {
    murmur: 'gor-crisis gor-crisis-murmur',
    crisis: 'gor-crisis',
    at_the_door: 'gor-crisis gor-crisis-atdoor',
};

const CrisisBanner: React.FC<{ crisis: string | null; grade?: CrisisGrade }> = ({ crisis, grade = 'crisis' }) => {
    if (!crisis) return null;

    // A murmur wears no metal, so it takes no ember glyphs either.
    const glyph = grade === 'murmur'
        ? null
        : <span className="gor-crisis-glyph" aria-hidden="true">⚠</span>;

    return (
        <div className={GRADE_CLASS[grade]} role="alert">
            {grade === 'at_the_door' && <span className="gor-crisis-dentil" aria-hidden="true" />}
            {glyph}
            <span className="gor-crisis-label">{GRADE_LABEL[grade]}</span>
            <span className="gor-crisis-text">{crisis}</span>
            {glyph}
        </div>
    );
};

export default CrisisBanner;
