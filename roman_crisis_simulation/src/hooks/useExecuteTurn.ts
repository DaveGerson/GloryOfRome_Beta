/**
 * hooks/useExecuteTurn.ts
 *
 * The turn transaction: submit -> runNewTurn -> knowledge/relationship/
 * no-attempt follow-ups -> commit-or-roll-back. Extracted verbatim out of
 * App.tsx's `executeTurn` useCallback on 2026-08-05 (work item 2 of
 * docs/superpowers/specs/2026-08-05-reign-export-import-design.md) so the
 * pipeline has one home instead of living inline in the composition root.
 * Pure extraction: no behavior changed, nothing reordered, nothing renamed
 * inside the body - only the identifiers now read off `deps`.
 *
 * `ExecuteTurnDeps` names everything the callback closes over: the reactive
 * state slices App.tsx's own 25-entry dependency array already tracked,
 * plus the setters/refs that array never needed to list. (The two pure
 * helpers it once also carried - newestInferredAmbition and
 * privateScenesFingerprint - are module imports from app/transactions.ts
 * since 2026-09-23.) React guarantees `useState` setters and `useRef`
 * objects are stable - `react-hooks/
 * exhaustive-deps` only recognizes those patterns when they're declared in
 * the SAME component, so once they cross this file boundary as plain
 * object fields they have to be named explicitly, both here and in the
 * useCallback's own array below. Listing them changes nothing at runtime:
 * every one of them already held a stable identity across App's renders.
 */

import { useCallback } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { GoogleGenAI } from '@google/genai';
import { GameState } from '../types';
import type {
    Entity,
    Message,
    WorldState,
    SimulationState,
    Report,
    TruthLedgerEntry,
    NpcIntent,
    TurnHistoryEntry,
    EventFiringRecord,
    StructuredTurnDraft,
    TurnSubmission,
} from '../types';
import type { GameAction } from '../state/gameReducer';
import { withOldSnapshotsDropped } from '../state/gameReducer';
import type { RunDomainMutation } from '../state/domainMutation';
import { runNewTurn } from '../ai/core/turn';
import type { TurnStage } from '../ai/core/turn';
import { AiServiceError } from '../ai/core/geminiService';
import { inferAmbition } from '../ai/tools/ambition';
import { updateSavedAmbition } from '../persistence/saveGame';
import type { SaveGameState, InferredAmbitionState } from '../persistence/saveGame';
import { getPacingPosture } from '../persistence/settings';
import {
    selectPendingPrivateSceneOutcome,
    buildPrivateSceneAdjudicatorProjection,
    buildPrivateSceneNpcMemoryProjection,
    consumePrivateSceneOutcome,
} from '../privateScene/model';
import type { PrivateSceneRecord } from '../privateScene/model';
import { replacePrivateSceneForCommit } from '../components/PrivateScene';
import { computeTurnKnowledge } from '../knowledge/commit';
import type { KnowledgeClaim } from '../knowledge/store';
import { buildPlayerSafeEvidence, buildTurnRelationshipEvidence, knownRecipientOptionsForPlayer } from '../knowledge/relationships';
import { getRelationshipObservations } from '../ai/tools/relationshipObservations';
import { emptyStructuredDraft } from '../playerInput/composerState';
import {
    deserializeTurnSubmission,
    projectForExternalInference,
    projectForNoAttemptResponse,
    serializeTurnSubmission,
} from '../playerInput/turnSubmission';
import { selectNoAttemptEvidence } from '../ai/tools/noAttemptResponse';
import {
    buildNoAttemptEvidence,
    PRIVATE_INTENT_ACKNOWLEDGEMENT,
    renderNoAttemptResponse,
} from '../playerView/noAttemptResponse';
import { buildInterventionTextWithFallout } from '../components/investigationLoop';
import { toRoman } from '../components/ui/Brand';
import type { TurnFailure } from '../components/ui/FailureNotices';
import { buildPlayerPerceivedDigest } from '../perception/visibility';
// The two pure helpers executeTurn shares with the other commit sites
// (commitPrivateScene, buildSaveState, the ambition-tracking effect) - once
// App.tsx-local values passed through `deps`, now one module-scope import.
import { newestInferredAmbition, privateScenesFingerprint } from '../app/transactions';
import type { DomainCommit, TransactionNote } from '../app/transactions';

