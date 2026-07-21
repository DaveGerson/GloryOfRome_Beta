/**
 * state/gameReducer.ts
 *
 * The single reducer for all game-domain state (DESIGN_DECISIONS.md D17).
 * Every slice that persistence/saveGame.ts's SaveGameState reads MUST live
 * here — App.tsx's buildSaveState is built from this state, so a game-domain
 * slice kept anywhere else would silently drop out of the autosave.
 * Transient, presentation-only state (input boxes, modal-open flags,
 * streaming-narration text, theme, retry affordances) stays as local
 * useState in App.tsx and must NOT migrate in.
 *
 * Each action models exactly one commit point: a single dispatch lands the
 * whole commit in one state transition, so no observer (render, autosave,
 * event-trigger check) can ever see a commit half-applied. Mid-turn failure
 * recovery is TURN_ROLLED_BACK, driven by App.tsx's preTurnSnapshotRef —
 * the reducer never rolls anything back on its own.
 *
 * The reducer is pure and DOM-free: persistence (saveGame/loadGame) stays
 * in App.tsx's handlers, which persist the SAME values they dispatch.
 */

import {
  GameState,
  Entity,
  Message,
  TurnHistoryEntry,
  Report,
  GameEvent,
  SimulationState,
  EventHistoryEntry,
  WorldState,
  TruthLedgerEntry,
} from '../types';
import type { SaveGameState, InferredAmbitionState } from '../persistence/saveGame';
import type { KnowledgeClaim } from '../knowledge/store';
import { INITIAL_WORLD_STATE, INITIAL_SIMULATION_STATE } from '../constants/baseScenario';
import { clearFallout } from '../components/investigationLoop';

export interface GameDomainState {
  gameState: GameState;
  messages: Message[];
  suggestedActions: string[];
  currentEvents: string[];
  entities: Entity[];
  worldState: WorldState;
  simulationState: SimulationState;
  reports: Report[];
  /**
   * DESIGN_DECISIONS.md D11 - the GM-private truth ledger: one entry per
   * rumor, recording whether its claim is actually true and who originated
   * it (written by ai/core/engine.ts alongside the Report the player sees,
   * bounded at MAX_TRUTH_LEDGER_ENTRIES). Same handling class as
   * `secret_truth`: rendered ONLY in GameMasterScreen's true-vs-believed
   * view (D7) - never on any player-facing surface.
   */
  truthLedger: TruthLedgerEntry[];
  /**
   * ROADMAP_PHASE_4.md 4B item 2 / DESIGN_DECISIONS.md D21 - the player
   * knowledge store: claim entities with time-dated update histories,
   * built EXCLUSIVELY from perception-filtered channels (the perceived
   * digest, Reports, investigation reveals - see knowledge/store.ts). The
   * opposite handling class from `truthLedger` above: this slice records
   * what the PLAYER believes and must never contain ground truth they
   * couldn't know (no `is_true`/`origin_id`/`secret_truth` data, ever).
   * App.tsx computes the next store via the pure ingestion functions and
   * commits it here atomically (TURN_COMMITTED / INVESTIGATION_COMMITTED).
   */
  knowledge: KnowledgeClaim[];
  turnNumber: number;
  playerCharacterId: string | null;
  turnHistory: TurnHistoryEntry[];
  /**
   * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the investigation-consequence
   * queue (components/investigationLoop.ts). Holds just the pending,
   * not-yet-narrated consequence strings; appended to by
   * INVESTIGATION_COMMITTED, prepended onto `gmInterventionText` for the
   * next `runNewTurn` call (see App.tsx's `executeTurn`), and only cleared
   * once that turn actually commits (TURN_COMMITTED) - NOT on a
   * failed/rolled-back turn, so a retry still carries it.
   */
  pendingIntelligenceFallout: string[];
  gmInterventionText: string;
  activeEvent: GameEvent | null;
  triggeredEventIds: string[];
  eventHistory: EventHistoryEntry[];
  metaNarrative: string;
  /**
   * DESIGN_DECISIONS.md D8 - the latest "apparent ambition" reading, if any
   * has been computed yet this campaign. GM-console/epilogue only (see
   * GameMasterScreen's "Apparent Ambition" line and EpilogueScreen) -
   * never rendered as a player-facing goal UI.
   */
  inferredAmbition: InferredAmbitionState | null;
}

export function createInitialGameState(): GameDomainState {
  return {
    gameState: GameState.SETUP,
    messages: [],
    suggestedActions: [],
    currentEvents: [],
    entities: [],
    worldState: INITIAL_WORLD_STATE,
    simulationState: INITIAL_SIMULATION_STATE,
    reports: [],
    truthLedger: [],
    knowledge: [],
    turnNumber: 1,
    playerCharacterId: null,
    turnHistory: [],
    pendingIntelligenceFallout: [],
    gmInterventionText: '',
    activeEvent: null,
    triggeredEventIds: [],
    eventHistory: [],
    metaNarrative: 'An imperial succession crisis in a crumbling empire teetering on the brink of civil war.',
    inferredAmbition: null,
  };
}

