import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { GameState, Entity, PlayerCharacterOption, Message, InvestigationResult, PlayerEventChoice, EventHistoryEntry, StructuredTurnDraft, TurnSubmission } from './types';

import Header from './components/Header';
import CharacterSelection, { SavedGameSummary } from './components/CharacterSelection';
import { ChatMessage, TypingIndicator, StreamingNarrationBubble, illuminatedNarrationIndices } from './components/Chat';
import { TurnComposer } from './components/TurnComposer';
import { PrivateScene, replacePrivateSceneForCommit } from './components/PrivateScene';
import CrisisBanner from './components/CrisisBanner';
import { crisisGrade } from './components/crisisGrade';
import DispatchesDigest from './components/DispatchesDigest';
import SidePanel from './components/SidePanel';
import GameMasterScreen from './components/GameMasterScreen';
import EventModal from './components/EventModal';
import EpilogueScreen from './components/EpilogueScreen';
import OnboardingOverlay from './components/OnboardingOverlay';
import SettingsMenu from './components/SettingsMenu';
import { deriveStarterActions } from './components/starterActions';
import { ALL_INITIAL_ENTITIES } from './constants/baseScenario';
import { TurnStage } from './ai/core/turn';
import { WorldState } from './types';
import { useGame } from './state/GameContext';
import type { DomainMutationContext, RunDomainMutation } from './state/domainMutation';
import { createCharacter } from './ai/tools/characterCreator';
import { checkForTriggeredEvent, applyEventChoiceDeltas, recordEventFiring } from './events/engine';
import { initiateWorld } from './ai/core/initiator';
import { resetSessionCallLog } from './ai/core/geminiService';
import { saveGame, loadGame, clearSave, hasSave, importSaveBlob, SaveGameState, InferredAmbitionState } from './persistence/saveGame';
import { hasSeenOnboarding, markOnboardingSeen } from './persistence/onboarding';
import { buildPlayerPerceivedDigest, projectPrivateSceneForPlayer, TabId } from './perception/visibility';
import {
    PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
    eligiblePrivateSceneTargets,
    beginPrivateScene,
    appendPrivateSceneExchange,
    endPrivateScene,
    finalizePrivateScene,
    type PrivateSceneRecord,
} from './privateScene/model';
import { continuePrivateScene } from './ai/tools/privateScene';
import { computeInvestigationKnowledge } from './knowledge/commit';
import { ingestOccurrenceFinding, type OccurrenceQuestion } from './knowledge/store';
import {
    buildInvestigationRelationshipEvidence,
    knownRecipientOptionsForPlayer,
} from './knowledge/relationships';
import { getRelationshipObservations } from './ai/tools/relationshipObservations';
import { emptyStructuredDraft } from './playerInput/composerState';
import {
    validateAndNormalizeTurnSubmission,
    deepFreezeTurnSubmission,
} from './playerInput/turnSubmission';
import { appendFallout, hasFallout } from './components/investigationLoop';
import { Button } from './components/ui/Core';
import {
    OfflineStrip, TurnFailureNotice, useOnline, type TurnFailure,
} from './components/ui/FailureNotices';
import { Tooltip } from './components/ui/Feedback';
import { useExecuteTurn } from './hooks/useExecuteTurn';
import { useSettings } from './hooks/useSettings';
import { useGmConsole } from './hooks/useGmConsole';
import { useWeekBeat } from './hooks/useWeekBeat';
import { useDevSmokeTest, useScrollToLatest, useUnloadGuardWhileProcessing } from './hooks/useShellEffects';
import {
    type TransactionNote, type DomainCommit,
    loadSavedGameSummary, newestInferredAmbition, isSameCampaignPrefix,
    privateScenesFingerprint, pickSaveState,
} from './app/transactions';
import { TransactionNoteView, downloadTheReign } from './app/TransactionNoteView';


// --- MAIN APP ---

