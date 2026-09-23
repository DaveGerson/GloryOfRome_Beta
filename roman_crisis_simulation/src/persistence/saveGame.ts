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
import type { PrivateSceneRecord } from '../privateScene/model';
import { migrateSaveEnvelope } from './saveMigrations';

/**
 * Bump this whenever `SaveGameState`'s shape changes in a backwards-
 * incompatible way - and register the matching upgrade step in
 * `persistence/saveMigrations.ts` (`SAVE_MIGRATIONS[old]`), or every older
 * save is refused as `version_mismatch`. Additive optional fields do not
 * need a bump.
 */
export const SAVE_VERSION = 1 as const;

/**
 * Exported for exactly one outside consumer: ErrorBoundary's last-resort
 * `removeItem` fallback, which must clear THIS slot even if `clearSave`
 * itself could not run. Everything else goes through the functions below.
 */
export const SAVE_KEY = 'gloryOfRome:autosave';

/**
 * The periodic D8 ambition-inference snapshot (App.tsx / ai/tools/ambition.ts),
 * plus the turn number it was computed as of, persisted solely so
 * GameMasterScreen can inspect and tune a fresh or stale read. It never feeds
 * the player epilogue, NPC reactions, or any other player-facing surface.
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
  /**
   * Phase 6 private-scene records. Optional so old v1 saves remain valid;
   * GAME_LOADED and TURN_ROLLED_BACK normalize an absent field to an empty
   * in-memory list. NPC-private fields stay nested in this GM-only record
   * and are never copied into any player-facing save slice. Both actions
   * additionally normalize PER RECORD via `normalizeLoadedPrivateScenes`
   * below - a structurally malformed persisted entry is dropped rather than
   * loaded verbatim, so a hand-edited or corrupted save can't crash render.
   */
  privateScenes?: PrivateSceneRecord[];
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
    if (!entry.rawCalls && !entry.proseRedactions) return entry;
    // `proseRedactions` carries each removed span verbatim (WP-19). Same
    // rule as the captured prompt text: the GM console reads it in session,
    // the save does not carry this copy of it.
    //
    // NOT a privacy boundary, and it must never be described as one: the
    // same spans also reach `adjudication.gm_private` as `[Boundary] …
    // Removed text: "…"` notes (ai/core/playerBoundary.ts), and that field
    // is required and persisted. The blob's GM-side content is shareable by
    // owner ruling (spoilers, not secrets — see D45); this strip just avoids
    // persisting a redundant copy.
    const { proseRedactions: _dropped, ...kept } = entry;
    return {
      ...kept,
      ...(entry.rawCalls ? { rawCalls: entry.rawCalls.map(({ promptText, systemInstruction, ...rest }) => rest) } : {}),
    };
  });
}

/**
 * `ImportResult` reasons, mirrored by `looksLikeSaveGame`'s rejections plus
 * the version check below - see `validateSaveBlob`.
 */
export type ImportResult =
  | { ok: true; turnNumber: number; characterName: string }
  | { ok: false; reason: 'unreadable' | 'not_a_reign' | 'version_mismatch' | 'storage_failed' };

function canonicalPrivateSceneTranscriptLine(
  line: PrivateSceneRecord['transcript'][number],
): PrivateSceneRecord['transcript'][number] {
  return {
    sequence: line.sequence,
    speaker: line.speaker,
    text: line.text,
  };
}

function canonicalPrivateSceneSpeechAct(
  act: PrivateSceneRecord['speechActs'][number],
): PrivateSceneRecord['speechActs'][number] {
  return {
    speaker: act.speaker,
    kind: act.kind,
    text: act.text,
    exchange: act.exchange,
  };
}

function canonicalPrivateSceneNpcPrivate(
  npcPrivate: PrivateSceneRecord['npcPrivate'],
): PrivateSceneRecord['npcPrivate'] {
  return {
    sincerity: npcPrivate.sincerity,
    hiddenIntent: npcPrivate.hiddenIntent,
    plannedFollowThrough: [...npcPrivate.plannedFollowThrough],
  };
}

/**
 * Rebuilds the persisted private-scene shape from its allowlisted contract.
 * Runtime-only additions must not silently cross the storage boundary, and
 * the source record remains available unchanged to the in-session GM tools.
 */