// DESIGN_DECISIONS.md D8 - how often the "cheap periodic model call" that
// infers the player's apparent ambition fires, counted in COMMITTED turns
// (the turn number just finished, not the upcoming one). Moved here
// verbatim from App.tsx: this constant is read only inside executeTurn.
const AMBITION_INFERENCE_TURN_INTERVAL = 3;
const NO_ATTEMPT_SELECTION_FAILURE_DIAGNOSTIC =
    '[No-attempt response] Evidence selection failed; the player received the safe no-answer fallback.';

export interface ExecuteTurnDeps {
    // --- AI context: what a turn is allowed to call and under what device
    // conditions. `ai`/`resolvedApiKey`/`isMockMode` are documented at their
    // declarations in App.tsx; `online` is the navigator.onLine mirror from
    // components/ui/FailureNotices.tsx's useOnline. ---
    ai: GoogleGenAI;
    isMockMode: boolean;
    resolvedApiKey: string | null;
    online: boolean;

    // --- Game-domain state slices (state/gameReducer.ts's GameDomainState,
    // destructured from useGame() in App.tsx) - exactly the reactive values
    // the original dependency array carried. ---
    entities: Entity[];
    worldState: WorldState;
    simulationState: SimulationState;
    reports: Report[];
    truthLedger: TruthLedgerEntry[];
    knowledge: KnowledgeClaim[];
    npcIntents: NpcIntent[];
    turnNumber: number;
    playerCharacterId: string | null;
    turnHistory: TurnHistoryEntry[];
    pendingIntelligenceFallout: string[];
    gmInterventionText: string;
    eventFirings: EventFiringRecord[];
    metaNarrative: string;
    messages: Message[];

    // --- Dispatch and transaction helpers (the composition root's wiring
    // over GameContext; see hooks/useCampaignTransactions.ts for
    // runDomainMutation/commitDomainMutation's own doc comments). The commit
    // shape is app/transactions.ts's shared `DomainCommit`. ---
    dispatch: Dispatch<GameAction>;
    getStateGeneration: () => number;
    runDomainMutation: RunDomainMutation;
    commitDomainMutation: (commit: DomainCommit) => boolean;
    buildSaveState: (overrides?: Partial<SaveGameState>) => SaveGameState;
    strikeWeekBeat: () => void;

    // --- Refs App.tsx owns across the whole component; executeTurn reads
    // and writes them exactly as it did as an inline useCallback. ---
    preTurnSnapshotRef: MutableRefObject<SaveGameState | null>;
    campaignGenerationRef: MutableRefObject<number>;
    privateScenesRef: MutableRefObject<PrivateSceneRecord[]>;
    appMountedRef: MutableRefObject<boolean>;
    latestInferredAmbitionRef: MutableRefObject<InferredAmbitionState | null>;

    // --- Transient, presentation-only setters (App.tsx local useState -
    // never part of the save bundle; see their declarations there). ---
    setPendingPlayerMessage: (value: Message | null) => void;
    setTurnFailure: (value: TurnFailure | null) => void;
    setRetrySubmission: (value: TurnSubmission | null) => void;
    setRetryDraft: (value: string | StructuredTurnDraft | null) => void;
    setChatDraft: (value: string) => void;
    setStructuredDraft: (value: StructuredTurnDraft) => void;
    setTurnStage: (value: TurnStage | null) => void;
    setStreamingNarration: (value: string) => void;
    setIsCheckingEvents: (value: boolean) => void;
    // app/transactions.ts's shared `TransactionNote` union.
    setTransactionNote: (note: TransactionNote | null) => void;
}

