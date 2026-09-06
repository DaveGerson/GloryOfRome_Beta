import React from 'react';
import { WorldState } from '../types';
import { Medallion, toRoman } from './ui/Brand';

/**
 * The masthead, compact (the September 2026 design pass).
 *
 * The twin-medallion vexillum stood ~140px tall on every screen - a fifth of
 * a laptop viewport given to a title the player reads once - and pushed the
 * chronicle and the composer down with it. It is now ONE row: a single
 * medallion, the title stacked with its SPQR kicker and the AUC line, and the
 * four world readings as engraved cells on the right, so the week and the
 * empire's condition read at a glance without a second row. Same Tyrian
 * metal, gold cornice and dentil rule; ~84px instead of ~140. Layout lives in
 * design/components.css (`.gor-masthead*`), so nocturne.css re-lights it
 * through the same banner tokens as before and the narrow stops can wrap the
 * readings under the title without structural selectors.
 *
 * The ⚙ Settings affordance keeps its accessible name ("Open configuration
 * menu") - every settings test and the onboarding flow reach it by that name.
 */
const Reading: React.FC<{ label: string; value: React.ReactNode; tone?: 'bronze' | 'crimson' }> = ({ label, value, tone }) => (
    <div className={`gor-reading${tone ? ` gor-reading-${tone}` : ''}`}>
        <dt className="gor-reading-label">{label}</dt>
        <dd className="gor-reading-value">{value}</dd>
    </div>
);

const Header: React.FC<{
    worldState: WorldState,
    /** D31 - opens the configuration menu (components/SettingsMenu.tsx). */
    onOpenSettings: () => void,
}> = ({ worldState, onOpenSettings }) => (
    <header className="gor-masthead">
        <span aria-hidden="true" className="gor-masthead-cornice" />
        <button
            type="button"
            className="gor-masthead-settings"
            onClick={onOpenSettings}
            aria-label="Open configuration menu"
            title="Configuration — API key, pacing, lighting, GM console"
        >
            <span aria-hidden="true">⚙</span>
            <span className="gor-masthead-settings-text">Settings</span>
        </button>
        <div className="gor-masthead-brand">
            <Medallion size={48} />
            <div className="gor-masthead-title">
                <span className="gor-masthead-kicker">Senatvs · Popvlvsqve · Romanvs</span>
                <h1>Roman Crisis Simulation</h1>
                <span className="gor-masthead-sub">The Glory of Rome · {worldState.year + 753} Ab Urbe Condita</span>
            </div>
        </div>
        <dl className="gor-masthead-readings" aria-label="The state of the world">
            <Reading label="Year" value={`${worldState.year} CE`} />
            <Reading label="Week" value={toRoman(worldState.week)} />
            <Reading label="Economy" value={worldState.economic_stability} tone="bronze" />
            <Reading label="Climate" value={worldState.political_climate} tone="crimson" />
        </dl>
    </header>
);

export default Header;
