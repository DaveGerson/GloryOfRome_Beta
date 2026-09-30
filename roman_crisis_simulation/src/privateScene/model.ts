import type { ComposureRoll, Entity } from '../types';
import { MAX_SIGNS_PER_SCENE, type ScreenedNpcTells } from '../ai/core/composure';
import { validateDelivery } from '../narration/performanceScript';

export const PRIVATE_SCENE_MAX_NPC_RESPONSES = 6;
export const PRIVATE_SCENE_MAX_UTTERANCE_CHARS = 2_000;

export type PrivateSceneStatus = 'active' | 'awaiting_last_word' | 'closed';
export type PrivateSceneClosureReason = 'refused' | 'player_ended' | 'npc_ended' | 'response_limit';
export type PrivateSceneSpeechActKind = 'claim' | 'disclosure' | 'request' | 'promise' | 'agreement' | 'refusal' | 'threat' | 'unclassified';
export type PrivateSceneSpeaker = 'player' | 'npc';

export interface PrivateSceneNpcPrivateState {
  sincerity: string;
  hiddenIntent: string;
  plannedFollowThrough: string[];
}

export interface PrivateSceneSpeechAct {
  speaker: PrivateSceneSpeaker;
  kind: PrivateSceneSpeechActKind;
  text: string;
  exchange: number;
}

export interface PrivateSceneModelResponse {
  disposition: 'refused' | 'continues' | 'ends';
  npcUtterance: string;
  speechActs: PrivateSceneSpeechAct[];
  npcPrivate: PrivateSceneNpcPrivateState;
  /**
   * D50, RAW model output: a short stage direction for how `npcUtterance` is
   * said. Never taken as is - ai/core/composure.ts::screenNpcTells screens
   * it, and a transition takes only the screened `tells`.
   */
  delivery?: unknown;
  /** D50, RAW model output: the tells the player saw, `{ subject, sign }` each - screened as `delivery` is. */
  signs?: unknown;
}

/** One line of a scene, as spoken. */
export interface PrivateSceneTranscriptLine {
  sequence: number;
  speaker: PrivateSceneSpeaker;
  text: string;
  /**
   * D50: an NPC line's delivery - how it was said ("voice catching"), shown
   * as a stage direction beside the line and performed as its leading cue.
   * Player-visible; only ever a screened delivery (ai/core/composure.ts).
   * Optional: lines without one, and every line saved before D50, lack it.
   */
  delivery?: string;
}

/**
 * One of the PLAYER's own composure rolls in a scene (D50), with EXACTLY the
 * line the NPC was told of it (ai/core/composure.ts::playerComposureTell),
 * or null when it held and the NPC was told nothing. The roll itself is
 * GM-private; the player is shown the outcome in words and `told`
 * (perception/visibility.ts::projectPrivateSceneForPlayer).
 */
export interface PrivateScenePlayerComposureRoll extends ComposureRoll {
  told: string | null;
}

/** A tell the NPC let show in this scene, and code let stand (D50). GM-PRIVATE: `subject` is the handle of what it betrayed. */
export interface PrivateSceneSign {
  subject: string;
  sign: string;
  exchange: number;
}

/** Both parties' composure for one scene, rolled once as the scene opens (D50). */
export interface PrivateSceneComposure {
  /** The seed of the scene's composure generator: the NPC's rolls first, then the player's. */
  seed: number;
  npc: ComposureRoll[];
  player: PrivateScenePlayerComposureRoll[];
}

export interface PrivateSceneRecord {
  sceneId: string;
  macroTurn: number;
  playerId: string;
  npcId: string;
  playerName: string;
  npcName: string;
  status: PrivateSceneStatus;
  transcript: PrivateSceneTranscriptLine[];
  npcResponseCount: number;
  speechActs: PrivateSceneSpeechAct[];
  npcPrivate: PrivateSceneNpcPrivateState;
  closureReason?: PrivateSceneClosureReason;
  lastWord?: string;
  consequenceStatus: 'pending' | 'consumed';
  consumedByTurn?: number;
  /**
   * GM-PRIVATE (D50): the seed the scene's composure was rolled from. The
   * rolls are made ONCE, as the scene opens, and persisted with it, so a
   * reload never rolls again. Optional, as are the three fields below:
   * scenes opened before D50 lack them all.
   */
  composureSeed?: number;
  /** GM-PRIVATE (D50): the NPC's composure this scene - one roll per inward mark and secret tie. */
  npcComposure?: ComposureRoll[];
  /** GM-PRIVATE (D50) as a record: the player's own composure this scene, and what the NPC was told of each. */
  playerComposure?: PrivateScenePlayerComposureRoll[];
  /** GM-PRIVATE (D50): the tells that showed and were let stand, each with its subject. Bounded at MAX_SIGNS_PER_SCENE. */
  composureSigns?: PrivateSceneSign[];
}