function canonicalPrivateScene(scene: PrivateSceneRecord): PrivateSceneRecord {
  return {
    sceneId: scene.sceneId,
    macroTurn: scene.macroTurn,
    playerId: scene.playerId,
    npcId: scene.npcId,
    playerName: scene.playerName,
    npcName: scene.npcName,
    status: scene.status,
    transcript: scene.transcript.map(canonicalPrivateSceneTranscriptLine),
    npcResponseCount: scene.npcResponseCount,
    speechActs: scene.speechActs.map(canonicalPrivateSceneSpeechAct),
    npcPrivate: canonicalPrivateSceneNpcPrivate(scene.npcPrivate),
    ...(scene.closureReason === undefined ? {} : { closureReason: scene.closureReason }),
    ...(scene.lastWord === undefined ? {} : { lastWord: scene.lastWord }),
    consequenceStatus: scene.consequenceStatus,
    ...(scene.consumedByTurn === undefined ? {} : { consumedByTurn: scene.consumedByTurn }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structural check on the envelope. Deliberately minimal - but "minimal"
 * means the BOOT path cannot crash on what this accepts: `.version`/`.state`
 * are readable, and `state.entities`/`state.turnNumber` - the two fields
 * `loadSavedGameSummary` and the import derive dereference before any
 * normalization runs - carry the right types. `turnNumber` must be a
 * non-negative INTEGER, not merely a number: `1e999` parses to `Infinity`,
 * `typeof Infinity === 'number'`, and `toRoman(Infinity)` never terminates
 * - so a `number` check alone lets a crafted file hang boot. Deeper
 * interior malformations keep parity with the pre-existing hand-edit
 * exposure: GAME_LOADED normalizes what it normalizes.
 */
function looksLikeSaveGame(value: unknown): value is SaveGame {
  if (
    !isRecord(value) ||
    typeof value['version'] !== 'number' ||
    typeof value['savedAt'] !== 'string'
  ) {
    return false;
  }
  const state = value['state'];
  if (!isRecord(state)) return false;
  return Array.isArray(state['entities']) && isNonNegativeInteger(state['turnNumber']);
}

/**
 * The one parse-then-shape-then-version gate a save envelope must clear,
 * whichever door it came through - `loadGame` reading the autosave slot or
 * `importSaveBlob` reading a player-chosen file. Both delegate here so
 * import acceptance and load acceptance are the SAME code path and can never
 * quietly drift apart (docs/superpowers/specs/2026-08-05-reign-export-import
 * -design.md). Never throws.
 */
function validateSaveBlob(
  raw: string,
): { ok: true; save: SaveGame; migratedFrom: number | null } | { ok: false; reason: 'unreadable' | 'not_a_reign' | 'version_mismatch' } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('validateSaveBlob: save data is corrupted JSON, discarding', e);
    return { ok: false, reason: 'unreadable' };
  }

  if (!looksLikeSaveGame(parsed)) {
    console.warn('validateSaveBlob: save data has an unrecognized shape, discarding');
    return { ok: false, reason: 'not_a_reign' };
  }

  // Current-version saves pass through untouched (same object); older ones
  // walk the explicit migration chain (persistence/saveMigrations.ts). A
  // newer build's save, or a version with no registered path, is refused.
  const migrated = migrateSaveEnvelope(parsed, SAVE_VERSION);
  if (!migrated.ok) {
    if (migrated.reason === 'version_mismatch') {
      console.warn(
        `validateSaveBlob: save version mismatch (found ${parsed.version}, expected ${SAVE_VERSION}), discarding`
      );
      return { ok: false, reason: 'version_mismatch' };
    }
    console.warn(`validateSaveBlob: migrating a v${parsed.version} save failed, discarding`);
    return { ok: false, reason: 'not_a_reign' };
  }

  // A migration's output must clear the same structural gate its input did.
  if (migrated.migratedFrom !== null && !looksLikeSaveGame(migrated.envelope)) {
    console.warn(`validateSaveBlob: a migrated v${parsed.version} save has an unrecognized shape, discarding`);
    return { ok: false, reason: 'not_a_reign' };
  }

  return { ok: true, save: migrated.envelope, migratedFrom: migrated.migratedFrom };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

const PRIVATE_SCENE_STATUSES: readonly PrivateSceneRecord['status'][] =
  ['active', 'awaiting_last_word', 'closed'];
const PRIVATE_SCENE_CLOSURE_REASONS: readonly NonNullable<PrivateSceneRecord['closureReason']>[] =
  ['refused', 'player_ended', 'npc_ended', 'response_limit'];
const PRIVATE_SCENE_SPEAKERS: readonly PrivateSceneRecord['transcript'][number]['speaker'][] =
  ['player', 'npc'];
const PRIVATE_SCENE_SPEECH_ACT_KINDS: readonly PrivateSceneRecord['speechActs'][number]['kind'][] =
  // model.ts's PROVIDER_SPEECH_ACT_KINDS is not exported and deliberately
  // excludes 'unclassified' (provider responses can't carry it) - persisted
  // player speech acts DO carry it (see beginPrivateScene/appendPrivateSceneExchange
  // in privateScene/model.ts), so the full 8-member set is defined here.
  ['claim', 'disclosure', 'request', 'promise', 'agreement', 'refusal', 'threat', 'unclassified'];
const PRIVATE_SCENE_CONSEQUENCE_STATUSES = ['pending', 'consumed'] as const;

function isPersistedTranscriptLine(value: unknown): value is PrivateSceneRecord['transcript'][number] {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value['sequence']) &&
    isOneOf(value['speaker'], PRIVATE_SCENE_SPEAKERS) &&
    typeof value['text'] === 'string'
  );
}

