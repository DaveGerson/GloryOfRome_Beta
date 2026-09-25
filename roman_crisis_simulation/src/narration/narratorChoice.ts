/**
 * narration/narratorChoice.ts
 *
 * What the Settings "Narration style" choice resolves to. Three kinds of
 * narrator stand behind that one select:
 *
 *  - a PRESET: the built-in Dramatic Reader or a deployed profile
 *    (narration/narrators.ts, narration/narrators/*.json);
 *  - IN CHARACTER: a character of the game recounts the week in the first
 *    person, as themselves. Only characters the PLAYER KNOWS are offered -
 *    `narratorCharactersFor` starts from `knownRecipientOptionsForPlayer`
 *    (knowledge/relationships.ts), the same player-knowledge list the
 *    composer's recipients and the Personae tab are built on, never the raw
 *    entity list - and the persona is built from their player-visible face
 *    alone: name and public position or epithet. Never secrets, schemes,
 *    beliefs, relationships, memories, goals, speech-style notes or any
 *    GM-private field (D4/D5). Their name and standing count as allowed
 *    names for the fidelity patch;
 *  - a CUSTOM narrator the player wrote (narration/customNarrators.ts).
 *
 * `resolveNarrator` turns the stored choice into the profile that performs,
 * the narrator's own delivery style, the extra names the guard allows, and
 * a `key` that separates one narrator's performances from another's - in
 * the clip cache and in the narration log's transcript reuse.
 */

import type { Entity } from '../types';
import type { KnowledgeClaim } from '../knowledge/store';
import { knownRecipientOptionsForPlayer } from '../knowledge/relationships';
import { GEMINI_NARRATION_PREP, GEMINI_TTS, NARRATION_PREP_THINKING_LEVEL } from '../ai/core/geminiService';
import { IN_CHARACTER_NARRATION_TASK, buildInCharacterPersona } from '../ai/prompts/narrationPerformance';
import { DRAMATIC_READER_NARRATOR, narratorById, type NarratorProfile } from './narrators';
import { customNarratorProfile, type CustomNarrator } from './customNarrators';
import { hashText } from './narrationPlayer';
import type { VoiceStyle } from './voiceStyle';

/** The Settings value for "In character…". */
export const IN_CHARACTER_NARRATOR_ID = 'in-character';

/** A character the player may choose to narrate: their player-visible face, nothing more. */
export interface NarratorCharacter {
  entityId: string;
  name: string;
  /** Public position, else epithet - what the Personae tab shows under the name. */
  standing?: string;
}

/**
 * The characters the player may hear narrate: living individuals the player
 * knows (`knownRecipientOptionsForPlayer`), as name and public standing.
 * Pure projection - no other field of the entity is read.
 */
export function narratorCharactersFor(player: Entity | null | undefined, entities: Entity[], knowledge: KnowledgeClaim[]): NarratorCharacter[] {
  if (!player) return [];
  const byId = new Map(entities.map(entity => [entity.entity_id, entity]));
  const characters: NarratorCharacter[] = [];
  for (const option of knownRecipientOptionsForPlayer(player, entities, knowledge)) {
    const entity = byId.get(option.entityId);
    if (!entity || entity.entity_type !== 'individual' || entity.status !== 'alive') continue;
    const standing = entity.position?.trim() || entity.epithet?.trim();
    characters.push({ entityId: entity.entity_id, name: option.displayName, ...(standing ? { standing } : {}) });
  }
  return characters;
}

/** A character narrator's profile: the Dramatic Reader's models, their own persona and ask. */
export function inCharacterNarratorProfile(character: NarratorCharacter, voiceName: string = DRAMATIC_READER_NARRATOR.voice.voiceName): NarratorProfile {
  return {
    id: IN_CHARACTER_NARRATOR_ID,
    name: character.name.slice(0, 40),
    description: `The week as ${character.name} tells it, from where they stand.`.slice(0, 160),
    prep: {
      model: GEMINI_NARRATION_PREP,
      thinkingLevel: NARRATION_PREP_THINKING_LEVEL,
      temperature: 0.7,
      persona: buildInCharacterPersona({ name: character.name, standing: character.standing }),
      task: IN_CHARACTER_NARRATION_TASK,
    },
    voice: { model: GEMINI_TTS, voiceName, temperature: 1 },
  };
}

export interface ResolvedNarrator {
  kind: 'preset' | 'in_character' | 'custom';
  profile: NarratorProfile;
  /** The narrator's own delivery style (custom narrators may set one). */
  ownStyle: VoiceStyle | null;
  /** Names the fidelity patch lets this narrator speak beyond the listener's own. */
  allowedNames: string[];
  /** The narrator's name as the log shows it. */
  displayName: string;
  /** Separates this narrator's performances from any other's, including an edited one's. */
  key: string;
  /** Set for a narrator in character. */
  character?: NarratorCharacter;
}

export interface NarratorSelection {
  /** The stored "Narration style" value: a preset id, `in-character`, or a custom id. */
  narratorId: string | null;
  /** The stored character, for `in-character`. */
  characterId: string | null;
  presets: readonly NarratorProfile[];
  customs: readonly CustomNarrator[];
  characters: readonly NarratorCharacter[];
}

function keyFor(profile: NarratorProfile, suffix = ''): string {
  return `${profile.id}${suffix}#${hashText(JSON.stringify(profile.prep))}`;
}

/** The character `in-character` narrates with: the stored one while the player still knows them, else the first. */
export function chosenCharacter(characterId: string | null, characters: readonly NarratorCharacter[]): NarratorCharacter | undefined {
  return characters.find(c => c.entityId === characterId) ?? characters[0];
}

/**
 * The narrator a stored choice resolves to. An unknown or retired id, a
 * deleted custom narrator, or "In character…" with no one known yet all
 * fall back to the built-in, so a choice can never leave the voice without
 * a narrator.
 */
export function resolveNarrator(selection: NarratorSelection): ResolvedNarrator {
  const { narratorId, characterId, presets, customs, characters } = selection;
  if (narratorId === IN_CHARACTER_NARRATOR_ID) {
    const character = chosenCharacter(characterId, characters);
    if (character) {
      const profile = inCharacterNarratorProfile(character);
      return {
        kind: 'in_character',
        profile,
        ownStyle: null,
        allowedNames: [character.name, ...(character.standing ? [character.standing] : [])],
        displayName: character.name,
        key: keyFor(profile, `:${character.entityId}`),
        character,
      };
    }
  }
  const custom = customs.find(c => c.id === narratorId);
  const customProfile = custom ? customNarratorProfile(custom) : null;
  if (custom && customProfile) {
    return { kind: 'custom', profile: customProfile, ownStyle: custom.voiceStyle, allowedNames: [], displayName: custom.name, key: keyFor(customProfile) };
  }
  const profile = narratorById(narratorId === IN_CHARACTER_NARRATOR_ID ? null : narratorId, presets);
  return { kind: 'preset', profile, ownStyle: null, allowedNames: [], displayName: profile.name, key: keyFor(profile) };
}
