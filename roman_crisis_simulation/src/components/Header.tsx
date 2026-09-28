import React from 'react';
import { WorldState } from '../types';
import { Medallion, toRoman } from './ui/Brand';
import { economicSeverity, economicStabilityGrade, ECONOMIC_STABILITY_GRADES } from '../events/stabilityVocabulary';
import { paletteChordLabel } from '../app/commands';

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
 *
 * On the game screen the masthead is `compact`: the ceremony (kicker, AUC
 * line) steps aside and the medallions shrink, giving the chronicle back the
 * height, and the Commands affordance (the command palette) mirrors Settings
 * on the right. Choose Your Destiny keeps the full ceremony.
 */

/** Player-visible copy (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command palette"). */
export const HEADER_COPY = {
    commands: 'Commands',
    commandsLabel: 'Open the command palette',
    shifted: 'Changed this week',
} as const;

const Stat: React.FC<{ k: string; v: React.ReactNode; tone?: string; trailing?: React.ReactNode }> = ({ k, v, tone, trailing }) => (
    <span className="gor-masthead-stat">
        <span className="gor-label gor-masthead-stat-key">{k}</span>
        <span className="gor-masthead-stat-value" style={tone ? { color: tone } : undefined}>{v}</span>
        {trailing}
    </span>
);

const Gem: React.FC = () => (
    <span aria-hidden="true" className="gor-masthead-gem">◆</span>
);

/**
 * The economy's five grades (events/stabilityVocabulary.ts) as five pips -
 * Prosperous lights all five, Crisis one. Drawn only for a value the
 * vocabulary recognizes; the word beside it stays the accessible statement,
 * so the pips are decoration and aria-hidden. From Failing down they burn
 * crimson.
 */
const EconomyPips: React.FC<{ value: string }> = ({ value }) => {
    const grade = economicStabilityGrade(value);
    if (!grade) return null;
    const severity = economicSeverity(grade);
    const lit = ECONOMIC_STABILITY_GRADES.length - severity;
    const dire = severity >= economicSeverity('Failing');
    return (
        <span aria-hidden="true" className={`gor-masthead-pips${dire ? ' gor-masthead-pips-dire' : ''}`} data-grade={grade}>
            {ECONOMIC_STABILITY_GRADES.map((g, i) => (
                <span key={g} className={i < lit ? 'gor-masthead-pip gor-masthead-pip-lit' : 'gor-masthead-pip'} />
            ))}
        </span>
    );
};

/** A public world change landed on this stat last week (D5 rule 1: 'world' deltas are public). */
const Shifted: React.FC = () => (
    <span className="gor-masthead-shift" title={HEADER_COPY.shifted}>
        <span aria-hidden="true">✦</span>
        <span className="gor-sr-only"> ({HEADER_COPY.shifted})</span>
    </span>
);

const Header: React.FC<{
    worldState: WorldState,
    /** D31 - opens the configuration menu (components/SettingsMenu.tsx). */
    onOpenSettings: () => void,
    /** The game screen: the masthead steps its ceremony back. */
    compact?: boolean,
    /** Opens the command palette; the affordance is drawn only when given. */
    onOpenCommands?: () => void,
    /** Which world stats a public 'world' delta changed in the last committed week. */
    worldShifts?: { economic_stability?: boolean; political_climate?: boolean },
}> = ({ worldState, onOpenSettings, compact = false, onOpenCommands, worldShifts }) => (
    <header className={`gor-masthead${compact ? ' gor-masthead-compact' : ''}`}>
        <span aria-hidden="true" className="gor-masthead-cornice"></span>
        <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open configuration menu"
            title="Configuration — API key, pacing, lighting, reading, GM console"
            className="gor-masthead-settings"
        ><span aria-hidden="true" className="gor-masthead-settings-glyph">⚙</span>{' '}<span className="gor-masthead-settings-word">Settings</span></button>
        {onOpenCommands && (
            <button
                type="button"
                onClick={onOpenCommands}
                aria-label={HEADER_COPY.commandsLabel}
                aria-haspopup="dialog"
                aria-keyshortcuts="Control+K Meta+K"
                className="gor-masthead-settings gor-masthead-commands"
            >
                <span aria-hidden="true" className="gor-masthead-settings-glyph">❖</span>{' '}
                <span className="gor-masthead-settings-word">{HEADER_COPY.commands}</span>
                <kbd aria-hidden="true" className="gor-kbd gor-masthead-kbd">{paletteChordLabel()}</kbd>
            </button>
        )}
        <div className="gor-masthead-crest">
            <span className="gor-masthead-medallion"><Medallion size={compact ? 36 : 52} /></span>
            <div className="gor-masthead-titles">
                <div className="gor-masthead-kicker">SENATVS · POPVLVSQVE · ROMANVS</div>
                <h1 className="gor-masthead-title">Roman Crisis Simulation</h1>
                <div className="gor-label gor-masthead-auc">The Glory of Rome · {worldState.year + 753} Ab Urbe Condita</div>
            </div>
            <span className="gor-masthead-medallion"><Medallion size={compact ? 36 : 52} /></span>
        </div>
        <div className="gor-masthead-stats">
            <Stat k="Year" v={`${worldState.year} CE`} />
            <Gem />
            <Stat k="Week" v={toRoman(worldState.week)} />
            <Gem />
            <Stat
                k="Economic Stability"
                v={worldState.economic_stability}
                tone="var(--banner-stat-bronze)"
                trailing={<>
                    <EconomyPips value={worldState.economic_stability} />
                    {worldShifts?.economic_stability && <Shifted />}
                </>}
            />
            <Gem />
            <Stat
                k="Political Climate"
                v={worldState.political_climate}
                tone="var(--banner-stat-crimson)"
                trailing={worldShifts?.political_climate ? <Shifted /> : undefined}
            />
        </div>
    </header>
);

export default Header;