function isPersistedSpeechAct(value: unknown): value is PrivateSceneRecord['speechActs'][number] {
  return (
    isRecord(value) &&
    isOneOf(value['speaker'], PRIVATE_SCENE_SPEAKERS) &&
    isOneOf(value['kind'], PRIVATE_SCENE_SPEECH_ACT_KINDS) &&
    typeof value['text'] === 'string' &&
    isNonNegativeInteger(value['exchange'])
  );
}

function isPersistedNpcPrivate(value: unknown): value is PrivateSceneRecord['npcPrivate'] {
  return (
    isRecord(value) &&
    typeof value['sincerity'] === 'string' &&
    typeof value['hiddenIntent'] === 'string' &&
    Array.isArray(value['plannedFollowThrough']) &&
    value['plannedFollowThrough'].every(step => typeof step === 'string')
  );
}

function isPersistedPrivateScene(value: unknown): value is PrivateSceneRecord {
  return (
    isRecord(value) &&
    typeof value['sceneId'] === 'string' &&
    typeof value['playerId'] === 'string' &&
    typeof value['npcId'] === 'string' &&
    typeof value['playerName'] === 'string' &&
    typeof value['npcName'] === 'string' &&
    isNonNegativeInteger(value['macroTurn']) &&
    isNonNegativeInteger(value['npcResponseCount']) &&
    isOneOf(value['status'], PRIVATE_SCENE_STATUSES) &&
    Array.isArray(value['transcript']) &&
    value['transcript'].every(isPersistedTranscriptLine) &&
    Array.isArray(value['speechActs']) &&
    value['speechActs'].every(isPersistedSpeechAct) &&
    isPersistedNpcPrivate(value['npcPrivate']) &&
    (value['closureReason'] === undefined || isOneOf(value['closureReason'], PRIVATE_SCENE_CLOSURE_REASONS)) &&
    // A closed scene MUST carry its closure reason. This is the one semantic
    // rule the structural validator enforces, because it is the only shape
    // whose omission reaches a `throw` rather than a graceful `{ok:false}`:
    // buildPrivateSceneAdjudicatorProjection requires the reason, and it runs
    // pre-commit inside executeTurn, so a closed+pending record without one
    // would roll the turn back and stay pending - locking the campaign on
    // every subsequent turn. No app write path produces it (closure always
    // sets a reason first); a corrupted or hand-edited save can.
    (value['status'] !== 'closed' || value['closureReason'] !== undefined) &&
    (value['lastWord'] === undefined || typeof value['lastWord'] === 'string') &&
    isOneOf(value['consequenceStatus'], PRIVATE_SCENE_CONSEQUENCE_STATUSES) &&
    (value['consumedByTurn'] === undefined || isNonNegativeInteger(value['consumedByTurn']))
  );
}