/**
 * How many of the most recent turnHistory entries keep their full
 * `postTurnEntities` snapshot (see types.ts). A snapshot deep-copies the
 * entire roster, so it is the dominant per-turn share of the save blob and
 * of localStorage's ~5MB quota - only a bounded recent window may retain
 * one. Must stay >= 1: the newest entry's snapshot backs App.tsx's
 * perception digest and the GM console's most-recent views.
 */
export const KEEP_FULL_SNAPSHOTS = 10;

/**
 * Drops `postTurnEntities` from every entry older than the most recent
 * KEEP_FULL_SNAPSHOTS. Returns the input array unchanged (same reference)
 * when no entry needs trimming, matching the reducer's convention that
 * untouched slices keep their identity - which also makes it idempotent
 * and safe to apply more than once per commit. Exported because App.tsx
 * must apply it to the turn-commit history BEFORE building the autosave:
 * the reducer's own trim (TURN_COMMITTED below) only bounds in-memory
 * state, and an autosave built from the untrimmed array would persist
 * every snapshot - growing the save by one snapshot per session on
 * legacy-shaped saves that carry one on every entry.
 */
export function withOldSnapshotsDropped(turnHistory: TurnHistoryEntry[]): TurnHistoryEntry[] {
  const cutoff = turnHistory.length - KEEP_FULL_SNAPSHOTS;
  if (cutoff <= 0) return turnHistory;
  let changed = false;
  const trimmed = turnHistory.map((entry, index) => {
    if (index >= cutoff || entry.postTurnEntities === undefined) return entry;
    changed = true;
    const { postTurnEntities, ...rest } = entry;
    return rest;
  });
  return changed ? trimmed : turnHistory;
}

export type GameAction =
  /** Append one chat message (player, GM, monologue, or ribbon). */
  | { type: 'MESSAGE_ADDED'; message: Message }
  /** Bare phase transition, for paths that change nothing else. */
  | { type: 'GAME_STATE_SET'; gameState: GameState }
  /**
   * A fresh turn attempt begins: enter PROCESSING, clear the suggested-action
   * pills, and put the player's action into the chat log. Nothing else may
   * change here - the pre-turn snapshot App.tsx takes right after this
   * dispatch must describe exactly the committed state plus this message.
   */
  | { type: 'TURN_STARTED'; playerMessage: Message }
  /**
   * The single commit point for a successfully resolved turn - every field a
   * committed turn produces lands here atomically, so a failure anywhere in
   * the pipeline means NONE of it was applied (see TURN_ROLLED_BACK).
   */
  | {
      type: 'TURN_COMMITTED';
      entities: Entity[];
      worldState: WorldState;
      simulationState: SimulationState;
      reports: Report[];
      truthLedger: TruthLedgerEntry[];
      /** The next knowledge store, computed by App.tsx from this turn's perceived digest + new Reports via knowledge/store.ts's pure ingestion (D21). */
      knowledge: KnowledgeClaim[];
      turnNumber: number;
      turnHistory: TurnHistoryEntry[];
      gmMessage: Message;
      monologueMessage: Message;
      ribbonMessage: Message;
      suggestedActions: string[];
      currentEvents: string[];
    }
  /**
   * Restore the pre-turn snapshot after a mid-turn failure. `messages` is
   * deliberately NOT restored - the player's message and the GM's error
   * notice should stay in the chat log. `playerCharacterId`, `metaNarrative`
   * and `inferredAmbition` are never touched mid-turn, so they are not part
   * of the rollback either. The phase transition back to
   * AWAITING_PLAYER_INPUT is a separate GAME_STATE_SET, because it must
   * happen even when no snapshot exists to restore.
   */
  | { type: 'TURN_ROLLED_BACK'; snapshot: SaveGameState }
  /** An authored event fired after a committed turn - open its modal. */
  | { type: 'EVENT_TRIGGERED'; event: GameEvent }
  /**
   * The single commit point for an authored event choice: deltas, chat log,
   * history, seen-ids and modal close land atomically.
   */
  | {
      type: 'EVENT_CHOICE_APPLIED';
      entities: Entity[];
      worldState: WorldState;
      eventMessage: Message;
      eventHistory: EventHistoryEntry[];
      triggeredEventIds: string[];
    }
  /**
   * A brand-new campaign begins with the chosen/created character.
   * `worldState`/`metaNarrative` are only set when a custom world provides
   * them - otherwise the defaults stand.
   */
  | {
      type: 'GAME_STARTED';
      entities: Entity[];
      playerCharacterId: string;
      introMessage: Message;
      suggestedActions: string[];
      worldState?: WorldState;
      metaNarrative?: string;
    }
  /** Restore a whole campaign from the autosave (persistence/saveGame.ts). */
  | { type: 'GAME_LOADED'; save: SaveGameState }
  /** A player resource spend (deep analysis) already applied to `entities`. */
  | { type: 'RESOURCE_SPENT'; entities: Entity[] }
  /**
   * One investigation reveal = one atomic commit: the spend, any blackmail
   * filing (secrets), the fallout-queue append, and the knowledge-store
   * ingestion of the revealed intel (D14/D21 - bought intel persists
   * instead of evaporating with the component) MUST land in a single
   * state transition - split across separate commits, whichever landed last
   * would silently revert the others' fields in the autosave.
   */
  | { type: 'INVESTIGATION_COMMITTED'; entities: Entity[]; pendingIntelligenceFallout: string[]; knowledge: KnowledgeClaim[] }
  /** GM-console operator authored (or cleared) the intervention text. */
  | { type: 'GM_INTERVENTION_SET'; text: string }
  /** DESIGN_DECISIONS.md D8 - a periodic ambition inference resolved. */
  | { type: 'AMBITION_INFERRED'; inferredAmbition: InferredAmbitionState };