export interface PrivateSceneAdjudicatorProjection {
  player: { entityId: string; name: string };
  npc: { entityId: string; name: string };
  closureReason: PrivateSceneClosureReason;
  speechActs: Array<Pick<PrivateSceneSpeechAct, 'speaker' | 'kind' | 'text'>>;
  lastWord?: string;
  latestNpcInternalIntent: string;
}

export interface PrivateSceneNpcMemoryProjection {
  closureReason: PrivateSceneClosureReason;
  transcript: Array<{ sequence: number; speaker: PrivateSceneSpeaker; text: string }>;
  speechActs: Array<Pick<PrivateSceneSpeechAct, 'speaker' | 'kind' | 'text'>>;
  lastWord?: string;
  npcPrivate: PrivateSceneNpcPrivateState;
  /**
   * D50: EXACTLY what this NPC was told of the player's own composure in that
   * audience - the code-written lines, never the rolls - so it may remember
   * what it saw. Absent when it was told nothing.
   */
  playerTells?: string[];
}

export type PrivateSceneTransitionResult =
  | { ok: true; scene: PrivateSceneRecord }
  | { ok: false; error: string };

type StringResult = { ok: true; value: string } | { ok: false; error: string };
type ResponseResult = { ok: true; value: PrivateSceneModelResponse } | { ok: false; error: string };

const PROVIDER_SPEECH_ACT_KINDS: readonly PrivateSceneSpeechActKind[] = [
  'claim',
  'disclosure',
  'request',
  'promise',
  'agreement',
  'refusal',
  'threat',
];

function failure(error: string): PrivateSceneTransitionResult {
  return { ok: false, error };
}

function trimmedRequired(value: unknown, field: string, maxLength?: number): StringResult {
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `${field} must not be empty` };
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return { ok: false, error: `${field} must be at most ${maxLength} characters` };
  }
  return { ok: true, value: trimmed };
}

function validTurn(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validResponseCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= PRIVATE_SCENE_MAX_NPC_RESPONSES;
}