/**
 * The load-side counterpart to `canonicalPrivateScene` - the single
 * normalization seam that `state/gameReducer.ts`'s GAME_LOADED and
 * TURN_ROLLED_BACK both route a persisted `privateScenes` value through. A
 * non-array `value` (including `undefined`, on a pre-Phase-6 save) normalizes
 * to an empty list, exactly as before. Per record, validation is now
 * structural: a malformed entry is silently DROPPED (no `console.warn`, no
 * reducer logging - matching this codebase's existing normalize-and-move-on
 * philosophy for corrupted optional slices) while its valid siblings survive.
 *
 * Validation checks exactly what makes a record safe for every consumer to
 * read without throwing: field presence, primitive types, closed-set enum
 * membership, and array-element shapes. It deliberately does NOT enforce
 * `privateScene/model.ts`'s semantic rules (non-empty trimmed strings,
 * `npcResponseCount` within its valid range, "closed implies closureReason",
 * at most one open scene at a time) - that hygiene is model.ts's job for
 * records this app itself creates, not this loader's.
 *
 * Every surviving record is rebuilt through `canonicalPrivateScene`, so a
 * hand-edited save cannot smuggle unknown keys past load, and re-saving the
 * loaded state is clean.
 *
 * Dropping an open ('active' / 'awaiting_last_word') scene needs no ledger
 * reconciliation: scene records are self-contained, `App.tsx`'s private-scene
 * handlers look a scene up by `sceneId` and no-op when it is absent, and both
 * the interaction lock and `canStartScene` are derived from this (now
 * corrected) list's contents rather than any separate pointer.
 */
export function normalizeLoadedPrivateScenes(value: unknown): PrivateSceneRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPersistedPrivateScene).map(canonicalPrivateScene);
}

/**
 * Persists the given game state as the single autosave slot. Never throws:
 * building the persistable lean-state/envelope is itself guarded (a
 * malformed in-memory `privateScenes` entry can throw while being rebuilt
 * through `canonicalPrivateScene` - see `buildSaveEnvelope`), and once a
 * valid envelope exists, localStorage access (quota, disabled storage,
 * private-mode `SecurityError`) is guarded too: if the first write fails,
 * one retry is made with older turnHistory entries' `rawCalls` stripped (the
 * most likely cause of an oversize save on a long campaign). If envelope
 * construction or both write attempts fail, the autosave is skipped and
 * `{ ok: false }` tells the caller whether that operation may safely commit
 * its accompanying in-memory state; its `reason` says why, so a caller can
 * tell "the browser's storage is full" (actionable: export the reign, clear
 * other site data) apart from "storage is unavailable" (private mode,
 * disabled storage) and "this state could not be serialized" (a bug).
 */
export type SaveFailureReason = 'quota_exceeded' | 'storage_unavailable' | 'build_failed';
export type SaveGameResult = { ok: true } | { ok: false; reason: SaveFailureReason };

/**
 * True for every browser's spelling of "localStorage is full": the standard
 * `QuotaExceededError` (legacy code 22), and Firefox's historical
 * `NS_ERROR_DOM_QUOTA_REACHED` (code 1014). Duck-typed rather than
 * `instanceof DOMException` so it holds across realms (iframes, jsdom).
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = error['name'];
  const code = error['code'];
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function storageFailureReason(error: unknown): SaveFailureReason {
  return isQuotaExceededError(error) ? 'quota_exceeded' : 'storage_unavailable';
}

/**
 * Builds the persistable envelope from live game state, or `null` if that
 * construction itself throws (e.g. a malformed in-memory private-scene
 * record that `canonicalPrivateScene`'s nested dereferences can't survive).
 * Kept separate from the localStorage write path so a construction failure
 * and a write failure can be told apart only by their distinct `console.warn`
 * messages, per this module's never-throws contract.
 */
function buildSaveEnvelope(state: SaveGameState): SaveGame | null {
  try {
    // Persisted saves never carry captured prompt text, regardless of size -
    // see stripCapturedCallText.
    const leanState: SaveGameState = {
      ...state,
      turnHistory: stripCapturedCallText(state.turnHistory),
      ...(state.privateScenes === undefined
        ? {}
        : { privateScenes: state.privateScenes.map(canonicalPrivateScene) }),
    };
    return { version: SAVE_VERSION, savedAt: new Date().toISOString(), state: leanState };
  } catch (e) {
    console.warn('saveGame: failed to build the persistable save state; autosave skipped', e);
    return null;
  }
}

