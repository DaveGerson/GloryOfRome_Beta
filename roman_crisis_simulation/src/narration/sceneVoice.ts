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
 *  - `npcVoiceFor`: each NPC's own voice, a stable hash of their entity id
 *    over the curated voices (persistence/uiPrefs.ts NARRATOR_VOICES),
 *    skipping the voice the chronicle narrator is using when it can, so the
 *    narrator and the person in the room never sound alike.
 *
 * Delivery style: none. An NPC line is always voiced "as written", whatever
 * the narrator's style - a style is a narrator's manner, not theirs, and
 * deriving one per NPC would need something about them beyond their words.
 */

import { hashText } from './narrationPlayer';
import { NARRATOR_VOICES } from '../persistence/uiPrefs';

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

/**
 * The NPC's own voice: deterministic per entity, and - when the curated
 * list allows - never `avoidVoice` (the chronicle narrator's current voice).
 */
export function npcVoiceFor(entityId: string, avoidVoice?: string | null): string {
  const voices = NARRATOR_VOICES.map(v => v.id as string);
  const pool = voices.filter(v => v !== avoidVoice);
  const candidates = pool.length > 0 ? pool : voices;
  return candidates[parseInt(hashText(entityId), 16) % candidates.length];
}
