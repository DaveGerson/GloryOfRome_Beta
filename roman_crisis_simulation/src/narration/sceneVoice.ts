/**
 * narration/sceneVoice.ts
 *
 * A private-scene NPC speaking their own committed lines aloud
 * (hooks/usePrivateSceneVoice.ts). No prep model is involved: the line is
 * already the NPC's own words, committed to the player's transcript
 * (privateScene/model.ts, projected by perception/visibility.ts
 * `projectPrivateSceneForPlayer`), so the only cost is the TTS call.
 *
 * Two deterministic pieces:
 *
 *  - `cleanSceneLineForSpeech`: the committed line minus markup a voice
 *    would read literally - `*stage business*`, `**bold**` markers,
 *    `[bracketed]` and `<angled>` asides - and nothing else. The private
 *    scene's format is plain dialogue; the model is not asked for stage
 *    business, but a stray asterisked gesture should never be spoken as
 *    "asterisk sighs asterisk".
 *  - `npcCastVoice`: the NPC's own voice and delivery note from the
 *    campaign's voice cast (narration/voiceCast.ts) - the same voice they
 *    narrate in "in character", unique in the cast, fitted to who they are.
 *    Someone not (yet) in the cast is voiced by the deterministic casting
 *    from their name alone.
 *
 * Delivery style: none reaches the voice. The line is the NPC's committed
 * words and there is no prep call to write them in a manner, and the TTS
 * model speaks every word it is given - so the NPC's character comes
 * entirely from their cast VOICE. Their cast note is returned for display
 * (the narration log shows it) and sent nowhere. Never the narrator's style
 * either: a style is a speaker's own manner.
 */

import { castStyle, deterministicMember, memberVoice, type CastVoice, type VoiceCast } from './voiceCast';

/** The committed line, stripped of markup a voice would read aloud. */
export function cleanSceneLineForSpeech(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*[^*\n]{1,200}\*/g, ' ')
    .replace(/\*/g, '')
    .replace(/\[[^\]\n]{0,200}\]/g, ' ')
    .replace(/<[^>\n]{0,200}>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/ ([,.;:!?…])/g, '$1')
    .trim();
}

/** The NPC's own voice and delivery: their cast member, else the rule from their name. */
export function npcCastVoice(cast: VoiceCast | null | undefined, npc: { npcId: string; npcName: string }): CastVoice {
  const member = memberVoice(cast, npc.npcId);
  if (member) return member;
  const byRule = deterministicMember({ entityId: npc.npcId, name: npc.npcName, entityType: 'individual' });
  return { voiceName: byRule.voiceName, style: castStyle(byRule.style) };
}
