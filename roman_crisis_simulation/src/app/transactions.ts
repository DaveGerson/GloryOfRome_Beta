/**
 * app/transactions.ts
 *
 * The composition root's pure transaction vocabulary: the shapes every
 * save-then-dispatch site shares, and the small pure helpers the durable
 * commit path leans on. Moved verbatim out of App.tsx (2026-09-23) so the
 * hooks that now carry App's handlers (hooks/useCampaignTransactions.ts,
 * hooks/usePrivateSceneController.ts, hooks/useExecuteTurn.ts, ...) import
 * ONE definition instead of each re-declaring a structural copy - the
 * duplication hooks/useExecuteTurn.ts's extraction had to accept, because
 * a hook must never import its own composition root.
 *
 * Nothing here touches React. The only side effects are the persistence
 * read in `loadSavedGameSummary` (readSaveSlot), the dev-only env read
 * in `readDevApiKey`, and the `navigator.onLine` read in `roadsOpenNow`.
 */

import type { GameAction } from '../state/gameReducer';
import type { GameDomainState } from '../state/gameReducer';
import type { SavedReign } from '../components/CharacterSelection';
import { readSaveSlot } from '../persistence/saveGame';
import type { SaveGameState, InferredAmbitionState } from '../persistence/saveGame';
import type { PrivateSceneRecord } from '../privateScene/model';

/**
 * What a non-turn transaction has to say (WP-21). Three shapes, because
 * three different things happen: a write that would not land names the last
 * safe week AND offers "Take a copy of the reign" (restored 2026-08-05 —
 * the import route exists now; DESIGN_DECISIONS.md D45 as amended); a
 * half-commit is not a failure at all and takes `role="status"`; and the
 * delete path is neither.
 */
export type TransactionNote =
    | { kind: 'save'; lead: string }
    | { kind: 'half_commit' }
    | { kind: 'plain'; message: string };

// Task 7 (task-7-site-map.md): the shared shape for every save-then-dispatch
// site. The durable bytes must exist before the reducer dispatch;
// `beforeDispatch` runs after save success and before dispatch, `onCommitted`
// after. Per-site clear-ordering and failure channels differ (see the site
// map) - the helper adapts to each site, never the reverse. Error CLEARS keep
// each site's original position (some before dispatch, some after) -
// preserved verbatim; do not normalize into onCommitted.
export interface DomainCommit {
    candidate: SaveGameState;
    action: GameAction;
    onSaveFailure: () => void;      // set*Error(...) or throw AUTOSAVE_FAILED
    beforeDispatch?: () => void;    // AFTER durable save, BEFORE dispatch
    onCommitted?: () => void;       // post-dispatch work
}

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
export function readDevApiKey(): string | undefined {
    if (!import.meta.env.DEV) return undefined;
    return typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
}

/**
 * What the destiny screen says about the autosave slot: nothing when it is
 * empty, the "Continue your reign" summary when it loads, and - when it
 * holds a reign this build refuses - the refusal reason, so the screen can
 * say so and gate the overwrite rather than look like a fresh device.
 */
export function loadSavedGameSummary(): SavedReign | null {
    const slot = readSaveSlot();
    if (slot.kind === 'empty') return null;
    if (slot.kind === 'refused') return { unreadable: slot.reason };
    const { save } = slot;
    const savedCharacter = save.state.entities.find(entity => entity.entity_id === save.state.playerCharacterId);
    // B7a 1a (spec: 2026-08-05-b7a-hardening-and-tablist-design.md): mirrors
    // importSaveBlob's derive - a non-string name is malformed data, not a
    // pretense to coerce ('Unknown' is honest, String(5) === '5' is not),
    // and this closes the boot crash at `(characterName || 'R').charAt(0)`.
    return {
        characterName: typeof savedCharacter?.name === 'string' ? savedCharacter.name : 'Unknown',
        turnNumber: save.state.turnNumber,
        savedAt: save.savedAt,
    };
}

/**
 * D8 - the newest of any number of inferred-ambition snapshots, by
 * `asOfTurn`. Ties go to the LATER argument, so a caller lists candidates
 * oldest-source-first (stored save, then candidate, then the live ref).
 */
