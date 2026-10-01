import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { GameState } from './types';

import Header from './components/Header';
import CharacterSelection from './components/CharacterSelection';
import { ChatMessage, TypingIndicator, StreamingNarrationBubble } from './components/Chat';
import { TurnComposer } from './components/TurnComposer';
import { PrivateScene } from './components/PrivateScene';
import CrisisBanner from './components/CrisisBanner';
import { crisisGrade } from './components/crisisGrade';
import DispatchesDigest from './components/DispatchesDigest';
import SidePanel from './components/SidePanel';
import EventModal from './components/EventModal';
import { useGame } from './state/GameContext';
import { hasStoredReign } from './persistence/saveGame';
import { knownRecipientOptionsForPlayer } from './knowledge/relationships';
import { Button } from './components/ui/Core';
import { OfflineStrip, TurnFailureNotice, useOnline } from './components/ui/FailureNotices';
import { Tooltip } from './components/ui/Feedback';
import { useCampaignTransactions } from './hooks/useCampaignTransactions';
import { useCampaignLifecycle } from './hooks/useCampaignLifecycle';
import { useEventFlow } from './hooks/useEventFlow';
import { useGmConsole } from './hooks/useGmConsole';
import { useIntelCommits } from './hooks/useIntelCommits';
import { useOnboarding } from './hooks/useOnboarding';
import { usePlayerPerception } from './hooks/usePlayerPerception';
import { usePanelInView, useSeenRegisters, weekKeyOf } from './hooks/useSeenRegisters';
import { usePrivateSceneController } from './hooks/usePrivateSceneController';
import { useSettings } from './hooks/useSettings';
import { useReadingPrefs } from './hooks/useReadingPrefs';
import { useTurnFlow } from './hooks/useTurnFlow';
import { useWeekBeat } from './hooks/useWeekBeat';
import { useNarrationVoice } from './hooks/useNarrationVoice';
import { IN_CHARACTER_NARRATOR_ID, narratorCharactersFor } from './narration/narratorChoice';
import { useNarrationLog } from './hooks/useNarrationLog';
import { usePrivateSceneVoice } from './hooks/usePrivateSceneVoice';
import { usePersonaeVoice } from './hooks/usePersonaeVoice';
import { useCastBasis, useVoiceCast } from './hooks/useVoiceCast';
import { NarrationLog } from './components/NarrationLog';
import { useDevSmokeTest, useUnloadGuardWhileProcessing } from './hooks/useShellEffects';
import { CHAT_FOLLOW_COPY, useChatFollow } from './hooks/useChatFollow';
import { useCommandPalette } from './hooks/useCommandPalette';
import { buildGameCommands } from './app/commands';
import { draftSuggestion, focusComposer, focusDesk, pressOpener, selectRegister } from './app/domCommands';
import { SIDE_PANEL_TABS } from './components/SidePanel';
import type { TransactionNote } from './app/transactions';
import { TransactionNoteView, downloadTheReign } from './app/TransactionNoteView';
import {
    GameMasterScreen, EpilogueScreen, SettingsMenu, OnboardingOverlay, CommandPalette, usePreloadLazyScreens,
} from './app/lazyScreens';


// --- MAIN APP ---

