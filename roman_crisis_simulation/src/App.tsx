import React, { useState, useMemo } from 'react';
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
import { hasSave } from './persistence/saveGame';
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
import { usePrivateSceneController } from './hooks/usePrivateSceneController';
import { useSettings } from './hooks/useSettings';
import { useTurnFlow } from './hooks/useTurnFlow';
import { useWeekBeat } from './hooks/useWeekBeat';
import { useNarrationVoice } from './hooks/useNarrationVoice';
import { narratorCharactersFor } from './narration/narratorChoice';
import { useNarrationLog } from './hooks/useNarrationLog';
import { NarrationLog } from './components/NarrationLog';
import { useDevSmokeTest, useScrollToLatest, useUnloadGuardWhileProcessing } from './hooks/useShellEffects';
import type { TransactionNote } from './app/transactions';
import { TransactionNoteView, downloadTheReign } from './app/TransactionNoteView';
import {
    GameMasterScreen, EpilogueScreen, SettingsMenu, OnboardingOverlay, usePreloadLazyScreens,
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
    useDevSmokeTest();
    usePreloadLazyScreens();
    const messagesEndRef = useScrollToLatest(messages, gameState);
    useUnloadGuardWhileProcessing(gameState);

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
        lastTurn, lastTurnPerceivedChanges, pulsingTabs, illuminatedNarrations, lastGmNarration,
    } = usePlayerPerception(messages, turnHistory, playerCharacterId, worldState, knowledge);

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
        ai, isMockMode,
        privateScenes: state.privateScenes,
        playerEntity, entities, privateSceneKnownIds, turnNumber,
        privateSceneInteractionLocked,
        runDomainMutation, commitDomainMutation, buildSaveState,
        privateSceneLockRef, privateScenesRef,
    });

    const { setIsCheckingEvents, eventChoiceError, handleEventChoice } = useEventFlow({
        activeEvent, playerEntity, entities, worldState, simulationState, turnNumber,
        eventFirings, eventHistory, triggeredEventIds, messages,
        dispatch, buildSaveState, commitDomainMutation, setTransactionNote,
    });

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
        eventFirings, metaNarrative, messages,
        dispatch, getStateGeneration, runDomainMutation, commitDomainMutation, buildSaveState, strikeWeekBeat,
        preTurnSnapshotRef, campaignGenerationRef, privateScenesRef, appMountedRef, latestInferredAmbitionRef,
        setIsCheckingEvents, setTransactionNote,
    });

    const {
        savedGameInfo,
        handleSelectCharacter,
        handleCustomCreation,
        handleContinue,
        handleStartAnew,
        handleImportReign,
    } = useCampaignLifecycle({
        ai, isMockMode, worldState, metaNarrative, messages,
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
    const {
        narrationVoiceMode, handleSetNarrationVoiceMode, toggleNarrationVoice, narrationVoiceStateFor,
        narrators, narratorId, handleSetNarrator,
        narratorCharacterId, handleSetNarratorCharacter,
        customNarrators, handleSaveCustomNarrator, handleDeleteCustomNarrator,
        narratorVoiceChoice, narratorOwnVoice, handleSetNarratorVoice,
        voiceStyleChoice, narratorOwnStyle, handleSetVoiceStyle,
    } = useNarrationVoice({
        ai, isMockMode, resolvedApiKey, messages, gameState, playerEntity, narratorCharacters,
        week: worldState.week, turnNumber,
    });
    // The narration log: every performance kept as text on this device, with
    // replay that never re-runs the narrator (narration/narrationLog.ts).
    const { narrationLogEntries, toggleReplay, replayStateFor, stopReplay, clearLog } = useNarrationLog({ ai, isMockMode, resolvedApiKey });

    const {
        handleSpendResource, handleOccurrenceFinding, handleInvestigationOutcome, handleSetIntervention,
    } = useIntelCommits({
        ai, isMockMode, entities, playerCharacterId, knowledge, pendingIntelligenceFallout, messages, turnNumber,
        buildSaveState, commitDomainMutation, setTransactionNote,
    });

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
                                        {messages.map((msg, index) => (
                                            <ChatMessage
                                                key={index}
                                                message={msg}
                                                illuminated={illuminatedNarrations.has(index)}
                                                index={index}
                                                voiceState={narrationVoiceStateFor(msg, index)}
                                                onToggleVoice={toggleNarrationVoice}
                                            />
                                        ))}
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
                                        {gameState === GameState.AWAITING_PLAYER_INPUT && canRetry && (
                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, animation: 'gorRise .4s ease-out both' }}>
                                                <Button
                                                    variant="secondary"
                                                    onClick={retryLastTurn}
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
                                                />
                                            )}
                                            {(narrationVoiceMode !== 'off' || narrationLogEntries.length > 0) && (
                                                <NarrationLog
                                                    entries={narrationLogEntries}
                                                    stateFor={replayStateFor}
                                                    onToggle={toggleReplay}
                                                    onClear={clearLog}
                                                    onClose={stopReplay}
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
                            resolvedApiKey={resolvedApiKey}
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