function canonicalResponse(response: PrivateSceneModelResponse, exchange: number): ResponseResult {
  if (!response || !['refused', 'continues', 'ends'].includes(response.disposition)) {
    return { ok: false, error: 'response disposition is invalid' };
  }

  const npcUtterance = trimmedRequired(
    response.npcUtterance,
    'NPC utterance',
    PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  );
  if (!npcUtterance.ok) return npcUtterance;

  if (!Array.isArray(response.speechActs)) {
    return { ok: false, error: 'response speech acts must be an array' };
  }
  const speechActs: PrivateSceneSpeechAct[] = [];
  for (const act of response.speechActs) {
    if (!act || act.speaker !== 'npc') {
      return { ok: false, error: 'provider response speech acts must belong to the NPC' };
    }
    if (!PROVIDER_SPEECH_ACT_KINDS.includes(act.kind)) {
      return { ok: false, error: 'response speech-act kind is invalid' };
    }
    if (act.exchange !== exchange) {
      return { ok: false, error: `response speech acts must belong to exchange ${exchange}` };
    }
    const text = trimmedRequired(act.text, 'speech-act text', PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
    if (!text.ok) return text;
    speechActs.push({ speaker: act.speaker, kind: act.kind, text: text.value, exchange });
  }

  if (!response.npcPrivate || !Array.isArray(response.npcPrivate.plannedFollowThrough)) {
    return { ok: false, error: 'NPC private state is invalid' };
  }
  const sincerity = trimmedRequired(response.npcPrivate.sincerity, 'NPC sincerity');
  if (!sincerity.ok) return sincerity;
  const hiddenIntent = trimmedRequired(response.npcPrivate.hiddenIntent, 'NPC hidden intent');
  if (!hiddenIntent.ok) return hiddenIntent;
  const plannedFollowThrough: string[] = [];
  for (const step of response.npcPrivate.plannedFollowThrough) {
    const canonicalStep = trimmedRequired(step, 'planned follow-through');
    if (!canonicalStep.ok) return canonicalStep;
    plannedFollowThrough.push(canonicalStep.value);
  }

  return {
    ok: true,
    value: {
      disposition: response.disposition,
      npcUtterance: npcUtterance.value,
      speechActs,
      npcPrivate: {
        sincerity: sincerity.value,
        hiddenIntent: hiddenIntent.value,
        plannedFollowThrough,
      },
    },
  };
}

function cloneRecord(scene: PrivateSceneRecord): PrivateSceneRecord {
  return {
    ...scene,
    transcript: scene.transcript.map(line => ({ ...line })),
    speechActs: scene.speechActs.map(act => ({ ...act })),
    npcPrivate: {
      ...scene.npcPrivate,
      plannedFollowThrough: [...scene.npcPrivate.plannedFollowThrough],
    },
    ...(scene.npcComposure ? { npcComposure: scene.npcComposure.map(roll => ({ ...roll })) } : {}),
    ...(scene.playerComposure ? { playerComposure: scene.playerComposure.map(roll => ({ ...roll })) } : {}),
    ...(scene.composureSigns ? { composureSigns: scene.composureSigns.map(sign => ({ ...sign })) } : {}),
  };
}

/**
 * What one NPC reply adds of its tells (D50), re-gated here although the
 * controller screened them (ai/core/composure.ts::screenNpcTells): the
 * delivery must still pass the cue rules, and a sign must still name one of
 * this scene's NPC subjects that did not hold - so no caller can hand the
 * record a tell the roll kept hidden. Signs past MAX_SIGNS_PER_SCENE for the
 * scene are dropped.
 */
function tellsForReply(
  tells: ScreenedNpcTells | undefined,
  npcComposure: readonly ComposureRoll[] | undefined,
  existing: readonly PrivateSceneSign[],
  exchange: number,
): { delivery?: string; signs: PrivateSceneSign[] } {
  const delivery = validateDelivery(tells?.delivery) ?? undefined;
  const open = new Set((npcComposure ?? []).filter(roll => roll.tier !== 'holds').map(roll => roll.subjectId));
  const room = Math.max(0, MAX_SIGNS_PER_SCENE - existing.length);
  const signs = (tells?.signs ?? [])
    .filter(sign => open.has(sign.subject) && typeof sign.sign === 'string' && sign.sign.trim().length > 0)
    .slice(0, room)
    .map(sign => ({ subject: sign.subject, sign: sign.sign.trim(), exchange }));
  return { ...(delivery ? { delivery } : {}), signs };
}

/** The scene's signs with this reply's appended, or no field at all when there are none. */
function withSigns(existing: readonly PrivateSceneSign[], added: readonly PrivateSceneSign[]): { composureSigns?: PrivateSceneSign[] } {
  const all = [...existing.map(sign => ({ ...sign })), ...added];
  return all.length > 0 ? { composureSigns: all } : {};
}

function closureForResponse(
  disposition: PrivateSceneModelResponse['disposition'],
  npcResponseCount: number,
): { status: PrivateSceneStatus; closureReason?: PrivateSceneClosureReason } {
  if (disposition === 'refused') return { status: 'awaiting_last_word', closureReason: 'refused' };
  if (disposition === 'ends') return { status: 'awaiting_last_word', closureReason: 'npc_ended' };
  if (npcResponseCount === PRIVATE_SCENE_MAX_NPC_RESPONSES) {
    return { status: 'awaiting_last_word', closureReason: 'response_limit' };
  }
  return { status: 'active' };
}

/**
 * One contact the player may take aside. `position` and `location` ride along
 * for the doorway's contact cards (WP-16): both are already-known facts about
 * an entity the player has met — the eligibility filter below requires
 * `known.has(entity.entity_id)` — so neither widens what the player can see.
 */
export interface PrivateSceneTarget {
  entityId: string;
  displayName: string;
  position?: string;
  location?: string;
}

export function eligiblePrivateSceneTargets(input: {
  player: Entity;
  entities: Entity[];
  knownEntityIds: readonly string[];
}): PrivateSceneTarget[] {
  const known = new Set(input.knownEntityIds);
  return input.entities
    .filter(entity =>
      entity.entity_id !== input.player.entity_id
      && entity.entity_type === 'individual'
      && entity.status === 'alive'
      && known.has(entity.entity_id)
      && (entity.location === input.player.location || input.player.visibility_network.includes(entity.entity_id)))
    .map(entity => ({
      entityId: entity.entity_id,
      displayName: entity.name,
      ...(entity.position ? { position: entity.position } : {}),
      ...(entity.location ? { location: entity.location } : {}),
    }));
}

export function beginPrivateScene(input: {
  sceneId: string;
  macroTurn: number;
  player: Entity;
  npc: Entity;
  knownEntityIds: readonly string[];
  opening: string;
  response: PrivateSceneModelResponse;
  existing: readonly PrivateSceneRecord[];
  /** D50: both parties' composure, rolled as the scene opens and kept with it. Absent: a scene without composure. */
  composure?: PrivateSceneComposure;
  /** D50: the NPC's first reply's tells, screened (ai/core/composure.ts::screenNpcTells). */
  tells?: ScreenedNpcTells;
}): PrivateSceneTransitionResult {
  const sceneId = trimmedRequired(input.sceneId, 'scene ID');
  if (!sceneId.ok) return failure(sceneId.error);
  if (!validTurn(input.macroTurn)) return failure('macro turn is invalid');
  if (input.existing.some(scene => scene.sceneId === sceneId.value)) return failure('scene ID already exists');
  if (input.existing.some(scene => scene.status === 'active' || scene.status === 'awaiting_last_word')) {
    return failure('another private scene is still open');
  }
  if (input.existing.some(scene => scene.macroTurn === input.macroTurn)) {
    return failure('the macro turn already contains a committed private scene');
  }

  const playerId = trimmedRequired(input.player.entity_id, 'player ID');
  if (!playerId.ok) return failure(playerId.error);
  const npcId = trimmedRequired(input.npc.entity_id, 'NPC ID');
  if (!npcId.ok) return failure(npcId.error);
  if (playerId.value === npcId.value) return failure('the player cannot open a private scene with themselves');
  if (!Array.isArray(input.knownEntityIds) || !input.knownEntityIds.includes(input.npc.entity_id)) {
    return failure('the private-scene target is not known to the player');
  }
  if (input.npc.entity_type !== 'individual' || input.npc.status !== 'alive') {
    return failure('the private-scene target must be a living individual');
  }
  if (input.npc.location !== input.player.location && !input.player.visibility_network.includes(input.npc.entity_id)) {
    return failure('the private-scene target is inaccessible');
  }

  const playerName = trimmedRequired(input.player.name, 'player name');
  if (!playerName.ok) return failure(playerName.error);
  const npcName = trimmedRequired(input.npc.name, 'NPC name');
  if (!npcName.ok) return failure(npcName.error);
  const opening = trimmedRequired(input.opening, 'opening', PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
  if (!opening.ok) return failure(opening.error);
  const response = canonicalResponse(input.response, 1);
  if (!response.ok) return failure(response.error);
  const lifecycle = closureForResponse(response.value.disposition, 1);
  const composure = input.composure;
  if (composure && (!Number.isInteger(composure.seed) || !Array.isArray(composure.npc) || !Array.isArray(composure.player))) {
    return failure('the scene composure is invalid');
  }
  const tells = tellsForReply(input.tells, composure?.npc, [], 1);

  return {
    ok: true,
    scene: {
      sceneId: sceneId.value,
      macroTurn: input.macroTurn,
      playerId: playerId.value,
      npcId: npcId.value,
      playerName: playerName.value,
      npcName: npcName.value,
      status: lifecycle.status,
      transcript: [
        { sequence: 1, speaker: 'player', text: opening.value },
        { sequence: 2, speaker: 'npc', text: response.value.npcUtterance, ...(tells.delivery ? { delivery: tells.delivery } : {}) },
      ],
      npcResponseCount: 1,
      speechActs: [
        { speaker: 'player', kind: 'unclassified', text: opening.value, exchange: 1 },
        ...response.value.speechActs,
      ],
      npcPrivate: response.value.npcPrivate,
      ...(lifecycle.closureReason ? { closureReason: lifecycle.closureReason } : {}),
      consequenceStatus: 'pending',
      ...(composure ? {
        composureSeed: composure.seed,
        npcComposure: composure.npc.map(roll => ({ ...roll })),
        playerComposure: composure.player.map(roll => ({ ...roll })),
      } : {}),
      ...withSigns([], tells.signs),
    },
  };
}

export function appendPrivateSceneExchange(input: {
  scene: PrivateSceneRecord;
  expectedNpcResponseCount: number;
  playerUtterance: string;
  response: PrivateSceneModelResponse;
  /** D50: this reply's tells, screened (ai/core/composure.ts::screenNpcTells). */
  tells?: ScreenedNpcTells;
}): PrivateSceneTransitionResult {
  if (input.scene.status !== 'active') return failure('only an active private scene can continue');
  if (!validResponseCount(input.scene.npcResponseCount)) return failure('scene response count is invalid');
  if (input.expectedNpcResponseCount !== input.scene.npcResponseCount) {
    return failure('scene response count is stale');
  }
  if (input.scene.npcResponseCount >= PRIVATE_SCENE_MAX_NPC_RESPONSES) {
    return failure('the private scene has reached its response limit');
  }
  if (input.response?.disposition === 'refused') {
    return failure('refusal is valid only for the invitation response');
  }

  const playerUtterance = trimmedRequired(
    input.playerUtterance,
    'player utterance',
    PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  );
  if (!playerUtterance.ok) return failure(playerUtterance.error);
  const nextCount = input.scene.npcResponseCount + 1;
  const response = canonicalResponse(input.response, nextCount);
  if (!response.ok) return failure(response.error);
  const lifecycle = closureForResponse(response.value.disposition, nextCount);
  const nextSequence = input.scene.transcript.length + 1;
  const priorSigns = input.scene.composureSigns ?? [];
  const tells = tellsForReply(input.tells, input.scene.npcComposure, priorSigns, nextCount);

  return {
    ok: true,
    scene: {
      ...cloneRecord(input.scene),
      ...withSigns(priorSigns, tells.signs),
      status: lifecycle.status,
      transcript: [
        ...input.scene.transcript.map(line => ({ ...line })),
        { sequence: nextSequence, speaker: 'player', text: playerUtterance.value },
        { sequence: nextSequence + 1, speaker: 'npc', text: response.value.npcUtterance, ...(tells.delivery ? { delivery: tells.delivery } : {}) },
      ],
      npcResponseCount: nextCount,
      speechActs: [
        ...input.scene.speechActs.map(act => ({ ...act })),
        { speaker: 'player', kind: 'unclassified', text: playerUtterance.value, exchange: nextCount },
        ...response.value.speechActs,
      ],
      npcPrivate: response.value.npcPrivate,
      ...(lifecycle.closureReason ? { closureReason: lifecycle.closureReason } : {}),
    },
  };
}

export function endPrivateScene(scene: PrivateSceneRecord): PrivateSceneTransitionResult {
  if (scene.status !== 'active') return failure('only an active private scene can be ended');
  if (!validResponseCount(scene.npcResponseCount)) return failure('scene response count is invalid');
  return {
    ok: true,
    scene: {
      ...cloneRecord(scene),
      status: 'awaiting_last_word',
      closureReason: 'player_ended',
    },
  };
}

export function finalizePrivateScene(
  scene: PrivateSceneRecord,
  lastWord: string | null,
): PrivateSceneTransitionResult {
  if (scene.status !== 'awaiting_last_word') {
    return failure('only a private scene awaiting a last word can be finalized');
  }
  if (!validResponseCount(scene.npcResponseCount)) return failure('scene response count is invalid');
  if (scene.lastWord !== undefined) return failure('the private scene already has a last word');

  const canonicalLastWord = lastWord === null
    ? null
    : trimmedRequired(lastWord, 'last word', PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
  if (canonicalLastWord !== null && !canonicalLastWord.ok) return failure(canonicalLastWord.error);

  const { lastWord: _discardedLastWord, ...withoutLastWord } = cloneRecord(scene);
  if (canonicalLastWord === null) {
    return { ok: true, scene: { ...withoutLastWord, status: 'closed' } };
  }

  const text = canonicalLastWord.value;
  return {
    ok: true,
    scene: {
      ...withoutLastWord,
      status: 'closed',
      transcript: [
        ...withoutLastWord.transcript,
        { sequence: withoutLastWord.transcript.length + 1, speaker: 'player', text },
      ],
      speechActs: [
        ...withoutLastWord.speechActs,
        {
          speaker: 'player',
          kind: 'unclassified',
          text,
          exchange: withoutLastWord.npcResponseCount + 1,
        },
      ],
      lastWord: text,
    },
  };
}

export function selectPendingPrivateSceneOutcome(
  scenes: readonly PrivateSceneRecord[],
): PrivateSceneRecord | null {
  return scenes.find(scene => scene.status === 'closed' && scene.consequenceStatus === 'pending') ?? null;
}

export function buildPrivateSceneAdjudicatorProjection(scene: PrivateSceneRecord): PrivateSceneAdjudicatorProjection {
  if (scene.status !== 'closed' || !scene.closureReason || scene.consequenceStatus !== 'pending') {
    throw new Error('only a closed pending private scene can be projected for adjudication');
  }
  return {
    player: { entityId: scene.playerId, name: scene.playerName },
    npc: { entityId: scene.npcId, name: scene.npcName },
    closureReason: scene.closureReason,
    speechActs: scene.speechActs.map(({ speaker, kind, text }) => ({ speaker, kind, text })),
    ...(scene.lastWord === undefined ? {} : { lastWord: scene.lastWord }),
    latestNpcInternalIntent: scene.npcPrivate.hiddenIntent,
  };
}

export function buildPrivateSceneNpcMemoryProjection(
  scenes: readonly PrivateSceneRecord[],
  npcId: string,
): PrivateSceneNpcMemoryProjection[] {
  return scenes
    .filter(scene => scene.npcId === npcId && scene.status === 'closed' && scene.closureReason)
    .sort((a, b) => b.macroTurn - a.macroTurn)
    .slice(0, 3)
    .map(scene => {
      const playerTells = (scene.playerComposure ?? [])
        .map(roll => roll.told)
        .filter((told): told is string => typeof told === 'string' && told.length > 0);
      return {
        closureReason: scene.closureReason!,
        transcript: scene.transcript.map(({ sequence, speaker, text }) => ({ sequence, speaker, text })),
        speechActs: scene.speechActs.map(({ speaker, kind, text }) => ({ speaker, kind, text })),
        ...(scene.lastWord === undefined ? {} : { lastWord: scene.lastWord }),
        npcPrivate: { ...scene.npcPrivate, plannedFollowThrough: [...scene.npcPrivate.plannedFollowThrough] },
        ...(playerTells.length > 0 ? { playerTells } : {}),
      };
    });
}

export function consumePrivateSceneOutcome(
  scenes: readonly PrivateSceneRecord[],
  sceneId: string,
  consumedByTurn: number,
): PrivateSceneTransitionResult {
  const canonicalSceneId = trimmedRequired(sceneId, 'scene ID');
  if (!canonicalSceneId.ok) return failure(canonicalSceneId.error);
  const scene = scenes.find(candidate => candidate.sceneId === canonicalSceneId.value);
  if (!scene) return failure('private scene does not exist');
  if (scene.status !== 'closed') return failure('only a closed private scene outcome can be consumed');
  if (scene.consequenceStatus !== 'pending') return failure('private scene outcome is already consumed');
  if (!validTurn(consumedByTurn) || consumedByTurn <= scene.macroTurn) {
    return failure('outcome consumption turn must follow the private scene turn');
  }

  return {
    ok: true,
    scene: {
      ...cloneRecord(scene),
      consequenceStatus: 'consumed',
      consumedByTurn,
    },
  };
}
