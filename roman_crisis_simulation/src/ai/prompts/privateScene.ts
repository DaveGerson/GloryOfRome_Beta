import {
  PRIVATE_SCENE_MAX_NPC_RESPONSES,
  PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  type PrivateSceneSpeaker,
} from '../../privateScene/model';

export interface PrivateSceneNpcSelfBrief {
  entityId: string;
  displayName: string;
  position?: string;
  location: string;
  voice?: string;
  selfDescription: string;
  goals: readonly string[];
  beliefs: readonly string[];
  ownSecrets: readonly string[];
  memories: readonly string[];
  relationshipToPlayer?: string;
}

export interface PrivateScenePlayerIdentity {
  entityId: string;
  displayName: string;
  position?: string;
}

export interface PrivateSceneTranscriptLine {
  speaker: PrivateSceneSpeaker;
  text: string;
}

export interface PrivateScenePromptInput {
  phase: 'invitation' | 'exchange';
  exchange: number;
  npc: PrivateSceneNpcSelfBrief;
  player: PrivateScenePlayerIdentity;
  transcript: readonly PrivateSceneTranscriptLine[];
}

/**
 * Builds the one-NPC private-scene request. Every nested object is rebuilt
 * field-by-field so accidentally passing a larger entity or simulation object
 * cannot smuggle unrelated state into the provider prompt.
 */
export function buildPrivateScenePrompt(input: PrivateScenePromptInput): {
  systemInstruction: string;
  prompt: string;
} {
  const { phase, exchange } = input;
  const {
    entityId,
    displayName,
    position,
    location,
    voice,
    selfDescription,
    goals,
    beliefs,
    ownSecrets,
    memories,
    relationshipToPlayer,
  } = input.npc;
  const { entityId: playerEntityId, displayName: playerDisplayName, position: playerPosition } = input.player;
  const transcript = input.transcript.map(({ speaker, text }) => ({ speaker, text }));

  const systemInstruction = `You portray exactly one NPC in a player-initiated private conversation.
NPC speech is dialogue and may be false, mistaken, evasive, or incomplete. npcPrivate records only the NPC's current internal intent; it does not establish world truth.
This call performs no action resolution, no deltas, and no changes to simulation state. Do not invent mechanical outcomes or identifiers.
Return only the requested structured response. Use speech-act kinds claim, disclosure, request, promise, agreement, refusal, or threat; never use unclassified.
Keep every utterance at most ${PRIVATE_SCENE_MAX_UTTERANCE_CHARS} characters and every speech-act exchange between 1 and ${PRIVATE_SCENE_MAX_NPC_RESPONSES}.`;

  const prompt = `Continue the current private scene from this bounded context.

PRIVATE SCENE CONTEXT
${JSON.stringify({
    phase,
    exchange,
    npc: {
      entityId,
      displayName,
      position,
      location,
      voice,
      selfDescription,
      goals: [...goals],
      beliefs: [...beliefs],
      ownSecrets: [...ownSecrets],
      memories: [...memories],
      relationshipToPlayer,
    },
    player: {
      entityId: playerEntityId,
      displayName: playerDisplayName,
      position: playerPosition,
    },
    transcript,
  }, null, 2)}

If phase is invitation, choose refused only when the NPC declines to converse; otherwise continue. During an exchange, choose ends only when the NPC ends the conversation; otherwise continue. Emit the NPC's next utterance, the material player/NPC speech acts for exchange ${exchange}, and the NPC's private interpretation and intended follow-through.`;

  return { systemInstruction, prompt };
}
