import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GameState, Entity, PlayerCharacterOption, Message, InvestigationResult, PlayerEventChoice, EventHistoryEntry, PacingPosture, StructuredTurnDraft, TurnSubmission } from './types';
import { GoogleGenAI } from "@google/genai";

import Header from './components/Header';
import CharacterSelection, { SavedGameSummary } from './components/CharacterSelection';
import { ChatMessage, TypingIndicator, StreamingNarrationBubble } from './components/Chat';
import { TurnComposer } from './components/TurnComposer';
import CrisisBanner from './components/CrisisBanner';
import DispatchesDigest from './components/DispatchesDigest';
import SidePanel from './components/SidePanel';
import GameMasterScreen from './components/GameMasterScreen';
import EventModal from './components/EventModal';
import EpilogueScreen from './components/EpilogueScreen';
import OnboardingOverlay from './components/OnboardingOverlay';
import SettingsMenu from './components/SettingsMenu';
import { deriveStarterActions } from './components/starterActions';
import { ALL_INITIAL_ENTITIES } from './constants/baseScenario';
import { runNewTurn, TurnStage } from './ai/core/turn';
import { WorldState } from './types';
import { useGame } from './state/GameContext';
import { withOldSnapshotsDropped } from './state/gameReducer';
import { createCharacter } from './ai/tools/characterCreator';
import { inferAmbition } from './ai/tools/ambition';
import { checkForTriggeredEvent, applyEventChoiceDeltas, recordEventFiring } from './events/engine';
import { initiateWorld } from './ai/core/initiator';
import { runSmokeTest } from './tests/smokeTest';
import { resetSessionCallLog } from './ai/core/geminiService';
import { saveGame, loadGame, clearSave, hasSave, updateSavedAmbition, SaveGameState, InferredAmbitionState } from './persistence/saveGame';
import { hasSeenOnboarding, markOnboardingSeen } from './persistence/onboarding';
import { getPacingPosture, setPacingPosture } from './persistence/settings';
import { getApiKey, setApiKey, clearApiKey, resolveApiKey } from './persistence/apiKey';
import {
    getGmConsoleEnabled, setGmConsoleEnabled,
    getGmInterventionEnabled, setGmInterventionEnabled,
} from './persistence/uiPrefs';
import { buildPerceivedDigest, TabId } from './perception/visibility';
import { computeTurnKnowledge, computeInvestigationKnowledge } from './knowledge/commit';
import { knownRecipientOptionsForPlayer } from './knowledge/relationships';
import { emptyStructuredDraft } from './playerInput/composerState';
import {
    deserializeTurnSubmission,
    projectForExternalInference,
    serializeTurnSubmission,
    validateAndNormalizeTurnSubmission,
    deepFreezeTurnSubmission,
} from './playerInput/turnSubmission';
import { appendFallout, buildInterventionTextWithFallout, hasFallout } from './components/investigationLoop';
import { Button } from './components/ui/Core';
import { Tooltip } from './components/ui/Feedback';
import { toRoman } from './components/ui/Brand';
import { shouldToggleGmConsole } from './components/ui/gmConsoleHotkey';
import nocturneUrl from './design/nocturne.css?url';


// --- MAIN APP ---

// DESIGN_DECISIONS.md D8 - how often the "cheap periodic model call" that
// infers the player's apparent ambition fires, counted in COMMITTED turns
// (the turn number just finished, not the upcoming one - see executeTurn).
const AMBITION_INFERENCE_TURN_INTERVAL = 3;

// ROADMAP_PHASE_4.md 4D item 1 (D23) - the Fates pacing selector's three
// options, in-fiction labels for the PacingPosture enum. ONE unobtrusive
// control beside the LVX/NOX toggle, deliberately NOT a settings surface
// (a full settings surface is explicitly out of Phase 4 scope). Titles are
// player-safe flavor only: they describe the felt pacing, never the
// adjudicator/prompt mechanics behind it (D4/D5 - the player only ever
// FEELS pacing).
const FATES_OPTIONS: { posture: PacingPosture; label: string; title: string }[] = [
    { posture: 'restrained', label: 'PATIENT', title: 'Patient Fates — long quiet weeks may stand' },
    { posture: 'balanced', label: 'MEASURED', title: 'Measured Fates — fortune turns when the story calls for it' },
    { posture: 'dramatic', label: 'EAGER', title: 'Eager Fates — the threads pull taut sooner' },
];

/**
 * DESIGN_DECISIONS.md D34 - the owner's local-dev convenience: read
 * `GEMINI_API_KEY` from `.env` exactly the way vite.config.ts's now
 * dev-server-only `define` block injects it, so the owner never has to
 * touch the configuration menu on their own machine. `import.meta.env.DEV`
 * is a build-time-known boolean literal ('DEV' is Vite's own static
 * constant, not this app's custom define) - a production build inlines it
 * to `false`, so this whole branch is unreachable at runtime and gets
 * dropped by the bundler, meaning `process` (which doesn't exist as a
 * browser global) is never referenced by shipped code. `typeof process`
 * is a second, purely defensive guard against the same failure mode were
 * that branch ever to survive into a build.
 */
function readDevApiKey(): string | undefined {
    if (!import.meta.env.DEV) return undefined;
    return typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
}

function loadSavedGameSummary(): SavedGameSummary | null {
    if (!hasSave()) return null;
    const save = loadGame();
    if (!save) return null;
    const savedCharacter = save.state.entities.find(entity => entity.entity_id === save.state.playerCharacterId);
    return {
        characterName: savedCharacter?.name ?? 'Unknown',
        turnNumber: save.state.turnNumber,
        savedAt: save.savedAt,
    };
}

