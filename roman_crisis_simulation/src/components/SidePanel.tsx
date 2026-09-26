import React, { useState } from 'react';
import { GameState, Entity, InvestigationResult, WorldState, Report, EventHistoryEntry, SimulationState, TurnHistoryEntry } from '../types';
import { GoogleGenAI } from "@google/genai";
import CurrentEventsTab from './tabs/CurrentEventsTab';
import DramatisPersonaeTab from './tabs/DramatisPersonaeTab';
import type { PersonaeVoice } from '../hooks/usePersonaeVoice';
import EmpireTab from './tabs/EmpireTab';
import ReportsTab from './tabs/ReportsTab';
import PlayerStatus from './PlayerStatus';
import ResourcesTab from './tabs/ResourcesTab';
import ChronicleTab from './tabs/ChronicleTab';
import { CoinPips } from './tabs/dramatisPersonaeUi';
import WorldStateTab from './tabs/WorldStateTab';
import { TabId } from '../perception/visibility';
import { corroboration } from '../knowledge/credibilityFraming';
import { isRegionKnownToPlayer } from '../perception/visibility';
import type { BriefingPointer } from './tabs/WorldStateTab';
import type { KnowledgeClaim, OccurrenceQuestion } from '../knowledge/store';
import { occurrenceFindings } from '../knowledge/store';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import { radioGroupKeyDown } from './ui/rovingRadio';
import { useImperialDispatch } from '../hooks/useImperialDispatch';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';

/** Shown under the Imperial Dispatch while the narration voice is SILENT (veto queue, B13). */
export const DISPATCH_SILENCED_NOTE = "Turn on the narrator's voice in Settings to hear this.";

/**
 * The intelligence dashboard — player dossier header, Tyrian-pennant tab bar,
 * and the seven tabs of what is known (and what can be bought).
 * `data-screen-label="Side Panel"` is load-bearing: nocturne.css re-washes this
 * surface by attribute selector.
 */

const TABS: { id: TabId; label: string; fullLabel: string }[] = [
    { id: 'world_state', label: 'World', fullLabel: 'World State' },
    { id: 'events', label: 'Events', fullLabel: 'Events' },
    { id: 'reports', label: 'Reports', fullLabel: 'Reports' },
    { id: 'chronicle', label: 'Chronicle', fullLabel: 'Chronicle' },
    { id: 'dramatis_personae', label: 'Personae', fullLabel: 'Dramatis Personae' },
    { id: 'locations', label: 'Empire', fullLabel: 'Empire' },
    { id: 'resources', label: 'Assets', fullLabel: 'Assets' },
];

/**
 * The tablist contract (spec: 2026-08-05-b7a-hardening-and-tablist-design.md
 * work item 2): one stable id per tab, one panel per bar whose content
 * swaps, `aria-controls`/`aria-labelledby` tying the two together.
 */
const SIDEPANEL_TABPANEL_ID = 'sidepanel-tabpanel';
const sidePanelTabDomId = (id: TabId): string => `sidepanel-tab-${id}`;