const App: React.FC = () => {
    // Every game-domain slice lives in the reducer behind GameContext
    // (state/gameReducer.ts, DESIGN_DECISIONS.md D17) - in particular, every
    // slice buildSaveState persists MUST come from there, never from a local
    // useState. App.tsx stays the composition root: children receive plain
    // props, never the context itself. Only transient, presentation-only
    // state (input box, modal flags, streaming text, theme, retry
    // affordances) may live in the local useState hooks below.
    const { state, dispatch, getStateGeneration } = useGame();
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
    // WP-21: WHICH failure, not a sentence. All the copy lives in
    // components/ui/FailureNotices.tsx, so the four kinds cannot drift
    // apart into four differently-worded versions of "try again".
    const [turnFailure, setTurnFailure] = useState<TurnFailure | null>(null);
    const [transactionNote, setTransactionNote] = useState<TransactionNote | null>(null);
    // navigator.onLine plus its two events — no network call, no polling.
    const online = useOnline();
    const [domainMutationInFlight, setDomainMutationInFlight] = useState(false);
    const { weekBeat, strikeWeekBeat } = useWeekBeat();
    const {
        isSettingsMenuOpen, openSettings, closeSettings,
        isMockMode, setIsMockMode,
        isNox, setIsNox,
        pacingPosture, handleSetPacingPosture,
        userApiKey, resolvedApiKey, handleSaveApiKey, handleClearApiKey,
        ai,
    } = useSettings();
    const {
        isGmScreenVisible, openGmScreen, closeGmScreen,
        isGmConsoleEnabled, handleSetGmConsoleOpen,
        gmConsoleAvailable, handleSetGmConsoleAvailable,
        gmInterventionAvailable, handleSetGmInterventionAvailable,
    } = useGmConsole();
    // Set when a turn commits with the player still alive; an effect below
    // then runs the authored-event trigger check against the freshly
    // committed state and resolves the phase to AWAITING_EVENT_CHOICE or
    // AWAITING_PLAYER_INPUT. Transient orchestration only - never saved.
    const [isCheckingEvents, setIsCheckingEvents] = useState(false);
    const [privateSceneOpeningDraft, setPrivateSceneOpeningDraft] = useState('');
    const [privateSceneReplyDraft, setPrivateSceneReplyDraft] = useState('');
    const [privateSceneLastWordDraft, setPrivateSceneLastWordDraft] = useState('');
    const [privateSceneError, setPrivateSceneError] = useState<string | null>(null);
    // A failed event-choice save renders in-modal (EventModal is a
    // role="dialog" with no close affordance, so the composer-strip alert
    // behind it via `transactionError` would be invisible) - mirrors
    // privateSceneError above.
    const [eventChoiceError, setEventChoiceError] = useState<string | null>(null);

    // Transient UI state for the persistence/retry flow (P0.2/P0.3 - see
    // ROADMAP_3_UX_INTERACTIONS.md and ROADMAP_5_TECH_PERFORMANCE.md). Never
    // part of the save bundle - see persistence/saveGame.ts.
    const [savedGameInfo, setSavedGameInfo] = useState<SavedGameSummary | null>(loadSavedGameSummary);

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

    // Snapshot of the committed game state taken right before a turn's AI
    // calls kick off, so a mid-turn failure can be rolled back to explicitly
    // rather than relying on "we just never committed" (P0.2/P0.4 - a
    // future refactor of the commit logic shouldn't silently break this).
    const preTurnSnapshotRef = useRef<SaveGameState | null>(null);
    const domainMutationLeaseRef = useRef<symbol | null>(null);
    const privateSceneLockRef = useRef(false);
    const privateScenesRef = useRef<PrivateSceneRecord[]>(state.privateScenes);
    const appMountedRef = useRef(true);
    const campaignGenerationRef = useRef(0);
    const latestInferredAmbitionRef = useRef<InferredAmbitionState | null>(inferredAmbition);

    useEffect(() => {
        appMountedRef.current = true;
        return () => {
            appMountedRef.current = false;
            campaignGenerationRef.current += 1;
            domainMutationLeaseRef.current = null;
        };
    }, []);

    useEffect(() => {
        latestInferredAmbitionRef.current = newestInferredAmbition(
            latestInferredAmbitionRef.current,
            inferredAmbition,
        );
    }, [inferredAmbition]);

    const runDomainMutation = useCallback<RunDomainMutation>(async <T,>(work: (context: DomainMutationContext) => T | Promise<T>, options: { allowDuringPrivateScene?: boolean } = {}) => {
        if (domainMutationLeaseRef.current || (privateSceneLockRef.current && !options.allowDuringPrivateScene)) {
            return { acquired: false };
        }
        const lease = Symbol('domain-mutation');
        domainMutationLeaseRef.current = lease;
        if (appMountedRef.current) setDomainMutationInFlight(true);
        const context: DomainMutationContext = {
            isCurrent: () => appMountedRef.current && domainMutationLeaseRef.current === lease,
        };
        try {
            return { acquired: true, value: await work(context) };
        } finally {
            if (domainMutationLeaseRef.current === lease) {
                domainMutationLeaseRef.current = null;
                if (appMountedRef.current) setDomainMutationInFlight(false);
            }
        }
    }, []);

    const beginCampaignSession = useCallback(() => {
        campaignGenerationRef.current += 1;
        latestInferredAmbitionRef.current = null;
        resetSessionCallLog();
    }, []);

    useDevSmokeTest();

    const playerEntity = entities.find(e => e.entity_id === playerCharacterId) || null;
    const recipientOptions = useMemo(
        () => playerEntity ? knownRecipientOptionsForPlayer(playerEntity, entities, knowledge) : [],
        [playerEntity, entities, knowledge],
    );
    const privateSceneKnownIds = useMemo(() => recipientOptions.map(option => option.entityId), [recipientOptions]);
    const privateSceneTargets = useMemo(
        () => playerEntity ? eligiblePrivateSceneTargets({ player: playerEntity, entities, knownEntityIds: privateSceneKnownIds }) : [],
        [playerEntity, entities, privateSceneKnownIds],
    );
    const privateSceneViews = useMemo(
        () => state.privateScenes.map(projectPrivateSceneForPlayer),
        [state.privateScenes],
    );
    const privateSceneInteractionLocked = state.privateScenes.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word');
    // A layout effect runs after React commits the matching controls but before
    // the browser can dispatch another user event. Successful scene commits
    // below also set this ref synchronously before dispatch, closing the
    // transaction-to-render interval without mutating a ref during render.
    useLayoutEffect(() => {
        privateSceneLockRef.current = privateSceneInteractionLocked;
        privateScenesRef.current = state.privateScenes;
    }, [privateSceneInteractionLocked, state.privateScenes]);

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
    // One illuminated initial per week (audit item 13) — derived from the
    // ribbon dividers already in the stream, so no message gains a field.
    const illuminatedNarrations = useMemo(() => illuminatedNarrationIndices(messages), [messages]);
    const lastTurnPerceivedChanges = useMemo(
        () => (lastTurn?.postTurnEntities && lastTurnPlayer)
            ? buildPlayerPerceivedDigest(lastTurn.adjudication.deltas, lastTurnPlayer, lastTurn.postTurnEntities, worldState)
            : [],
        [lastTurn, lastTurnPlayer, worldState]
    );
    // Which SidePanel tabs to pulse - built strictly from the already-filtered
    // perceived changes above, never from the raw deltas, so a pulse can
    // never itself leak something the perception filter withheld.
    const pulsingTabs = useMemo(() => {
        const tabs = new Set<TabId>();
        lastTurnPerceivedChanges.forEach(change => change.tabs.forEach(tab => {
            if (tab !== 'dramatis_personae') tabs.add(tab);
        }));
        if (lastTurn && knowledge.some(claim =>
            claim.relationshipObservation && claim.firstLearnedTurn === lastTurn.turnNumber
        )) {
            tabs.add('dramatis_personae');
        }
        return tabs;
    }, [knowledge, lastTurn, lastTurnPerceivedChanges]);

    // Builds the full persistable game-state bundle from current state,
    // optionally overriding fields with just-computed values (a dispatch
    // doesn't change this render's state object, so a caller that just
    // committed new values must pass them explicitly rather than reading
    // the stale closure). See persistence/saveGame.ts for exactly which
    // game state this does (and doesn't) include, and why.
    const buildSaveState = useCallback((overrides: Partial<SaveGameState> = {}): SaveGameState => {
        const candidate: SaveGameState = { ...pickSaveState(state), ...overrides };
        const stored = loadGame()?.state;
        const storedAmbition = stored && isSameCampaignPrefix(candidate, stored)
            ? stored.inferredAmbition
            : null;
        candidate.inferredAmbition = newestInferredAmbition(
            storedAmbition,
            candidate.inferredAmbition,
            latestInferredAmbitionRef.current,
        );
        latestInferredAmbitionRef.current = candidate.inferredAmbition ?? null;
        return candidate;
    }, [state]);

    const messagesEndRef = useScrollToLatest(messages, gameState);
    useUnloadGuardWhileProcessing(gameState);

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

    const privateScenePromptFor = useCallback((npc: Entity, transcript: PrivateSceneRecord['transcript'], exchange: number) => {
        if (!playerEntity) throw new Error('The player is unavailable for this private scene.');
        return {
        phase: exchange === 1 ? 'invitation' as const : 'exchange' as const,
        exchange,
        npc: {
            entityId: npc.entity_id, displayName: npc.name, position: npc.position, location: npc.location,
            voice: npc.voice, selfDescription: npc.current_state_narrative,
            goals: npc.short_term_goals.slice(0, 8), beliefs: (npc.beliefs ?? []).slice(0, 8),
            ownSecrets: (npc.secrets ?? []).slice(0, 8), memories: npc.memories.slice(-8).map(memory => memory.event_description),
            relationshipToPlayer: undefined,
        },
        player: { entityId: playerEntity.entity_id, displayName: playerEntity.name, position: playerEntity.position },
        transcript: transcript.map(line => ({ speaker: line.speaker, text: line.text })),
    };
    }, [playerEntity]);

    const commitDomainMutation = useCallback(({ candidate, action, onSaveFailure, beforeDispatch, onCommitted }: DomainCommit): boolean => {
        if (!saveGame(candidate).ok) { onSaveFailure(); return false; }
        beforeDispatch?.();
        dispatch(action);
        onCommitted?.();
        return true;
    }, [dispatch]);

    const commitPrivateScene = useCallback((candidate: PrivateSceneRecord, expectedScenesFingerprint: string): boolean => {
        const latest = privateScenesRef.current;
        // Exact list/record identity prevents a retained callback from
        // resurrecting, discarding, or appending to any intervening commit.
        if (privateScenesFingerprint(latest) !== expectedScenesFingerprint) return false;
        const candidateScenes = replacePrivateSceneForCommit(latest, candidate);
        // Recheck immediately before persistence. JavaScript cannot interleave
        // another handler between this synchronous check and saveGame.
        if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenesFingerprint) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ privateScenes: candidateScenes }),
            action: { type: 'PRIVATE_SCENES_COMMITTED', privateScenes: candidateScenes },
            // Same voice as every other write that would not land (D45): the
            // device is named, and what is kept is named. No bare "try again".
            onSaveFailure: () => setPrivateSceneError('The scene could not be saved. This device would not take the writing down — your words are kept here, and the scene has not moved.'),
            beforeDispatch: () => {
                // The durable bytes exist before this point. Set the handler-level
                // guard before reducer dispatch so another event cannot enter an
                // ordinary mutation in React's commit/render interval.
                privateSceneLockRef.current = candidateScenes.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word');
                privateScenesRef.current = candidateScenes;
            },
            onCommitted: () => setPrivateSceneError(null),
        });
    }, [buildSaveState, commitDomainMutation]);

    const handlePrivateSceneInvite = useCallback((targetId: string) => {
        void runDomainMutation(async transaction => {
            const opening = privateSceneOpeningDraft.trim();
            if (!transaction.isCurrent() || !playerEntity || !opening || opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (opening.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const npc = entities.find(entity => entity.entity_id === targetId);
            const stillEligible = eligiblePrivateSceneTargets({ player: playerEntity, entities, knownEntityIds: privateSceneKnownIds })
                .some(target => target.entityId === targetId);
            if (!npc) {
                setPrivateSceneError('That contact can no longer be found. Choose another and try again.');
                return false;
            }
            if (!stillEligible) {
                setPrivateSceneError('That contact is no longer within reach. Choose another and try again.');
                return false;
            }
            if (privateScenesRef.current.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word' || scene.macroTurn === turnNumber)) {
                setPrivateSceneError('A private scene has already been held this turn.');
                return false;
            }
            try {
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [{ sequence: 1, speaker: 'player', text: privateSceneOpeningDraft.trim() }], 1), isMockMode);
                if (!transaction.isCurrent() || privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const transition = beginPrivateScene({ sceneId: `private-scene-${turnNumber}-${npc.entity_id}`, macroTurn: turnNumber, player: playerEntity, npc, knownEntityIds: privateSceneKnownIds, opening, response, existing: privateScenesRef.current });
                if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
                setPrivateSceneOpeningDraft('');
                return true;
            } catch {
                if (transaction.isCurrent()) setPrivateSceneError('The scene could not continue. Your words remain ready to retry.');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, isMockMode, playerEntity, privateSceneKnownIds, privateSceneOpeningDraft, privateScenePromptFor, runDomainMutation, turnNumber]);

    const handlePrivateSceneReply = useCallback((sceneId: string) => {
        void runDomainMutation(async transaction => {
            const reply = privateSceneReplyDraft.trim();
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!transaction.isCurrent() || !scene || scene.status !== 'active' || !reply || reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                if (reply.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const npc = entities.find(entity => entity.entity_id === scene.npcId);
            if (!npc) return false;
            try {
                const response = await continuePrivateScene(ai, privateScenePromptFor(npc, [...scene.transcript, { sequence: scene.transcript.length + 1, speaker: 'player', text: privateSceneReplyDraft.trim() }], scene.npcResponseCount + 1), isMockMode);
                if (!transaction.isCurrent()) return false;
                const current = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
                if (!current || current.status !== 'active' || current.macroTurn !== scene.macroTurn || current.npcResponseCount !== scene.npcResponseCount) return false;
                if (privateScenesFingerprint(privateScenesRef.current) !== expectedScenes) return false;
                const transition = appendPrivateSceneExchange({ scene: current, expectedNpcResponseCount: scene.npcResponseCount, playerUtterance: reply, response });
                if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
                setPrivateSceneReplyDraft('');
                return true;
            } catch {
                if (transaction.isCurrent()) setPrivateSceneError('The scene could not continue. Your words remain ready to retry.');
                return false;
            }
        }, { allowDuringPrivateScene: true });
    }, [ai, commitPrivateScene, entities, isMockMode, privateScenePromptFor, privateSceneReplyDraft, runDomainMutation]);

    const handlePrivateSceneEnd = useCallback((sceneId: string) => {
        void runDomainMutation(() => {
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = endPrivateScene(scene);
            return transition.ok && commitPrivateScene(transition.scene, expectedScenes);
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, runDomainMutation]);

    const handlePrivateSceneFinalize = useCallback((sceneId: string, lastWord: string | null) => {
        void runDomainMutation(() => {
            const text = lastWord?.trim() ?? null;
            if (text !== null && text.length > PRIVATE_SCENE_MAX_UTTERANCE_CHARS) {
                setPrivateSceneError('Private-scene messages may be at most 2,000 characters.');
                return false;
            }
            const expectedScenes = privateScenesFingerprint(privateScenesRef.current);
            const scene = privateScenesRef.current.find(candidate => candidate.sceneId === sceneId);
            if (!scene) return false;
            const transition = finalizePrivateScene(scene, text);
            if (!transition.ok || !commitPrivateScene(transition.scene, expectedScenes)) return false;
            setPrivateSceneLastWordDraft('');
            return true;
        }, { allowDuringPrivateScene: true });
    }, [commitPrivateScene, runDomainMutation]);

    const executeTurn = useExecuteTurn({
        ai, isMockMode, resolvedApiKey, online,
        entities, worldState, simulationState, reports, truthLedger, knowledge, npcIntents,
        turnNumber, playerCharacterId, turnHistory, pendingIntelligenceFallout, gmInterventionText,
        eventFirings, metaNarrative, messages,
        dispatch, getStateGeneration, runDomainMutation, commitDomainMutation, buildSaveState, strikeWeekBeat,
        preTurnSnapshotRef, campaignGenerationRef, privateScenesRef, appMountedRef, latestInferredAmbitionRef,
        setPendingPlayerMessage, setTurnFailure, setRetrySubmission, setRetryDraft,
        setChatDraft, setStructuredDraft, setTurnStage, setStreamingNarration,
        setIsCheckingEvents, setTransactionNote,
    });

    const handleComposerSubmit = (draft: string | StructuredTurnDraft) => {
        if (gameState !== GameState.AWAITING_PLAYER_INPUT || privateSceneInteractionLocked) return;
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
        if (!commitDomainMutation({
            candidate,
            action: {
                type: 'GAME_STARTED',
                entities: allInitialEntities,
                playerCharacterId: characterEntity.entity_id,
                introMessage,
                suggestedActions: starterActions,
                worldState: initialWorldState,
                metaNarrative: initialMetaNarrative,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your campaign could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        })) {
            return;
        }

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
        beginCampaignSession();
        const playerEntity = ALL_INITIAL_ENTITIES.find(e => e.entity_id === option.entity_id);
        if(playerEntity) {
            startGameWithCharacter(playerEntity, JSON.parse(JSON.stringify(ALL_INITIAL_ENTITIES)));
        }
    };

    const handleCustomCreation = async (
        { description, metaNarrative: newMetaNarrative, useCustomGamestate }: { description: string, metaNarrative?: string, useCustomGamestate: boolean },
        transaction: DomainMutationContext,
    ) => {
        // Per-campaign-session log (see handleSelectCharacter). Reset here -
        // not in startGameWithCharacter - so the world/character-generation
        // calls made just below already belong to the NEW campaign's log.
        beginCampaignSession();
        if (useCustomGamestate && newMetaNarrative) {
            // New world generation logic
            const { worldState: newWorldState, entities: newEntities, playerCharacterId: newPlayerId } = await initiateWorld(ai, newMetaNarrative, description, isMockMode);
            if (!transaction.isCurrent()) return;
            const playerChar = newEntities.find(e => e.entity_id === newPlayerId);
            if (playerChar) {
                startGameWithCharacter(playerChar, newEntities, newWorldState, newMetaNarrative);
            } else {
                 addMessage({ sender: 'gm', text: "Error: Failed to generate a valid player character in the new world."});
            }
        } else {
            // Existing custom character in default world
            const newCharacter = await createCharacter(ai, description, isMockMode);
            if (!transaction.isCurrent()) return;
            const finalEntities = ALL_INITIAL_ENTITIES.find(e => e.entity_id === newCharacter.entity_id) 
                ? ALL_INITIAL_ENTITIES.map(e => e.entity_id === newCharacter.entity_id ? newCharacter : e)
                : [...ALL_INITIAL_ENTITIES, newCharacter];
            startGameWithCharacter(newCharacter, JSON.parse(JSON.stringify(finalEntities)));
        }
    };

    const handleSpendResource = (
        resourceName: 'deep_analyses' | 'investigations',
        cost: number,
        request: DomainMutationContext,
    ): boolean => {
        if (!request.isCurrent()) return false;
        const newEntities = entities.map(e => {
            if (e.entity_id === playerCharacterId) {
                const newResources = {...e.resources};
                const currentAmount = (newResources[resourceName] as number) || 0;
                newResources[resourceName] = Math.max(0, currentAmount - cost);
                return {...e, resources: newResources};
            }
            return e;
        });
        if (!request.isCurrent()) return false;
        return commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities }),
            action: { type: 'RESOURCE_SPENT', entities: newEntities },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your change could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };

    /**
     * WP-15 / audit item 40 — what your agents came back with about a public
     * occurrence. It used to live in CurrentEventsTab's component-local
     * `useState` and was discarded the moment the player switched tabs, even
     * though they had waited on the AI call for it. It now lands in the
     * knowledge store in a durable commit, exactly like a bought investigation
     * reveal, so it survives a tab switch and a reload.
     *
     * Free: asking costs no investigation. What it costs is the wait.
     */
    const handleOccurrenceFinding = (
        occurrence: string,
        question: OccurrenceQuestion,
        text: string,
        request: DomainMutationContext,
    ): boolean => {
        if (!request.isCurrent()) return false;
        const newKnowledge = ingestOccurrenceFinding(knowledge, { occurrence, question, text, turn: turnNumber });
        return commitDomainMutation({
            candidate: buildSaveState({ knowledge: newKnowledge }),
            // The same commit shape a bought reveal uses — entities and the
            // fallout queue are handed back unchanged, because asking a
            // question about a public occurrence spends nothing and queues
            // nothing. Only the knowledge slice moves.
            action: {
                type: 'INVESTIGATION_COMMITTED',
                entities,
                pendingIntelligenceFallout,
                knowledge: newKnowledge,
            },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'What your agents found could not be recorded.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
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
    const handleInvestigationOutcome = async (
        kind: 'beliefs' | 'scheme' | 'secrets',
        targetId: string,
        reportData: unknown,
        cost: number,
        result: InvestigationResult,
        request: DomainMutationContext,
    ): Promise<boolean> => {
        if (!request.isCurrent()) return false;
        const entityDirectory = entities.map(entity => ({
            entity_id: entity.entity_id,
            name: entity.name,
        }));
        const relationshipEvidence = [buildInvestigationRelationshipEvidence({
            reportText: result.report,
            targetId,
            kind,
            turnNumber,
            entities: entityDirectory,
        })];
        const currentPlayer = entities.find(entity => entity.entity_id === playerCharacterId) ?? null;
        const knownEntityIds = currentPlayer
            ? [
                currentPlayer.entity_id,
                ...knownRecipientOptionsForPlayer(currentPlayer, entities, knowledge)
                    .map(option => option.entityId),
            ]
            : [];
        const relationshipDrafts = await getRelationshipObservations(
            ai,
            relationshipEvidence,
            entityDirectory,
            knownEntityIds,
            isMockMode,
        );
        if (!request.isCurrent()) return false;
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
            relationshipObservations: {
                evidence: relationshipEvidence,
                drafts: relationshipDrafts,
                entities: entityDirectory,
                knownEntityIds,
            },
        });

        const falloutMessage: Message | undefined = hasFallout(result.consequences)
            ? { sender: 'gm', text: 'Your agent returns — but something in their manner suggests the visit did not go unnoticed.' }
            : undefined;
        // This is intentionally adjacent to the durable write. A future
        // async-extraction phase may add work above; an EntityDetails unmount
        // during that work must cancel before charging or committing any result.
        if (!request.isCurrent()) return false;
        if (!commitDomainMutation({
            candidate: buildSaveState({ entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, messages: falloutMessage ? [...messages, falloutMessage] : messages }),
            action: { type: 'INVESTIGATION_COMMITTED', entities: newEntities, pendingIntelligenceFallout: nextFallout, knowledge: nextKnowledge, falloutMessage },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'Your investigation could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        })) {
            return false;
        }

        return true;
    };

    const handleSetIntervention = (text: string): boolean => {
        return commitDomainMutation({
            candidate: buildSaveState({ gmInterventionText: text }),
            action: { type: 'GM_INTERVENTION_SET', text },
            onSaveFailure: () => setTransactionNote({ kind: 'save', lead: 'The directive could not be saved.' }),
            beforeDispatch: () => setTransactionNote(null),
        });
    };
    
    const handleEventChoice = useCallback((choice: PlayerEventChoice) => {
        if (!activeEvent || !playerEntity) return;

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
        if (!commitDomainMutation({
            candidate: buildSaveState({ entities: updatedEntities, worldState: updatedWorldState, eventHistory: newEventHistory, triggeredEventIds: newTriggeredEventIds, eventFirings: newEventFirings, messages: [...messages, eventMessage] }),
            action: {
                type: 'EVENT_CHOICE_APPLIED',
                entities: updatedEntities,
                worldState: updatedWorldState,
                eventMessage,
                eventHistory: newEventHistory,
                triggeredEventIds: newTriggeredEventIds,
                eventFirings: newEventFirings,
            },
            onSaveFailure: () => setEventChoiceError('Your choice could not be saved. Please try again.'),
            beforeDispatch: () => {
                setTransactionNote(null);
                setEventChoiceError(null);
            },
        })) {
            return;
        }

    }, [activeEvent, buildSaveState, commitDomainMutation, entities, eventFirings, eventHistory, messages, playerEntity, triggeredEventIds, turnNumber, worldState]);

    const handleContinue = useCallback(() => {
        const save = loadGame();
        if (!save) {
            setSavedGameInfo(null);
            return;
        }
        // Per-campaign-session log (see handleSelectCharacter): the loaded
        // campaign starts a fresh session log, dropping any calls a prior
        // campaign made in this tab.
        beginCampaignSession();
        // GAME_LOADED (state/gameReducer.ts) restores the whole campaign in
        // one state transition: it normalizes the optional save fields
        // (inferredAmbition, pendingIntelligenceFallout - absent on older
        // saves) and re-derives the terminal state from the loaded player
        // entity's status (DESIGN_DECISIONS.md D1 - only death is terminal;
        // GAME_OVER itself is never persisted, only the underlying entities
        // are, and a save CAN legitimately be reloaded on an already-ended
        // run when the player closed the tab on the epilogue screen).
        dispatch({ type: 'GAME_LOADED', save: save.state });
        setTransactionNote(null);
    }, [beginCampaignSession, dispatch]);

    const handleStartAnew = useCallback(() => {
        if (!clearSave().ok) {
            setTransactionNote({ kind: 'plain', message: 'Your saved reign could not be removed. Please try again.' });
            return false;
        }
        beginCampaignSession();
        setTransactionNote(null);
        setSavedGameInfo(null);
        return true;
    }, [beginCampaignSession]);

    /**
     * B7a 1c (spec: 2026-08-05-b7a-hardening-and-tablist-design.md): a
     * successful import must invalidate any in-flight D8 ambition tail from
     * the PRIOR reign the same way turn-rollback invalidation works
     * (useExecuteTurn.ts's generation guard) - otherwise a stale inference
     * that resolves after the import patches its old ambition into the
     * freshly imported slot. Bumping the generation here is that guard's one
     * trigger; both import homes receive this wrapper, never the raw
     * `importSaveBlob`.
     */
    const handleImportReign = useCallback((text: string) => {
        const result = importSaveBlob(text);
        if (result.ok) campaignGenerationRef.current += 1;
        return result;
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
            {weekBeat && <div className="gor-week-beat" aria-hidden="true" />}
            <Header
                worldState={worldState}
                onOpenSettings={openSettings}
            />
            {gameState !== GameState.GAME_OVER && (
                <CrisisBanner
                    crisis={simulationState.major_ongoing_crisis}
                    grade={crisisGrade(simulationState) ?? 'crisis'}
                />
            )}
            {/* Item 49: the roads are shut. The tablet stays fully editable —
                writing the week is the one thing that still works. */}
            {!online && gameState !== GameState.SETUP && <OfflineStrip />}
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
                        turnHistory={turnHistory}
                        eventHistory={eventHistory}
                        metaNarrative={metaNarrative}
                        ai={ai}
                        isMockMode={isMockMode}
                    />
                ) : (
                    <>
                        <section data-screen-label="Chat" style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            {gameState === GameState.SETUP && transactionNote && (
                                <TransactionNoteView note={transactionNote} style={{ margin: '0 24px 12px' }} />
                            )}
                            {gameState === GameState.SETUP ? (
                                <CharacterSelection
                                    onSelectCharacter={(option) => {
                                        void runDomainMutation(() => handleSelectCharacter(option));
                                    }}
                                    onCreateCharacter={async (args) => {
                                        await runDomainMutation((transaction) => handleCustomCreation(args, transaction));
                                    }}
                                    savedGame={savedGameInfo}
                                    onContinue={() => {
                                        void runDomainMutation(handleContinue);
                                    }}
                                    onStartAnew={() => {
                                        void runDomainMutation(handleStartAnew);
                                    }}
                                    onImportReign={handleImportReign}
                                    interactionLocked={domainMutationInFlight}
                                />
                            ) : (
                                <>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} role="log" aria-live="polite" aria-label="Chat log">
                                        {messages.map((msg, index) => <ChatMessage key={index} message={msg} illuminated={illuminatedNarrations.has(index)} />)}
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
                                        {/* Four kinds of failed week, and three kinds of
                                            transaction note — each in its own voice and its
                                            own tone. Nothing here is modal: the tablet below
                                            stays editable in every one of these states. */}
                                        {/* The offline kind is deliberately not drawn here: the
                                            strip under the crisis banner is the standing statement
                                            that the roads are shut, and rendering the same sentence
                                            again — once role="status", once role="alert" — said one
                                            thing twice. (It would also outlive its own truth: once
                                            the roads reopen the notice would still claim they are
                                            shut.) The kind is still recorded, and the send stays
                                            held while `online` is false. */}
                                        {turnFailure && turnFailure.kind !== 'offline' && (
                                            <div style={{ marginBottom: 10 }}>
                                                <TurnFailureNotice
                                                    failure={turnFailure}
                                                    onEditTheWeek={() => {
                                                        setTurnFailure(null);
                                                        // Whichever composer is mounted — `#chat-input`
                                                        // does not exist in structured mode, where this
                                                        // used to dismiss the notice and focus nothing.
                                                        document.querySelector<HTMLElement>('#chat-input, #structured-input')?.focus();
                                                    }}
                                                    onOpenSettings={openSettings}
                                                    onEnableMockMode={() => { setIsMockMode(true); setTurnFailure(null); }}
                                                    onOpenLedger={isGmConsoleEnabled ? openGmScreen : undefined}
                                                />
                                            </div>
                                        )}
                                        {transactionNote && <TransactionNoteView note={transactionNote} style={{ marginBottom: 10 }} />}
                                        {gameState === GameState.AWAITING_PLAYER_INPUT && retrySubmission && retryDraft && (
                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, animation: 'gorRise .4s ease-out both' }}>
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => void executeTurn(retrySubmission, retryDraft)}
                                                    aria-label="Retry the last action"
                                                    // Item 49: this is a send like any other, so the
                                                    // shut roads hold it too — it used to be the one
                                                    // way past the offline gate.
                                                    disabled={domainMutationInFlight || !online}
                                                >
                                                    {online ? '↻ Retry the last action' : '↻ Hold until the roads reopen'}
                                                </Button>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                            <TurnComposer
                                                chatDraft={chatDraft}
                                                structuredDraft={structuredDraft}
                                                recipientOptions={recipientOptions}
                                                suggestedActions={gameState === GameState.PROCESSING ? [] : suggestedActions}
                                                onChatDraftChange={setChatDraft}
                                                onStructuredDraftChange={setStructuredDraft}
                                                onSubmit={handleComposerSubmit}
                                                disabled={domainMutationInFlight || privateSceneInteractionLocked || gameState !== GameState.AWAITING_PLAYER_INPUT}
                                                isProcessing={gameState === GameState.PROCESSING}
                                                turnStage={turnStage}
                                                playerInitial={playerEntity?.name}
                                                canReachTheFates={isMockMode || Boolean(resolvedApiKey)}
                                                online={online}
                                                onOpenSettings={openSettings}
                                                onEnableMockMode={() => setIsMockMode(true)}
                                            />
                                            {gameState === GameState.AWAITING_PLAYER_INPUT && (
                                                <PrivateScene
                                                    scenes={privateSceneViews}
                                                    currentMacroTurn={turnNumber}
                                                    canStartScene={!privateSceneInteractionLocked && !state.privateScenes.some(scene => scene.macroTurn === turnNumber)}
                                                    eligibleTargets={privateSceneTargets}
                                                    openingDraft={privateSceneOpeningDraft}
                                                    replyDraft={privateSceneReplyDraft}
                                                    lastWordDraft={privateSceneLastWordDraft}
                                                    loading={domainMutationInFlight}
                                                    error={privateSceneError}
                                                    onOpeningDraftChange={setPrivateSceneOpeningDraft}
                                                    onReplyDraftChange={setPrivateSceneReplyDraft}
                                                    onLastWordDraftChange={setPrivateSceneLastWordDraft}
                                                    onInvite={handlePrivateSceneInvite}
                                                    onReply={handlePrivateSceneReply}
                                                    onEnd={handlePrivateSceneEnd}
                                                    onLastWord={sceneId => handlePrivateSceneFinalize(sceneId, privateSceneLastWordDraft)}
                                                    onSkipLastWord={sceneId => handlePrivateSceneFinalize(sceneId, null)}
                                                />
                                            )}
                                            {isGmConsoleEnabled && (
                                                <Tooltip wide label={turnHistory.length > 0 ? "The Fates' ledger — every thread and die of the simulation, recorded." : 'The ledger opens once a turn has been played.'}>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={openGmScreen}
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
                            onSpendDeepAnalysis={(cost, request) => handleSpendResource('deep_analyses', cost, request)}
                            onInvestigationOutcome={handleInvestigationOutcome}
                            runDomainMutation={runDomainMutation}
                            interactionLocked={domainMutationInFlight || privateSceneInteractionLocked || gameState === GameState.PROCESSING}
                            ai={ai}
                            isMockMode={isMockMode}
                            eventHistory={eventHistory}
                            turnHistory={turnHistory}
                            pulsingTabs={pulsingTabs}
                            onOccurrenceFinding={handleOccurrenceFinding}
                        />
                    </>
                )}
            </main>
            {isGmConsoleEnabled && isGmScreenVisible && <GameMasterScreen
                history={turnHistory}
                onClose={closeGmScreen}
                interventionText={gmInterventionText}
                onSetIntervention={async (text) => {
                    const result = await runDomainMutation(() => handleSetIntervention(text));
                    return result.acquired && result.value !== false;
                }}
                interactionLocked={domainMutationInFlight || privateSceneInteractionLocked || gameState === GameState.PROCESSING}
                playerCharacterId={playerCharacterId}
                worldState={worldState}
                turnNumber={turnNumber}
                inferredAmbition={inferredAmbition}
                pendingIntelligenceFallout={pendingIntelligenceFallout}
                truthLedger={truthLedger}
                reports={reports}
                knowledge={knowledge}
                npcIntents={npcIntents}
                privateScenes={state.privateScenes}
                gmInterventionEnabled={gmInterventionAvailable}
            />}
            {activeEvent && <EventModal
                event={activeEvent}
                onChoose={(choice) => {
                    void runDomainMutation(() => handleEventChoice(choice));
                }}
                interactionLocked={domainMutationInFlight || privateSceneInteractionLocked}
                error={eventChoiceError}
            />}
            {showOnboarding && gameState === GameState.AWAITING_PLAYER_INPUT && (
                <OnboardingOverlay isOpen={showOnboarding} onClose={handleCloseOnboarding} />
            )}
            {isSettingsMenuOpen && (
                <SettingsMenu
                    onClose={closeSettings}
                    apiKey={userApiKey}
                    onSaveApiKey={handleSaveApiKey}
                    onClearApiKey={handleClearApiKey}
                    pacingPosture={pacingPosture}
                    onSetPacingPosture={handleSetPacingPosture}
                    isNox={isNox}
                    onSetIsNox={setIsNox}
                    gmConsoleEnabled={gmConsoleAvailable}
                    onSetGmConsoleEnabled={handleSetGmConsoleAvailable}
                    gmInterventionEnabled={gmInterventionAvailable}
                    onSetGmInterventionEnabled={handleSetGmInterventionAvailable}
                    isMockMode={isMockMode}
                    onSetIsMockMode={setIsMockMode}
                    gmConsoleOpen={isGmConsoleEnabled}
                    onSetGmConsoleOpen={handleSetGmConsoleOpen}
                    hasSavedReign={hasSave()}
                    onExportReign={downloadTheReign}
                    onImportReign={handleImportReign}
                    interactionLocked={domainMutationInFlight || gameState === GameState.PROCESSING}
                />
            )}
        </div>
    );
};

export default App;
