import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GameState, Entity, PlayerCharacterOption, Message, TurnHistoryEntry, InvestigationResult, Report, GameEvent, PlayerEventChoice, SimulationState, EventHistoryEntry } from './types';
import { GoogleGenAI, Type } from "@google/genai";

import Header from './components/Header';
import CharacterSelection, { SavedGameSummary } from './components/CharacterSelection';
import { ChatMessage, ChatInput, ActionPills, TypingIndicator, StreamingNarrationBubble } from './components/Chat';
import CrisisBanner from './components/CrisisBanner';
import DispatchesDigest from './components/DispatchesDigest';
import SidePanel from './components/SidePanel';
import GameMasterScreen from './components/GameMasterScreen';
import EventModal from './components/EventModal';
import EpilogueScreen from './components/EpilogueScreen';
import OnboardingOverlay from './components/OnboardingOverlay';
import { deriveStarterActions } from './components/starterActions';
import { ALL_INITIAL_ENTITIES, INITIAL_WORLD_STATE, INITIAL_SIMULATION_STATE } from './constants/baseScenario';
import { runNewTurn, TurnStage } from './ai/core/turn';
import { WorldState } from './types';
import { createCharacter } from './ai/tools/characterCreator';
import { inferAmbition } from './ai/tools/ambition';
import { checkForTriggeredEvent, applyEventChoiceDeltas } from './events/engine';
import { initiateWorld } from './ai/core/initiator';
import { runSmokeTest } from './tests/smokeTest';
import { AiServiceError } from './ai/core/geminiService';
import { saveGame, loadGame, clearSave, hasSave, SaveGameState, InferredAmbitionState } from './persistence/saveGame';
import { hasSeenOnboarding, markOnboardingSeen } from './persistence/onboarding';
import { buildPerceivedDigest, TabId } from './perception/visibility';
import { appendFallout, clearFallout, buildInterventionTextWithFallout, hasFallout } from './components/investigationLoop';


// --- MAIN APP ---

