import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Entity, PlayerCharacterOption, Message, TurnHistoryEntry, InvestigationResult, Report, GameEvent, PlayerEventChoice, SimulationState, EventHistoryEntry } from './types';
import { GoogleGenAI, Type } from "@google/genai";

import Header from './components/Header';
import CharacterSelection from './components/CharacterSelection';
import { ChatMessage, ChatInput, ActionPills } from './components/Chat';
import SidePanel from './components/SidePanel';
import GameMasterScreen from './components/GameMasterScreen';
import EventModal from './components/EventModal';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE, INITIAL_SIMULATION_STATE } from './constants/baseScenario';
import { runNewTurn } from './ai/core/turn';
import { WorldState } from './types';
import { createCharacter } from './ai/tools/characterCreator';
import { checkForTriggeredEvent, applyEventChoiceDeltas } from './events/engine';
import { initiateWorld } from './ai/core/initiator';
import { runSmokeTest } from './tests/smokeTest';


// --- MAIN APP ---

const App: React.FC = () => {
    const [gameState, setGameState] = useState<GameState>(GameState.SETUP);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
    const [currentEvents, setCurrentEvents] = useState<string[]>([]);
    
    const [entities, setEntities] = useState<Entity[]>([]);
    const [worldState, setWorldState] = useState<WorldState>(INITIAL_WORLD_STATE);
    const [simulationState, setSimulationState] = useState<SimulationState>(INITIAL_SIMULATION_STATE);
    const [reports, setReports] = useState<Report[]>([]);
    const [turnNumber, setTurnNumber] = useState<number>(1);
    const [playerCharacterId, setPlayerCharacterId] = useState<string | null>(null);
    const [turnHistory, setTurnHistory] = useState<TurnHistoryEntry[]>([]);
    const [isGmScreenVisible, setIsGmScreenVisible] = useState(false);
    const [turnInvestigations, setTurnInvestigations] = useState<InvestigationResult[]>([]);
    const [gmInterventionText, setGmInterventionText] = useState<string>('');
    const [isMockMode, setIsMockMode] = useState(false);
    const [activeEvent, setActiveEvent] = useState<GameEvent | null>(null);
    const [triggeredEventIds, setTriggeredEventIds] = useState<string[]>([]);
    const [eventHistory, setEventHistory] = useState<EventHistoryEntry[]>([]);
    const [isCheckingEvents, setIsCheckingEvents] = useState(false);
    const [metaNarrative, setMetaNarrative] = useState<string>('An imperial succession crisis in a crumbling empire teetering on the brink of civil war.');
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const aiRef = useRef(new GoogleGenAI({apiKey: process.env.API_KEY}));

    useEffect(() => {
        // Run a "smoke test" on startup to validate that all mock functions
        // are working as expected after any system changes.
        const performSmokeTest = async () => {
            try {
                await runSmokeTest();
            } catch (error) {
                // Display the error prominently to the developer/user.
                // In a production build, this might be handled by an error boundary.
                console.error(error);
                alert((error as Error).message); 
            }
        };

        // This test runs on every startup to ensure build validity.
        performSmokeTest();
    }, []); // Empty dependency array ensures this runs only once on mount.

    const playerEntity = entities.find(e => e.entity_id === playerCharacterId) || null;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, gameState]);
    
    const addMessage = useCallback((message: Message) => {
        setMessages(prev => [...prev, message]);
    }, []);

    useEffect(() => {
        if (isCheckingEvents) {
            const event = checkForTriggeredEvent(worldState, entities, triggeredEventIds, playerEntity);
            if (event) {
                setActiveEvent(event);
                setGameState(GameState.AWAITING_EVENT_CHOICE);
            } else {
                setGameState(GameState.AWAITING_PLAYER_INPUT);
            }
            setIsCheckingEvents(false); // Reset the flag
        }
    }, [isCheckingEvents, worldState, entities, triggeredEventIds, playerEntity]);

    const executeTurn = useCallback(async (playerActionText: string) => {
        setGameState(GameState.PROCESSING);
        setSuggestedActions([]);
        addMessage({ sender: 'player', text: playerActionText });

        const playerEntity = entities.find(e => e.entity_id === playerCharacterId);
        if (!playerEntity) {
            addMessage({ sender: 'gm', text: "Error: Player character not found."});
            setGameState(GameState.AWAITING_PLAYER_INPUT);
            return;
        }

        try {
            const result = await runNewTurn(
                aiRef.current,
                playerActionText,
                playerEntity,
                turnNumber,
                entities,
                worldState,
                simulationState, // Pass the new state here
                turnHistory,
                reports,
                gmInterventionText,
                isMockMode,
                metaNarrative
            );

            // COMMIT STATE
            setEntities(result.updatedEntities);
            setReports(result.updatedReports);
            setSimulationState(result.updatedSimulationState); // Set the returned state
            setWorldState(prev => {
                let newWeek = prev.week + 1;
                let newYear = prev.year;
                if (newWeek > 52) { newWeek = 1; newYear += 1; }
                return { ...result.updatedWorldState, year: newYear, week: newWeek };
            });
            // Add post-turn entity state to history for GM view
            const historyEntryWithState = { ...result.newHistoryEntry, postTurnEntities: result.updatedEntities };
            setTurnHistory(prev => [...prev, historyEntryWithState]);
            setTurnNumber(prev => prev + 1);
            
            addMessage({ sender: 'gm', text: result.narration });
            addMessage({ sender: 'player_monologue', text: result.playerMonologue });
            setSuggestedActions(result.suggestedActions);
            setCurrentEvents(result.headlines);
            setTurnInvestigations([]);
            setGmInterventionText(''); // Clear intervention after it's used
            
            // Flag that the turn is over and events should be checked
            setIsCheckingEvents(true);

        } catch (error)
        {
            console.error("Error running turn:", error);
            addMessage({ sender: 'gm', text: "A fateful error has occurred. The simulation cannot proceed. Please refresh."});
            setGameState(GameState.AWAITING_PLAYER_INPUT);
        }
    }, [entities, playerCharacterId, turnNumber, worldState, simulationState, reports, turnHistory, addMessage, gmInterventionText, isMockMode, metaNarrative]);

    const handleSendMessage = () => {
        const text = inputValue.trim();
        if (!text || gameState !== GameState.AWAITING_PLAYER_INPUT) return;
        setInputValue('');
        executeTurn(text);
    };

    const handlePillClick = (action: string) => {
        setInputValue(action);
    };
    
    const startGameWithCharacter = (characterEntity: Entity, allInitialEntities: Entity[], initialWorldState?: WorldState, initialMetaNarrative?: string) => {
        setEntities(allInitialEntities);
        if (initialWorldState) {
            setWorldState(initialWorldState);
        }
        if (initialMetaNarrative) {
            setMetaNarrative(initialMetaNarrative);
        }
        setPlayerCharacterId(characterEntity.entity_id);
        setGameState(GameState.AWAITING_PLAYER_INPUT);
    
        addMessage({ 
            sender: 'gm', 
            text: `You have chosen to be **${characterEntity.name}**.\n\n${characterEntity.current_state_narrative}\n\nThe world holds its breath. What is your first action?` 
        });
    };

    const handleSelectCharacter = (option: PlayerCharacterOption) => {
        const playerEntity = ALL_INITIAL_ENTITIES.find(e => e.entity_id === option.entity_id);
        if(playerEntity) {
            startGameWithCharacter(playerEntity, JSON.parse(JSON.stringify(ALL_INITIAL_ENTITIES)));
        }
    };

    const handleCustomCreation = async ({ description, metaNarrative: newMetaNarrative, useCustomGamestate }: { description: string, metaNarrative?: string, useCustomGamestate: boolean }) => {
        if (useCustomGamestate && newMetaNarrative) {
            // New world generation logic
            const { worldState: newWorldState, entities: newEntities, playerCharacterId: newPlayerId } = await initiateWorld(aiRef.current, newMetaNarrative, description, isMockMode);
            const playerChar = newEntities.find(e => e.entity_id === newPlayerId);
            if (playerChar) {
                startGameWithCharacter(playerChar, newEntities, newWorldState, newMetaNarrative);
            } else {
                 addMessage({ sender: 'gm', text: "Error: Failed to generate a valid player character in the new world."});
            }
        } else {
            // Existing custom character in default world
            const newCharacter = await createCharacter(aiRef.current, description, isMockMode);
            const finalEntities = ALL_INITIAL_ENTITIES.find(e => e.entity_id === newCharacter.entity_id) 
                ? ALL_INITIAL_ENTITIES.map(e => e.entity_id === newCharacter.entity_id ? newCharacter : e)
                : [...ALL_INITIAL_ENTITIES, newCharacter];
            startGameWithCharacter(newCharacter, JSON.parse(JSON.stringify(finalEntities)));
        }
    };

    const handleSpendResource = (resourceName: 'deep_analyses' | 'investigations', cost: number) => {
        setEntities(prevEntities => prevEntities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentAmount = (newResources[resourceName] as number) || 0;
                newResources[resourceName] = Math.max(0, currentAmount - cost);
                return {...e, resources: newResources};
            }
            return e;
        }));
    };

    const handleAddSecretAsResource = (targetId: string, secrets: string[]) => {
        setEntities(prevEntities => prevEntities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const resourceKey = `blackmail_on_${targetId}`;
                const existingSecrets = (newResources[resourceKey] as string[]) || [];
                const newSecretSet = new Set([...existingSecrets, ...secrets]);
                newResources[resourceKey] = Array.from(newSecretSet);
                return {...e, resources: newResources};
            }
            return e;
        }));
    };

    const handleNewInvestigationResult = (result: InvestigationResult) => {
        setTurnInvestigations(prev => [...prev, result]);
    };

    const handleSetIntervention = (text: string) => {
        setGmInterventionText(text);
    };
    
    const handleEventChoice = useCallback((choice: PlayerEventChoice) => {
        if (!activeEvent || !playerEntity) return;

        const newEventHistoryEntry: EventHistoryEntry = {
            eventId: activeEvent.id,
            eventTitle: activeEvent.title,
            choiceText: choice.text,
            turnNumber: turnNumber,
        };
    
        const { updatedEntities, updatedWorldState } = applyEventChoiceDeltas(choice, playerEntity, entities, worldState);
    
        // Commit state changes from event
        setEntities(updatedEntities);
        setWorldState(updatedWorldState);
    
        // Log the event and choice
        addMessage({ sender: 'gm', text: `**Event: ${activeEvent.title}**\nYou chose to: *${choice.text}*`});
    
        // Add to event history
        setEventHistory(prev => [...prev, newEventHistoryEntry]);

        // Mark event as seen and close modal
        setTriggeredEventIds(prev => [...prev, activeEvent.id]);
        setActiveEvent(null);
        setGameState(GameState.AWAITING_PLAYER_INPUT);
    
    }, [activeEvent, entities, worldState, addMessage, playerEntity, turnNumber]);

    return (
        <div className="min-h-screen text-[#3a2e2c] flex flex-col h-screen">
            <Header worldState={worldState} isMockMode={isMockMode} setIsMockMode={setIsMockMode} />
            <div className="flex flex-grow overflow-hidden">
                <div className="w-2/3 flex flex-col">
                    {gameState === GameState.SETUP ? (
                        <CharacterSelection onSelectCharacter={handleSelectCharacter} onCreateCharacter={handleCustomCreation} />
                    ) : (
                        <>
                            <main className="flex-grow p-4 overflow-y-auto">
                                {messages.map((msg, index) => <ChatMessage key={index} message={msg} />)}
                                <div ref={messagesEndRef} />
                            </main>
                            <div className="bg-[#e8e6e1]/70 backdrop-blur-sm border-t-4 border-double border-[#c9c5b8]">
                                {gameState === GameState.AWAITING_PLAYER_INPUT && suggestedActions.length > 0 && (
                                    <ActionPills actions={suggestedActions} onSelectAction={handlePillClick} />
                                )}
                                <div className="flex items-center">
                                    <div className="flex-grow">
                                        <ChatInput
                                            value={inputValue}
                                            onChange={setInputValue}
                                            onSubmit={handleSendMessage}
                                            disabled={gameState !== GameState.AWAITING_PLAYER_INPUT}
                                        />
                                    </div>
                                    <div className="pr-4">
                                        <button
                                            onClick={() => setIsGmScreenVisible(true)}
                                            className="bg-stone-800 text-amber-200 border-2 border-amber-400/50 rounded-sm px-4 py-2 hover:bg-stone-700 hover:text-amber-100 disabled:bg-stone-400 disabled:border-stone-500 disabled:text-stone-500 transition-all btn-animate"
                                            aria-label="Open Game Master Screen"
                                            disabled={turnHistory.length === 0}
                                        >
                                            GM LOG
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                
                <SidePanel 
                    gameState={gameState} 
                    playerEntity={playerEntity}
                    entities={entities} 
                    currentEvents={currentEvents}
                    worldState={worldState}
                    reports={reports}
                    onSpendInvestigation={(cost) => handleSpendResource('investigations', cost)}
                    onNewInvestigationResult={handleNewInvestigationResult}
                    onAddSecretAsResource={handleAddSecretAsResource}
                    ai={aiRef.current}
                    isMockMode={isMockMode}
                    eventHistory={eventHistory}
                />
            </div>
            {isGmScreenVisible && <GameMasterScreen 
                history={turnHistory} 
                onClose={() => setIsGmScreenVisible(false)} 
                interventionText={gmInterventionText}
                onSetIntervention={handleSetIntervention}
            />}
            {activeEvent && <EventModal event={activeEvent} onChoose={handleEventChoice} />}
        </div>
    );
};

export default App;