const App: React.FC = () => {
    // Every game-domain slice lives in the reducer behind GameContext
    // (state/gameReducer.ts, DESIGN_DECISIONS.md D17) - in particular, every
    // slice buildSaveState persists MUST come from there, never from a local
    // useState. App.tsx stays the composition root: children receive plain
    // props, never the context itself. Only transient, presentation-only
    // state (input box, modal flags, streaming text, theme, retry
    // affordances) may live in local useState - here, or in the hooks/
    // this component composes (each owns one concern; see their headers).
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
        reignSeed,
    } = state;

    // --- Shell: device preferences, the GM console, window-level effects.
    const [transactionNote, setTransactionNote] = useState<TransactionNote | null>(null);
    // navigator.onLine plus its two events — no network call, no polling.
    const online = useOnline();
    const { weekBeat, strikeWeekBeat } = useWeekBeat();
    const {
        isSettingsMenuOpen, openSettings, closeSettings,
        isMockMode, setIsMockMode,
        isNox, setIsNox,
        lightingChoice, setLightingChoice,
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
    const { showOnboarding, offerOnboarding, handleCloseOnboarding } = useOnboarding();
    // Text size, motion, how the narration arrives, single-key shortcuts -
    // the configuration menu's Reading register (persistence/readingPrefs.ts).
    const reading = useReadingPrefs();
    useDevSmokeTest();
    usePreloadLazyScreens();
    // The game screen proper: a week to write, being written, or a fate
    // awaiting its choice (whose modal holds the room - the palette never
    // opens over it). Character selection keeps the full masthead ceremony;
    // the epilogue has no desk.
    const inGame = gameState !== GameState.SETUP && gameState !== GameState.GAME_OVER;

    // --- The transaction kernel every durable handler below runs on.
    const {
        domainMutationInFlight,
        privateSceneInteractionLocked,
        runDomainMutation,
        commitDomainMutation,
        buildSaveState,
        beginCampaignSession,
        preTurnSnapshotRef,
        privateSceneLockRef,
        privateScenesRef,
        appMountedRef,
        campaignGenerationRef,
        latestInferredAmbitionRef,
    } = useCampaignTransactions(state, dispatch);

    // --- What the player can see and reach.
    const playerEntity = entities.find(e => e.entity_id === playerCharacterId) || null;
    const recipientOptions = useMemo(
        () => playerEntity ? knownRecipientOptionsForPlayer(playerEntity, entities, knowledge) : [],
        [playerEntity, entities, knowledge],
    );
    const privateSceneKnownIds = useMemo(() => recipientOptions.map(option => option.entityId), [recipientOptions]);
    // DESIGN_DECISIONS.md D1 - survival-only: ONLY death ends a run. Exile
    // and "missing" are survivable states the player keeps playing through,
    // each with a persistent contextual banner (input stays enabled) rather
    // than Stage A's stopgap, which locked input for any non-'alive' status.
    // Death itself is handled entirely via GameState.GAME_OVER (see
    // executeTurn/handleEventChoice/handleContinue), not here.
    const isPlayerExiledOrMissing = playerEntity !== null && (playerEntity.status === 'exiled' || playerEntity.status === 'missing');
    const {
        lastTurn, lastTurnPerceivedChanges, tabChangeCounts, illuminatedNarrations, lastGmNarration,
    } = usePlayerPerception(messages, turnHistory, playerCharacterId, worldState, knowledge);
    // "What changed since you last looked": the open tab and what has been
    // looked at since the week landed, held here so the tab rail and the
    // command palette say the same count (hooks/useSeenRegisters.ts). The
    // open tab counts as looked at only while the panel is on the screen -
    // on a phone it waits a swipe away from the chronicle.
    const weekKey = useMemo(() => weekKeyOf(lastTurn), [lastTurn]);
    const [sidePanelElement, setSidePanelElement] = useState<HTMLElement | null>(null);
    const panelInView = usePanelInView(sidePanelElement);
    const {
        activeTab: activeRegister, selectTab: handleSelectRegister, unseenCounts, unseenTabs,
    } = useSeenRegisters({ weekKey, tabChangeCounts, panelInView });
    // Which masthead stats a 'world' delta moved last week - public by D5
    // rule 1, and the header already shows both values unconditionally.
    const worldShifts = useMemo(() => {
        const moved = (key: string) => Boolean(lastTurn?.adjudication.deltas.some(delta => delta.type === 'world' && delta.key === key));
        return { economic_stability: moved('economic_stability'), political_climate: moved('political_climate') };
    }, [lastTurn]);

    // --- The domain handlers, one hook per surface.
    const {
        privateSceneViews,
        privateSceneTargets,
        canStartScene,
        privateSceneOpeningDraft, setPrivateSceneOpeningDraft,
        privateSceneReplyDraft, setPrivateSceneReplyDraft,
        privateSceneLastWordDraft, setPrivateSceneLastWordDraft,
        privateSceneError,
        handlePrivateSceneInvite,
        handlePrivateSceneReply,
        handlePrivateSceneEnd,
        handlePrivateSceneLastWord,
        handlePrivateSceneSkipLastWord,
    } = usePrivateSceneController({
        ai, isMockMode, online,
        privateScenes: state.privateScenes,
        playerEntity, entities, privateSceneKnownIds, knowledge, turnNumber,
        privateSceneInteractionLocked,
        runDomainMutation, commitDomainMutation, buildSaveState,
        privateSceneLockRef, privateScenesRef,
    });
    // A scene left open - its dialog closed, or the game reloaded mid-scene -
    // holds the desk. The tablet names it and the way back to it, rather
    // than claiming the Senate is deliberating (TurnComposer `openScene`).
    const openScene = useMemo(() => {
        const scene = privateSceneViews.find(view => view.status === 'active' || view.status === 'awaiting_last_word');
        return scene ? { npcName: scene.npcName, awaitingLastWord: scene.status === 'awaiting_last_word' } : null;
    }, [privateSceneViews]);

    const { setIsCheckingEvents, eventChoiceError, handleEventChoice, openFateUnsaved } = useEventFlow({
        activeEvent, playerEntity, entities, worldState, simulationState, turnNumber,
        eventFirings, eventHistory, triggeredEventIds, messages,
        dispatch, buildSaveState, commitDomainMutation, setTransactionNote,
    });
    useUnloadGuardWhileProcessing(gameState, openFateUnsaved);

    const {
        chatDraft, setChatDraft,
        structuredDraft, setStructuredDraft,
        canRetry, retryLastTurn,
        pendingPlayerMessage,
        turnFailure, setTurnFailure,
        turnStage,
        streamingNarration,
        handleComposerSubmit,
    } = useTurnFlow({
        gameState, privateSceneInteractionLocked, recipientOptions,
        ai, isMockMode, resolvedApiKey, online,
        entities, worldState, simulationState, reports, truthLedger, knowledge, npcIntents,
        turnNumber, playerCharacterId, turnHistory, pendingIntelligenceFallout, gmInterventionText,
        eventFirings, metaNarrative, messages, reignSeed,
        dispatch, getStateGeneration, runDomainMutation, commitDomainMutation, buildSaveState, strikeWeekBeat,
        preTurnSnapshotRef, campaignGenerationRef, privateScenesRef, appMountedRef, latestInferredAmbitionRef,
        setIsCheckingEvents, setTransactionNote,
    });
    // The log follows the newest line only while the reader is at it
    // (hooks/useChatFollow.ts) - including the streamed narration.
    const {
        logRef: chatLogRef, endRef: chatEndRef, onLogScroll, awayFromFoot, hasUnseen, jumpToLatest,
    } = useChatFollow({
        messageCount: messages.length,
        gameState,
        streamingText: reading.narrationReveal === 'stream' ? streamingNarration : '',
    });
    // A Settings that closes on nothing hands focus to the desk: its focus
    // trap returns focus to the control that opened it, and "Enter your key"
    // on the no-key notice is gone by then - the saved key took the notice
    // with it, and focus fell to <body>. The tablet takes it, or on a touch
    // screen the log, so no keyboard is thrown up unasked (focusDesk).
    const settingsWasOpenRef = useRef(isSettingsMenuOpen);
    useEffect(() => {
        const closed = settingsWasOpenRef.current && !isSettingsMenuOpen;
        settingsWasOpenRef.current = isSettingsMenuOpen;
        const active = document.activeElement;
        if (closed && (!active || active === document.body)) focusDesk(chatLogRef.current);
    }, [isSettingsMenuOpen, chatLogRef]);

    const {
        savedGameInfo,
        handleSelectCharacter,
        handleCustomCreation,
        handleContinue,
        handleStartAnew,
        handleImportReign,
    } = useCampaignLifecycle({
        ai, isMockMode, resolvedApiKey, worldState, metaNarrative, messages,
        dispatch, buildSaveState, commitDomainMutation, beginCampaignSession, campaignGenerationRef,
        setTransactionNote, offerOnboarding,
    });

    // "Hear it performed" - voices committed GM narration only (D4/D5); a
    // device preference, default off (every clip is a paid call). See the
    // hook's header.
    // "In character…" offers ONLY characters the player knows, as name and
    // public standing (narration/narratorChoice.ts) - never raw entities.
    const narratorCharacters = useMemo(
        () => narratorCharactersFor(playerEntity, entities, knowledge),
        [playerEntity, entities, knowledge],
    );
    // The campaign's voice cast (narration/voiceCast.ts): every character
    // the player knows gets a voice of their own - player-visible data only.
    const castBasis = useCastBasis({ voiceCast: state.voiceCast, playerEntity, entities, knowledge });
    const { effectiveCast } = castBasis;
    const {
        narrationVoiceMode, handleSetNarrationVoiceMode, toggleNarrationVoice, narrationVoiceStateFor,
        narrators, narratorId, narratorVoiceFromCast, handleSetNarrator,
        narratorCharacterId, handleSetNarratorCharacter,
        customNarrators, handleSaveCustomNarrator, handleDeleteCustomNarrator,
        narratorVoiceChoice, narratorOwnVoice, handleSetNarratorVoice,
        voiceStyleChoice, narratorOwnStyle, handleSetVoiceStyle,
    } = useNarrationVoice({
        ai, isMockMode, resolvedApiKey, messages, gameState, playerEntity, narratorCharacters,
        week: worldState.week, turnNumber, voiceCast: effectiveCast, castCandidates: castBasis.candidates,
    });
    // The casting director: runs when the voice is first needed, then for newcomers (see the hook).
    const {
        recastStatus, canRecast, handleRecast, handleOverrideMember, handleResetMember,
    } = useVoiceCast({
        ai, isMockMode, resolvedApiKey, narrationVoiceMode, gameState, voiceCast: state.voiceCast, dispatch,
        playerEntity, basis: castBasis, metaNarrative, campaignGenerationRef,
    });
    // The narration log: every performance kept as text on this device, with
    // replay that never re-runs the narrator (narration/narrationLog.ts).
    const { narrationLogEntries, toggleReplay, replayStateFor, stopReplay, clearLog } = useNarrationLog({ ai, isMockMode, resolvedApiKey, narrationVoiceMode });
    // "Hear them speak": a private-scene NPC's committed lines in their own
    // voice - always shown (disabled with a pointer while SILENT), off by default.
    const privateSceneNpcVoice = usePrivateSceneVoice({
        ai, isMockMode, resolvedApiKey, narrationVoiceMode, voiceCast: effectiveCast, week: worldState.week,
    });
    // The voice row on each Personae card: the cast voice, "Narrate as them"
    // (the same "In character…" state Settings sets) and "Hear their voice"
    // (one paid TTS call: their name, no prep). Disabled while SILENT.
    const castCandidateIds = useMemo(() => castBasis.candidates.map(c => c.entityId), [castBasis.candidates]);
    const narrateAs = useCallback((entityId: string) => {
        handleSetNarrator(IN_CHARACTER_NARRATOR_ID);
        handleSetNarratorCharacter(entityId);
    }, [handleSetNarrator, handleSetNarratorCharacter]);
    const personaeVoice = usePersonaeVoice({
        ai, isMockMode, resolvedApiKey, narrationVoiceMode, voiceCast: effectiveCast, candidateIds: castCandidateIds,
        narratingId: narratorId === IN_CHARACTER_NARRATOR_ID ? narratorCharacterId : null, onNarrateAs: narrateAs,
        week: worldState.week, turnNumber,
    });

    const {
        handleDeepAnalysis, handleOccurrenceFinding, handleInvestigationOutcome, handleSetIntervention, occurrenceSibling,
    } = useIntelCommits({
        ai, isMockMode, entities, playerCharacterId, knowledge, truthLedger, pendingIntelligenceFallout, messages, turnNumber,
        buildSaveState, commitDomainMutation, setTransactionNote,
    });

    // --- The command palette (Ctrl+K / ⌘K) and the game screen's keys.
    // Everything it offers runs through the control the player would press
    // (app/domCommands.ts); it never sets an option itself (D43).
    const singleKeys = reading.shortcuts === 'on';
    const { paletteOpen, openPalette, closePalette } = useCommandPalette({
        inGame,
        singleKeys,
        onAction: action => {
            if (action.kind === 'focus-composer') focusComposer();
            else selectRegister(SIDE_PANEL_TABS[action.index].id);
        },
    });
    const canWrite = gameState === GameState.AWAITING_PLAYER_INPUT && !domainMutationInFlight && !privateSceneInteractionLocked;
    const paletteCommands = paletteOpen ? buildGameCommands({
        registers: SIDE_PANEL_TABS,
        // What the tab rail shows: the week's counts less what was looked at.
        changeCounts: unseenCounts,
        singleKeys,
        canWrite,
        // Not gated on the scene lock: an active scene is exactly when the
        // player may want its dialog back (the opener stays enabled then).
        canOpenPrivateScene: gameState === GameState.AWAITING_PLAYER_INPUT && !domainMutationInFlight,
        canOpenLedger: isGmConsoleEnabled && turnHistory.length > 0,
        suggestedActions,
        selectRegister: id => { selectRegister(id); },
        focusComposer: () => { focusComposer(); },
        draftSuggestion: index => { draftSuggestion(index); },
        openPrivateScene: () => { pressOpener('private-scene'); },
        openNarrationLog: () => { pressOpener('narration-log'); },
        jumpToLatest,
        openSettings,
        openLedger: openGmScreen,
    }) : [];

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {weekBeat && <div className="gor-week-beat" aria-hidden="true" />}
            <Header
                worldState={worldState}
                onOpenSettings={openSettings}
                compact={inGame}
                showWorldStats={gameState !== GameState.SETUP}
                onOpenCommands={inGame ? openPalette : undefined}
                worldShifts={inGame ? worldShifts : undefined}
            />
            {/* Not on the destiny screen: until a reign is chosen or continued
                there is no crisis to report (the masthead's stats wait too). */}
            {gameState !== GameState.GAME_OVER && gameState !== GameState.SETUP && (
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
                                    onTakeCopy={downloadTheReign}
                                    canReachTheFates={isMockMode || Boolean(resolvedApiKey)}
                                    onOpenSettings={openSettings}
                                    onEnableMockMode={() => setIsMockMode(true)}
                                    interactionLocked={domainMutationInFlight}
                                />
                            ) : (
                                <>
                                    {/* The chronicle keeps a reading height whatever the
                                        desk below holds (the Structured registers
                                        once squeezed it to a sliver); the desk
                                        scrolls within itself instead. */}
                                    <div ref={chatLogRef} onScroll={onLogScroll} tabIndex={-1} style={{ flex: 1, minHeight: 'min(200px, 40%)', overflowY: 'auto', padding: '20px 24px' }} role="log" aria-live="polite" aria-label="Chat log">
                                        {/* The week being sent is drawn where its committed
                                            leaf will land - the same list, the same key - so
                                            it stays one node from send to commit and the log
                                            speaks the player's words once. Drawn after the
                                            list, it was a second node, announced again. */}
                                        {messages.map((msg, index) => (
                                            <ChatMessage
                                                key={index}
                                                message={msg}
                                                illuminated={illuminatedNarrations.has(index)}
                                                index={index}
                                                voiceState={narrationVoiceStateFor(msg, index)}
                                                onToggleVoice={toggleNarrationVoice}
                                            />
                                        )).concat(pendingPlayerMessage
                                            ? [<ChatMessage key={messages.length} message={pendingPlayerMessage} />]
                                            : [])}
                                        {gameState === GameState.PROCESSING && (
                                            // "Whole" (Settings → Reading) keeps the loom up until the
                                            // week commits instead of streaming the pen's progress.
                                            streamingNarration && reading.narrationReveal === 'stream'
                                                ? <StreamingNarrationBubble text={streamingNarration} />
                                                : <TypingIndicator stage={turnStage} />
                                        )}
                                        {gameState !== GameState.PROCESSING && lastTurn && (
                                            <DispatchesDigest changes={lastTurnPerceivedChanges} />
                                        )}
                                        <div ref={chatEndRef} />
                                    </div>
                                    {/* The desk gives way before the chronicle does: a
                                        column that may shrink, where only the Structured
                                        registers scroll (TurnComposer), so the page itself
                                        never scrolls and the masthead stays put. */}
                                    <div style={{ flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-subtle)', padding: '12px 24px 16px', background: 'rgba(255,254,249,.55)' }}>
                                        {/* Scrolled back through the chronicle: the way to the
                                            latest, which says so once something has landed. It
                                            rides the desk's top edge (the log's own sibling must
                                            stay the desk - design/shell.css reaches it as `+div`). */}
                                        {awayFromFoot && (
                                            <button
                                                type="button"
                                                className={`gor-follow${hasUnseen ? ' gor-follow-unseen' : ''}`}
                                                onClick={jumpToLatest}
                                            >
                                                <span aria-hidden="true">↓</span>
                                                {hasUnseen ? CHAT_FOLLOW_COPY.unseen : CHAT_FOLLOW_COPY.toLatest}
                                            </button>
                                        )}
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
                                                    onEnableMockMode={() => {
                                                        setIsMockMode(true);
                                                        setTurnFailure(null);
                                                        // The notice - and the pressed control with it -
                                                        // is going; the tablet the player can now use
                                                        // takes focus rather than <body>.
                                                        focusComposer();
                                                    }}
                                                    onOpenLedger={isGmConsoleEnabled ? openGmScreen : undefined}
                                                />
                                            </div>
                                        )}
                                        {transactionNote && <TransactionNoteView note={transactionNote} style={{ marginBottom: 10 }} />}
                                        {gameState === GameState.AWAITING_PLAYER_INPUT && canRetry && (
                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, animation: 'gorRise .4s ease-out both' }}>
                                                <Button
                                                    variant="secondary"
                                                    onClick={retryLastTurn}
                                                    // Its name is its visible words, less the glyph.
                                                    aria-label={online ? 'Retry the last action' : 'Hold until the roads reopen'}
                                                    // Item 49: this is a send like any other, so the
                                                    // shut roads hold it too — it used to be the one
                                                    // way past the offline gate. An open private scene
                                                    // holds it as it holds the tablet: pressed then,
                                                    // it refused and did nothing.
                                                    disabled={domainMutationInFlight || privateSceneInteractionLocked || !online}
                                                >
                                                    {online ? '↻ Retry the last action' : '↻ Hold until the roads reopen'}
                                                </Button>
                                            </div>
                                        )}
                                        <TurnComposer
                                            chatDraft={chatDraft}
                                            structuredDraft={structuredDraft}
                                            recipientOptions={recipientOptions}
                                            suggestedActions={gameState === GameState.PROCESSING ? [] : suggestedActions}
                                            onChatDraftChange={setChatDraft}
                                            onStructuredDraftChange={setStructuredDraft}
                                            onSubmit={handleComposerSubmit}
                                            disabled={domainMutationInFlight || privateSceneInteractionLocked || gameState !== GameState.AWAITING_PLAYER_INPUT}
                                            openScene={openScene}
                                            isProcessing={gameState === GameState.PROCESSING}
                                            turnStage={turnStage}
                                            playerInitial={playerEntity?.name}
                                            canReachTheFates={isMockMode || Boolean(resolvedApiKey)}
                                            online={online}
                                            onOpenSettings={openSettings}
                                            onEnableMockMode={() => setIsMockMode(true)}
                                            tools={<>
                                                {gameState === GameState.AWAITING_PLAYER_INPUT && (
                                                    <PrivateScene
                                                        scenes={privateSceneViews}
                                                        currentMacroTurn={turnNumber}
                                                        canStartScene={canStartScene}
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
                                                        onLastWord={handlePrivateSceneLastWord}
                                                        onSkipLastWord={handlePrivateSceneSkipLastWord}
                                                        npcVoice={privateSceneNpcVoice}
                                                    />
                                                )}
                                                {/* Always present: the text log stays readable while SILENT; replay is silenced (useNarrationLog). */}
                                                <NarrationLog
                                                    entries={narrationLogEntries}
                                                    stateFor={replayStateFor}
                                                    onToggle={toggleReplay}
                                                    onClear={clearLog}
                                                    onClose={stopReplay}
                                                />
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
                                            </>}
                                        />
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
                            onSpendDeepAnalysis={handleDeepAnalysis}
                            onInvestigationOutcome={handleInvestigationOutcome}
                            runDomainMutation={runDomainMutation}
                            interactionLocked={domainMutationInFlight || privateSceneInteractionLocked || gameState === GameState.PROCESSING}
                            ai={ai}
                            isMockMode={isMockMode}
                            eventHistory={eventHistory}
                            turnHistory={turnHistory}
                            pulsingTabs={unseenTabs}
                            tabChangeCounts={unseenCounts}
                            activeTab={activeRegister}
                            onSelectTab={handleSelectRegister}
                            panelRef={setSidePanelElement}
                            onOccurrenceFinding={handleOccurrenceFinding}
                            occurrenceSibling={occurrenceSibling}
                            resolvedApiKey={resolvedApiKey}
                            narrationVoiceMode={narrationVoiceMode}
                            personaeVoice={personaeVoice}
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
                reignSeed={reignSeed}
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
            {paletteOpen && <CommandPalette commands={paletteCommands} onClose={closePalette} />}
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
                    lightingChoice={lightingChoice}
                    onSetLightingChoice={setLightingChoice}
                    gmConsoleEnabled={gmConsoleAvailable}
                    onSetGmConsoleEnabled={handleSetGmConsoleAvailable}
                    gmInterventionEnabled={gmInterventionAvailable}
                    onSetGmInterventionEnabled={handleSetGmInterventionAvailable}
                    narrationVoiceMode={narrationVoiceMode}
                    onSetNarrationVoiceMode={handleSetNarrationVoiceMode}
                    narrators={narrators}
                    narratorId={narratorId}
                    onSetNarrator={handleSetNarrator}
                    narratorCharacters={narratorCharacters}
                    narratorCharacterId={narratorCharacterId}
                    onSetNarratorCharacter={handleSetNarratorCharacter}
                    customNarrators={customNarrators}
                    onSaveCustomNarrator={handleSaveCustomNarrator}
                    onDeleteCustomNarrator={handleDeleteCustomNarrator}
                    narratorVoiceChoice={narratorVoiceChoice}
                    narratorOwnVoice={narratorOwnVoice}
                    onSetNarratorVoice={handleSetNarratorVoice}
                    voiceStyleChoice={voiceStyleChoice}
                    narratorOwnStyle={narratorOwnStyle}
                    onSetVoiceStyle={handleSetVoiceStyle}
                    narratorVoiceFromCast={narratorVoiceFromCast}
                    voiceCast={effectiveCast}
                    castCharacters={castBasis.candidates}
                    canRecast={canRecast}
                    recastStatus={recastStatus}
                    onRecast={handleRecast}
                    onOverrideCastMember={handleOverrideMember}
                    onResetCastMember={handleResetMember}
                    isMockMode={isMockMode}
                    onSetIsMockMode={setIsMockMode}
                    gmConsoleOpen={isGmConsoleEnabled}
                    onSetGmConsoleOpen={handleSetGmConsoleOpen}
                    hasSavedReign={hasStoredReign()}
                    onExportReign={downloadTheReign}
                    onImportReign={handleImportReign}
                    interactionLocked={domainMutationInFlight || gameState === GameState.PROCESSING}
                    reading={{
                        readingScale: reading.readingScale, onSetReadingScale: reading.handleSetReadingScale,
                        motion: reading.motion, onSetMotion: reading.handleSetMotion,
                        narrationReveal: reading.narrationReveal, onSetNarrationReveal: reading.handleSetNarrationReveal,
                        shortcuts: reading.shortcuts, onSetShortcuts: reading.handleSetShortcuts,
                    }}
                />
            )}
        </div>
    );
};

export default App;