/**
 * DESIGN_DECISIONS.md D1 - survival-only: ONLY the player's own death ends
 * the run. Exile/missing are survivable states the player keeps playing
 * through - only 'dead' is terminal.
 */
function isPlayerDead(entities: Entity[], playerCharacterId: string | null): boolean {
  if (!playerCharacterId) return false;
  return entities.find(e => e.entity_id === playerCharacterId)?.status === 'dead';
}

export function gameReducer(state: GameDomainState, action: GameAction): GameDomainState {
  switch (action.type) {
    case 'MESSAGE_ADDED':
      return { ...state, messages: [...state.messages, action.message] };

    case 'GAME_STATE_SET':
      return { ...state, gameState: action.gameState };

    case 'TURN_STARTED':
      return {
        ...state,
        gameState: GameState.PROCESSING,
        suggestedActions: [],
        messages: [...state.messages, action.playerMessage],
      };

    case 'TURN_COMMITTED': {
      // DESIGN_DECISIONS.md D1 - once the player is dead, go straight to
      // GAME_OVER (App.tsx then swaps the chat pane for EpilogueScreen and
      // skips the event-trigger check entirely). Otherwise the phase stays
      // as-is (PROCESSING) until App.tsx's event-trigger check resolves it
      // to AWAITING_EVENT_CHOICE or AWAITING_PLAYER_INPUT.
      const diedThisTurn = isPlayerDead(action.entities, state.playerCharacterId);
      return {
        ...state,
        entities: action.entities,
        worldState: action.worldState,
        simulationState: action.simulationState,
        reports: action.reports,
        truthLedger: action.truthLedger,
        knowledge: action.knowledge,
        turnNumber: action.turnNumber,
        // Older entries shed their full entity snapshots here - the one
        // commit point every turn passes through, so state and autosave
        // always carry the identical bounded shape. App.tsx applies the
        // same (idempotent) trim to this array before dispatching, since
        // the autosave is built from the array directly, not from the
        // state this reducer returns; this application stays as the
        // in-memory backstop.
        turnHistory: withOldSnapshotsDropped(action.turnHistory),
        messages: [...state.messages, action.gmMessage, action.monologueMessage, action.ribbonMessage],
        suggestedActions: action.suggestedActions,
        currentEvents: action.currentEvents,
        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the fallout queue is
        // "consumed" only here, once the turn that was handed the
        // intervention text built from it has actually committed. A
        // failed/rolled-back attempt never dispatches this action, so the
        // queue survives untouched for a retry.
        pendingIntelligenceFallout: clearFallout(),
        gmInterventionText: '',
        gameState: diedThisTurn ? GameState.GAME_OVER : state.gameState,
      };
    }

    case 'TURN_ROLLED_BACK': {
      const { snapshot } = action;
      return {
        ...state,
        entities: snapshot.entities,
        worldState: snapshot.worldState,
        simulationState: snapshot.simulationState,
        reports: snapshot.reports,
        // Optional field (D11) - a pre-ledger snapshot restores to an empty
        // ledger, same normalization as GAME_LOADED below.
        truthLedger: snapshot.truthLedger ?? [],
        // Optional field (D21) - same normalization; a failed turn's
        // knowledge ingestion never commits, so restoring the pre-turn
        // store keeps the slice consistent with reports/truthLedger.
        knowledge: snapshot.knowledge ?? [],
        turnNumber: snapshot.turnNumber,
        turnHistory: snapshot.turnHistory,
        eventHistory: snapshot.eventHistory,
        triggeredEventIds: snapshot.triggeredEventIds,
        suggestedActions: snapshot.suggestedActions,
        currentEvents: snapshot.currentEvents,
        gmInterventionText: snapshot.gmInterventionText,
        // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the fallout queue is
        // never cleared on the failure path (that only happens in
        // TURN_COMMITTED), so this is a no-op in practice - restored
        // explicitly anyway rather than relying on that invariant, so a
        // failed/rolled-back turn's pending fallout is guaranteed to
        // survive intact for a retry.
        pendingIntelligenceFallout: snapshot.pendingIntelligenceFallout ?? [],
      };
    }

    case 'EVENT_TRIGGERED':
      return {
        ...state,
        activeEvent: action.event,
        gameState: GameState.AWAITING_EVENT_CHOICE,
      };

    case 'EVENT_CHOICE_APPLIED':
      // DESIGN_DECISIONS.md D1 - an authored event choice's deltas can also
      // kill the player (applyEventChoiceDeltas), not just the adjudicated
      // turn pipeline - so this commit needs the exact same GAME_OVER check
      // as TURN_COMMITTED above.
      return {
        ...state,
        entities: action.entities,
        worldState: action.worldState,
        messages: [...state.messages, action.eventMessage],
        eventHistory: action.eventHistory,
        triggeredEventIds: action.triggeredEventIds,
        activeEvent: null,
        gameState: isPlayerDead(action.entities, state.playerCharacterId)
          ? GameState.GAME_OVER
          : GameState.AWAITING_PLAYER_INPUT,
      };

    case 'GAME_STARTED':
      return {
        ...state,
        entities: action.entities,
        worldState: action.worldState ?? state.worldState,
        metaNarrative: action.metaNarrative ? action.metaNarrative : state.metaNarrative,
        playerCharacterId: action.playerCharacterId,
        gameState: GameState.AWAITING_PLAYER_INPUT,
        messages: [...state.messages, action.introMessage],
        suggestedActions: action.suggestedActions,
      };

    case 'GAME_LOADED': {
      const s = action.save;
      return {
        ...state,
        entities: s.entities,
        worldState: s.worldState,
        simulationState: s.simulationState,
        reports: s.reports,
        turnNumber: s.turnNumber,
        playerCharacterId: s.playerCharacterId,
        turnHistory: s.turnHistory,
        eventHistory: s.eventHistory,
        metaNarrative: s.metaNarrative,
        messages: s.messages,
        triggeredEventIds: s.triggeredEventIds,
        suggestedActions: s.suggestedActions,
        currentEvents: s.currentEvents,
        gmInterventionText: s.gmInterventionText,
        // Optional field (D11) - absent on saves from before the truth
        // ledger existed, so this normalizes it to an empty ledger.
        truthLedger: s.truthLedger ?? [],
        // Optional field (D21) - absent on saves from before the knowledge
        // store existed, so this normalizes it to an empty store.
        knowledge: s.knowledge ?? [],
        // Optional field (D8) - absent on saves from before this field
        // existed, so this normalizes it to `null` rather than `undefined`
        // for InferredAmbitionState | null's sake.
        inferredAmbition: s.inferredAmbition ?? null,
        // Optional field (Phase 3 item 5) - absent on saves from before the
        // investigation-fallout queue existed, so this normalizes it to an
        // empty queue rather than `undefined`.
        pendingIntelligenceFallout: s.pendingIntelligenceFallout ?? [],
        // A save can legitimately be reloaded while the last-loaded run had
        // already ended (the player closed/refreshed the tab on the epilogue
        // screen - GAME_OVER itself is never persisted, only the underlying
        // entities are). Re-derive the terminal state from the loaded player
        // entity's status rather than assuming a continued save always means
        // "still playable" (DESIGN_DECISIONS.md D1 - only death is terminal).
        gameState: isPlayerDead(s.entities, s.playerCharacterId)
          ? GameState.GAME_OVER
          : GameState.AWAITING_PLAYER_INPUT,
      };
    }

    case 'RESOURCE_SPENT':
      return { ...state, entities: action.entities };

    case 'INVESTIGATION_COMMITTED':
      return {
        ...state,
        entities: action.entities,
        pendingIntelligenceFallout: action.pendingIntelligenceFallout,
        knowledge: action.knowledge,
      };

    case 'GM_INTERVENTION_SET':
      return { ...state, gmInterventionText: action.text };

    case 'AMBITION_INFERRED':
      return { ...state, inferredAmbition: action.inferredAmbition };

    default:
      return state;
  }
}
