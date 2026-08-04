import React from 'react';
import { SimulationState } from '../../types';
import { Alert } from '../ui/Alert';
import { toRoman } from '../ui/Brand';
import type { TabId } from '../../perception/visibility';
import { EmptyRegister } from './EmptyRegister';

/**
 * "The week's briefing" (WP-15, audit items 38–39).
 *
 * ONE OWNER PER FACT. Two thirds of this tab used to be rendered in two other
 * tabs and, because the duplicates were styled differently, the player could
 * not tell they were the same facts:
 *
 *  - "Your Intelligence Picture" printed the same regions, under the same
 *    sight rule, as Empire's "Locations in Rome" — the duplication was
 *    explicit in the code (`isRegionKnownToPlayer` was exported FROM here so
 *    EmpireTab could import it) and invisible in the UI. Empire owns regions
 *    now; the sight rule moved to perception/visibility.ts, which is where a
 *    perception rule belongs.
 *  - "Recent Headlines" rendered `currentEvents` as an inert <ul> with browser
 *    disc bullets — the last genuinely unstyled element in the panel — while
 *    the Events tab rendered the same sentences as pressable cards that summon
 *    your agents. Events owns occurrences now.
 *
 * Only the five macro SimulationState rows were ever unique to this tab, and
 * they are treated as PUBLIC per D5's crude-v1 convention: "the throne is
 * vacant" is the kind of thing everyone in the Empire knows.
 *
 * What is left is the briefing: the state of Rome, the crisis, and where to
 * look.
 */

type Severity = 'good' | 'warn' | 'bad';

const SEVERITY_COLOR: Record<Severity, string> = {
    good: 'var(--laurel-500)',
    warn: 'var(--bronze-500)',
    bad: 'var(--crimson-500)',
};

const IMPERIAL_STATUS_SEVERITY: Record<SimulationState['imperial_status'], Severity> = {
    Stable: 'good',
    Contested: 'warn',
    Vacant: 'bad',
};

const SENATE_STATUS_SEVERITY: Record<SimulationState['senate_status'], Severity> = {
    Ascendant: 'good',
    Functional: 'good',
    Irrelevant: 'warn',
    Deposed: 'bad',
};

const MILITARY_STATUS_SEVERITY: Record<SimulationState['military_status'], Severity> = {
    Loyal: 'good',
    Divided: 'warn',
    Rebellious: 'bad',
};

const PLEBEIAN_MOOD_SEVERITY: Record<SimulationState['plebeian_mood'], Severity> = {
    Content: 'good',
    Uneasy: 'warn',
    Rioting: 'bad',
};

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

/** One cell of the 2×2 engraved grid. `fell` marks a standing that slipped this week. */
const MacroCell: React.FC<{ label: string; value: string; severity: Severity; fell: boolean }> = ({ label, value, severity, fell }) => (
    <div className="gor-macro-cell">
        <span className="gor-label" style={{ fontSize: 9.5 }}>{label}</span>
        <span className="gor-macro-value" style={{ color: SEVERITY_COLOR[severity] }}>
            {value}
            {fell && <span aria-label="fell this week" className="gor-macro-fell">▾</span>}
        </span>
    </div>
);

/** One "where to look" row: what is waiting, and a press that takes you there. */
export interface BriefingPointer {
    tab: TabId;
    name: string;
    /** Plain English — "Four occurrences this week, none yet examined." */
    line: string;
    /** Reuses existing panel vocabulary: a pulse dot, "⚠ Conflict", "2 / 4", coin pips. */
    indicator?: React.ReactNode;
}

const WorldStateTab: React.FC<{
    simulationState: SimulationState;
    /** The week this briefing covers. */
    week: number;
    /**
     * Which macro standings fell this turn, derived from the deltas the turn
     * pipeline ALREADY computes — never a new AI call.
     */
    fellThisWeek?: ReadonlySet<keyof SimulationState>;
    pointers: readonly BriefingPointer[];
    /** Switches the panel's active tab, and clears that tab's pulse exactly as a direct press does. */
    onNavigate: (tab: TabId) => void;
}> = ({ simulationState, week, fellThisWeek, pointers, onNavigate }) => {
    const fell = (field: keyof SimulationState) => fellThisWeek?.has(field) ?? false;
    const anyFell = fellThisWeek ? fellThisWeek.size > 0 : false;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <header className="gor-briefing-head">
                <span className="gor-briefing-title">The week's briefing</span>
                <span className="gor-label" style={{ color: 'var(--gold-700)' }}>Week {toRoman(week)}</span>
            </header>

            {/* The single most urgent fact stops being the fifth row of a table. */}
            {simulationState.major_ongoing_crisis && (
                <Alert title="The crisis at hand">{simulationState.major_ongoing_crisis}</Alert>
            )}

            <div className="gor-macro-grid">
                <MacroCell label="The Throne" value={simulationState.imperial_status} severity={IMPERIAL_STATUS_SEVERITY[simulationState.imperial_status]} fell={fell('imperial_status')} />
                <MacroCell label="The Senate" value={simulationState.senate_status} severity={SENATE_STATUS_SEVERITY[simulationState.senate_status]} fell={fell('senate_status')} />
                <MacroCell label="The Legions" value={simulationState.military_status} severity={MILITARY_STATUS_SEVERITY[simulationState.military_status]} fell={fell('military_status')} />
                <MacroCell label="The Plebs" value={simulationState.plebeian_mood} severity={PLEBEIAN_MOOD_SEVERITY[simulationState.plebeian_mood]} fell={fell('plebeian_mood')} />
            </div>
            {anyFell && <p style={{ ...quiet, fontSize: 13, margin: 0 }}>▾ marks a standing that fell this week.</p>}

            <div>
                <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Where to look</h3>
                {pointers.length === 0 ? (
                    <EmptyRegister
                        line="Nothing waits on you."
                        hint="Every occurrence has been examined and every report read."
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
                        {pointers.map(pointer => (
                            <button
                                key={pointer.tab}
                                type="button"
                                className="gor-pointer"
                                onClick={() => onNavigate(pointer.tab)}
                            >
                                <span className="gor-pointer-body">
                                    <span className="gor-pointer-name">{pointer.name}</span>
                                    <span className="gor-pointer-line">{pointer.line}</span>
                                </span>
                                <span className="gor-pointer-indicator">{pointer.indicator}</span>
                                <span aria-hidden="true" className="gor-pointer-chevron">›</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorldStateTab;
