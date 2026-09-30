import React, { useState } from 'react';
import { GameState, Entity, InvestigationResult, InvestigationTruth, OccurrenceSiblingOutcome, OccurrenceTruth, WorldState, Report, EventHistoryEntry, SimulationState, TurnHistoryEntry } from '../types';
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
import WorldStateTab, { fellStandings } from './tabs/WorldStateTab';
import { TabId } from '../perception/visibility';
import { corroboration } from '../knowledge/credibilityFraming';
import { isRegionKnownToPlayer } from '../perception/visibility';
import type { BriefingPointer } from './tabs/WorldStateTab';
import type { KnowledgeClaim, OccurrenceQuestion } from '../knowledge/store';
import { occurrenceFindings } from '../knowledge/store';
import type { DomainMutationContext, RunDomainMutation } from '../state/domainMutation';
import { radioGroupKeyDown } from './ui/rovingRadio';
import { useImperialDispatch, type ImperialDispatchStatus } from '../hooks/useImperialDispatch';
import type { NarrationVoiceMode } from '../persistence/uiPrefs';
import { NARRATION_VOICE_COPY } from './Chat';

/** Shown under the Imperial Dispatch while the narration voice is SILENT (veto queue, B13). */
export const DISPATCH_SILENCED_NOTE = "Turn on the narrator's voice in Settings to hear this.";

/** The Imperial Dispatch control's constant name - its visible label. */
export const DISPATCH_BUTTON_LABEL = 'Hear Report';

/**
 * The line under the Imperial Dispatch, which describes its button. A
 * failure and a missing key say so in the words every other voice control
 * uses (Chat's NarrationVoiceControl) - they used to fall through to the
 * idle subtitle, so a failed reading ended in silence and a disabled button
 * gave no reason.
 */
export function dispatchNote(status: ImperialDispatchStatus): string {
    switch (status) {
        case 'silenced': return DISPATCH_SILENCED_NOTE;
        case 'unavailable': return NARRATION_VOICE_COPY.unavailable;
        case 'error': return NARRATION_VOICE_COPY.error;
        case 'preparing': return 'Drafting situation report…';
        case 'playing': return 'Reading all tabs aloud…';
        case 'idle': return 'High English tab report';
    }
}

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
export const sidePanelTabDomId = (id: TabId): string => `sidepanel-tab-${id}`;

/** The seven registers in rail order - the command palette and the 1-7 keys read the same list. */
export const SIDE_PANEL_TABS: readonly { id: TabId; label: string; fullLabel: string }[] = TABS;

/**
 * A pulsing tab's accessible name says how much is new when the count is
 * known ("Reports (2 new)"), and falls back to the older wording when it is
 * not (veto queue: roadmaps/BACKLOG.md, "Reading, motion and the command
 * palette").
 */
