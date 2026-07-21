import React, { useState, useEffect } from 'react';
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

const TABS: { id: TabId; label: string }[] = [
    { id: 'world_state', label: 'World State' },
    { id: 'events', label: 'Events' },
    { id: 'reports', label: 'Reports' },
    { id: 'chronicle', label: 'Chronicle' },
    { id: 'dramatis_personae', label: 'Dramatis Personae' },
    { id: 'locations', label: 'Empire' },
    { id: 'resources', label: 'Assets' },
];

const SidePanel: React.FC<{
    gameState: GameState;
    playerEntity: Entity | null;
    entities: Entity[];
    currentEvents: string[];
    worldState: WorldState;
    simulationState: SimulationState;
    reports: Report[];
    onSpendInvestigation: (cost: number) => void;
    onSpendDeepAnalysis: (cost: number) => void;
    onNewInvestigationResult: (result: InvestigationResult) => void;
    onAddSecretAsResource: (targetId: string, secrets: string[]) => void;
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
}> = ({ gameState, playerEntity, entities, currentEvents, worldState, simulationState, reports, onSpendInvestigation, onSpendDeepAnalysis, onNewInvestigationResult, onAddSecretAsResource, ai, isMockMode, eventHistory, pulsingTabs }) => {
    const [activeTab, setActiveTab] = useState<TabId>('world_state');
    // Tabs the player has already looked at since the current pulsingTabs
    // set arrived - clicking a pulsing tab dismisses its own pulse
    // immediately rather than waiting for the next turn to clear it.
    const [dismissed, setDismissed] = useState<Set<TabId>>(new Set());

    useEffect(() => {
        setDismissed(new Set());
    }, [pulsingTabs]);

    if (gameState === GameState.SETUP) {
        return <div className="w-1/3 bg-[#e8e6e1]/70 backdrop-blur-sm border-l-4 border-double border-[#c9c5b8] flex items-center justify-center p-4"><p className="text-stone-600">Awaiting Character Selection...</p></div>;
    }

    const handleTabClick = (id: TabId) => {
        setActiveTab(id);
        setDismissed(prev => new Set(prev).add(id));
    };

    return (
        <div className="w-1/3 bg-[#e8e6e1]/70 backdrop-blur-sm border-l-4 border-double border-[#c9c5b8] flex flex-col">
            <style>{`
                @keyframes sidePanelTabPulse {
                    0%, 100% { box-shadow: 0 0 0 rgba(153, 27, 27, 0); }
                    50% { box-shadow: 0 0 0 3px rgba(153, 27, 27, 0.45); }
                }
                .tab-pulse {
                    animation: sidePanelTabPulse 1.4s ease-in-out 3;
                }
            `}</style>
            <PlayerStatus playerEntity={playerEntity} />
            <div className="flex border-b-4 border-double border-[#c9c5b8] flex-wrap">
                {TABS.map(tab => {
                    const shouldPulse = pulsingTabs.has(tab.id) && !dismissed.has(tab.id);
                    return (
                        <button
                            key={tab.id}
                            onClick={() => handleTabClick(tab.id)}
                            className={`flex-1 p-3 text-sm font-bold uppercase tracking-wider border-b-4 transition-colors relative ${activeTab === tab.id ? 'bg-transparent text-red-900 border-red-900' : 'bg-transparent text-stone-600 hover:bg-[#d8d5ce] border-transparent'} ${shouldPulse ? 'tab-pulse' : ''}`}
                            aria-label={shouldPulse ? `${tab.label} (new intelligence)` : tab.label}
                        >
                            {tab.label}
                            {shouldPulse && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-700" aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
            <div className="flex-grow overflow-y-auto">
                {activeTab === 'world_state' && <WorldStateTab simulationState={simulationState} worldState={worldState} entities={entities} playerEntity={playerEntity} currentEvents={currentEvents} />}
                {activeTab === 'events' && <CurrentEventsTab events={currentEvents} playerEntity={playerEntity} allEntities={entities} ai={ai} isMockMode={isMockMode} />}
                {activeTab === 'reports' && <ReportsTab reports={reports} />}
                {activeTab === 'chronicle' && <ChronicleTab eventHistory={eventHistory} />}
                {activeTab === 'dramatis_personae' && <DramatisPersonaeTab
                    playerEntity={playerEntity}
                    entities={entities}
                    onSpendInvestigation={onSpendInvestigation}
                    onSpendDeepAnalysis={onSpendDeepAnalysis}
                    onNewInvestigationResult={onNewInvestigationResult}
                    onAddSecretAsResource={onAddSecretAsResource}
                    ai={ai}
                    isMockMode={isMockMode}
                />}
                {activeTab === 'locations' && <EmpireTab worldState={worldState} entities={entities} />}
                {activeTab === 'resources' && <ResourcesTab playerEntity={playerEntity} />}
            </div>
        </div>
    );
};

export default SidePanel;