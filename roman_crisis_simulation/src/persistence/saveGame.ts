/**
 * persistence/saveGame.ts
 *
 * The single persistence seam for Glory of Rome. Before this file existed
 * there was zero `localStorage`/`IndexedDB` use in the app (see
 * ROADMAP_3_UX_INTERACTIONS.md P0.2 and ROADMAP_5_TECH_PERFORMANCE.md P0.1) -
 * a refresh, crash, or transient AI failure destroyed the entire campaign.
 *
 * Design notes:
 *  - The `SaveGame` envelope/state types are defined HERE (not in
 *    `types.ts`), deliberately - `types.ts` is owned by a concurrent
 *    workstream. Everything inside `SaveGameState` is composed from types
 *    that already live in `../types`, with one exception: `inferredAmbition`
 *    (DESIGN_DECISIONS.md D8) is typed off `ai/tools/ambition.ts`, a file
 *    owned by this same workstream, not the concurrent one.
 *  - Every localStorage call is guarded: a private/incognito context can
 *    throw `SecurityError` just for touching `localStorage`, and any write
 *    can throw `QuotaExceededError`. Neither should ever crash the game -
 *    worst case, autosave silently fails and play continues.
 *  - `loadGame` never throws: corrupted JSON, an unexpected shape, or a
 *    version mismatch all just return `null` (with a `console.warn`) so
 *    `App.tsx` can fall back to a fresh game instead of crashing on load.
 */

import type {
  Entity,
  WorldState,
  SimulationState,
  Report,
  TruthLedgerEntry,
  TurnHistoryEntry,
  EventHistoryEntry,
  EventFiringRecord,
  Message,
  NpcIntent,
} from '../types';
import type { AmbitionInference } from '../ai/tools/ambition';
import type { KnowledgeClaim } from '../knowledge/store';

/** Bump this whenever `SaveGameState`'s shape changes in a backwards-incompatible way. */
export const SAVE_VERSION = 1 as const;

const SAVE_KEY = 'gloryOfRome:autosave';

/**
 * The periodic D8 ambition-inference snapshot (App.tsx / ai/tools/ambition.ts),
 * plus the turn number it was computed as of - so a consumer (GameMasterScreen,
 * EpilogueScreen) can tell a fresh read from a stale one on a long-since-moved-on
 * campaign. GM-console/epilogue only - never rendered as a player-facing goal UI.
 */
export interface InferredAmbitionState extends AmbitionInference {
  asOfTurn: number;
}

/**
 * Everything that makes up "the campaign" - i.e. the subset of `App.tsx`'s
 * `useState` hooks that are actual game state, as opposed to transient UI
 * state (input boxes, modal-open flags, processing spinners) that has no
 * meaning across a reload. See `App.tsx` for the full enumeration/rationale.
 */