export function tabAriaLabel(fullLabel: string, pulsing: boolean, count: number | undefined): string {
    if (!pulsing) return fullLabel;
    return count ? `${fullLabel} (${count} new)` : `${fullLabel} (new intelligence)`;
}

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
    /** One atomic callback per commissioned assessment - the deep_analyses spend and the assessment itself (hooks/useIntelCommits.ts). `truth` is GM-private (D11/D47): forwarded for the truth ledger, never rendered. */
    onSpendDeepAnalysis: (targetId: string, cost: number, analysis: string, request: DomainMutationContext, truth?: InvestigationTruth) => boolean | void | Promise<boolean | void>;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout + truth ledger in a single state/save pass (see App.tsx's handleInvestigationOutcome). `truth` as above. */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult, request: DomainMutationContext, truth?: InvestigationTruth) => Promise<boolean | void>;
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
     * buildPlayerPerceivedDigest's output, never raw deltas. App passes only
     * the tabs not yet looked at since the week landed
     * (hooks/useSeenRegisters.ts); the panel draws exactly what it is given. */
    pulsingTabs: ReadonlySet<TabId>;
    /**
     * How many perceived changes landed on each pulsing tab last turn
     * (hooks/usePlayerPerception.ts's tabChangeCountsFor - built from the
     * same filtered digest as `pulsingTabs`, so it can say nothing the
     * digest did not). With it, a pulsing tab carries its count instead of a
     * bare dot; without it (or for a tab it has no count for) the dot stays.
     */
    tabChangeCounts?: ReadonlyMap<TabId, number>;
    /**
     * The open tab, when App holds it (hooks/useSeenRegisters.ts - the
     * command palette reads the same memory). Without it the panel keeps
     * its own.
     */
    activeTab?: TabId;
    /** Told whenever the player opens a tab (a click, the arrows, a briefing pointer, the palette). */
    onSelectTab?: (id: TabId) => void;
    /** The panel's own element, so App can tell whether it is on the screen (hooks/useSeenRegisters.ts). */
    panelRef?: React.Ref<HTMLElement>;
    /** Commits one occurrence finding to the knowledge store (audit item 40). `truth` is GM-private (D11/D47): forwarded for the truth ledger, never rendered. */
    onOccurrenceFinding: (occurrence: string, question: OccurrenceQuestion, text: string, request: DomainMutationContext, truth?: OccurrenceTruth) => boolean | void | Promise<boolean | void>;
    /** What the other grounded question on an occurrence came back with, off the truth ledger (hooks/useIntelCommits.ts) - handed to the Events tab's questions so the two agree on whether anyone acted (D47). */
    occurrenceSibling: (occurrence: string, question: OccurrenceQuestion) => OccurrenceSiblingOutcome | null;
    resolvedApiKey?: string | null;
    /** The narration voice's mode: SILENT disables the Imperial Dispatch control, with a pointer. */
    narrationVoiceMode?: NarrationVoiceMode;
    /** The voice row on each Personae card (hooks/usePersonaeVoice.ts). */
    personaeVoice?: PersonaeVoice;
}> = ({ gameState, playerEntity, entities, currentEvents, worldState, simulationState, reports, knowledge, turnNumber, onSpendDeepAnalysis, onInvestigationOutcome, runDomainMutation, interactionLocked = false, ai, isMockMode, eventHistory, turnHistory, pulsingTabs, tabChangeCounts, activeTab: heldTab, onSelectTab, panelRef, onOccurrenceFinding, occurrenceSibling, resolvedApiKey, narrationVoiceMode, personaeVoice }) => {
    const [ownTab, setOwnTab] = useState<TabId>('world_state');
    const activeTab = heldTab ?? ownTab;
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
    // Choose Your Destiny has nothing to brief yet: the panel steps aside and
    // the destinies take the width (it used to hold a third of the screen for
    // one waiting line, and pushed every card below the fold on a laptop).
    if (gameState === GameState.SETUP) return null;

    const handleTabClick = (id: TabId) => {
        setOwnTab(id);
        onSelectTab?.(id);
    };
    const dispatchEngaged = dispatchStatus === 'preparing' || dispatchStatus === 'playing';

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
        <aside ref={panelRef} data-screen-label="Side Panel" className="gor-panel">
            <style>{`
                @keyframes gorTabPulse {
                    0%, 100% { box-shadow: inset 0 0 0 rgba(158,126,27,0); }
                    50% { box-shadow: inset 0 0 0 2px rgba(201,162,39,.75); }
                }
                .gor-tab-pulse { animation: gorTabPulse 1.4s ease-in-out 3; }
                @media (prefers-reduced-motion: reduce) { .gor-tab-pulse { animation: none; } }
            `}</style>
            <PlayerStatus playerEntity={playerEntity} />
            {/* The Imperial Dispatch: a spoken briefing of every register.
                Presentation lives in design/shell.css (`gor-dispatch-*`).
                One toggle with a constant name, its visible label, as
                NarrationVoiceControl: pressed while the report is drafted
                or read (pressing again stops it), busy while drafted. */}
            <div className="gor-dispatch-bar">
                <span className="gor-dispatch-seal" aria-hidden="true">✉</span>
                <div className="gor-dispatch-text">
                    <span className="gor-dispatch-title">Imperial Dispatch</span>
                    <span id="imperial-dispatch-note" className="gor-dispatch-note">{dispatchNote(dispatchStatus)}</span>
                </div>
                <button
                    type="button"
                    className="gor-voice-btn gor-dispatch-btn"
                    aria-pressed={dispatchEngaged}
                    aria-busy={dispatchStatus === 'preparing' || undefined}
                    disabled={dispatchStatus === 'unavailable' || dispatchStatus === 'silenced'}
                    aria-describedby="imperial-dispatch-note"
                    title={dispatchEngaged ? NARRATION_VOICE_COPY.stop : undefined}
                    onClick={toggleDispatch}
                >
                    <span className="gor-voice-glyph" aria-hidden="true">
                        {dispatchStatus === 'preparing' ? <span className="gor-voice-spinner" /> : dispatchStatus === 'playing' ? '■' : '▶'}
                    </span>
                    {DISPATCH_BUTTON_LABEL}
                </button>
            </div>
            <div
                className="gor-panel-tabs"
                role="tablist"
                aria-label="Intelligence dashboard"
                onKeyDown={radioGroupKeyDown(TABS.map(tab => tab.id), activeTab, handleTabClick, { role: 'tab' })}
            >
                {TABS.map(tab => {
                    const shouldPulse = pulsingTabs.has(tab.id);
                    const count = shouldPulse ? tabChangeCounts?.get(tab.id) : undefined;
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
                            aria-label={tabAriaLabel(tab.fullLabel, shouldPulse, count)}
                        >
                            {/* The label carries the coin, so where the rail
                                stretches its tabs (a phone, a tablet) the coin
                                rides its word instead of floating between two
                                labels, or off the screen's edge (shell.css). */}
                            <span className="gor-tab-label">
                                {tab.label}
                                {shouldPulse && count
                                    ? <span aria-hidden="true" className="gor-tab-count">{count > 9 ? '9+' : count}</span>
                                    : null}
                            </span>
                            {shouldPulse && !count && <span aria-hidden="true" className="gor-tab-dot" />}
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
                    fellThisWeek={fellStandings(turnHistory[turnHistory.length - 1]?.preTurnSimulationState, simulationState)}
                    pointers={briefingPointers}
                    onNavigate={handleTabClick}
                />}
                {activeTab === 'events' && <CurrentEventsTab
                    events={currentEvents}
                    week={worldState.week}
                    playerEntity={playerEntity}
                    allEntities={entities}
                    turnHistory={turnHistory}
                    knowledge={knowledge}
                    ai={ai}
                    isMockMode={isMockMode}
                    onFinding={onOccurrenceFinding}
                    occurrenceSibling={occurrenceSibling}
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
