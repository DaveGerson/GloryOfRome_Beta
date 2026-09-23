import React from 'react';
import { WorldState } from '../types';
import { Medallion, toRoman } from './ui/Brand';

/**
 * Twin-medallion Tyrian vexillum masthead (design system ui_kits/simulation/Header):
 * SENATVS·POPVLVSQVE·ROMANVS kicker, gold cornice, ◆-separated world stats, and
 * the ⚙ Settings affordance. World stats are live from `worldState`. The old
 * dev-only Mock Mode / GM Console switches now live in the configuration
 * menu's Developer card (components/SettingsMenu.tsx).
 *
 * Presentation lives in design/shell.css (`gor-masthead*`) rather than inline,
 * so the narrow-viewport layout can re-cut the masthead by class instead of
 * by DOM position and the night skin can reach every surface of it.
 */

const Stat: React.FC<{ k: string; v: React.ReactNode; tone?: string }> = ({ k, v, tone }) => (
    <span className="gor-masthead-stat">
        <span className="gor-label gor-masthead-stat-key">{k}</span>
        <span className="gor-masthead-stat-value" style={tone ? { color: tone } : undefined}>{v}</span>
    </span>
);

const Gem: React.FC = () => (
    <span aria-hidden="true" className="gor-masthead-gem">◆</span>
);

const Header: React.FC<{
    worldState: WorldState,
    /** D31 - opens the configuration menu (components/SettingsMenu.tsx). */
    onOpenSettings: () => void,
}> = ({ worldState, onOpenSettings }) => (
    <header className="gor-masthead">
        <span aria-hidden="true" className="gor-masthead-cornice"></span>
        <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open configuration menu"
            title="Configuration — API key, pacing, lighting, GM console"
            className="gor-masthead-settings"
        ><span aria-hidden="true" className="gor-masthead-settings-glyph">⚙</span>{' '}<span className="gor-masthead-settings-word">Settings</span></button>
        <div className="gor-masthead-crest">
            <span className="gor-masthead-medallion"><Medallion size={52} /></span>
            <div className="gor-masthead-titles">
                <div className="gor-masthead-kicker">SENATVS · POPVLVSQVE · ROMANVS</div>
                <h1 className="gor-masthead-title">Roman Crisis Simulation</h1>
                <div className="gor-label gor-masthead-auc">The Glory of Rome · {worldState.year + 753} Ab Urbe Condita</div>
            </div>
            <span className="gor-masthead-medallion"><Medallion size={52} /></span>
        </div>
        <div className="gor-masthead-stats">
            <Stat k="Year" v={`${worldState.year} CE`} />
            <Gem />
            <Stat k="Week" v={toRoman(worldState.week)} />
            <Gem />
            <Stat k="Economic Stability" v={worldState.economic_stability} tone="var(--banner-stat-bronze)" />
            <Gem />
            <Stat k="Political Climate" v={worldState.political_climate} tone="var(--banner-stat-crimson)" />
        </div>
    </header>
);

export default Header;