export interface SaveGameState {
  entities: Entity[];
  worldState: WorldState;
  simulationState: SimulationState;
  reports: Report[];
  turnNumber: number;
  playerCharacterId: string | null;
  turnHistory: TurnHistoryEntry[];
  eventHistory: EventHistoryEntry[];
  metaNarrative: string;
  messages: Message[];
  triggeredEventIds: string[];
  suggestedActions: string[];
  currentEvents: string[];
  gmInterventionText: string;
  /**
   * DESIGN_DECISIONS.md D8 - the most recent inferred-ambition snapshot, if
   * any has been computed yet this campaign. Optional (and nullable) so
   * `SAVE_VERSION` stays at 1: a pre-existing save with no such field at all
   * still loads cleanly (see `looksLikeSaveGame`'s deliberately minimal
   * structural check below, and App.tsx's `handleContinue`, which falls
   * back to `null` when reading it off an old save).
   */
  inferredAmbition?: InferredAmbitionState | null;
  /**
   * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the investigation-consequence
   * queue closing the `turnInvestigations` loop (see
   * `components/investigationLoop.ts`). Optional so `SAVE_VERSION` stays at
   * 1: a pre-existing save with no such field loads cleanly and simply
   * starts with an empty queue (App.tsx's `handleContinue` falls back to
   * `[]` when reading it off an old save). Deliberately survives a
   * mid-retry failure - only cleared once the turn that consumes it
   * actually commits.
   */
  pendingIntelligenceFallout?: string[];
  /**
   * DESIGN_DECISIONS.md D11 - the GM-private truth ledger (one entry per
   * rumor: actual truth disposition + origin, bounded at
   * ai/core/engine.ts's MAX_TRUTH_LEDGER_ENTRIES). Optional so
   * `SAVE_VERSION` stays at 1: a pre-existing save with no such field
   * loads cleanly and starts with an empty ledger (GAME_LOADED in
   * state/gameReducer.ts falls back to `[]`). GM-console-only data, same
   * handling class as `secret_truth` - persisting it is bookkeeping, never
   * a license for a player-facing surface to read it.
   */
  truthLedger?: TruthLedgerEntry[];
  /**
   * ROADMAP_PHASE_4.md 4B item 2 / DESIGN_DECISIONS.md D21 - the player
   * knowledge store (knowledge/store.ts): claim entities with time-dated
   * update histories, built only from perception-filtered channels. The
   * player-belief counterpart to `truthLedger` above - by construction it
   * carries no GM-private truth data. Optional so `SAVE_VERSION` stays at
   * 1: a pre-existing save with no such field loads cleanly and starts
   * with an empty store (GAME_LOADED in state/gameReducer.ts falls back
   * to `[]`). Bounded at knowledge/store.ts's MAX_KNOWLEDGE_CLAIMS.
   */
  knowledge?: KnowledgeClaim[];
  /**
   * ROADMAP_PHASE_4.md 4C item 3 - the Director's current per-spotlight
   * persistent intents, replaced wholesale each turn commit and fed back
   * into the next turn's Director (the continuity loop). Bounded at
   * ai/core/turn.ts's MAX_NPC_INTENTS. Optional so `SAVE_VERSION` stays at
   * 1: a pre-existing save with no such field loads cleanly and starts with
   * an empty list (GAME_LOADED in state/gameReducer.ts falls back to `[]`).
   * GM-PRIVATE data class (D4/D5), same handling as `truthLedger` above:
   * persisting it is bookkeeping, never a license for a player-facing
   * surface to read it.
   */
  npcIntents?: NpcIntent[];
  /**
   * ROADMAP_PHASE_4.md 4D item 2 (D12) - per-event firing bookkeeping (last
   * fired turn + count), the richer successor to `triggeredEventIds` that
   * repeatable events' cooldowns require. BOTH shapes are written in
   * lockstep (`triggeredEventIds` stays the legacy deduped ever-fired set).
   * Optional so `SAVE_VERSION` stays at 1: a pre-existing save with no such
   * field loads cleanly and GAME_LOADED (state/gameReducer.ts) normalizes
   * the bookkeeping from `triggeredEventIds` alone
   * (events/engine.ts::normalizeEventFirings - legacy ids are conservatively
   * stamped with the loaded turn, so cooldowns restart from load).
   */
  eventFirings?: EventFiringRecord[];
}

/** The versioned envelope actually written to storage. */
export interface SaveGame {
  version: typeof SAVE_VERSION;
  savedAt: string; // ISO-8601 timestamp
  state: SaveGameState;
}

/**
 * Strips `rawCalls` (the raw prompt/response capture - see
 * `ai/core/geminiService.ts` - which can be tens of KB per turn) from every
 * `turnHistory` entry except the most recent one. Used as a one-shot retry
 * when the full save is too large for `localStorage`'s ~5MB quota; the
 * parsed adjudication/narration/postTurnEntities are untouched, only the
 * debug-oriented raw capture is dropped for older turns.
 */
function stripOldRawCalls(turnHistory: TurnHistoryEntry[]): TurnHistoryEntry[] {
  if (turnHistory.length <= 1) return turnHistory;
  const lastIndex = turnHistory.length - 1;
  return turnHistory.map((entry, index) => {
    if (index === lastIndex || !entry.rawCalls) return entry;
    const { rawCalls, ...rest } = entry;
    return rest;
  });
}

/**
 * Strips the captured prompt/system-instruction text from every rawCall
 * record before serialization. Call capture is session-side only
 * (DESIGN_DECISIONS.md D18: saves stay lean) - the persisted blob keeps each
 * record's `rawResponse`/metadata for the GM screen's raw-JSON tab, but the
 * full prompt text must never be written to storage. The in-memory records
 * are left untouched (new entry/record objects are built), so the GM console
 * and session-side export keep the full text.
 */