export function useExecuteTurn(deps: ExecuteTurnDeps) {
    const {
        ai, isMockMode, resolvedApiKey, online,
        entities, worldState, simulationState, reports, truthLedger, knowledge, npcIntents,
        turnNumber, playerCharacterId, turnHistory, pendingIntelligenceFallout, gmInterventionText,
        eventFirings, metaNarrative, messages,
        dispatch, getStateGeneration, runDomainMutation, commitDomainMutation, buildSaveState, strikeWeekBeat,
        preTurnSnapshotRef, campaignGenerationRef, privateScenesRef, appMountedRef, latestInferredAmbitionRef,
        setPendingPlayerMessage, setTurnFailure, setRetrySubmission, setRetryDraft,
        setChatDraft, setStructuredDraft, setTurnStage, setStreamingNarration,
        setIsCheckingEvents, setTransactionNote,
    } = deps;

    return useCallback(async (submission: TurnSubmission, draftToRestore: string | StructuredTurnDraft): Promise<boolean> => {
        const mutation = await runDomainMutation(async transaction => {
        // Capture both campaign-session and whole-state generations before
        // any turn work begins. The context token advances synchronously
        // before GAME_LOADED/GAME_STARTED/TURN_ROLLED_BACK dispatches; the
        // session token also covers campaign abandonment paths that do not
        // replace reducer state. Neither relies on a render-time ref write.
        const campaignGenerationForTurn = campaignGenerationRef.current;
        const stateGenerationForTurn = getStateGeneration();
        const turnGenerationIsCurrent = () => (
            campaignGenerationRef.current === campaignGenerationForTurn
            && getStateGeneration() === stateGenerationForTurn
        );
        const serialized = serializeTurnSubmission(submission);
        const noAttemptResponse = projectForNoAttemptResponse(submission);
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
        setTurnFailure(null);
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
            setTurnFailure({ kind: 'fatal' });
            dispatch({ type: 'TURN_ROLLED_BACK', snapshot: preTurnSnapshot });
            dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            if (typeof restoreDraft === 'string') setChatDraft(restoreDraft);
            else setStructuredDraft(restoreDraft);
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
            // No notice here: the composer already carries the standing
            // "No token on this device" notice from first paint (item 46),
            // and rendering a second copy of it would be two alerts saying
            // the same thing. This guard's job is to stop the call and keep
            // the draft, which it does above.
            setTurnFailure(null);
            dispatch({ type: 'TURN_ROLLED_BACK', snapshot: preTurnSnapshot });
            dispatch({ type: 'GAME_STATE_SET', gameState: GameState.AWAITING_PLAYER_INPUT });
            if (typeof restoreDraft === 'string') setChatDraft(restoreDraft);
            else setStructuredDraft(restoreDraft);
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
        // A macro turn gets one immutable view of the private-scene ledger.
        // This is both the source for its bounded AI projections and the
        // compare-before-commit token that prevents a late response from
        // overwriting a campaign reload or another replacement of the scene
        // list. The raw ledger/transcript never crosses the runNewTurn seam.
        const privateScenesForTurn = privateScenesRef.current;
        const privateScenesFingerprintForTurn = privateScenesFingerprint(privateScenesForTurn);
        const privateSceneSnapshotIsCurrent = () => (
            privateScenesFingerprint(privateScenesRef.current) === privateScenesFingerprintForTurn
        );
        const turnSnapshotIsCurrent = () => (
            turnGenerationIsCurrent() && privateSceneSnapshotIsCurrent()
        );

        // Set once the turn is durably saved (inside commitDomainMutation's
        // beforeDispatch; onSaveFailure throws AUTOSAVE_FAILED first
        // otherwise). Gates the catch below: a throw AFTER this point must
        // never roll back an already-committed turn or offer Retry on top of
        // the N+1 autosave - see the catch's marker-first branch.
        // A boxed `.current` (rather than a plain reassigned `let`) because
        // the write now happens inside commitDomainMutation's `beforeDispatch`
        // closure - TypeScript's control-flow narrowing doesn't see into a
        // nested function body, so a bare `let` would (wrongly, only at the
        // type level) narrow to `null` at the read site below.
        const committedTail: { current: { diedThisTurn: boolean } | null } = { current: null };

        try {
            // At most one closed pending scene informs the macro adjudicator.
            // NPC memories remain partitioned by the NPC who participated;
            // builders expose only the purpose-built projections, never the
            // raw transcript or full private-scene record.
            const pendingPrivateScene = selectPendingPrivateSceneOutcome(privateScenesForTurn);
            const privateSceneAdjudicatorProjection = pendingPrivateScene
                ? buildPrivateSceneAdjudicatorProjection(pendingPrivateScene)
                : undefined;
            const privateSceneNpcMemoriesByNpcId = Object.fromEntries(
                [...new Set(
                    privateScenesForTurn
                        .filter(scene => scene.status === 'closed')
                        .map(scene => scene.npcId),
                )].map(npcId => [
                    npcId,
                    buildPrivateSceneNpcMemoryProjection(privateScenesForTurn, npcId),
                ]),
            );
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
                {
                    onStage: stage => {
                        if (transaction.isCurrent() && turnSnapshotIsCurrent()) setTurnStage(stage);
                    },
                    onNarrationChunk: textSoFar => {
                        if (transaction.isCurrent() && turnSnapshotIsCurrent()) setStreamingNarration(textSoFar);
                    },
                    pacingPosture: getPacingPosture(),
                    eventFirings,
                    privateSceneAdjudicatorProjection,
                    privateSceneNpcMemoriesByNpcId,
                }
            );
            if (!transaction.isCurrent() || !turnSnapshotIsCurrent()) return;

            // COMMIT STATE
            const newWorldState = ((): WorldState => {
                let newWeek = worldState.week + 1;
                let newYear = worldState.year;
                if (newWeek > 52) { newWeek = 1; newYear += 1; }
                return { ...result.updatedWorldState, year: newYear, week: newWeek };
            })();
            // Add post-turn entity state to history for GM view
            const baseHistoryEntryWithState = { ...result.newHistoryEntry, playerIntent: serialized, postTurnEntities: result.updatedEntities };
            const newTurnNumber = turnNumber + 1;

            // D21 knowledge-store ingestion (knowledge/commit.ts): the next
            // store is computed from the SAME D5-filtered digest the player
            // is about to see (the identical buildPlayerPerceivedDigest inputs the
            // lastTurnPerceivedChanges memo will re-derive from this history
            // entry) plus this turn's NEW Reports - never from raw deltas or
            // anything GM-private. The helper owns the new-report id filter
            // and stamps every update with the authoritative `turnNumber`
            // (never a model-authored turn field). Committed atomically with
            // the rest of the turn below, so a rolled-back turn ingests
            // nothing.
            const playerAfterTurn = result.updatedEntities.find(e => e.entity_id === playerCharacterId) ?? null;
            const perceivedThisTurn = playerAfterTurn
                ? buildPlayerPerceivedDigest(baseHistoryEntryWithState.adjudication.deltas, playerAfterTurn, result.updatedEntities, newWorldState)
                : [];
            const priorReportIds = new Set(reports.map(report => report.id));
            const reportsThisTurn = result.updatedReports.filter(report => !priorReportIds.has(report.id));
            const entityDirectory = result.updatedEntities.map(entity => ({
                entity_id: entity.entity_id,
                name: entity.name,
            }));
            const relationshipEvidence = buildTurnRelationshipEvidence({
                submission: projectForExternalInference(submission),
                perceivedChanges: perceivedThisTurn,
                reports: reportsThisTurn,
            }).map(item => buildPlayerSafeEvidence(item, entityDirectory));
            const knownEntityIds = playerAfterTurn
                ? [
                    playerAfterTurn.entity_id,
                    ...knownRecipientOptionsForPlayer(playerAfterTurn, result.updatedEntities, knowledge)
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
            if (!transaction.isCurrent() || !turnSnapshotIsCurrent()) return;
            const newKnowledge = computeTurnKnowledge({
                prev: knowledge,
                perceivedChanges: perceivedThisTurn,
                reportsBefore: reports,
                reportsAfter: result.updatedReports,
                turnNumber,
                relationshipObservations: {
                    evidence: relationshipEvidence,
                    drafts: relationshipDrafts,
                    entities: entityDirectory,
                    knownEntityIds,
                },
            });
            let finalNarration = result.narration;
            let finalAdjudication = baseHistoryEntryWithState.adjudication;
            if (noAttemptResponse?.kind === 'question') {
                const evidence = buildNoAttemptEvidence(newKnowledge);
                const selection = await selectNoAttemptEvidence(
                    ai,
                    noAttemptResponse.question,
                    evidence,
                    isMockMode,
                );
                if (!transaction.isCurrent() || !turnSnapshotIsCurrent()) return;
                finalNarration = renderNoAttemptResponse(selection);
                if (selection.kind === 'no_answer'
                    && (selection.reason === 'invalid_selection' || selection.reason === 'selector_failure')) {
                    finalAdjudication = {
                        ...finalAdjudication,
                        gm_private: [
                            ...finalAdjudication.gm_private,
                            NO_ATTEMPT_SELECTION_FAILURE_DIAGNOSTIC,
                        ],
                    };
                }
            } else if (noAttemptResponse?.kind === 'private_intent') {
                finalNarration = PRIVATE_INTENT_ACKNOWLEDGEMENT;
            }

            const historyEntryWithState = {
                ...baseHistoryEntryWithState,
                narration: finalNarration,
                adjudication: finalAdjudication,
            };
            // Bound the snapshot window HERE, once, because this same array
            // feeds BOTH the TURN_COMMITTED dispatch and the autosave below -
            // the reducer's own trim only bounds in-memory state, so an
            // autosave built from the raw array would persist every snapshot
            // (and re-persist all of a legacy save's per-entry snapshots each
            // session). Applying it here also self-heals such legacy saves on
            // their first commit; the reducer's trim is idempotent on the
            // already-bounded array.
            const newTurnHistory = withOldSnapshotsDropped([...turnHistory, historyEntryWithState]);
            const gmMessage: Message = { sender: 'gm', text: historyEntryWithState.narration };
            const monologueMessage: Message | null = result.playerMonologue
                ? { sender: 'player_monologue', text: result.playerMonologue }
                : null;
            // Week-advance ribbon written into the stream once the turn commits
            // (rendered as a TurnRibbon divider, not a speech bubble).
            // The week numeral is the vexillum's first line; the Roman date is
            // rendered from `ribbonDate` rather than baked into the text, so a
            // ribbon written today still reads correctly a reign later.
            const ribbonMessage: Message = {
                sender: 'ribbon',
                text: `Week ${toRoman(newWorldState.week)}`,
                ribbonDate: { week: newWorldState.week, year: newWorldState.year },
            };
            const committedMessages = [
                playerMessage,
                gmMessage,
                ...(monologueMessage ? [monologueMessage] : []),
                ribbonMessage,
            ];

            // Nothing may consume a private-scene outcome unless the exact
            // scene snapshot supplied to this turn is still current. The
            // consumed record is prepared before persistence, but becomes
            // live only after the whole macro-turn candidate is durable.
            if (!turnSnapshotIsCurrent()) return;
            let committedPrivateScenes = [...privateScenesForTurn];
            if (pendingPrivateScene) {
                const consumed = consumePrivateSceneOutcome(
                    privateScenesForTurn,
                    pendingPrivateScene.sceneId,
                    newTurnNumber,
                );
                if (!consumed.ok) {
                    throw new Error(`PRIVATE_SCENE_CONSUMPTION_FAILED: ${consumed.error}`);
                }
                committedPrivateScenes = replacePrivateSceneForCommit(privateScenesForTurn, consumed.scene);
            }

            // DESIGN_DECISIONS.md D1 - survival-only: ONLY the player's own
            // death ends the run. Hoisted above the commit so the post-commit
            // tail (below) and the committedTail marker can both use it
            // without a duplicate declaration.
            const updatedPlayerEntity = result.updatedEntities.find(e => e.entity_id === playerCharacterId);
            const diedThisTurn = updatedPlayerEntity?.status === 'dead';

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
                privateScenes: committedPrivateScenes,
                turnNumber: newTurnNumber,
                turnHistory: newTurnHistory,
                messages: [...messages, ...committedMessages],
                suggestedActions: result.suggestedActions,
                currentEvents: result.headlines,
                gmInterventionText: '',
                pendingIntelligenceFallout: [],
            });
            // onSaveFailure throws, so the false return is unreachable here.
            commitDomainMutation({
                candidate: nextSaveState,
                action: {
                    type: 'TURN_COMMITTED',
                    entities: result.updatedEntities,
                    worldState: newWorldState,
                    simulationState: result.updatedSimulationState,
                    reports: result.updatedReports,
                    truthLedger: result.updatedTruthLedger,
                    knowledge: newKnowledge,
                    npcIntents: result.updatedNpcIntents,
                    privateScenes: committedPrivateScenes,
                    turnNumber: newTurnNumber,
                    turnHistory: newTurnHistory,
                    playerMessage,
                    gmMessage,
                    monologueMessage,
                    ribbonMessage,
                    suggestedActions: result.suggestedActions,
                    currentEvents: result.headlines,
                },
                onSaveFailure: () => { throw new Error('AUTOSAVE_FAILED'); },
                beforeDispatch: () => {
                    committedTail.current = { diedThisTurn };
                    privateScenesRef.current = committedPrivateScenes;
                },
                onCommitted: () => { setTransactionNote(null); strikeWeekBeat(); },
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
            // triggers this. (updatedPlayerEntity/diedThisTurn are hoisted
            // above the commit; see the comment there.)
            if (!diedThisTurn) {
                // Flag that the turn is over and events should be checked
                setIsCheckingEvents(true);
            }

            if (submission.kind === 'freeform') setChatDraft('');
            else setStructuredDraft(emptyStructuredDraft());
            setPendingPlayerMessage(null);
            setTurnFailure(null);

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
                const ambitionCampaignGeneration = campaignGenerationRef.current;
                inferAmbition(ai, updatedPlayerEntity, recentIntents, recentHeadlines, isMockMode)
                    .then(inference => {
                        if (!appMountedRef.current || campaignGenerationRef.current !== ambitionCampaignGeneration) return;
                        const nextAmbition: InferredAmbitionState = { ...inference, asOfTurn: ambitionTurnNumber };
                        // Let the turn transaction settle first. This out-of-band
                        // enrichment must never interleave with its durable commit.
                        setTimeout(() => {
                            if (!appMountedRef.current || campaignGenerationRef.current !== ambitionCampaignGeneration) return;
                            dispatch({ type: 'AMBITION_INFERRED', inferredAmbition: nextAmbition });
                            latestInferredAmbitionRef.current = newestInferredAmbition(
                                latestInferredAmbitionRef.current,
                                nextAmbition,
                            );
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
            if (committedTail.current) {
                // The turn is durably saved and dispatched; never roll back or
                // offer Retry here — that would double-resolve the submission
                // on top of the N+1 autosave.
                if (transaction.isCurrent()) {
                    console.error('Turn committed; post-commit work failed:', error);
                    setTurnStage(null);
                    setStreamingNarration('');
                    setPendingPlayerMessage(null);
                    if (submission.kind === 'freeform') setChatDraft('');
                    else setStructuredDraft(emptyStructuredDraft());
                    if (!committedTail.current.diedThisTurn) setIsCheckingEvents(true);
                    setTransactionNote({ kind: 'half_commit' });
                }
                return;
            }
            if (!transaction.isCurrent() || !turnSnapshotIsCurrent()) return;
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
            // `AiServiceError.kind` already split these; only the player was
            // never told which. `debugSnippet` stays where it is (D4/D5) —
            // nothing below reads it.
            //
            // A failed autosave is NOT a failure of the Fates: the model
            // answered, the same words would work, and there is nothing in the
            // week to change. Routing it to the fatal notice told the player
            // three false things in a row, so it goes to the save notice — the
            // one that names the device and the last safe week — while the
            // retry affordance below stays exactly as it was.
            if (error instanceof Error && error.message === 'AUTOSAVE_FAILED') {
                setTurnFailure(null);
                setTransactionNote({
                    kind: 'save',
                    lead: 'The week could not be saved. Your draft is kept and the week has not turned.',
                });
            } else {
                setTurnFailure(
                    !online ? { kind: 'offline' }
                        : error instanceof AiServiceError && error.kind === 'transient' ? { kind: 'transient' }
                            : { kind: 'fatal' },
                );
            }

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
        }
        });
        return mutation.acquired;
    }, [ai, buildSaveState, commitDomainMutation, dispatch, entities, eventFirings, getStateGeneration, gmInterventionText, isMockMode, knowledge, messages, metaNarrative, npcIntents, online, pendingIntelligenceFallout, playerCharacterId, reports, resolvedApiKey, runDomainMutation, simulationState, strikeWeekBeat, truthLedger, turnHistory, turnNumber, worldState, preTurnSnapshotRef, campaignGenerationRef, privateScenesRef, appMountedRef, latestInferredAmbitionRef, setPendingPlayerMessage, setTurnFailure, setRetrySubmission, setRetryDraft, setChatDraft, setStructuredDraft, setTurnStage, setStreamingNarration, setIsCheckingEvents, setTransactionNote]);
}