const SidePanel: React.FC<{
    gameState: GameState;
    playerEntity: Entity | null;
    entities: Entity[];
    currentEvents: string[];
    worldState: WorldState;
    simulationState: SimulationState;
    reports: Report[];
    /** The player knowledge store - the D14/D27 dossier read model over it prices held-dossier refreshes in DramatisPersonaeTab. */
    knowledge: KnowledgeClaim[];
    /** The App's authoritative turn counter - the staleness clock D27 prices a dossier refresh against. */
    turnNumber: number;
    onSpendDeepAnalysis: (cost: number, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult, request: DomainMutationContext) => Promise<boolean | void>;
    runDomainMutation: RunDomainMutation;
    interactionLocked?: boolean;
    ai: GoogleGenAI;
    isMockMode: boolean;
    eventHistory: EventHistoryEntry[];
    /** Every week the player has played - the Chronicle's Reign register is built from it (audit item 37). */
    turnHistory: TurnHistoryEntry[];
    /** Tabs whose underlying data was touched by a VISIBLE change in the
     * most recently committed turn (see perception/visibility.ts's
     * tabsForDelta and App.tsx's pulsingTabs). Gets a brief CSS pulse so the
     * player notices where to look, without leaking anything the perception
     * filter didn't already let through - this set is built strictly from
     * buildPlayerPerceivedDigest's output, never raw deltas. */
    pulsingTabs: Set<TabId>;
    /** Commits one occurrence finding to the knowledge store (audit item 40). */
    onOccurrenceFinding: (occurrence: string, question: OccurrenceQuestion, text: string, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
    resolvedApiKey?: string | null;
    /** The narration voice's mode: SILENT disables the Imperial Dispatch control, with a pointer. */
    narrationVoiceMode?: NarrationVoiceMode;
    /** The voice row on each Personae card (hooks/usePersonaeVoice.ts). */
    personaeVoice?: PersonaeVoice;
}> = ({ gameState, playerEntity, entities, currentEvents, worldState, simulationState, reports, knowledge, turnNumber, onSpendDeepAnalysis, onInvestigationOutcome, runDomainMutation, interactionLocked = false, ai, isMockMode, eventHistory, turnHistory, pulsingTabs, onOccurrenceFinding, resolvedApiKey, narrationVoiceMode, personaeVoice }) => {
    const [activeTab, setActiveTab] = useState<TabId>('world_state');
    const { dispatchStatus, toggleDispatch } = useImperialDispatch({
        ai,
        isMockMode,
        resolvedApiKey,
        narrationVoiceMode,
        worldState,
        simulationState,
        entities,
        reports,
        knowledge,
        currentEvents,
        playerEntity,
        turnNumber,
    });
    // Tabs the player has already looked at since the current pulsingTabs
    // set arrived - clicking a pulsing tab dismisses its own pulse
    // immediately rather than waiting for the next turn to clear it.
    const pulseKey = [...pulsingTabs].sort().join('|');
    const [dismissal, setDismissal] = useState<{ pulseKey: string; tabs: Set<TabId> }>({ pulseKey, tabs: new Set() });
    const dismissed = dismissal.pulseKey === pulseKey ? dismissal.tabs : new Set<TabId>();

    if (gameState === GameState.SETUP) {
        return (
            <aside data-screen-label="Side Panel" className="gor-panel gor-panel-waiting">
                <span aria-hidden="true" className="gor-panel-waiting-mark">❦</span>
                <p className="gor-panel-waiting-line">Awaiting the choice of a destiny…</p>
            </aside>
        );
    }

    const handleTabClick = (id: TabId) => {
        setActiveTab(id);
        setDismissal(previous => ({
            pulseKey,
            tabs: new Set(previous.pulseKey === pulseKey ? previous.tabs : []).add(id),
        }));
    };

    /**
     * "Where to look" (WP-15): one row per tab that has something waiting,
     * built here because this is where the panel already knows every tab's
     * state. Indicators reuse the panel's existing vocabulary rather than
     * inventing a second one - the same gold pulse dot the tab bar uses, the
     * corroboration verdict Reports derives, a known/total count for Empire,
     * coin pips for unspent investigations.
     */
    const unexamined = currentEvents.filter(occurrence => occurrenceFindings(knowledge, occurrence).length === 0).length;
    // One pass to group by subject: this runs on every App render (each
    // streamed narration chunk included), and the old per-report re-filter
    // was quadratic in the report log.
    const reportsBySubject = new Map<string, Report[]>();
    for (const report of reports) {
        const group = reportsBySubject.get(report.about);
        if (group) group.push(report);
        else reportsBySubject.set(report.about, [report]);
    }
    const conflictedSubjects = [...reportsBySubject.values()]
        .filter(group => corroboration(group).verdict === 'conflict').length;
    const knownRegions = playerEntity
        ? Object.keys(worldState.regions).filter(name => isRegionKnownToPlayer(name, playerEntity, entities)).length
        : 0;
    const totalRegions = Object.keys(worldState.regions).length;
    const investigations = playerEntity ? Number(playerEntity.resources?.investigations ?? 0) : 0;

    const briefingPointers: BriefingPointer[] = [];
    if (currentEvents.length > 0) {
        briefingPointers.push({
            tab: 'events',
            name: 'Events',
            line: unexamined > 0
                ? `${currentEvents.length} occurrence${currentEvents.length === 1 ? '' : 's'} this week, ${unexamined} not yet examined.`
                : `${currentEvents.length} occurrence${currentEvents.length === 1 ? '' : 's'} this week, all examined.`,
            indicator: unexamined > 0
                ? <span aria-hidden="true" className="gor-pointer-pulse" />
                : undefined,
        });
    }
    if (conflictedSubjects > 0) {
        briefingPointers.push({
            tab: 'reports',
            name: 'Reports',
            line: `Accounts of ${conflictedSubjects} subject${conflictedSubjects === 1 ? '' : 's'} do not agree.`,
            indicator: <span className="gor-verdict gor-verdict-conflict">⚠ Conflict</span>,
        });
    }
    if (totalRegions > 0 && knownRegions < totalRegions) {
        briefingPointers.push({
            tab: 'locations',
            name: 'Empire',
            line: 'Places you have no eyes on.',
            indicator: <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-quiet)' }}>{knownRegions} / {totalRegions}</span>,
        });
    }
    if (investigations > 0) {
        briefingPointers.push({
            tab: 'dramatis_personae',
            name: 'Personae',
            line: `${investigations} investigation${investigations === 1 ? '' : 's'} unspent.`,
            indicator: <CoinPips spend={Math.min(investigations, 4)} balance={investigations} />,
        });
    }

    return (
        <aside data-screen-label="Side Panel" className="gor-panel">
            <style>{`
                @keyframes gorTabPulse {
                    0%, 100% { box-shadow: inset 0 0 0 rgba(158,126,27,0); }
                    50% { box-shadow: inset 0 0 0 2px rgba(201,162,39,.75); }
                }
                .gor-tab-pulse { animation: gorTabPulse 1.4s ease-in-out 3; }
                @media (prefers-reduced-motion: reduce) { .gor-tab-pulse { animation: none; } }
            `}</style>
            <PlayerStatus playerEntity={playerEntity} />
            <div className="gor-dispatch-bar" style={{
                margin: '8px 12px 6px 12px',
                padding: '6px 10px',
                background: 'var(--surface-hover, rgba(201,162,39,.06))',
                border: '1px solid var(--border-subtle, rgba(201,162,39,.2))',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--gold-500)' }}>
                        📜 Imperial Dispatch
                    </span>
                    <span id="imperial-dispatch-note" style={{ fontSize: '11px', color: 'var(--text-quiet)', fontStyle: 'italic' }}>
                        {dispatchStatus === 'silenced'
                            ? DISPATCH_SILENCED_NOTE
                            : dispatchStatus === 'preparing'
                            ? 'Drafting situation report…'
                            : dispatchStatus === 'playing'
                                ? 'Reading all tabs aloud…'
                                : 'High English tab report'}
                    </span>
                </div>
                <button
                    type="button"
                    className="gor-voice-btn"
                    aria-label={dispatchStatus === 'playing' ? 'Stop Imperial Dispatch' : 'Hear Imperial Dispatch'}
                    disabled={dispatchStatus === 'unavailable' || dispatchStatus === 'silenced'}
                    aria-describedby="imperial-dispatch-note"
                    onClick={toggleDispatch}
                    style={{ fontSize: '11px', padding: '3px 8px', height: '24px' }}
                >
                    <span className="gor-voice-glyph" aria-hidden="true">
                        {dispatchStatus === 'preparing' ? <span className="gor-voice-spinner" /> : dispatchStatus === 'playing' ? '■' : '▶'}
                    </span>
                    {dispatchStatus === 'playing' ? 'Stop' : 'Hear Report'}
                </button>
            </div>
            <div
                className="gor-panel-tabs"
                role="tablist"
                aria-label="Intelligence dashboard"
                onKeyDown={radioGroupKeyDown(TABS.map(tab => tab.id), activeTab, handleTabClick, { role: 'tab' })}
            >
                {TABS.map(tab => {
                    const shouldPulse = pulsingTabs.has(tab.id) && !dismissed.has(tab.id);
                    return (
                        <button
                            key={tab.id}
                            id={sidePanelTabDomId(tab.id)}
                            className={`gor-tab ${shouldPulse ? 'gor-tab-pulse' : ''}`}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls={SIDEPANEL_TABPANEL_ID}
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => handleTabClick(tab.id)}
                            aria-label={shouldPulse ? `${tab.fullLabel} (new intelligence)` : tab.fullLabel}
                        >
                            {tab.label}
                            {shouldPulse && <span aria-hidden="true" className="gor-tab-dot" />}
                        </button>
                    );
                })}
            </div>
            <div
                role="tabpanel"
                id={SIDEPANEL_TABPANEL_ID}
                aria-labelledby={sidePanelTabDomId(activeTab)}
                className="gor-panel-body"
            >
                {activeTab === 'world_state' && <WorldStateTab
                    simulationState={simulationState}
                    week={worldState.week}
                    pointers={briefingPointers}
                    onNavigate={handleTabClick}
                />}
                {activeTab === 'events' && <CurrentEventsTab
                    events={currentEvents}
                    week={worldState.week}
                    playerEntity={playerEntity}
                    allEntities={entities}
                    knowledge={knowledge}
                    ai={ai}
                    isMockMode={isMockMode}
                    onFinding={onOccurrenceFinding}
                    runDomainMutation={runDomainMutation}
                    interactionLocked={interactionLocked}
                />}
                {activeTab === 'reports' && <ReportsTab reports={reports} knowledge={knowledge} />}
                {activeTab === 'chronicle' && <ChronicleTab eventHistory={eventHistory} turnHistory={turnHistory} reignEnded={gameState === GameState.GAME_OVER} />}
                {activeTab === 'dramatis_personae' && <DramatisPersonaeTab
                    playerEntity={playerEntity}
                    entities={entities}
                    knowledge={knowledge}
                    turnNumber={turnNumber}
                    onSpendDeepAnalysis={onSpendDeepAnalysis}
                    onInvestigationOutcome={onInvestigationOutcome}
                    runDomainMutation={runDomainMutation}
                    interactionLocked={interactionLocked}
                    ai={ai}
                    isMockMode={isMockMode}
                    personaeVoice={personaeVoice}
                />}
                {activeTab === 'locations' && <EmpireTab worldState={worldState} entities={entities} playerEntity={playerEntity} knowledge={knowledge} />}
                {activeTab === 'resources' && <ResourcesTab playerEntity={playerEntity} />}
            </div>
        </aside>
    );
};

export default SidePanel;
