import React, { useState } from 'react';
import { GameState, Entity, InvestigationResult, WorldState, Report, EventHistoryEntry } from '../types';
import { GoogleGenAI } from "@google/genai";
import CurrentEventsTab from './tabs/CurrentEventsTab';
import DramatisPersonaeTab from './tabs/DramatisPersonaeTab';
import EmpireTab from './tabs/EmpireTab';
import ReportsTab from './tabs/ReportsTab';
import PlayerStatus from './PlayerStatus';
import ResourcesTab from './tabs/ResourcesTab';
import ChronicleTab from './tabs/ChronicleTab';

const SidePanel: React.FC<{
    gameState: GameState;
    playerEntity: Entity | null;
    entities: Entity[];
    currentEvents: string[];
    worldState: WorldState;
    reports: Report[];
    onSpendInvestigation: (cost: number) => void;
    onNewInvestigationResult: (result: InvestigationResult) => void;
    onAddSecretAsResource: (targetId: string, secrets: string[]) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
    eventHistory: EventHistoryEntry[];
}> = ({ gameState, playerEntity, entities, currentEvents, worldState, reports, onSpendInvestigation, onNewInvestigationResult, onAddSecretAsResource, ai, isMockMode, eventHistory }) => {
    const [activeTab, setActiveTab] = useState('events');

    if (gameState === GameState.SETUP) {
        return <div className="w-1/3 bg-[#e8e6e1]/70 backdrop-blur-sm border-l-4 border-double border-[#c9c5b8] flex items-center justify-center p-4"><p className="text-stone-600">Awaiting Character Selection...</p></div>;
    }

    const tabs = [
        { id: 'events', label: 'Events' },
        { id: 'reports', label: 'Reports' },
        { id: 'chronicle', label: 'Chronicle' },
        { id: 'dramatis_personae', label: 'Dramatis Personae' },
        { id: 'locations', label: 'Empire' },
        { id: 'resources', label: 'Assets' },
    ];

    return (
        <div className="w-1/3 bg-[#e8e6e1]/70 backdrop-blur-sm border-l-4 border-double border-[#c9c5b8] flex flex-col">
            <PlayerStatus playerEntity={playerEntity} />
            <div className="flex border-b-4 border-double border-[#c9c5b8] flex-wrap">
                {tabs.map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)} 
                        className={`flex-1 p-3 text-sm font-bold uppercase tracking-wider border-b-4 transition-colors ${activeTab === tab.id ? 'bg-transparent text-red-900 border-red-900' : 'bg-transparent text-stone-600 hover:bg-[#d8d5ce] border-transparent'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="flex-grow overflow-y-auto">
                {activeTab === 'events' && <CurrentEventsTab events={currentEvents} playerEntity={playerEntity} allEntities={entities} ai={ai} isMockMode={isMockMode} />}
                {activeTab === 'reports' && <ReportsTab reports={reports} />}
                {activeTab === 'chronicle' && <ChronicleTab eventHistory={eventHistory} />}
                {activeTab === 'dramatis_personae' && <DramatisPersonaeTab 
                    playerEntity={playerEntity} 
                    entities={entities} 
                    onSpendInvestigation={onSpendInvestigation} 
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