// DESIGN_DECISIONS.md D8 - how often the "cheap periodic model call" that
// infers the player's apparent ambition fires, counted in COMMITTED turns
// (the turn number just finished, not the upcoming one - see executeTurn).
const AMBITION_INFERENCE_TURN_INTERVAL = 3;

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
    // D7 - the GM console (log/debugger) stays in the codebase permanently
    // but is hidden by default for a clean player view. This is the runtime
    // toggle that governs whether the GM LOG button even appears; Ctrl+Shift+G
    // (see the effect below) and, in dev builds, a small Header checkbox both
    // flip it. Deliberately not persisted - every fresh session starts hidden.
    const [isGmConsoleEnabled, setIsGmConsoleEnabled] = useState(false);
    // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the investigation-consequence
    // queue (components/investigationLoop.ts). Replaces the old
    // `turnInvestigations: InvestigationResult[]` state, which stashed full
    // investigation results and cleared them every turn WITHOUT ever
    // feeding the `consequences` string back into the world - the exact
    // "wired and never consumed" dead loop the roadmap calls out. This
    // holds just the pending, not-yet-narrated consequence strings; it's
    // appended to by handleNewInvestigationResult, prepended onto
    // `gmInterventionText` for the next `runNewTurn` call (see
    // `executeTurn`), and only cleared once that turn actually commits -
    // NOT on a failed/rolled-back turn, so a retry still carries it.
    const [pendingIntelligenceFallout, setPendingIntelligenceFallout] = useState<string[]>([]);
    const [gmInterventionText, setGmInterventionText] = useState<string>('');
    const [isMockMode, setIsMockMode] = useState(false);
    const [activeEvent, setActiveEvent] = useState<GameEvent | null>(null);
    const [triggeredEventIds, setTriggeredEventIds] = useState<string[]>([]);
    const [eventHistory, setEventHistory] = useState<EventHistoryEntry[]>([]);
    const [isCheckingEvents, setIsCheckingEvents] = useState(false);
    const [metaNarrative, setMetaNarrative] = useState<string>('An imperial succession crisis in a crumbling empire teetering on the brink of civil war.');
    // DESIGN_DECISIONS.md D8 - the latest "apparent ambition" reading, if any
    // has been computed yet this campaign. GM-console/epilogue only (see
    // GameMasterScreen's "Apparent Ambition" line and EpilogueScreen) -
    // never rendered as a player-facing goal UI.
    const [inferredAmbition, setInferredAmbition] = useState<InferredAmbitionState | null>(null);

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedGameSummary | null>(null);
    const [retryAction, setRetryAction] = useState<string | null>(null);

    // ROADMAP_0_MASTER_PLAN.md Phase 3 items 1-2 - the "thinking theater" and
    // streaming narration. Both are purely transient, in-flight-turn UI
    // state, never part of the save bundle: `turnStage` drives the themed
    // status line (see components/Chat.tsx's TypingIndicator/ChatInput),
    // `streamingNarration` holds the live, gate-filtered GM bubble text
    // (see StreamingNarrationBubble) fed by runNewTurn's `onNarrationChunk`.
    // Both are cleared the instant a turn commits OR errors - see
    // executeTurn below - so they never survive past the turn that set them.
    const [turnStage, setTurnStage] = useState<TurnStage | null>(null);
    const [streamingNarration, setStreamingNarration] = useState<string>('');

    // ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - the first-turn onboarding
    // intro. Purely transient UI state (never part of the save bundle):
    // whether it's EVER been dismissed on this device lives in
    // persistence/onboarding.ts, a dedicated localStorage key outside the
    // save blob (it's a device preference, not campaign state). Only ever
    // set true from `startGameWithCharacter` (a brand-new campaign, whether
    // from a preset or a custom-created character) - never from
    // `handleContinue`, so resuming an existing save never shows it.
    const [showOnboarding, setShowOnboarding] = useState(false);

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

    // DESIGN_DECISIONS.md D1 - survival-only: ONLY death ends a run. Exile
    // and "missing" are survivable states the player keeps playing through,
    // each with a persistent contextual banner (input stays enabled) rather
    // than Stage A's stopgap, which locked input for any non-'alive' status.
    // Death itself is handled entirely via GameState.GAME_OVER (see
    // executeTurn/handleEventChoice/handleContinue below), not here.
    const isPlayerExiledOrMissing = playerEntity !== null && (playerEntity.status === 'exiled' || playerEntity.status === 'missing');

    // The most recent GM-authored narration text, used as the epilogue's
    // "manner of death" account regardless of whether the fatal blow landed
    // via a committed turn (runNewTurn's narration) or an authored event
    // choice (handleEventChoice's own message) - both paths already push a
    // 'gm' message here, and `messages` is itself part of the save bundle,
    // so this also survives a reload straight into a still-open epilogue
    // (see handleContinue).
    const lastGmNarration = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender === 'gm') return messages[i].text;
        }
        return '';
    }, [messages]);

    // The mortality pipeline's pre-decided narrative directive for the
    // player's death, if the final committed turn's mortalityTrace covers
    // them (ai/core/mortality.ts) - absent when the run instead ended via an
    // authored event choice, which never runs that pipeline. Per D4, this is
    // the SAME text already handed to the (player-facing) narration call -
    // nothing new leaks into the epilogue by reading it here.
    const finalMortalityOutcomeSummary = useMemo(() => {
        if (!playerCharacterId) return undefined;
        const lastEntry = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
        return lastEntry?.mortalityTrace?.find(ev => ev.entity_id === playerCharacterId && ev.valid)?.outcomeSummary;
    }, [turnHistory, playerCharacterId]);

    // Perception layer (D5, Phase 2 item 2): the most recently committed
    // turn's ground-truth deltas, filtered down to what the player would
    // actually perceive. Recomputed from turnHistory itself (which already
    // persists) rather than kept in separate state, so the digest survives
    // a reload with no extra save-format changes. Uses that turn's OWN
    // postTurnEntities for the player's location/network, since either can
    // change turn to turn.
    const lastTurn = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
    const lastTurnPlayer = useMemo(
        () => lastTurn?.postTurnEntities.find(e => e.entity_id === playerCharacterId) ?? null,
        [lastTurn, playerCharacterId]
    );
    const lastTurnPerceivedChanges = useMemo(
        () => (lastTurn && lastTurnPlayer)
            ? buildPerceivedDigest(lastTurn.adjudication.deltas, lastTurnPlayer, lastTurn.postTurnEntities, worldState)
            : [],
        [lastTurn, lastTurnPlayer, worldState]
    );
    // Which SidePanel tabs to pulse - built strictly from the already-filtered
    // perceived changes above, never from the raw deltas, so a pulse can
    // never itself leak something the perception filter withheld.
    const pulsingTabs = useMemo(() => {
        const tabs = new Set<TabId>();
        lastTurnPerceivedChanges.forEach(change => change.tabs.forEach(tab => tabs.add(tab)));
        return tabs;
    }, [lastTurnPerceivedChanges]);

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
        inferredAmbition,
        pendingIntelligenceFallout,
        ...overrides,
    }), [entities, worldState, simulationState, reports, turnNumber, playerCharacterId, turnHistory, eventHistory, metaNarrative, messages, triggeredEventIds, suggestedActions, currentEvents, gmInterventionText, inferredAmbition, pendingIntelligenceFallout]);

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

    // D7 - Ctrl+Shift+G is the primary runtime toggle for the GM console's
    // availability (separate from whether the screen is currently open -
    // see isGmScreenVisible). Works in every build, not just dev, since the
    // console itself is meant to stay reachable for tuning, just hidden by
    // default.
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && (event.key === 'G' || event.key === 'g')) {
                event.preventDefault();
                setIsGmConsoleEnabled(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // If the console is toggled off (keyboard or the dev Header checkbox)
    // while the screen happens to be open, close it too - "hidden by
    // default" shouldn't leave a stale open panel behind.
    useEffect(() => {
        if (!isGmConsoleEnabled) setIsGmScreenVisible(false);
    }, [isGmConsoleEnabled]);

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
        // Reset the thinking-theater/streaming state for this fresh attempt.
        // Defensive: both are already cleared by the previous turn's
        // success/error path below, but a stale value must never carry over.
        setTurnStage(null);
        setStreamingNarration('');

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

        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - without touching
        // runNewTurn's signature (ai/** is off-limits here), any pending
        // investigation fallout rides into this turn's adjudication by
        // being prepended onto the GM Intervention text - the adjudicator
        // already treats that argument as a must-honor world fact (see
        // ai/prompts/fragments.ts's buildGmInterventionBlock). This is
        // computed fresh from CURRENT state every attempt (including a
        // retry), so a retried turn still carries the same fallout.
        const interventionTextForTurn = buildInterventionTextWithFallout(pendingIntelligenceFallout, gmInterventionText);

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
                interventionTextForTurn,
                isMockMode,
                metaNarrative,
                { onStage: setTurnStage, onNarrationChunk: setStreamingNarration }
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
            // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the fallout queue is
            // "consumed" only here, once the turn that was handed
            // `interventionTextForTurn` (built from it, above) has actually
            // committed. A failed/rolled-back attempt never reaches this
            // line, so the queue survives untouched for a retry.
            setPendingIntelligenceFallout(clearFallout());
            setGmInterventionText(''); // Clear intervention after it's used
            // The final, parsed narration message above now replaces the
            // transient streaming bubble - clear the thinking-theater state
            // so it can't linger into the next AWAITING_PLAYER_INPUT render.
            setTurnStage(null);
            setStreamingNarration('');

            // DESIGN_DECISIONS.md D1 - survival-only: ONLY the player's own
            // death ends the run. Once it does, skip the event-trigger check
            // entirely (an event modal popping over a terminal epilogue
            // makes no sense) and go straight to GameState.GAME_OVER -
            // App.tsx's render then swaps the whole chat pane for
            // EpilogueScreen. Exile/missing are NOT terminal (see
            // isPlayerExiledOrMissing above) - only 'dead' triggers this.
            const updatedPlayerEntity = result.updatedEntities.find(e => e.entity_id === playerCharacterId);
            const diedThisTurn = updatedPlayerEntity?.status === 'dead';

            if (diedThisTurn) {
                setGameState(GameState.GAME_OVER);
            } else {
                // Flag that the turn is over and events should be checked
                setIsCheckingEvents(true);
            }

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
                pendingIntelligenceFallout: [],
            }));

            // DESIGN_DECISIONS.md D8 - a cheap periodic model call infers the
            // player's apparent ambition every AMBITION_INFERENCE_TURN_INTERVAL
            // committed turns (counting the turn that JUST finished, i.e.
            // `turnNumber` as passed into runNewTurn above - not the
            // just-incremented `newTurnNumber`). Deliberately fire-and-forget:
            // `.catch(console.warn)` so a failed inference is never allowed to
            // break the turn that's already committed above, and this never
            // blocks the turn's own UI update. Runs even on the turn the
            // player died on - a fresh read can still usefully inform the
            // epilogue about to be generated.
            if (updatedPlayerEntity && turnNumber % AMBITION_INFERENCE_TURN_INTERVAL === 0) {
                const recentIntents = newTurnHistory.map(h => h.playerIntent).slice(-6);
                const recentHeadlines = newTurnHistory.slice(-3).flatMap(h => h.adjudication.headlines);
                const ambitionTurnNumber = turnNumber;
                inferAmbition(aiRef.current, updatedPlayerEntity, recentIntents, recentHeadlines, isMockMode)
                    .then(inference => {
                        const nextAmbition: InferredAmbitionState = { ...inference, asOfTurn: ambitionTurnNumber };
                        setInferredAmbition(nextAmbition);
                        // Persist alongside the turn's own autosave above -
                        // this call resolves asynchronously, well after that
                        // saveGame() already ran, so it needs its own write
                        // rather than relying on that earlier one to have
                        // captured it.
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
                            pendingIntelligenceFallout: [],
                            inferredAmbition: nextAmbition,
                        }));
                    })
                    .catch(console.warn);
            }

        } catch (error)
        {
            // Keep the full error in the console for diagnosis, but never lose
            // the player's game over this — no "please refresh" (persistence
            // now exists, and nothing was committed mid-turn anyway).
            console.error("Error running turn:", error);

            // On ANY error, the transient streaming bubble and stage state
            // are cleared - they're pure in-flight-turn UI, and this turn's
            // attempt just ended (whether or not the player retries).
            setTurnStage(null);
            setStreamingNarration('');

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
                // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the fallout
                // queue was never actually cleared on this path (that only
                // happens in the success branch above), so this is a no-op
                // in practice today - restored explicitly anyway, for the
                // same "don't rely on the invariant" reason as every other
                // field here. Guarantees a failed/rolled-back turn's
                // pending fallout survives intact for a retry.
                setPendingIntelligenceFallout(snapshot.pendingIntelligenceFallout ?? []);
            }

            setGameState(GameState.AWAITING_PLAYER_INPUT);
            // Restore the player's action so they can retry without retyping it.
            setInputValue(playerActionText);
        }
    }, [entities, playerCharacterId, turnNumber, worldState, simulationState, reports, turnHistory, messages, addMessage, gmInterventionText, isMockMode, metaNarrative, buildSaveState, pendingIntelligenceFallout]);

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

        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - seed the suggested-action
        // pills from the chosen character's own goals (pure, no AI call - see
        // components/starterActions.ts) so turn 1 isn't a blank page.
        const starterActions = deriveStarterActions(characterEntity);
        setSuggestedActions(starterActions);

        // Show the first-turn onboarding overlay exactly once ever, on
        // whichever device/browser hasn't dismissed it yet - covers both a
        // preset character (handleSelectCharacter) and a custom-created one
        // (handleCustomCreation), since both call this function. Never
        // fires from handleContinue, which restores `showOnboarding`'s
        // default of `false` implicitly (it isn't part of SaveGameState).
        if (!hasSeenOnboarding()) {
            setShowOnboarding(true);
        }

        // Autosave the very first commit of a new campaign - this is what
        // makes "Continue your reign" available on the next visit.
        saveGame(buildSaveState({
            entities: allInitialEntities,
            worldState: resolvedWorldState,
            metaNarrative: resolvedMetaNarrative,
            playerCharacterId: characterEntity.entity_id,
            messages: [...messages, introMessage],
            suggestedActions: starterActions,
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

    // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - queues any risky
    // investigation's consequence for the next turn (see
    // components/investigationLoop.ts and executeTurn's
    // interventionTextForTurn above), and - per DESIGN_DECISIONS.md D5 (the
    // player is never omniscient) - surfaces only a subtle, in-fiction hint
    // right now, never the mechanical consequence text itself. That text
    // only ever reaches a player-facing surface once it's been reinterpreted
    // through next turn's narration/dispatches; the GM console
    // (GameMasterScreen's "Pending Intelligence Fallout" line) is the one
    // place it's shown verbatim.
    const handleNewInvestigationResult = (result: InvestigationResult) => {
        const nextFallout = appendFallout(pendingIntelligenceFallout, result);
        if (nextFallout !== pendingIntelligenceFallout) {
            setPendingIntelligenceFallout(nextFallout);
            saveGame(buildSaveState({ pendingIntelligenceFallout: nextFallout }));
        }

        if (hasFallout(result.consequences)) {
            addMessage({
                sender: 'gm',
                text: "Your agent returns — but something in their manner suggests the visit did not go unnoticed."
            });
        }
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

        // DESIGN_DECISIONS.md D1 - an authored event choice's deltas can also
        // kill the player (applyEventChoiceDeltas), not just the adjudicated
        // turn pipeline - so this path needs the exact same GAME_OVER check
        // as executeTurn's commit above.
        const updatedPlayerEntity = updatedEntities.find(e => e.entity_id === playerCharacterId);
        setGameState(updatedPlayerEntity?.status === 'dead' ? GameState.GAME_OVER : GameState.AWAITING_PLAYER_INPUT);

        // Autosave immediately after this commit (P0.2).
        saveGame(buildSaveState({
            entities: updatedEntities,
            worldState: updatedWorldState,
            eventHistory: newEventHistory,
            triggeredEventIds: newTriggeredEventIds,
            messages: [...messages, eventMessage],
        }));

    }, [activeEvent, entities, worldState, addMessage, playerEntity, playerCharacterId, turnNumber, eventHistory, triggeredEventIds, messages, buildSaveState]);

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
        // Optional field (D8) - absent on saves from before this field
        // existed, so this normalizes it to `null` rather than `undefined`
        // for InferredAmbitionState | null's sake.
        setInferredAmbition(s.inferredAmbition ?? null);
        // Optional field (Phase 3 item 5) - absent on saves from before the
        // investigation-fallout queue existed, so this normalizes it to an
        // empty queue rather than `undefined`.
        setPendingIntelligenceFallout(s.pendingIntelligenceFallout ?? []);

        // A save can legitimately be reloaded while the last-loaded run had
        // already ended (the player closed/refreshed the tab on the epilogue
        // screen - GAME_OVER itself is never persisted, only the underlying
        // entities are). Re-derive the terminal state from the loaded player
        // entity's status rather than assuming a continued save always means
        // "still playable" (DESIGN_DECISIONS.md D1 - only death is terminal).
        const loadedPlayer = s.entities.find(e => e.entity_id === s.playerCharacterId);
        setGameState(loadedPlayer?.status === 'dead' ? GameState.GAME_OVER : GameState.AWAITING_PLAYER_INPUT);
    }, []);

    const handleStartAnew = useCallback(() => {
        clearSave();
        setSavedGameInfo(null);
    }, []);

    // Fires on X, Escape, or finishing the final step alike (see
    // OnboardingOverlay's onClose) - marks the device-level seen-flag so it
    // never shows again, then hides the overlay.
    const handleCloseOnboarding = useCallback(() => {
        markOnboardingSeen();
        setShowOnboarding(false);
    }, []);

    return (
        <div className="min-h-screen text-[#3a2e2c] flex flex-col h-screen">
            <Header
                worldState={worldState}
                isMockMode={isMockMode}
                setIsMockMode={setIsMockMode}
                isGmConsoleEnabled={isGmConsoleEnabled}
                setIsGmConsoleEnabled={setIsGmConsoleEnabled}
            />
            {gameState !== GameState.GAME_OVER && <CrisisBanner crisis={simulationState.major_ongoing_crisis} />}
            {/*
              DESIGN_DECISIONS.md D1: exile/missing are survivable - the run
              keeps going, input stays enabled - so this is a persistent
              contextual banner, not the Stage A stopgap's input lock. Dead
              is handled entirely below via GameState.GAME_OVER, which
              replaces this whole area with EpilogueScreen, so this branch
              never renders for a dead player.
            */}
            {gameState !== GameState.GAME_OVER && isPlayerExiledOrMissing && playerEntity && (
                <div
                    role="status"
                    className="w-full bg-stone-800 text-stone-300 border-y-2 border-double border-stone-600 px-4 py-2 shadow-md text-center animate-fade-in"
                >
                    <p className="italic text-sm sm:text-base">
                        {playerEntity.status === 'exiled'
                            ? `You scheme from exile in ${playerEntity.location}.`
                            : `You have gone missing — last seen near ${playerEntity.location}. The world does not know if you yet live.`}
                    </p>
                </div>
            )}
            <div className="flex flex-grow overflow-hidden">
                {gameState === GameState.GAME_OVER && playerEntity ? (
                    <EpilogueScreen
                        player={playerEntity}
                        causeNarration={lastGmNarration}
                        mortalityOutcomeSummary={finalMortalityOutcomeSummary}
                        turnHistory={turnHistory}
                        eventHistory={eventHistory}
                        metaNarrative={metaNarrative}
                        inferredAmbition={inferredAmbition}
                        ai={aiRef.current}
                        isMockMode={isMockMode}
                    />
                ) : (
                    <>
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
                                        {gameState === GameState.PROCESSING && (
                                            streamingNarration
                                                ? <StreamingNarrationBubble text={streamingNarration} />
                                                : <TypingIndicator stage={turnStage} />
                                        )}
                                        {gameState !== GameState.PROCESSING && lastTurn && (
                                            <DispatchesDigest changes={lastTurnPerceivedChanges} />
                                        )}
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
                                                    turnStage={turnStage}
                                                />
                                            </div>
                                            <div className="pr-4">
                                                {isGmConsoleEnabled && (
                                                    <button
                                                        onClick={() => setIsGmScreenVisible(true)}
                                                        className="bg-stone-800 text-amber-200 border-2 border-amber-400/50 rounded-sm px-4 py-2 hover:bg-stone-700 hover:text-amber-100 disabled:bg-stone-400 disabled:border-stone-500 disabled:text-stone-500 transition-all btn-animate"
                                                        aria-label="Open Game Master Screen"
                                                        disabled={turnHistory.length === 0}
                                                    >
                                                        GM LOG
                                                    </button>
                                                )}
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
                            simulationState={simulationState}
                            reports={reports}
                            onSpendInvestigation={(cost) => handleSpendResource('investigations', cost)}
                            onSpendDeepAnalysis={(cost) => handleSpendResource('deep_analyses', cost)}
                            onNewInvestigationResult={handleNewInvestigationResult}
                            onAddSecretAsResource={handleAddSecretAsResource}
                            ai={aiRef.current}
                            isMockMode={isMockMode}
                            eventHistory={eventHistory}
                            pulsingTabs={pulsingTabs}
                        />
                    </>
                )}
            </div>
            {isGmConsoleEnabled && isGmScreenVisible && <GameMasterScreen
                history={turnHistory}
                onClose={() => setIsGmScreenVisible(false)}
                interventionText={gmInterventionText}
                onSetIntervention={handleSetIntervention}
                playerCharacterId={playerCharacterId}
                worldState={worldState}
                inferredAmbition={inferredAmbition}
                pendingIntelligenceFallout={pendingIntelligenceFallout}
            />}
            {activeEvent && <EventModal event={activeEvent} onChoose={handleEventChoice} />}
            {showOnboarding && gameState === GameState.AWAITING_PLAYER_INPUT && (
                <OnboardingOverlay isOpen={showOnboarding} onClose={handleCloseOnboarding} />
            )}
        </div>
    );
};

export default App;