export function newestInferredAmbition(
    ...candidates: Array<InferredAmbitionState | null | undefined>
): InferredAmbitionState | null {
    return candidates.reduce<InferredAmbitionState | null>(
        (newest, candidate) => candidate && (!newest || candidate.asOfTurn >= newest.asOfTurn)
            ? candidate
            : newest,
        null,
    );
}

/**
 * Whether `stored` is an earlier (or identical) point in the SAME campaign
 * as `candidate` - same player, same premise, and a turn history that is a
 * prefix of the candidate's. Only then may a stored ambition be carried
 * forward into the candidate (see buildSaveState).
 */
export function isSameCampaignPrefix(candidate: SaveGameState, stored: SaveGameState): boolean {
    return stored.playerCharacterId === candidate.playerCharacterId
        && stored.metaNarrative === candidate.metaNarrative
        && stored.turnNumber <= candidate.turnNumber
        && stored.turnHistory.length <= candidate.turnHistory.length
        && stored.turnHistory.every((entry, index) => {
            const candidateEntry = candidate.turnHistory[index];
            return candidateEntry?.turnNumber === entry.turnNumber
                && candidateEntry.playerIntent === entry.playerIntent;
        });
}

export function privateScenesFingerprint(scenes: readonly PrivateSceneRecord[]): string {
    return JSON.stringify(scenes);
}

/**
 * Whether a private scene currently holds the table: one is open, or is
 * waiting on the player's last word. While true, ordinary domain mutations
 * are refused (runDomainMutation's allowDuringPrivateScene) and the
 * composer, side panel and event modal lock. The ONE predicate both the
 * render-time lock and commitPrivateScene's pre-dispatch ref write use.
 */
export function isPrivateSceneInteractionLocked(scenes: readonly PrivateSceneRecord[]): boolean {
    return scenes.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word');
}

/**
 * Whether the roads are open at this moment: `navigator.onLine`, read when
 * asked rather than when a handler was made, since a turn's calls outlast
 * the render that started them (components/ui/FailureNotices.tsx's
 * useOnline mirrors the same value for the screen). Where nothing can be
 * asked, they are open.
 */
export function roadsOpenNow(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * The relationship-observation selector as a commit runs it (D36), with the
 * roads open or shut (D45). Its observations are drawn FROM what the commit
 * already holds - the week's dispatches and reports, a bought report - and
 * are never a condition of it. So with the roads shut it is not called and
 * draws nothing, and a call the roads shut on mid-flight is let go the same
 * way: the turn the player watched being written, or the reveal they paid
 * for, commits without that one commit's observation markers. The evidence
 * stays where the player reads it. Skipped, not deferred: carrying the
 * evidence to the next open road would need it in the save and would date
 * each observation a week late. A failure with the roads open still throws,
 * and the commit rolls back exactly as before.
 */
export async function relationshipDraftsUnlessOffline<T>(select: () => Promise<T[]>): Promise<T[]> {
    if (!roadsOpenNow()) return [];
    try {
        return await select();
    } catch (error) {
        if (roadsOpenNow()) throw error;
        console.warn('relationshipObservations: the roads shut during the call; committing without them', error);
        return [];
    }
}

/**
 * The persistable slice of the reducer state, field for field - the half of
 * buildSaveState that is pure. Every slice buildSaveState persists MUST come
 * from the reducer (D17), which is why this takes GameDomainState and
 * nothing else. See persistence/saveGame.ts for exactly which game state
 * this does (and doesn't) include, and why.
 */
export function pickSaveState(state: GameDomainState): SaveGameState {
    return {
        entities: state.entities,
        worldState: state.worldState,
        simulationState: state.simulationState,
        reports: state.reports,
        truthLedger: state.truthLedger,
        knowledge: state.knowledge,
        npcIntents: state.npcIntents,
        privateScenes: state.privateScenes,
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
        voiceCast: state.voiceCast,
        // A fate awaiting its choice is part of the reign (see the field's
        // doc in persistence/saveGame.ts); absent whenever none is open.
        pendingEventId: state.activeEvent?.id,
        // D51 - the seed every turn's dice are derived from.
        reignSeed: state.reignSeed,
    };
}
