import React, { useState } from 'react';
import { GameState, Entity, InvestigationResult, WorldState, Report, EventHistoryEntry, SimulationState } from '../types';
import { GoogleGenAI } from "@google/genai";
import CurrentEventsTab from './tabs/CurrentEventsTab';
import DramatisPersonaeTab from './tabs/DramatisPersonaeTab';
import EmpireTab from './tabs/EmpireTab';
import ReportsTab from './tabs/ReportsTab';
import PlayerStatus from './PlayerStatus';
import ResourcesTab from './tabs/ResourcesTab';
import ChronicleTab from './tabs/ChronicleTab';
import WorldStateTab from './tabs/WorldStateTab';
import { TabId } from '../perception/visibility';
import type { KnowledgeClaim } from '../knowledge/store';

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
    onSpendDeepAnalysis: (cost: number) => void;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
    eventHistory: EventHistoryEntry[];
    /** Tabs whose underlying data was touched by a VISIBLE change in the
     * most recently committed turn (see perception/visibility.ts's
     * tabsForDelta and App.tsx's pulsingTabs). Gets a brief CSS pulse so the
     * player notices where to look, without leaking anything the perception
     * filter didn't already let through - this set is built strictly from
     * buildPerceivedDigest's output, never raw deltas. */
    pulsingTabs: Set<TabId>;
}> = ({ gameState, playerEntity, entities, currentEvents, worldState, simulationState, reports, knowledge, turnNumber, onSpendDeepAnalysis, onInvestigationOutcome, ai, isMockMode, eventHistory, pulsingTabs }) => {
    const [activeTab, setActiveTab] = useState<TabId>('world_state');
    // Tabs the player has already looked at since the current pulsingTabs
    // set arrived - clicking a pulsing tab dismisses its own pulse
    // immediately rather than waiting for the next turn to clear it.
    const pulseKey = [...pulsingTabs].sort().join('|');
    const [dismissal, setDismissal] = useState<{ pulseKey: string; tabs: Set<TabId> }>({ pulseKey, tabs: new Set() });
    const dismissed = dismissal.pulseKey === pulseKey ? dismissal.tabs : new Set<TabId>();

    if (gameState === GameState.SETUP) {
        return (
            <aside data-screen-label="Side Panel" style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,254,249,.45)', padding: 16 }}>
                <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', textAlign: 'center' }}>Awaiting the choice of a destiny…</p>
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

    return (
        <aside data-screen-label="Side Panel" style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', display: 'flex', flexDirection: 'column', background: 'rgba(255,254,249,.45)' }}>
            <style>{`
                @keyframes gorTabPulse {
                    0%, 100% { box-shadow: inset 0 0 0 rgba(158,126,27,0); }
                    50% { box-shadow: inset 0 0 0 2px rgba(201,162,39,.75); }
                }
                .gor-tab-pulse { animation: gorTabPulse 1.4s ease-in-out 3; }
                @media (prefers-reduced-motion: reduce) { .gor-tab-pulse { animation: none; } }
            `}</style>
            <PlayerStatus playerEntity={playerEntity} />
            <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }} role="tablist" aria-label="Intelligence dashboard">
                {TABS.map(tab => {
                    const shouldPulse = pulsingTabs.has(tab.id) && !dismissed.has(tab.id);
                    return (
                        <button
                            key={tab.id}
                            className={`gor-tab ${shouldPulse ? 'gor-tab-pulse' : ''}`}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => handleTabClick(tab.id)}
                            aria-label={shouldPulse ? `${tab.fullLabel} (new intelligence)` : tab.fullLabel}
                            style={{ padding: '9px 7px', fontSize: 11, flex: '1 0 auto', textAlign: 'center', position: 'relative' }}
                        >
                            {tab.label}
                            {shouldPulse && <span aria-hidden="true" style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #E8C959, #9E7E1B 70%)', boxShadow: '0 0 4px rgba(232,201,89,.8)' }} />}
                        </button>
                    );
                })}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {activeTab === 'world_state' && <WorldStateTab simulationState={simulationState} worldState={worldState} entities={entities} playerEntity={playerEntity} currentEvents={currentEvents} />}
                {activeTab === 'events' && <CurrentEventsTab events={currentEvents} playerEntity={playerEntity} allEntities={entities} ai={ai} isMockMode={isMockMode} />}
                {activeTab === 'reports' && <ReportsTab reports={reports} />}
                {activeTab === 'chronicle' && <ChronicleTab eventHistory={eventHistory} />}
                {activeTab === 'dramatis_personae' && <DramatisPersonaeTab
                    playerEntity={playerEntity}
                    entities={entities}
                    knowledge={knowledge}
                    turnNumber={turnNumber}
                    onSpendDeepAnalysis={onSpendDeepAnalysis}
                    onInvestigationOutcome={onInvestigationOutcome}
                    interactionLocked={gameState === GameState.PROCESSING}
                    ai={ai}
                    isMockMode={isMockMode}
                />}
                {activeTab === 'locations' && <EmpireTab worldState={worldState} entities={entities} playerEntity={playerEntity} />}
                {activeTab === 'resources' && <ResourcesTab playerEntity={playerEntity} />}
            </div>
        </aside>
    );
};

export default SidePanel;
