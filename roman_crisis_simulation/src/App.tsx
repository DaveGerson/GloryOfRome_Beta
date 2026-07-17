import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Entity, PlayerCharacterOption, Message, TurnHistoryEntry, InvestigationResult, Report, GameEvent, PlayerEventChoice, SimulationState, EventHistoryEntry } from './types';
import { GoogleGenAI, Type } from "@google/genai";

import Header from './components/Header';
import CharacterSelection, { SavedGameSummary } from './components/CharacterSelection';
import { ChatMessage, ChatInput, ActionPills, TypingIndicator } from './components/Chat';
import CrisisBanner from './components/CrisisBanner';
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
import { AiServiceError } from './ai/core/geminiService';
import { saveGame, loadGame, clearSave, hasSave, SaveGameState } from './persistence/saveGame';


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

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedGameSummary | null>(null);
    const [retryAction, setRetryAction] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const aiRef = useRef(new GoogleGenAI({apiKey: process.env.API_KEY}));
    // Snapshot of the committed game state taken right before a turn's AI
    // calls kick off, so a mid-turn failure can be rolled back to explicitly
    // rather than relying on "we just never committed" (P0.2/P0.4 - a
    // future refactor of the commit logic shouldn't silently break this).
    const preTurnSnapshotRef = useRef<SaveGameState | null>(null);

    useEffect(() => {
        // Run a "smoke test" on startup to validate that all mock functions
        // are working as expected after any system changes.
        // Dev-only scaffolding: never runs (and never alerts) in a production
        // build — players should never see a blocking alert() on load.
        if (!import.meta.env.DEV) return;

        const performSmokeTest = async () => {
            try {
                await runSmokeTest();
            } catch (error) {
                // Display the error prominently to the developer.
                console.error(error);
                alert((error as Error).message);
            }
        };

        // This test runs on every startup (in dev only) to ensure build validity.
        performSmokeTest();
    }, []); // Empty dependency array ensures this runs only once on mount.

    const playerEntity = entities.find(e => e.entity_id === playerCharacterId) || null;

    // Builds the full persistable game-state bundle from current state,
    // optionally overriding fields with just-computed values (state setters
    // are async, so a caller that just committed new values must pass them
    // explicitly rather than reading the stale closure). See
    // persistence/saveGame.ts for exactly which App.tsx state this does (and
    // doesn't) include, and why.
    const buildSaveState = useCallback((overrides: Partial<SaveGameState> = {}): SaveGameState => ({
        entities,
        worldState,
        simulationState,
        reports,
        turnNumber,
        playerCharacterId,
        turnHistory,
        eventHistory,
        metaNarrative,
        messages,
        triggeredEventIds,
        suggestedActions,
        currentEvents,
        gmInterventionText,
        ...overrides,
    }), [entities, worldState, simulationState, reports, turnNumber, playerCharacterId, turnHistory, eventHistory, metaNarrative, messages, triggeredEventIds, suggestedActions, currentEvents, gmInterventionText]);

    // On mount, check for an existing autosave so CharacterSelection can
    // offer a "Continue your reign" card instead of forcing a fresh start.
    useEffect(() => {
        if (!hasSave()) return;
        const save = loadGame();
        if (!save) return;
        const savedCharacter = save.state.entities.find(e => e.entity_id === save.state.playerCharacterId);
        setSavedGameInfo({
            characterName: savedCharacter?.name ?? 'Unknown',
            turnNumber: save.state.turnNumber,
            savedAt: save.savedAt,
        });
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, gameState]);

    // Now that every turn/event-choice/resource-spend autosaves (see
    // executeTurn/handleEventChoice/handleSpendResource below), the only
    // window with genuinely unsaved changes is while a turn is in flight
    // (PROCESSING) - the pre-turn snapshot was already saved, but this
    // turn's outcome hasn't committed yet. A committed-and-saved state
    // doesn't need the scare dialog.
    useEffect(() => {
        if (gameState !== GameState.PROCESSING) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [gameState]);

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
        // Any in-flight retry affordance is superseded by this attempt (fresh
        // or re-run) - it'll be recreated below if this attempt also fails.
        setRetryAction(null);

        const playerMessage: Message = { sender: 'player', text: playerActionText };
        addMessage(playerMessage);

        const playerEntity = entities.find(e => e.entity_id === playerCharacterId);
        if (!playerEntity) {
            addMessage({ sender: 'gm', text: "Error: Player character not found."});
            setGameState(GameState.AWAITING_PLAYER_INPUT);
            setInputValue(playerActionText);
            return;
        }

        // Snapshot the committed game state as it stands right before this
        // turn's AI calls kick off. State is only ever committed at the very
        // end of the try block below (after every AI call has succeeded), so
        // nothing here has changed yet - this snapshot is a defensive,
        // explicit rollback target rather than something we're relying on
        // "never having touched" to stay true across future refactors.
        const preTurnSnapshot = buildSaveState({ messages: [...messages, playerMessage] });
        preTurnSnapshotRef.current = preTurnSnapshot;

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
            const newWorldState = ((): WorldState => {
                let newWeek = worldState.week + 1;
                let newYear = worldState.year;
                if (newWeek > 52) { newWeek = 1; newYear += 1; }
                return { ...result.updatedWorldState, year: newYear, week: newWeek };
            })();
            // Add post-turn entity state to history for GM view
            const historyEntryWithState = { ...result.newHistoryEntry, postTurnEntities: result.updatedEntities };
            const newTurnHistory = [...turnHistory, historyEntryWithState];
            const newTurnNumber = turnNumber + 1;
            const gmMessage: Message = { sender: 'gm', text: result.narration };
            const monologueMessage: Message = { sender: 'player_monologue', text: result.playerMonologue };

            setEntities(result.updatedEntities);
            setReports(result.updatedReports);
            setSimulationState(result.updatedSimulationState); // Set the returned state
            setWorldState(newWorldState);
            setTurnHistory(newTurnHistory);
            setTurnNumber(newTurnNumber);

            addMessage(gmMessage);
            addMessage(monologueMessage);
            setSuggestedActions(result.suggestedActions);
            setCurrentEvents(result.headlines);
            setTurnInvestigations([]);
            setGmInterventionText(''); // Clear intervention after it's used

            // Flag that the turn is over and events should be checked
            setIsCheckingEvents(true);

            // Autosave the freshly committed state (P0.2 - see
            // persistence/saveGame.ts). Built from the just-computed local
            // values rather than re-reading state, since setState above
            // hasn't flushed yet.
            saveGame(buildSaveState({
                entities: result.updatedEntities,
                worldState: newWorldState,
                simulationState: result.updatedSimulationState,
                reports: result.updatedReports,
                turnNumber: newTurnNumber,
                turnHistory: newTurnHistory,
                messages: [...messages, playerMessage, gmMessage, monologueMessage],
                suggestedActions: result.suggestedActions,
                currentEvents: result.headlines,
                gmInterventionText: '',
            }));

        } catch (error)
        {
            // Keep the full error in the console for diagnosis, but never lose
            // the player's game over this — no "please refresh" (persistence
            // now exists, and nothing was committed mid-turn anyway).
            console.error("Error running turn:", error);

            // AiServiceError (ai/core/geminiService.ts) distinguishes a
            // transient failure (network/429/5xx that survived retries) -
            // worth a one-click retry of the exact same action - from a
            // fatal one (bad API key, unparseable/invalid model output even
            // after the repair-retry), where retrying the same request is
            // unlikely to help and the player deserves the real detail.
            const isTransient = error instanceof AiServiceError && error.kind === 'transient';

            if (isTransient) {
                addMessage({
                    sender: 'gm',
                    text: "The courier was waylaid — the Fates offer another chance.\n\nYour game is safe; nothing was lost. Your action has been restored below, or use Retry to send it again immediately."
                });
                setRetryAction(playerActionText);
            } else {
                const errorDetail = error instanceof Error ? error.message : String(error);
                addMessage({
                    sender: 'gm',
                    text: `A fateful error has occurred and the turn could not be resolved: ${errorDetail}\n\nYour game is safe. Your action has been restored below — press Send to try again.`
                });
            }

            // Roll back to the pre-turn snapshot. In practice nothing above
            // was committed yet, but restore explicitly (rather than relying
            // on that invariant) so a future change to the commit ordering
            // can't silently leave the game half-updated after a failure.
            // `messages` is deliberately excluded here - the player's message
            // and the GM's error notice above should stay in the chat log.
            const snapshot = preTurnSnapshotRef.current;
            if (snapshot) {
                setEntities(snapshot.entities);
                setWorldState(snapshot.worldState);
                setSimulationState(snapshot.simulationState);
                setReports(snapshot.reports);
                setTurnNumber(snapshot.turnNumber);
                setTurnHistory(snapshot.turnHistory);
                setEventHistory(snapshot.eventHistory);
                setTriggeredEventIds(snapshot.triggeredEventIds);
                setSuggestedActions(snapshot.suggestedActions);
                setCurrentEvents(snapshot.currentEvents);
                setGmInterventionText(snapshot.gmInterventionText);
            }

            setGameState(GameState.AWAITING_PLAYER_INPUT);
            // Restore the player's action so they can retry without retyping it.
            setInputValue(playerActionText);
        }
    }, [entities, playerCharacterId, turnNumber, worldState, simulationState, reports, turnHistory, messages, addMessage, gmInterventionText, isMockMode, metaNarrative, buildSaveState]);

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
        const resolvedWorldState = initialWorldState ?? worldState;
        const resolvedMetaNarrative = initialMetaNarrative ?? metaNarrative;

        setEntities(allInitialEntities);
        if (initialWorldState) {
            setWorldState(initialWorldState);
        }
        if (initialMetaNarrative) {
            setMetaNarrative(initialMetaNarrative);
        }
        setPlayerCharacterId(characterEntity.entity_id);
        setGameState(GameState.AWAITING_PLAYER_INPUT);

        const introMessage: Message = {
            sender: 'gm',
            text: `You have chosen to be **${characterEntity.name}**.\n\n${characterEntity.current_state_narrative}\n\nThe world holds its breath. What is your first action?`
        };
        addMessage(introMessage);

        // Autosave the very first commit of a new campaign - this is what
        // makes "Continue your reign" available on the next visit.
        saveGame(buildSaveState({
            entities: allInitialEntities,
            worldState: resolvedWorldState,
            metaNarrative: resolvedMetaNarrative,
            playerCharacterId: characterEntity.entity_id,
            messages: [...messages, introMessage],
        }));
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
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentAmount = (newResources[resourceName] as number) || 0;
                newResources[resourceName] = Math.max(0, currentAmount - cost);
                return {...e, resources: newResources};
            }
            return e;
        });
        setEntities(newEntities);
        saveGame(buildSaveState({ entities: newEntities }));
    };

    const handleAddSecretAsResource = (targetId: string, secrets: string[]) => {
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const resourceKey = `blackmail_on_${targetId}`;
                const existingSecrets = (newResources[resourceKey] as string[]) || [];
                const newSecretSet = new Set([...existingSecrets, ...secrets]);
                newResources[resourceKey] = Array.from(newSecretSet);
                return {...e, resources: newResources};
            }
            return e;
        });
        setEntities(newEntities);
        saveGame(buildSaveState({ entities: newEntities }));
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
        const eventMessage: Message = { sender: 'gm', text: `**Event: ${activeEvent.title}**\nYou chose to: *${choice.text}*`};
        const newEventHistory = [...eventHistory, newEventHistoryEntry];
        const newTriggeredEventIds = [...triggeredEventIds, activeEvent.id];

        // Commit state changes from event
        setEntities(updatedEntities);
        setWorldState(updatedWorldState);

        // Log the event and choice
        addMessage(eventMessage);

        // Add to event history
        setEventHistory(newEventHistory);

        // Mark event as seen and close modal
        setTriggeredEventIds(newTriggeredEventIds);
        setActiveEvent(null);
        setGameState(GameState.AWAITING_PLAYER_INPUT);

        // Autosave immediately after this commit (P0.2).
        saveGame(buildSaveState({
            entities: updatedEntities,
            worldState: updatedWorldState,
            eventHistory: newEventHistory,
            triggeredEventIds: newTriggeredEventIds,
            messages: [...messages, eventMessage],
        }));

    }, [activeEvent, entities, worldState, addMessage, playerEntity, turnNumber, eventHistory, triggeredEventIds, messages, buildSaveState]);

    const handleContinue = useCallback(() => {
        const save = loadGame();
        if (!save) {
            setSavedGameInfo(null);
            return;
        }
        const s = save.state;
        setEntities(s.entities);
        setWorldState(s.worldState);
        setSimulationState(s.simulationState);
        setReports(s.reports);
        setTurnNumber(s.turnNumber);
        setPlayerCharacterId(s.playerCharacterId);
        setTurnHistory(s.turnHistory);
        setEventHistory(s.eventHistory);
        setMetaNarrative(s.metaNarrative);
        setMessages(s.messages);
        setTriggeredEventIds(s.triggeredEventIds);
        setSuggestedActions(s.suggestedActions);
        setCurrentEvents(s.currentEvents);
        setGmInterventionText(s.gmInterventionText);
        setGameState(GameState.AWAITING_PLAYER_INPUT);
    }, []);

    const handleStartAnew = useCallback(() => {
        clearSave();
        setSavedGameInfo(null);
    }, []);

    return (
        <div className="min-h-screen text-[#3a2e2c] flex flex-col h-screen">
            <Header worldState={worldState} isMockMode={isMockMode} setIsMockMode={setIsMockMode} />
            <CrisisBanner crisis={simulationState.major_ongoing_crisis} />
            <div className="flex flex-grow overflow-hidden">
                <div className="w-2/3 flex flex-col">
                    {gameState === GameState.SETUP ? (
                        <CharacterSelection
                            onSelectCharacter={handleSelectCharacter}
                            onCreateCharacter={handleCustomCreation}
                            savedGame={savedGameInfo}
                            onContinue={handleContinue}
                            onStartAnew={handleStartAnew}
                        />
                    ) : (
                        <>
                            <main className="flex-grow p-4 overflow-y-auto" aria-live="polite">
                                {messages.map((msg, index) => <ChatMessage key={index} message={msg} />)}
                                {gameState === GameState.PROCESSING && <TypingIndicator />}
                                <div ref={messagesEndRef} />
                            </main>
                            <div className="bg-[#e8e6e1]/70 backdrop-blur-sm border-t-4 border-double border-[#c9c5b8]">
                                {gameState === GameState.AWAITING_PLAYER_INPUT && retryAction && (
                                    <div className="px-4 pt-2 flex justify-center animate-fade-in">
                                        <button
                                            onClick={() => executeTurn(retryAction)}
                                            className="bg-amber-800 hover:bg-amber-700 text-amber-50 rounded-sm px-4 py-1.5 text-sm shadow-md border border-amber-950 btn-animate"
                                            aria-label="Retry the last action"
                                        >
                                            &#8635; Retry: "{retryAction.length > 60 ? `${retryAction.slice(0, 60)}…` : retryAction}"
                                        </button>
                                    </div>
                                )}
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
                                            isProcessing={gameState === GameState.PROCESSING}
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