export function saveGame(state: SaveGameState): SaveGameResult {
  const envelope = buildSaveEnvelope(state);
  if (!envelope) return { ok: false, reason: 'build_failed' };

  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch (e) {
    console.warn('saveGame: failed to serialize the save state; autosave skipped', e);
    return { ok: false, reason: 'build_failed' };
  }

  try {
    localStorage.setItem(SAVE_KEY, serialized);
    return { ok: true };
  } catch (e) {
    console.warn('saveGame: initial write failed, retrying with older rawCalls stripped', e);
  }

  try {
    const strippedEnvelope: SaveGame = {
      ...envelope,
      state: { ...envelope.state, turnHistory: stripOldRawCalls(envelope.state.turnHistory) },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(strippedEnvelope));
    return { ok: true };
  } catch (e) {
    console.warn('saveGame: retry after stripping rawCalls also failed; autosave skipped', e);
    return { ok: false, reason: storageFailureReason(e) };
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

  const validated = validateSaveBlob(raw);
  return validated.ok ? validated.save : null;
}

/**
 * Removes the autosave, if any. Never throws, but unlike a best-effort cleanup
 * this is a campaign-boundary operation: callers must not start a replacement
 * session unless `{ ok: true }` confirms that the old reign is durably gone.
 */
export function clearSave(): SaveGameResult {
  try {
    localStorage.removeItem(SAVE_KEY);
    return { ok: true };
  } catch (e) {
    console.warn('clearSave: localStorage.removeItem failed', e);
    return { ok: false, reason: 'storage_unavailable' };
  }
}

/** True if a valid (parseable, version-matching) autosave exists. */
export function hasSave(): boolean {
  return loadGame() !== null;
}

/**
 * The persisted reign verbatim, for "Take a copy of the reign" (WP-21,
 * restored 2026-08-05 - see DESIGN_DECISIONS.md D45 as amended). This is
 * NOT a privacy boundary: the blob's GM-side content - `gm_private`, the
 * truth ledger, NPC intents, hidden rolls - is spoiler material, not
 * private material, by owner ruling. It is the same blob `saveGame` wrote;
 * what changed since the download was first pulled is that `importSaveBlob`
 * below can now read it back.
 */
export function rawSaveBlob(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch (error) {
    console.warn('Could not read the saved reign:', error);
    return null;
  }
}

/**
 * Accepts a player-chosen file's text as a full replacement for the
 * autosave slot (docs/superpowers/specs/2026-08-05-reign-export-import
 * -design.md). Never throws. Runs the save envelope through the SAME
 * `validateSaveBlob` gate `loadGame` uses, so whatever `loadGame` would
 * discard, this refuses too - with a reason, never a throw.
 *
 * The UI's overwrite confirm happens BEFORE this is called; this function
 * never asks. So on `ok` the slot has ALREADY been written; on any `ok:
 * false` the slot is byte-for-byte untouched - `text` is only ever written
 * once validation clears it.
 */
export function importSaveBlob(text: string): ImportResult {
  const validated = validateSaveBlob(text);
  if (!validated.ok) return validated;

  // Derived BEFORE the write, so the ok path has nothing left that can
  // throw once the slot is overwritten - the write is the last fallible
  // operation, and its failure is already `storage_failed`. The derive is
  // guarded too: the validator vouches for the fields boot dereferences,
  // not for every interior shape, and this function promises never to
  // throw - an envelope whose interior breaks the derive is refused, slot
  // untouched.
  let turnNumber: number;
  let characterName: string;
  try {
    const { state } = validated.save;
    const restoredCharacter = state.entities.find(entity => entity.entity_id === state.playerCharacterId);
    turnNumber = state.turnNumber;
    // B7a 1a: a non-string name is malformed data, not a pretense to coerce
    // - 'Unknown' is honest, String(5) === '5' is not (see the spec).
    characterName = typeof restoredCharacter?.name === 'string' ? restoredCharacter.name : 'Unknown';
  } catch (e) {
    console.warn('importSaveBlob: save data has an unrecognized shape, discarding', e);
    return { ok: false, reason: 'not_a_reign' };
  }

  try {
    // A current-version file is stored verbatim; an older one is stored in
    // its migrated form, so the slot always holds a current envelope.
    localStorage.setItem(SAVE_KEY, validated.migratedFrom === null ? text : JSON.stringify(validated.save));
  } catch (e) {
    console.warn('importSaveBlob: write failed, the existing reign is untouched', e);
    return { ok: false, reason: 'storage_failed' };
  }

  return { ok: true, turnNumber, characterName };
}