function stripCapturedCallText(turnHistory: TurnHistoryEntry[]): TurnHistoryEntry[] {
  return turnHistory.map(entry => {
    if (!entry.rawCalls) return entry;
    return {
      ...entry,
      rawCalls: entry.rawCalls.map(({ promptText, systemInstruction, ...rest }) => rest),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Minimal structural check - enough to safely read `.version`/`.state` without throwing. */
function looksLikeSaveGame(value: unknown): value is SaveGame {
  return (
    isRecord(value) &&
    typeof value['version'] === 'number' &&
    typeof value['savedAt'] === 'string' &&
    isRecord(value['state'])
  );
}

/**
 * Persists the given game state as the single autosave slot. Never throws:
 * localStorage access itself (quota, disabled storage, private-mode
 * `SecurityError`) is guarded, and if the first write fails, one retry is
 * made with older turnHistory entries' `rawCalls` stripped (the most likely
 * cause of an oversize save on a long campaign). If both attempts fail, the
 * autosave is skipped and `{ ok: false }` tells the caller whether that
 * operation may safely commit its accompanying in-memory state.
 */
export type SaveGameResult = { ok: true } | { ok: false };

export function saveGame(state: SaveGameState): SaveGameResult {
  // Persisted saves never carry captured prompt text, regardless of size -
  // see stripCapturedCallText.
  const leanState: SaveGameState = {
    ...state,
    turnHistory: stripCapturedCallText(state.turnHistory),
  };

  const envelope: SaveGame = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: leanState,
  };

  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch (e) {
    console.warn('saveGame: initial write failed, retrying with older rawCalls stripped', e);
  }

  try {
    const strippedEnvelope: SaveGame = {
      ...envelope,
      state: {
        ...leanState,
        turnHistory: stripOldRawCalls(leanState.turnHistory),
      },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(strippedEnvelope));
    return { ok: true };
  } catch (e) {
    console.warn('saveGame: retry after stripping rawCalls also failed; autosave skipped', e);
    return { ok: false };
  }
}

/**
 * Patches ONLY the inferred-ambition field into whatever autosave is
 * currently stored, leaving every other field of the latest save untouched.
 *
 * This exists because ambition inference is fire-and-forget and can resolve
 * WELL AFTER later turns have committed and autosaved: writing a full
 * `saveGame(buildSaveState(...))` from that async callback would clobber
 * the newer autosave with the stale turn snapshot the callback closed over
 * (losing every subsequently committed turn on reload). Patching the stored
 * blob in place is immune to that staleness - it always decorates the
 * NEWEST save, whichever turn produced it.
 *
 * No-ops safely (with a console.warn) when no valid save exists or storage
 * is unavailable.
 */
export function updateSavedAmbition(ambition: InferredAmbitionState): void {
  const existing = loadGame();
  if (!existing) {
    console.warn('updateSavedAmbition: no valid autosave to patch; skipping');
    return;
  }

  const storedAmbition = existing.state.inferredAmbition;
  if (storedAmbition && storedAmbition.asOfTurn > ambition.asOfTurn) {
    return;
  }

  try {
    const patched: SaveGame = {
      ...existing,
      savedAt: new Date().toISOString(),
      state: { ...existing.state, inferredAmbition: ambition },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(patched));
  } catch (e) {
    console.warn('updateSavedAmbition: write failed; ambition not persisted', e);
  }
}

/**
 * Loads the autosave, or `null` if there is none, it's corrupted, it's an
 * unrecognized shape, or its version doesn't match `SAVE_VERSION`. Never
 * throws - every failure mode is a `console.warn` + `null`, so callers can
 * always treat `null` as "start fresh."
 */
export function loadGame(): SaveGame | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    console.warn('loadGame: localStorage.getItem failed', e);
    return null;
  }

  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('loadGame: save data is corrupted JSON, discarding', e);
    return null;
  }

  if (!looksLikeSaveGame(parsed)) {
    console.warn('loadGame: save data has an unrecognized shape, discarding');
    return null;
  }

  if (parsed.version !== SAVE_VERSION) {
    console.warn(
      `loadGame: save version mismatch (found ${parsed.version}, expected ${SAVE_VERSION}), discarding`
    );
    return null;
  }

  return parsed;
}

/** Removes the autosave, if any. Guarded the same way as `saveGame`/`loadGame` - never throws. */
export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    console.warn('clearSave: localStorage.removeItem failed', e);
  }
}

/** True if a valid (parseable, version-matching) autosave exists. */
export function hasSave(): boolean {
  return loadGame() !== null;
}
