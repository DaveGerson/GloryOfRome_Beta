import React, { useState } from 'react';
import { TurnHistoryEntry, Adjudication, Entity, Relationship, Memory, Scheme, RawCallRecord } from '../types';

const TabButton: React.FC<{ label: string; active: boolean; onClick: () => void; }> = ({ label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-bold transition-colors duration-200 ${
            active
                ? 'bg-stone-700 text-red-400 border-b-2 border-red-400'
                : 'text-stone-400 hover:bg-stone-700 hover:text-white'
        }`}
    >
        {label}
    </button>
);

const SummaryView: React.FC<{ entry: TurnHistoryEntry }> = ({ entry }) => (
    <>
        <div className="mb-4">
             <h4 className="font-bold text-stone-300 mb-2 underline">Player Intent</h4>
             <p className="text-sm bg-stone-700 p-2 rounded text-stone-300">"{entry.playerIntent}"</p>
        </div>
        <div>
             <h4 className="font-bold text-stone-300 mb-2 underline">Generated Narration</h4>
             <p className="text-sm bg-stone-900 p-2 rounded text-stone-300 italic">{entry.narration || "No narration generated."}</p>
        </div>
    </>
);

const ActionsView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <div className="space-y-2">
        {adjudication.entityActions.length > 0 ? (
            adjudication.entityActions.map((action, index) => (
                <div key={index} className="bg-stone-900 p-2 rounded text-sm">
                    <p><span className="font-bold text-red-400">{action.id}</span></p>
                    <p className="ml-2"><strong>Intent:</strong> {action.intent}</p>
                    {action.target && <p className="ml-2"><strong>Target:</strong> {action.target}</p>}
                    <p className="ml-2 italic"><strong>Notes:</strong> "{action.notes}"</p>
                </div>
            ))
        ) : (
            <p className="text-stone-400">No specific entity actions were recorded.</p>
        )}
    </div>
);

const DeltasView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
     <div className="space-y-2">
        {adjudication.deltas.length > 0 ? (
            adjudication.deltas.map((delta, index) => (
                <div key={index} className="bg-stone-900 p-2 rounded text-sm">
                    <p><span className="font-bold text-red-400 capitalize">{delta.type}</span></p>
                    <p className="ml-2"><strong>Key:</strong> {delta.key}</p>
                    <p className="ml-2"><strong>Delta:</strong> {delta.delta}</p>
                    <p className="ml-2 italic"><strong>Reason:</strong> "{delta.reason}"</p>
                </div>
            ))
        ) : (
            <p className="text-stone-400">No state deltas were recorded.</p>
        )}
    </div>
);

const PrivateView: React.FC<{ adjudication: Adjudication }> = ({ adjudication }) => (
    <div className="space-y-2">
        {adjudication.gm_private.length > 0 ? (
            adjudication.gm_private.map((note, index) => (
                <p key={index} className="bg-stone-900 p-2 rounded text-sm italic">"{note}"</p>
            ))
        ) : (
            <p className="text-stone-400">No private GM notes for this turn.</p>
        )}
    </div>
);

const SchemeDisplay: React.FC<{ scheme: Scheme }> = ({ scheme }) => (
    <div className="mt-2 text-xs bg-stone-800 p-2 rounded">
        <p><strong className="text-stone-300">Active Scheme:</strong> <span className="italic text-yellow-300">"{scheme.name}"</span></p>
        <p className="text-stone-400 mt-1"><strong>Goal:</strong> {scheme.overall_goal}</p>
        <ul className="list-disc list-inside ml-2 mt-1 text-stone-300">
            {scheme.steps.map((step, i) => (
                <li key={i}><span className="capitalize">{step.status}:</span> {step.objective}</li>
            ))}
        </ul>
    </div>
);

const EntityStatesView: React.FC<{ entities: Entity[] }> = ({ entities }) => (
    <div className="space-y-3">
        {entities.map(entity => (
            <div key={entity.entity_id} className="bg-stone-900 p-3 rounded text-sm">
                <h5 className="font-bold text-red-400">{entity.name} <span className="text-stone-400 font-normal">- {entity.position || entity.entity_type}</span></h5>
                
                {entity.active_scheme && <SchemeDisplay scheme={entity.active_scheme} />}

                <div className="grid grid-cols-2 gap-x-4 text-xs mt-2">
                    <div>
                        <p><strong className="text-stone-300">Status:</strong> {entity.status}</p>
                        <p><strong className="text-stone-300">Location:</strong> {entity.location}</p>
                    </div>
                    <div>
                        <p><strong className="text-stone-300">Resources:</strong></p>
                        <ul className="list-disc list-inside ml-2">
                            {Object.entries(entity.resources).map(([key, value]) => (
                                <li key={key}>{key.replace(/_/g, ' ')}: {value}</li>
                            ))}
                        </ul>
                    </div>
                </div>
                
                {entity.personality && entity.skills && (
                    <div className="mt-2 text-xs border-t border-stone-700 pt-2">
                        <p><strong className="text-stone-300">Personality & Skills:</strong></p>
                        <div className="grid grid-cols-2 gap-x-4">
                            <ul className="list-disc list-inside ml-2">
                                {Object.entries(entity.personality).map(([key, value]) => (
                                    <li key={key}>{key.charAt(0).toUpperCase() + key.slice(1)}: {value}</li>
                                ))}
                            </ul>
                            <ul className="list-disc list-inside ml-2">
                                {Object.entries(entity.skills).map(([key, value]) => (
                                    <li key={key}>{key.charAt(0).toUpperCase() + key.slice(1)}: {value}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
                
                {(entity.beliefs && entity.beliefs.length > 0) || (entity.secrets && entity.secrets.length > 0) ? (
                     <div className="mt-2 text-xs border-t border-stone-700 pt-2">
                        {entity.beliefs && entity.beliefs.length > 0 && (
                            <div>
                                <p><strong className="text-stone-300">Beliefs:</strong></p>
                                <ul className="list-disc list-inside ml-2">
                                    {entity.beliefs.map((belief, i) => <li key={i}>{belief}</li>)}
                                </ul>
                            </div>
                        )}
                         {entity.secrets && entity.secrets.length > 0 && (
                            <div className="mt-1">
                                <p><strong className="text-stone-300">Secrets:</strong></p>
                                 <ul className="list-disc list-inside ml-2">
                                    {entity.secrets.map((secret, i) => <li key={i}>{secret}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : null}

                {entity.memories && entity.memories.length > 0 && (
                    <div className="mt-2 text-xs border-t border-stone-700 pt-2">
                        <p><strong className="text-stone-300">Recent Memories:</strong></p>
                        <ul className="list-disc list-inside ml-2">
                            {entity.memories.slice(-3).reverse().map((memory: Memory, i: number) => (
                                <li key={i}>Turn {memory.turn}: {memory.event_description}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="mt-2 text-xs border-t border-stone-700 pt-2">
                     <p><strong className="text-stone-300">Relationships:</strong></p>
                     <ul className="list-disc list-inside ml-2">
                        {Object.entries(entity.relationships).filter(([, rel]) => rel).map(([targetId, rel]: [string, Relationship]) => {
                             const targetName = entities.find(e => e.entity_id === targetId)?.name || targetId;
                             const relDetails = `T: ${rel.trust_level}, Th: ${rel.perceived_threat ?? 0}, A: ${rel.ideological_alignment ?? 0}, D: ${rel.dependency_level ?? 0}`;
                             return <li key={targetId}>{targetName}: {relDetails}</li>
                        })}
                     </ul>
                </div>
            </div>
        ))}
    </div>
);

const RawCallsView: React.FC<{ rawCalls?: RawCallRecord[] }> = ({ rawCalls }) => (
    <div className="space-y-2">
        {rawCalls && rawCalls.length > 0 ? (
            rawCalls.map((call, index) => (
                <details key={index} className="bg-stone-900 p-2 rounded text-xs">
                    <summary className="cursor-pointer font-bold text-red-400">
                        {call.callName} <span className="text-stone-400 font-normal">- {call.model} - {call.latencyMs}ms - {call.attempts} attempt(s) - {call.validated ? 'validated' : 'NOT validated'}</span>
                    </summary>
                    <p className="text-stone-400 mt-1">Prompt chars: {call.promptChars}</p>
                    <pre className="mt-1 whitespace-pre-wrap break-words">{call.rawResponse}</pre>
                </details>
            ))
        ) : (
            <p className="text-stone-400">No raw calls captured for this turn.</p>
        )}
    </div>
);

const RawJsonView: React.FC<{ adjudication: Adjudication; rawCalls?: RawCallRecord[] }> = ({ adjudication, rawCalls }) => (
    <div className="space-y-4">
        <div>
            <h4 className="font-bold text-stone-300 mb-2 underline">Raw AI Calls (prompt/response capture)</h4>
            <RawCallsView rawCalls={rawCalls} />
        </div>
        <div>
            <h4 className="font-bold text-stone-300 mb-2 underline">Parsed Adjudication</h4>
            <div className="text-xs space-y-2 bg-stone-900 p-3 rounded overflow-x-auto">
                <pre>{JSON.stringify(adjudication, null, 2)}</pre>
            </div>
        </div>
    </div>
);

const GameMasterScreen: React.FC<{
    history: TurnHistoryEntry[];
    onClose: () => void;
    interventionText: string;
    onSetIntervention: (text: string) => void;
}> = ({ history, onClose, interventionText, onSetIntervention }) => {
    const [activeTab, setActiveTab] = useState('summary');
    const [interventionInput, setInterventionInput] = useState(interventionText);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const handleSetIntervention = () => {
        onSetIntervention(interventionInput);
        setShowConfirmation(true);
        setTimeout(() => setShowConfirmation(false), 3000);
    };

    const tabs = ['summary', 'entity states', 'actions', 'deltas', 'private', 'raw json'];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 animate-fade-in">
            <div className="gm-panel-bg text-stone-100 font-mono w-4/5 h-4/5 rounded-lg shadow-xl flex flex-col p-4">
                <div className="flex justify-between items-center border-b border-stone-600 pb-2 mb-4 flex-shrink-0">
                    <h2 className="text-2xl font-decorative text-red-400">Game Master Tools</h2>
                    <button onClick={onClose} className="text-stone-300 hover:text-white text-2xl transition-transform duration-200 ease-in-out hover:scale-110" aria-label="Close Game Master screen">&times;</button>
                </div>

                <div className="p-4 border border-stone-600 rounded-md flex-shrink-0 bg-stone-900">
                    <h3 className="text-lg font-bold text-stone-300 mb-2">GM Intervention</h3>
                    <p className="text-sm text-stone-400 mb-2">
                        Add a directive for the AI to consider in the next turn's adjudication. This can introduce external events or steer entity behavior.
                    </p>
                    <textarea
                        value={interventionInput}
                        onChange={(e) => setInterventionInput(e.target.value)}
                        className="w-full h-20 bg-stone-700 text-stone-200 p-2 rounded-sm border border-stone-500 focus:ring-1 focus:ring-red-500 focus:border-red-500"
                        placeholder="e.g., A plague breaks out in the Suburra. or Maximinus Thrax should become more aggressive."
                        aria-label="Game Master Intervention Input"
                    />
                    <div className="flex items-center mt-2">
                        <button
                            onClick={handleSetIntervention}
                            className="bg-red-700 text-white px-4 py-2 rounded-sm hover:bg-red-600 disabled:bg-red-900 disabled:cursor-not-allowed transition-colors shadow-md btn-animate"
                        >
                            Set Directive for Next Turn
                        </button>
                        {showConfirmation && <span className="ml-4 text-green-400 animate-fade-in">Directive Saved!</span>}
                    </div>
                </div>

                <div className="flex border-b border-stone-600 flex-shrink-0 mt-4">
                    {tabs.map(tab => (
                         <TabButton key={tab} label={tab.toUpperCase()} active={activeTab === tab} onClick={() => setActiveTab(tab)} />
                    ))}
                </div>

                <div className="overflow-y-auto flex-grow pr-2 mt-4">
                    {history.length === 0 ? (
                        <p className="text-stone-400 p-4">No turns have been processed yet.</p>
                    ) : (
                        history.slice().reverse().map(entry => (
                            <div key={entry.turnNumber} className="mb-6 pb-4 border-b border-stone-700 last:border-b-0">
                                <h3 className="text-xl font-bold text-red-500 mb-2">Turn {entry.turnNumber}</h3>
                                <div className="p-2">
                                    {activeTab === 'summary' && <SummaryView entry={entry} />}
                                    {activeTab === 'entity states' && <EntityStatesView entities={entry.postTurnEntities} />}
                                    {activeTab === 'actions' && <ActionsView adjudication={entry.adjudication} />}
                                    {activeTab === 'deltas' && <DeltasView adjudication={entry.adjudication} />}
                                    {activeTab === 'private' && <PrivateView adjudication={entry.adjudication} />}
                                    {activeTab === 'raw json' && <RawJsonView adjudication={entry.adjudication} rawCalls={entry.rawCalls} />}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default GameMasterScreen;