const App: React.FC = () => {
    // Every game-domain slice lives in the reducer behind GameContext
    // (state/gameReducer.ts, DESIGN_DECISIONS.md D17) - in particular, every
    // slice buildSaveState persists MUST come from there, never from a local
    // useState. App.tsx stays the composition root: children receive plain
    // props, never the context itself. Only transient, presentation-only
    // state (input box, modal flags, streaming text, theme, retry
    // affordances) may live in the local useState hooks below.
    const { state, dispatch } = useGame();
    const {
        gameState,
        messages,
        suggestedActions,
        currentEvents,
        entities,
        worldState,
        simulationState,
        reports,
        truthLedger,
        knowledge,
        npcIntents,
        turnNumber,
        playerCharacterId,
        turnHistory,
        pendingIntelligenceFallout,
        gmInterventionText,
        activeEvent,
        triggeredEventIds,
        eventFirings,
        eventHistory,
        metaNarrative,
        inferredAmbition,
    } = state;

    const [chatDraft, setChatDraft] = useState('');
    const [structuredDraft, setStructuredDraft] = useState<StructuredTurnDraft>(() => emptyStructuredDraft());
    const [retrySubmission, setRetrySubmission] = useState<TurnSubmission | null>(null);
    const [retryDraft, setRetryDraft] = useState<string | StructuredTurnDraft | null>(null);
    const [pendingPlayerMessage, setPendingPlayerMessage] = useState<Message | null>(null);
    const [turnError, setTurnError] = useState<string | null>(null);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [isGmScreenVisible, setIsGmScreenVisible] = useState(false);
    // D7 - the GM console (log/debugger) stays in the codebase permanently
    // but is hidden by default for a clean player view. This is the runtime
    // toggle that governs whether the GM LOG button even appears; Ctrl+Shift+G
    // (see the effect below) and, in dev builds, a small Header checkbox both
    // flip it. Deliberately not persisted - every fresh session starts hidden.
    const [isGmConsoleEnabled, setIsGmConsoleEnabled] = useState(false);
    const updateGmConsoleEnabled = useCallback((enabled: boolean) => {
        if (!enabled) setIsGmScreenVisible(false);
        setIsGmConsoleEnabled(enabled);
    }, []);
    // DESIGN_DECISIONS.md D33 - whether the GM console is available AT ALL,
    // a device preference (persistence/uiPrefs.ts) distinct from
    // `isGmConsoleEnabled` above (whether it's currently toggled ON for
    // this session). Defaults true ("available"), so out of the box
    // nothing about the Ctrl+Shift+G/dev-checkbox behavior above changes.
    // When false, the effect below turns the hotkey into a no-op and this
    // also forces `isGmConsoleEnabled` off (see handleSetGmConsoleAvailable).
    const [gmConsoleAvailable, setGmConsoleAvailableState] = useState<boolean>(() => getGmConsoleEnabled());
    const handleSetGmConsoleAvailable = useCallback((enabled: boolean) => {
        setGmConsoleAvailableState(enabled);
        setGmConsoleEnabled(enabled);
        if (!enabled) {
            updateGmConsoleEnabled(false);
        }
    }, [updateGmConsoleEnabled]);
    // DESIGN_DECISIONS.md D32 - whether GM Intervention's free-text input is
    // available at all (persistence/uiPrefs.ts), same device-preference
    // mold as above. Defaults true; passed straight through to
    // GameMasterScreen, which does the actual UI gating.
    const [gmInterventionAvailable, setGmInterventionAvailableState] = useState<boolean>(() => getGmInterventionEnabled());
    const handleSetGmInterventionAvailable = useCallback((enabled: boolean) => {
        setGmInterventionAvailableState(enabled);
        setGmInterventionEnabled(enabled);
    }, []);
    // D31 - the configuration menu's own open/closed flag. Purely transient
    // UI state, never part of the save bundle.
    const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
    const [isMockMode, setIsMockMode] = useState(false);
    // Set when a turn commits with the player still alive; an effect below
    // then runs the authored-event trigger check against the freshly
    // committed state and resolves the phase to AWAITING_EVENT_CHOICE or
    // AWAITING_PLAYER_INPUT. Transient orchestration only - never saved.
    const [isCheckingEvents, setIsCheckingEvents] = useState(false);

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedGameSummary | null>(loadSavedGameSummary);

    // LVX/NOX lighting. Nox Romae (design/nocturne.css) is an override
    // stylesheet loaded after styles.css; toggling swaps the whole client
    // between marble day and the torchlit night skin. Persisted so the
    // choice survives reloads. Presentation-only - never part of the save.
    const [isNox, setIsNox] = useState<boolean>(() => {
        try { return localStorage.getItem('gor-theme') === 'nox'; } catch { return false; }
    });

    useEffect(() => {
        let link = document.getElementById('nox-css') as HTMLLinkElement | null;
        if (!link && isNox) {
            link = document.createElement('link');
            link.id = 'nox-css';
            link.rel = 'stylesheet';
            link.href = nocturneUrl;
            document.head.appendChild(link);
        } else if (link) {
            link.disabled = !isNox;
        }
        try { localStorage.setItem('gor-theme', isNox ? 'nox' : 'lux'); } catch { /* private mode */ }
    }, [isNox]);

    // The Fates pacing posture (ROADMAP_PHASE_4.md 4D item 1, D23) - a
    // device-level USER PREFERENCE beside the theme/onboarding keys
    // (persistence/settings.ts), never part of the save bundle. This local
    // state only mirrors localStorage for the selector's rendering:
    // executeTurn re-reads the STORED value fresh at each turn's start, so
    // a change takes effect on the next turn without touching executeTurn's
    // dependency array.
    const [pacingPosture, setPacingPostureState] = useState<PacingPosture>(() => getPacingPosture());
    const handleSetPacingPosture = useCallback((posture: PacingPosture) => {
        setPacingPostureState(posture);
        setPacingPosture(posture);
    }, []);

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
    // DESIGN_DECISIONS.md D34 - bring-your-own-key. The player's own key
    // (persistence/apiKey.ts, entered via SettingsMenu) takes priority over
    // the dev-mode `.env` convenience (readDevApiKey, above); resolveApiKey
    // returns null when neither is set. Mirrors localStorage in local state
    // exactly like `pacingPosture` above, so saving/clearing a key in the
    // menu re-renders with the fresh value.
    const [userApiKey, setUserApiKeyState] = useState<string | null>(() => getApiKey());
    const resolvedApiKey = useMemo(() => resolveApiKey(userApiKey, readDevApiKey()), [userApiKey]);
    const handleSaveApiKey = useCallback((key: string) => {
        setApiKey(key);
        setUserApiKeyState(key);
    }, []);
    const handleClearApiKey = useCallback(() => {
        clearApiKey();
        setUserApiKeyState(null);
    }, []);
    // A real key is required only for REAL turns. The SDK constructor throws
    // in a browser when the key is unset, which would crash the app before
    // character select even in Mock Mode (which exists precisely to run
    // keyless). Fall back to a sentinel so the app always boots; Mock Mode
    // never calls the API, and executeTurn below short-circuits a real turn
    // with no key at all before ever reaching the network (see its
    // resolvedApiKey guard) rather than letting the sentinel hit an auth
    // error. Rebuilt (not a stable ref) whenever the resolved key changes,
    // so saving a new key in the configuration menu takes effect on the
    // very next AI call - an in-flight turn already holds the OLD client in
    // its own closure and simply finishes on it, which is fine.
    const ai = useMemo(
        () => new GoogleGenAI({ apiKey: resolvedApiKey || 'NO_API_KEY_SET' }),
        [resolvedApiKey]
    );
    // Snapshot of the committed game state taken right before a turn's AI
    // calls kick off, so a mid-turn failure can be rolled back to explicitly
    // rather than relying on "we just never committed" (P0.2/P0.4 - a
    // future refactor of the commit logic shouldn't silently break this).
    const preTurnSnapshotRef = useRef<SaveGameState | null>(null);
    const turnInFlightRef = useRef(false);

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
    const recipientOptions = useMemo(
        () => playerEntity ? knownRecipientOptionsForPlayer(playerEntity, entities, knowledge) : [],
        [playerEntity, entities, knowledge],
    );

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
    // The newest entry always retains its snapshot (the reducer's
    // KEEP_FULL_SNAPSHOTS window keeps at least the most recent entry), but
    // the field is optional on TurnHistoryEntry, so both reads guard for
    // absence rather than assuming it.
    const lastTurn = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
    const lastTurnPlayer = useMemo(
        () => lastTurn?.postTurnEntities?.find(e => e.entity_id === playerCharacterId) ?? null,
        [lastTurn, playerCharacterId]
    );
    const lastTurnPerceivedChanges = useMemo(
        () => (lastTurn?.postTurnEntities && lastTurnPlayer)
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
    // optionally overriding fields with just-computed values (a dispatch
    // doesn't change this render's state object, so a caller that just
    // committed new values must pass them explicitly rather than reading
    // the stale closure). See persistence/saveGame.ts for exactly which
    // game state this does (and doesn't) include, and why.
    const buildSaveState = useCallback((overrides: Partial<SaveGameState> = {}): SaveGameState => ({
        entities: state.entities,
        worldState: state.worldState,
        simulationState: state.simulationState,
        reports: state.reports,
        truthLedger: state.truthLedger,
        knowledge: state.knowledge,
        npcIntents: state.npcIntents,
        turnNumber: state.turnNumber,
        playerCharacterId: state.playerCharacterId,
        turnHistory: state.turnHistory,
        eventHistory: state.eventHistory,
        metaNarrative: state.metaNarrative,
        messages: state.messages,
        triggeredEventIds: state.triggeredEventIds,
        eventFirings: state.eventFirings,
        suggestedActions: state.suggestedActions,
        currentEvents: state.currentEvents,
        gmInterventionText: state.gmInterventionText,
        inferredAmbition: state.inferredAmbition,
        pendingIntelligenceFallout: state.pendingIntelligenceFallout,
        ...overrides,
    }), [state]);

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
    // default. D33 - a no-op entirely when `gmConsoleAvailable` (the
    // configuration menu's toggle) is false - including not preventing the
    // browser's default handling of the chord (see shouldToggleGmConsole).
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!shouldToggleGmConsole(event, gmConsoleAvailable)) return;
            event.preventDefault();
            updateGmConsoleEnabled(!isGmConsoleEnabled);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [gmConsoleAvailable, isGmConsoleEnabled, updateGmConsoleEnabled]);

    const addMessage = useCallback((message: Message) => {
        dispatch({ type: 'MESSAGE_ADDED', message });
    }, [dispatch]);

    useEffect(() => {
        if (isCheckingEvents) {
            // 4D.2 (D12): eligibility is decided by the per-event firing
            // records (repeatable + cooldown), not the legacy string set;
            // simulationState/turnNumber feed the sim-state-keyed triggers
            // and the cooldown arithmetic.
            // Known coordination gap: nothing suppresses a verbatim modal
            // fire for a premise the adjudicator wove into the turn that
            // just committed - "verbatim as the exception" (D12) is held
            // only by trigger rarity and cooldowns. The prompt's
            // never-pre-stage clause keeps content from duplicating, but a
            // same-turn weave-then-modal double-hit is possible; a
            // suppression gate is an owner-ruling candidate.
            const event = checkForTriggeredEvent(worldState, entities, eventFirings, playerEntity, simulationState, turnNumber);
            if (event) {
                dispatch({ type: 'EVENT_TRIGGERED', event });
            } else {
                dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            }
            queueMicrotask(() => setIsCheckingEvents(false));
        }
    }, [isCheckingEvents, worldState, entities, eventFirings, playerEntity, simulationState, turnNumber, dispatch]);

    const executeTurn = useCallback(async (submission: TurnSubmission, draftToRestore: string | StructuredTurnDraft) => {
        if (turnInFlightRef.current) return;
        turnInFlightRef.current = true;
        const serialized = serializeTurnSubmission(submission);
        const playerMessage: Message = { sender: 'player', text: serialized };
        const restoreDraft: string | StructuredTurnDraft = typeof draftToRestore === 'string'
            ? draftToRestore
            : {
                ...draftToRestore,
                actions: [...draftToRestore.actions],
                messagesOrOrders: draftToRestore.messagesOrOrders.map(row => ({
                    ...row,
                    recipient: row.recipient?.kind === 'known_entity'
                        ? { kind: 'known_entity', entityId: row.recipient.entityId }
                        : row.recipient?.kind === 'free_text'
                        ? { kind: 'free_text', text: row.recipient.text }
                        : null,
                })),
            };
        setPendingPlayerMessage(playerMessage);
        setTurnError(null);
        setRetrySubmission(null);
        setRetryDraft(null);
        dispatch({ type: 'TURN_STARTED', playerMessage });
        // Reset the thinking-theater/streaming state for this fresh attempt.
        // Defensive: both are already cleared by the previous turn's
        // success/error path below, but a stale value must never carry over.
        setTurnStage(null);
        setStreamingNarration('');
        const preTurnSnapshot = buildSaveState();
        preTurnSnapshotRef.current = preTurnSnapshot;

        const playerEntity = entities.find(e => e.entity_id === playerCharacterId);
        if (!playerEntity) {
            setPendingPlayerMessage(null);
            setRetrySubmission(submission);
            setRetryDraft(restoreDraft);
            setTurnError('The turn could not be resolved. Your draft has been restored; retry when you are ready.');
            dispatch({ type: 'TURN_ROLLED_BACK', snapshot: preTurnSnapshot });
            dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            if (typeof restoreDraft === 'string') setChatDraft(restoreDraft);
            else setStructuredDraft(restoreDraft);
            turnInFlightRef.current = false;
            return;
        }

        // DESIGN_DECISIONS.md D34 - Mock Mode keeps booting and playing
        // keyless exactly as before (commit 894f469); a REAL turn with
        // neither a player key nor a dev key resolved (see `ai` above)
        // would otherwise hit the network with the 'NO_API_KEY_SET'
        // sentinel and surface a raw provider auth error. Catching it here
        // instead - before any AI call - keeps the message small,
        // player-facing-safe, and pointed at the one thing that fixes it.
        if (!isMockMode && !resolvedApiKey) {
            setPendingPlayerMessage(null);
            setRetrySubmission(submission);
            setRetryDraft(restoreDraft);
            setTurnError('The turn could not be resolved. Your draft has been restored; retry when you are ready.');
            dispatch({ type: 'TURN_ROLLED_BACK', snapshot: preTurnSnapshot });
            dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            if (typeof restoreDraft === 'string') setChatDraft(restoreDraft);
            else setStructuredDraft(restoreDraft);
            turnInFlightRef.current = false;
            return;
        }

        // Snapshot the committed game state as it stands right before this
        // turn's AI calls kick off. State is only ever committed at the very
        // end of the try block below (after every AI call has succeeded), so
        // nothing here has changed yet - this snapshot is a defensive,
        // explicit rollback target rather than something we're relying on
        // "never having touched" to stay true across future refactors.
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
                ai,
                submission,
                playerEntity,
                turnNumber,
                entities,
                worldState,
                simulationState, // Pass the new state here
                turnHistory,
                reports,
                truthLedger,
                npcIntents,
                interventionTextForTurn,
                isMockMode,
                metaNarrative,
                // pacingPosture is read fresh from localStorage each turn
                // (never from the mirroring React state), so the Fates
                // selector takes effect on the NEXT turn with no
                // executeTurn dependency on it (D23 - a user preference,
                // not save state). eventFirings (4D.2, D24) lets runNewTurn
                // surface ripe/near authored events as GM-private
                // HISTORICAL MATERIAL in the adjudication prompt.
                { onStage: setTurnStage, onNarrationChunk: setStreamingNarration, pacingPosture: getPacingPosture(), eventFirings }
            );

            // COMMIT STATE
            const newWorldState = ((): WorldState => {
                let newWeek = worldState.week + 1;
                let newYear = worldState.year;
                if (newWeek > 52) { newWeek = 1; newYear += 1; }
                return { ...result.updatedWorldState, year: newYear, week: newWeek };
            })();
            // Add post-turn entity state to history for GM view
            const historyEntryWithState = { ...result.newHistoryEntry, playerIntent: serialized, postTurnEntities: result.updatedEntities };
            // Bound the snapshot window HERE, once, because this same array
            // feeds BOTH the TURN_COMMITTED dispatch and the autosave below -
            // the reducer's own trim only bounds in-memory state, so an
            // autosave built from the raw array would persist every snapshot
            // (and re-persist all of a legacy save's per-entry snapshots each
            // session). Applying it here also self-heals such legacy saves on
            // their first commit; the reducer's trim is idempotent on the
            // already-bounded array.
            const newTurnHistory = withOldSnapshotsDropped([...turnHistory, historyEntryWithState]);
            const newTurnNumber = turnNumber + 1;

            // D21 knowledge-store ingestion (knowledge/commit.ts): the next
            // store is computed from the SAME D5-filtered digest the player
            // is about to see (the identical buildPerceivedDigest inputs the
            // lastTurnPerceivedChanges memo will re-derive from this history
            // entry) plus this turn's NEW Reports - never from raw deltas or
            // anything GM-private. The helper owns the new-report id filter
            // and stamps every update with the authoritative `turnNumber`
            // (never a model-authored turn field). Committed atomically with
            // the rest of the turn below, so a rolled-back turn ingests
            // nothing.
            const playerAfterTurn = result.updatedEntities.find(e => e.entity_id === playerCharacterId) ?? null;
            const perceivedThisTurn = playerAfterTurn
                ? buildPerceivedDigest(historyEntryWithState.adjudication.deltas, playerAfterTurn, result.updatedEntities, newWorldState)
                : [];
            const newKnowledge = computeTurnKnowledge({
                prev: knowledge,
                perceivedChanges: perceivedThisTurn,
                reportsBefore: reports,
                reportsAfter: result.updatedReports,
                turnNumber,
            });
            const gmMessage: Message = { sender: 'gm', text: result.narration };
            const monologueMessage: Message = { sender: 'player_monologue', text: result.playerMonologue };
            // Week-advance ribbon written into the stream once the turn commits
            // (rendered as a TurnRibbon divider, not a speech bubble).
            const ribbonMessage: Message = { sender: 'ribbon', text: `Week ${toRoman(newWorldState.week)} · The chronicler sets down the day` };

            // The single atomic commit for this turn (state/gameReducer.ts's
            // TURN_COMMITTED): entities, world, history, chat log, pills and
            // headlines - plus consuming the fallout queue and the GM
            // intervention text this turn was handed (`interventionTextForTurn`,
            // built from them above) - land in ONE state transition. A
            // failed/rolled-back attempt never dispatches this, so both
            // survive untouched for a retry. If the player died this turn,
            // the reducer resolves the phase straight to GAME_OVER (D1).
            const nextSaveState = buildSaveState({
                entities: result.updatedEntities,
                worldState: newWorldState,
                simulationState: result.updatedSimulationState,
                reports: result.updatedReports,
                truthLedger: result.updatedTruthLedger,
                knowledge: newKnowledge,
                npcIntents: result.updatedNpcIntents,
                turnNumber: newTurnNumber,
                turnHistory: newTurnHistory,
                messages: [...messages, playerMessage, gmMessage, monologueMessage, ribbonMessage],
                suggestedActions: result.suggestedActions,
                currentEvents: result.headlines,
                gmInterventionText: '',
                pendingIntelligenceFallout: [],
            });
            if (!saveGame(nextSaveState).ok) {
                throw new Error('AUTOSAVE_FAILED');
            }
            dispatch({
                type: 'TURN_COMMITTED',
                entities: result.updatedEntities,
                worldState: newWorldState,
                simulationState: result.updatedSimulationState,
                reports: result.updatedReports,
                truthLedger: result.updatedTruthLedger,
                knowledge: newKnowledge,
                npcIntents: result.updatedNpcIntents,
                turnNumber: newTurnNumber,
                turnHistory: newTurnHistory,
                playerMessage,
                gmMessage,
                monologueMessage,
                ribbonMessage,
                suggestedActions: result.suggestedActions,
                currentEvents: result.headlines,
            });
            // The final, parsed narration message above now replaces the
            // transient streaming bubble - clear the thinking-theater state
            // so it can't linger into the next AWAITING_PLAYER_INPUT render.
            setTurnStage(null);
            setStreamingNarration('');

            // DESIGN_DECISIONS.md D1 - survival-only: ONLY the player's own
            // death ends the run. Once it does, skip the event-trigger check
            // entirely (an event modal popping over a terminal epilogue
            // makes no sense) - TURN_COMMITTED above already resolved the
            // phase to GameState.GAME_OVER, and App.tsx's render then swaps
            // the whole chat pane for EpilogueScreen. Exile/missing are NOT
            // terminal (see isPlayerExiledOrMissing above) - only 'dead'
            // triggers this.
            const updatedPlayerEntity = result.updatedEntities.find(e => e.entity_id === playerCharacterId);
            const diedThisTurn = updatedPlayerEntity?.status === 'dead';

            if (!diedThisTurn) {
                // Flag that the turn is over and events should be checked
                setIsCheckingEvents(true);
            }

            if (submission.kind === 'freeform') setChatDraft('');
            else setStructuredDraft(emptyStructuredDraft());
            setPendingPlayerMessage(null);
            setTurnError(null);

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
                const recentIntents = newTurnHistory
                    .map(historyEntry => deserializeTurnSubmission(historyEntry.playerIntent))
                    .map(historySubmission => historySubmission && projectForExternalInference(historySubmission))
                    .filter((intent): intent is string => intent !== null)
                    .slice(-6);
                const recentHeadlines = newTurnHistory.slice(-3).flatMap(h => h.adjudication.headlines);
                const ambitionTurnNumber = turnNumber;
                inferAmbition(ai, updatedPlayerEntity, recentIntents, recentHeadlines, isMockMode)
                    .then(inference => {
                        const nextAmbition: InferredAmbitionState = { ...inference, asOfTurn: ambitionTurnNumber };
                        // Let the turn transaction settle first. This out-of-band
                        // enrichment must never interleave with its durable commit.
                        setTimeout(() => {
                        dispatch({ type: 'AMBITION_INFERRED', inferredAmbition: nextAmbition });
                        // Persist by PATCHING only the ambition field into
                        // whatever autosave is newest at the moment this
                        // resolves. A full saveGame(buildSaveState(...)) here
                        // would write the stale turn snapshot this callback
                        // closed over - if the player committed another turn
                        // while inference was in flight, that would clobber
                        // the newer autosave and lose those turns on reload.
                        updateSavedAmbition(nextAmbition);
                        }, 50);
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

            setPendingPlayerMessage(null);
            setRetrySubmission(submission);
            setRetryDraft(restoreDraft);
            setTurnError('The turn could not be resolved. Your draft has been restored; retry when you are ready.');

            // Roll back to the pre-turn snapshot. In practice nothing above
            // was committed yet, but restore explicitly (rather than relying
            // on that invariant) so a future change to the commit ordering
            // can't silently leave the game half-updated after a failure.
            const snapshot = preTurnSnapshotRef.current;
            if (snapshot) {
                dispatch({ type: 'TURN_ROLLED_BACK', snapshot });
            }

            dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            if (typeof restoreDraft === 'string') setChatDraft(restoreDraft);
            else setStructuredDraft(restoreDraft);
        } finally {
            turnInFlightRef.current = false;
        }
    }, [ai, buildSaveState, dispatch, entities, eventFirings, gmInterventionText, isMockMode, knowledge, messages, metaNarrative, npcIntents, pendingIntelligenceFallout, playerCharacterId, reports, resolvedApiKey, simulationState, truthLedger, turnHistory, turnNumber, worldState]);

    const handleComposerSubmit = (draft: string | StructuredTurnDraft) => {
        if (gameState !== GameState.AWAITING_PLAYER_INPUT) return;
        const candidate: TurnSubmission | StructuredTurnDraft = typeof draft === 'string'
            ? { version: 1, kind: 'freeform', text: draft }
            : draft;
        const normalized = validateAndNormalizeTurnSubmission(candidate, { knownRecipients: recipientOptions });
        if (!normalized.ok) return;
        void executeTurn(deepFreezeTurnSubmission(normalized.submission), draft);
    };
    
    const startGameWithCharacter = (characterEntity: Entity, allInitialEntities: Entity[], initialWorldState?: WorldState, initialMetaNarrative?: string) => {
        const resolvedWorldState = initialWorldState ?? worldState;
        const resolvedMetaNarrative = initialMetaNarrative ?? metaNarrative;

        const introMessage: Message = {
            sender: 'gm',
            text: `You have chosen to be **${characterEntity.name}**.\n\n${characterEntity.current_state_narrative}\n\nThe world holds its breath. What is your first action?`
        };

        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 6 - seed the suggested-action
        // pills from the chosen character's own goals (pure, no AI call - see
        // components/starterActions.ts) so turn 1 isn't a blank page.
        const starterActions = deriveStarterActions(characterEntity);

        const candidate = buildSaveState({ entities: allInitialEntities, worldState: resolvedWorldState, metaNarrative: resolvedMetaNarrative, playerCharacterId: characterEntity.entity_id, messages: [...messages, introMessage], suggestedActions: starterActions });
        if (!saveGame(candidate).ok) {
            setTransactionError('Your campaign could not be saved. Please try again.');
            return;
        }
        setTransactionError(null);
        dispatch({
            type: 'GAME_STARTED',
            entities: allInitialEntities,
            playerCharacterId: characterEntity.entity_id,
            introMessage,
            suggestedActions: starterActions,
            worldState: initialWorldState,
            metaNarrative: initialMetaNarrative,
        });

        // Show the first-turn onboarding overlay exactly once ever, on
        // whichever device/browser hasn't dismissed it yet - covers both a
        // preset character (handleSelectCharacter) and a custom-created one
        // (handleCustomCreation), since both call this function. Never
        // fires from handleContinue, which restores `showOnboarding`'s
        // default of `false` implicitly (it isn't part of SaveGameState).
        if (!hasSeenOnboarding()) {
            setShowOnboarding(true);
        }

    };

    const handleSelectCharacter = (option: PlayerCharacterOption) => {
        // The session call log (ai/core/geminiService.ts) is per-campaign-
        // session: reset it at every campaign boundary, BEFORE the new
        // campaign's first AI call, so calls from a previous campaign in the
        // same tab can't contaminate this campaign's eval-corpus export.
        // Same constraint in handleCustomCreation and handleContinue.
        resetSessionCallLog();
        const playerEntity = ALL_INITIAL_ENTITIES.find(e => e.entity_id === option.entity_id);
        if(playerEntity) {
            startGameWithCharacter(playerEntity, JSON.parse(JSON.stringify(ALL_INITIAL_ENTITIES)));
        }
    };

    const handleCustomCreation = async ({ description, metaNarrative: newMetaNarrative, useCustomGamestate }: { description: string, metaNarrative?: string, useCustomGamestate: boolean }) => {
        // Per-campaign-session log (see handleSelectCharacter). Reset here -
        // not in startGameWithCharacter - so the world/character-generation
        // calls made just below already belong to the NEW campaign's log.
        resetSessionCallLog();
        if (useCustomGamestate && newMetaNarrative) {
            // New world generation logic
            const { worldState: newWorldState, entities: newEntities, playerCharacterId: newPlayerId } = await initiateWorld(ai, newMetaNarrative, description, isMockMode);
            const playerChar = newEntities.find(e => e.entity_id === newPlayerId);
            if (playerChar) {
                startGameWithCharacter(playerChar, newEntities, newWorldState, newMetaNarrative);
            } else {
                 addMessage({ sender: 'gm', text: "Error: Failed to generate a valid player character in the new world."});
            }
        } else {
            // Existing custom character in default world
            const newCharacter = await createCharacter(ai, description, isMockMode);
            const finalEntities = ALL_INITIAL_ENTITIES.find(e => e.entity_id === newCharacter.entity_id) 
                ? ALL_INITIAL_ENTITIES.map(e => e.entity_id === newCharacter.entity_id ? newCharacter : e)
                : [...ALL_INITIAL_ENTITIES, newCharacter];
            startGameWithCharacter(newCharacter, JSON.parse(JSON.stringify(finalEntities)));
        }
    };

    const handleSpendResource = (resourceName: 'deep_analyses' | 'investigations', cost: number): boolean => {
        if (turnInFlightRef.current) return false;
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentAmount = (newResources[resourceName] as number) || 0;
                newResources[resourceName] = Math.max(0, currentAmount - cost);
                return {...e, resources: newResources};
            }
            return e;
        });
        if (!saveGame(buildSaveState({ entities: newEntities })).ok) {
            setTransactionError('Your change could not be saved. Please try again.');
            return false;
        }
        setTransactionError(null);
        dispatch({ type: 'RESOURCE_SPENT', entities: newEntities });
        return true;
    };

    // One reveal = one atomic commit. The investigation spend, any blackmail
    // filing (secrets), and the fallout-queue append MUST all land in a
    // single state+save pass: the previous per-concern handlers (spend /
    // blackmail / fallout) each rebuilt the whole save bundle from stale
    // closures, so whichever ran last silently reverted the others' fields -
    // the spend vanished from the save on any secrets reveal, and on ANY
    // reveal that carried consequences.
    //
    // The fallout half keeps ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 /
    // DESIGN_DECISIONS.md D5 semantics verbatim: queue the consequence for
    // the next turn (components/investigationLoop.ts), surface only a
    // subtle in-fiction hint now - the raw text is GM-console-only
    // (GameMasterScreen's "Pending Intelligence Fallout" line) until next
    // turn's narration reinterprets it.
    const handleInvestigationOutcome = (
        kind: 'beliefs' | 'scheme' | 'secrets',
        targetId: string,
        reportData: unknown,
        cost: number,
        result: InvestigationResult,
    ): boolean => {
        if (turnInFlightRef.current) return false;
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentInv = (newResources.investigations as number) || 0;
                newResources.investigations = Math.max(0, currentInv - cost);
                if (kind === 'secrets' && Array.isArray(reportData)) {
                    const resourceKey = `blackmail_on_${targetId}`;
                    const existingSecrets = (newResources[resourceKey] as string[]) || [];
                    newResources[resourceKey] = Array.from(new Set([...existingSecrets, ...(reportData as string[])]));
                }
                return {...e, resources: newResources};
            }
            return e;
        });
        const nextFallout = appendFallout(pendingIntelligenceFallout, result);
        // D14/D21 - the bought reveal is ingested into the knowledge store
        // (knowledge/commit.ts) in the SAME atomic commit as the spend, so
        // the intel finally persists (in state and in the save) instead of
        // evaporating with DramatisPersonaeTab's component-local display
        // state. Only the player-facing report text is ingested - never the
        // resolution trace or anything GM-private.
        const nextKnowledge = computeInvestigationKnowledge({
            prev: knowledge,
            targetId,
            kind,
            reportText: result.report,
            turnNumber,
        });

        const falloutMessage: Message | undefined = hasFallout(result.consequences)
            ? { sender: 'gm', text: 'Your agent returns — but something in their manner suggests the visit did not go unnoticed.' }
            : undefined;
        if (!saveGame(buildSaveState({ entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, messages: falloutMessage ? [...messages, falloutMessage] : messages })).ok) {
            setTransactionError('Your investigation could not be saved. Please try again.');
            return false;
        }
        setTransactionError(null);
        dispatch({ type: 'INVESTIGATION_COMMITTED', entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, falloutMessage });

        if (hasFallout(result.consequences)) {
            // The visible hint was included in the candidate transaction above.
            /* addMessage({
                sender: 'gm',
                text: "Your agent returns — but something in their manner suggests the visit did not go unnoticed."
            }); */
        }
        return true;
    };

    const handleSetIntervention = (text: string): boolean => {
        if (turnInFlightRef.current) return false;
        if (!saveGame(buildSaveState({ gmInterventionText: text })).ok) {
            setTransactionError('The directive could not be saved. Please try again.');
            return false;
        }
        setTransactionError(null);
        dispatch({ type: 'GM_INTERVENTION_SET', text });
        return true;
    };
    
    const handleEventChoice = useCallback((choice: PlayerEventChoice) => {
        if (turnInFlightRef.current || !activeEvent || !playerEntity) return;

        const newEventHistoryEntry: EventHistoryEntry = {
            eventId: activeEvent.id,
            eventTitle: activeEvent.title,
            choiceText: choice.text,
            turnNumber: turnNumber,
        };

        const { updatedEntities, updatedWorldState } = applyEventChoiceDeltas(choice, playerEntity, entities, worldState, turnNumber);
        const eventMessage: Message = { sender: 'gm', text: `**Event: ${activeEvent.title}**\nYou chose to: *${choice.text}*`};
        const newEventHistory = [...eventHistory, newEventHistoryEntry];
        // 4D.2 (D12): both bookkeeping shapes advance together - the legacy
        // deduped ever-fired set (a repeat firing never duplicates its id)
        // and the turn-stamped records the cooldown logic reads.
        const { triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings } =
            recordEventFiring(triggeredEventIds, eventFirings, activeEvent.id, turnNumber);

        // The single atomic commit for this event choice
        // (state/gameReducer.ts's EVENT_CHOICE_APPLIED): deltas, chat log,
        // event history, seen-ids and modal close land in one state
        // transition. DESIGN_DECISIONS.md D1 - an authored event choice's
        // deltas can also kill the player (applyEventChoiceDeltas), not just
        // the adjudicated turn pipeline - the reducer applies the exact same
        // GAME_OVER check as TURN_COMMITTED.
        if (!saveGame(buildSaveState({ entities: updatedEntities, worldState: updatedWorldState, eventHistory: newEventHistory, triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings, messages: [...messages, eventMessage] })).ok) {
            setTransactionError('Your choice could not be saved. Please try again.');
            return;
        }
        setTransactionError(null);
        dispatch({
            type: 'EVENT_CHOICE_APPLIED',
            entities: updatedEntities,
            worldState: updatedWorldState,
            eventMessage,
            eventHistory: newEventHistory,
            triggeredEventIds: newTriggeredEventIds,
            eventFirings: newEventFirings,
        });

    }, [activeEvent, buildSaveState, dispatch, entities, eventFirings, eventHistory, messages, playerEntity, triggeredEventIds, turnNumber, worldState]);

    const handleContinue = useCallback(() => {
        const save = loadGame();
        if (!save) {
            setSavedGameInfo(null);
            return;
        }
        // Per-campaign-session log (see handleSelectCharacter): the loaded
        // campaign starts a fresh session log, dropping any calls a prior
        // campaign made in this tab.
        resetSessionCallLog();
        // GAME_LOADED (state/gameReducer.ts) restores the whole campaign in
        // one state transition: it normalizes the optional save fields
        // (inferredAmbition, pendingIntelligenceFallout - absent on older
        // saves) and re-derives the terminal state from the loaded player
        // entity's status (DESIGN_DECISIONS.md D1 - only death is terminal;
        // GAME_OVER itself is never persisted, only the underlying entities
        // are, and a save CAN legitimately be reloaded on an already-ended
        // run when the player closed the tab on the epilogue screen).
        dispatch({ type: 'GAME_LOADED', save: save.state });
    }, [dispatch]);

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
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <Header
                worldState={worldState}
                isMockMode={isMockMode}
                setIsMockMode={setIsMockMode}
                isGmConsoleEnabled={isGmConsoleEnabled}
                setIsGmConsoleEnabled={(enabled) => {
                    if (gmConsoleAvailable) {
                        updateGmConsoleEnabled(enabled);
                    }
                }}
                onOpenSettings={() => setIsSettingsMenuOpen(true)}
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
                    style={{ width: '100%', background: 'linear-gradient(180deg,#2A231A,#1B1509)', color: '#D9C89E', borderTop: '1px solid rgba(201,162,39,.35)', borderBottom: '1px solid rgba(201,162,39,.35)', padding: '8px 16px', textAlign: 'center', boxShadow: '0 2px 6px rgba(58,44,16,.3)', animation: 'gorFadeIn .5s ease-out both' }}
                >
                    <p style={{ margin: 0, fontStyle: 'italic', fontSize: 15 }}>
                        {playerEntity.status === 'exiled'
                            ? `You scheme from exile in ${playerEntity.location}.`
                            : `You have gone missing — last seen near ${playerEntity.location}. The world does not know if you yet live.`}
                    </p>
                </div>
            )}
            <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                {gameState === GameState.GAME_OVER && playerEntity ? (
                    <EpilogueScreen
                        player={playerEntity}
                        causeNarration={lastGmNarration}
                        mortalityOutcomeSummary={finalMortalityOutcomeSummary}
                        turnHistory={turnHistory}
                        eventHistory={eventHistory}
                        metaNarrative={metaNarrative}
                        inferredAmbition={inferredAmbition}
                        ai={ai}
                        isMockMode={isMockMode}
                    />
                ) : (
                    <>
                        <section data-screen-label="Chat" style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            {gameState === GameState.SETUP && transactionError && <p role="alert">{transactionError}</p>}
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
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} role="log" aria-live="polite" aria-label="Chat log">
                                        {messages.map((msg, index) => <ChatMessage key={index} message={msg} />)}
                                        {pendingPlayerMessage && <ChatMessage message={pendingPlayerMessage} />}
                                        {gameState === GameState.PROCESSING && (
                                            streamingNarration
                                                ? <StreamingNarrationBubble text={streamingNarration} />
                                                : <TypingIndicator stage={turnStage} />
                                        )}
                                        {gameState !== GameState.PROCESSING && lastTurn && (
                                            <DispatchesDigest changes={lastTurnPerceivedChanges} />
                                        )}
                                        <div ref={messagesEndRef} />
                                    </div>
                                    <div style={{ flex: 'none', borderTop: '1px solid var(--border-subtle)', padding: '12px 24px 16px', background: 'rgba(255,254,249,.55)' }}>
                                        {(turnError || transactionError) && <p role="alert">{turnError ?? transactionError}</p>}
                                        {gameState === GameState.AWAITING_PLAYER_INPUT && retrySubmission && retryDraft && (
                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, animation: 'gorRise .4s ease-out both' }}>
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => void executeTurn(retrySubmission, retryDraft)}
                                                    aria-label="Retry the last action"
                                                >
                                                    ↻ Retry the last action
                                                </Button>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                            <TurnComposer
                                                chatDraft={chatDraft}
                                                structuredDraft={structuredDraft}
                                                recipientOptions={recipientOptions}
                                                suggestedActions={suggestedActions}
                                                onChatDraftChange={setChatDraft}
                                                onStructuredDraftChange={setStructuredDraft}
                                                onSubmit={handleComposerSubmit}
                                                disabled={gameState !== GameState.AWAITING_PLAYER_INPUT}
                                                isProcessing={gameState === GameState.PROCESSING}
                                                turnStage={turnStage}
                                            />
                                            {isGmConsoleEnabled && (
                                                <Tooltip wide label={turnHistory.length > 0 ? "The Fates' ledger — every thread and die of the simulation, recorded." : 'The ledger opens once a turn has been played.'}>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => setIsGmScreenVisible(true)}
                                                        aria-label="Open Game Master Screen"
                                                        disabled={turnHistory.length === 0}
                                                    >
                                                        GM Log
                                                    </Button>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>

                        <SidePanel
                            gameState={gameState}
                            playerEntity={playerEntity}
                            entities={entities}
                            currentEvents={currentEvents}
                            worldState={worldState}
                            simulationState={simulationState}
                            reports={reports}
                            knowledge={knowledge}
                            turnNumber={turnNumber}
                            onSpendDeepAnalysis={(cost) => handleSpendResource('deep_analyses', cost)}
                            onInvestigationOutcome={handleInvestigationOutcome}
                            ai={ai}
                            isMockMode={isMockMode}
                            eventHistory={eventHistory}
                            pulsingTabs={pulsingTabs}
                        />
                    </>
                )}
            </main>
            {/* Fixed bottom-right chrome: the Fates pacing selector (4D.1,
                D23) beside the LVX/NOX lighting toggle. Both are device
                preferences persisted in localStorage, never save state. */}
            <div style={{ position: 'fixed', bottom: 14, right: 14, zIndex: 80, display: 'flex', gap: 10 }}>
                <div role="group" aria-label="The Fates: how patiently fortune paces the story" style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', boxShadow: 'var(--shadow-raised)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.14em' }}>
                    <span aria-hidden="true" style={{ padding: '6px 10px', background: 'var(--surface-card)', color: 'var(--gold-700)' }}>FATES</span>
                    {FATES_OPTIONS.map(({ posture, label, title }) => (
                        <button key={posture} type="button" aria-pressed={pacingPosture === posture} title={title} onClick={() => handleSetPacingPosture(posture)} style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', borderLeft: '1px solid var(--border-subtle)', background: pacingPosture === posture ? 'var(--gold-600)' : 'var(--surface-card)', color: pacingPosture === posture ? '#241C11' : 'var(--text-muted)' }}>{label}</button>
                    ))}
                </div>
                <div role="group" aria-label="Lighting: marble day or torchlit night" style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', boxShadow: 'var(--shadow-raised)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.14em' }}>
                    <button type="button" aria-pressed={!isNox} title="Marble — day" onClick={() => setIsNox(false)} style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', background: !isNox ? 'var(--gold-600)' : 'var(--surface-card)', color: !isNox ? '#241C11' : 'var(--text-muted)' }}>LVX</button>
                    <button type="button" aria-pressed={isNox} title="Nox Romae — torchlit" onClick={() => setIsNox(true)} style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', borderLeft: '1px solid var(--border-subtle)', background: isNox ? 'var(--gold-600)' : 'var(--surface-card)', color: isNox ? '#241C11' : 'var(--text-muted)' }}>NOX</button>
                </div>
            </div>
            {isGmConsoleEnabled && isGmScreenVisible && <GameMasterScreen
                history={turnHistory}
                onClose={() => setIsGmScreenVisible(false)}
                interventionText={gmInterventionText}
                onSetIntervention={handleSetIntervention}
                interactionLocked={gameState === GameState.PROCESSING}
                playerCharacterId={playerCharacterId}
                worldState={worldState}
                turnNumber={turnNumber}
                inferredAmbition={inferredAmbition}
                pendingIntelligenceFallout={pendingIntelligenceFallout}
                truthLedger={truthLedger}
                reports={reports}
                knowledge={knowledge}
                npcIntents={npcIntents}
                gmInterventionEnabled={gmInterventionAvailable}
            />}
            {activeEvent && <EventModal event={activeEvent} onChoose={handleEventChoice} />}
            {showOnboarding && gameState === GameState.AWAITING_PLAYER_INPUT && (
                <OnboardingOverlay isOpen={showOnboarding} onClose={handleCloseOnboarding} />
            )}
            {isSettingsMenuOpen && (
                <SettingsMenu
                    onClose={() => setIsSettingsMenuOpen(false)}
                    apiKey={userApiKey}
                    onSaveApiKey={handleSaveApiKey}
                    onClearApiKey={handleClearApiKey}
                    pacingPosture={pacingPosture}
                    onSetPacingPosture={handleSetPacingPosture}
                    gmConsoleEnabled={gmConsoleAvailable}
                    onSetGmConsoleEnabled={handleSetGmConsoleAvailable}
                    gmInterventionEnabled={gmInterventionAvailable}
                    onSetGmInterventionEnabled={handleSetGmInterventionAvailable}
                />
            )}
        </div>
    );
};

export default App;
