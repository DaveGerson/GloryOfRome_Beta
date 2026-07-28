import { z } from 'zod';
import {
  PRIVATE_SCENE_MAX_NPC_RESPONSES,
  PRIVATE_SCENE_MAX_UTTERANCE_CHARS,
  type PrivateSceneSpeaker,
} from '../../privateScene/model';

export const PRIVATE_SCENE_MAX_CONTEXT_ITEMS = 8;
export const PRIVATE_SCENE_MAX_TRANSCRIPT_LINES = PRIVATE_SCENE_MAX_NPC_RESPONSES * 2;
export const PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS = 20_000;

const zPrivateSceneInputText = z.string().trim().min(1).max(PRIVATE_SCENE_MAX_UTTERANCE_CHARS);
const zPrivateSceneContextList = z.array(zPrivateSceneInputText).max(PRIVATE_SCENE_MAX_CONTEXT_ITEMS);

export const zPrivateScenePromptInput = z.object({
  phase: z.enum(['invitation', 'exchange']),
  exchange: z.number().int().min(1).max(PRIVATE_SCENE_MAX_NPC_RESPONSES),
  npc: z.object({
    entityId: zPrivateSceneInputText,
    displayName: zPrivateSceneInputText,
    position: zPrivateSceneInputText.optional(),
    location: zPrivateSceneInputText,
    voice: zPrivateSceneInputText.optional(),
    selfDescription: zPrivateSceneInputText,
    goals: zPrivateSceneContextList,
    beliefs: zPrivateSceneContextList,
    ownSecrets: zPrivateSceneContextList,
    memories: zPrivateSceneContextList,
    relationshipToPlayer: zPrivateSceneInputText.optional(),
  }).strict(),
  player: z.object({
    entityId: zPrivateSceneInputText,
    displayName: zPrivateSceneInputText,
    position: zPrivateSceneInputText.optional(),
  }).strict(),
  transcript: z.array(z.object({
    speaker: z.enum(['player', 'npc'] satisfies readonly PrivateSceneSpeaker[]),
    text: zPrivateSceneInputText,
  }).strict()).min(1).max(PRIVATE_SCENE_MAX_TRANSCRIPT_LINES),
}).strict().superRefine((input, context) => {
  if (input.phase === 'invitation' && input.exchange !== 1) {
    context.addIssue({ code: 'custom', path: ['exchange'], message: 'an invitation must request exchange 1' });
  }
  if (input.phase === 'exchange' && input.exchange < 2) {
    context.addIssue({ code: 'custom', path: ['exchange'], message: 'a later exchange must request exchange 2 or greater' });
  }
  if (JSON.stringify(input).length > PRIVATE_SCENE_MAX_PROMPT_INPUT_CHARS) {
    context.addIssue({ code: 'custom', message: 'private-scene prompt input exceeds its aggregate character budget' });
  }
});

export type PrivateScenePromptInput = z.input<typeof zPrivateScenePromptInput>;

export function parsePrivateScenePromptInput(input: PrivateScenePromptInput): z.output<typeof zPrivateScenePromptInput> {
  const parsed = zPrivateScenePromptInput.safeParse(input);
  if (!parsed.success) throw new Error('Private-scene input is invalid.');
  return parsed.data;
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
  const boundedInput = parsePrivateScenePromptInput(input);
  const { phase, exchange } = boundedInput;
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
  } = boundedInput.npc;
  const { entityId: playerEntityId, displayName: playerDisplayName, position: playerPosition } = boundedInput.player;
  const transcript = boundedInput.transcript.map(({ speaker, text }) => ({ speaker, text }));

  const systemInstruction = `You portray exactly one NPC in a player-initiated private conversation.
NPC speech is dialogue and may be false, mistaken, evasive, or incomplete. npcPrivate records only the NPC's current internal intent; it does not establish world truth.
This call performs no action resolution, no deltas, and no changes to simulation state. Do not invent mechanical outcomes or identifiers.
Return only the requested structured response. Emit speech acts only for the NPC; never fabricate, quote, or attribute a player speech act. Use kinds claim, disclosure, request, promise, agreement, refusal, or threat; never use unclassified.
Use no numeric relationship levels, scores, ratings, scales, or other relationship mechanics anywhere in the response.
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

If phase is invitation, choose refused only when the NPC declines to converse; otherwise continue or end. During an exchange, never choose refused; choose ends only when the NPC ends the conversation, otherwise continue. Emit the NPC's next utterance, only the material NPC speech acts for exchange ${exchange}, and the NPC's private interpretation and intended follow-through.`;

  return { systemInstruction, prompt };
}
