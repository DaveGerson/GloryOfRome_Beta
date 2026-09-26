/**
 * narration/voiceStyle.ts
 *
 * The narration voice's delivery style: a MANNER the acted script should
 * carry ("hushed and conspiratorial"). It never reaches the text-to-speech
 * model as an instruction. gemini-3.8-flash-tts performs the script it is
 * given word for word - it acts every `<cue>` and speaks every word outside
 * one - and its `speechConfig` has no style parameter, only the prebuilt
 * voice (and language). So the TTS input is the script and nothing else,
 * always (ai/prompts/narrationPerformance.ts `buildNarrationTtsPrompt`): a
 * "Say it …:" prefix would be read aloud.
 *
 * Instead a style shapes the WRITING: where a prep call exists (the
 * chronicle narrator, "In character…", the player's own narrators), the
 * chosen style is handed to the prep model as a DELIVERY BRIEF
 * (`buildDeliveryBrief` in ai/prompts/narrationPerformance.ts), which asks
 * for the manner to be carried in the words (word choice, sentence length,
 * rhythm) AND in the script's performance cues (`<angle brackets>`: tone,
 * pace, pauses, breath) - never described outside a cue. Where no prep call
 * exists (a private-scene NPC's committed line, the Imperial Dispatch, a
 * replay from the narration log), the voice alone carries the character.
 *
 * Audition a style's effect on the writing with a real key:
 *
 *   GEMINI_API_KEY=... GOR_NARRATOR_AUDIO=1 GOR_NARRATOR_STYLE=newsreader npm run narrator:tune
 *
 * (`GOR_NARRATOR_STYLE` takes a preset id or free text, which is sanitized
 * exactly as a player's custom style is, and feeds the prep brief.)
 *
 * A custom style is player-typed text that reaches the prep model, so it is
 * sanitized to delivery language only - letters, spaces and light
 * punctuation; no digits, quote marks, brackets or colons - capped at
 * `MAX_CUSTOM_VOICE_STYLE_CHARS`, and embedded as JSON-quoted data (D41,
 * `asPromptData`). It carries no game content.
 */

import { z } from 'zod';

export const MAX_CUSTOM_VOICE_STYLE_CHARS = 80;

export type VoiceStylePresetId = 'as-written' | 'tragedian' | 'newsreader' | 'conspiratorial' | 'old-soldier';

/** A chosen delivery: a preset, or the player's own words. */
export type VoiceStyle =
  | { preset: VoiceStylePresetId }
  | { preset: 'custom'; text: string };

/** Player-visible labels are veto-queue copy (roadmaps/BACKLOG.md B13). */
/** `manner` is what the prep brief asks the words to carry (never sent to the TTS model). */
export const VOICE_STYLE_PRESETS: readonly { id: VoiceStylePresetId; label: string; manner: string | null }[] = [
  { id: 'as-written', label: 'As written', manner: null },
  { id: 'tragedian', label: 'Epic stage tragedian', manner: 'grand and resonant, like an epic stage tragedian' },
  { id: 'newsreader', label: 'Composed newsreader', manner: 'composed, even and clear, like a newsreader' },
  { id: 'conspiratorial', label: 'Hushed and conspiratorial', manner: 'hushed and conspiratorial, as if overheard' },
  { id: 'old-soldier', label: 'Weary old soldier', manner: 'weary and plain, like an old soldier' },
];

export const CUSTOM_VOICE_STYLE_LABEL = 'Custom…';

const PRESET_IDS = VOICE_STYLE_PRESETS.map(p => p.id) as [VoiceStylePresetId, ...VoiceStylePresetId[]];

export const voiceStyleSchema = z.union([
  z.object({ preset: z.enum(PRESET_IDS) }).strict(),
  z.object({ preset: z.literal('custom'), text: z.string().max(MAX_CUSTOM_VOICE_STYLE_CHARS) }).strict(),
]);

/** A stored or typed style, or null when it is not one. */
export function parseVoiceStyle(value: unknown): VoiceStyle | null {
  const parsed = voiceStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Letters, marks, spaces and light punctuation; an apostrophe only inside a
// word ("soldier's"), where it is not a quote mark.
const DISALLOWED = /[^\p{L}\p{M} ,.;!?\-–—']/gu;

/**
 * What the custom-style field keeps as the player types: disallowed
 * characters dropped, capped at the limit, but spaces left alone so typing
 * is not fought. `sanitizeVoiceStyleText` finishes the job.
 */
export function filterVoiceStyleInput(raw: string): string {
  return raw.replace(/\s/g, ' ').replace(DISALLOWED, '').slice(0, MAX_CUSTOM_VOICE_STYLE_CHARS);
}

/** Delivery language only (see the module header), trimmed and capped. */
export function sanitizeVoiceStyleText(raw: string): string {
  return filterVoiceStyleInput(raw)
    .replace(/(^|[^\p{L}])'|'(?![\p{L}])/gu, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.;!?])/g, '$1')
    .replace(/([,.;!?])(?:[ ,.;!?]*[,.;!?])+/g, '$1')
    .replace(/^[\s,.;!?\-–—]+|[\s,.;!?\-–—]+$/gu, '')
    .slice(0, MAX_CUSTOM_VOICE_STYLE_CHARS)
    .trim();
}

/**
 * The manner a style asks the spoken text to carry - or null for "As
 * written" / no style. The prep model's delivery brief is built from this;
 * nothing here ever reaches the TTS input.
 */
export function voiceStyleManner(style: VoiceStyle | null | undefined): string | null {
  if (!style) return null;
  if (style.preset !== 'custom') return VOICE_STYLE_PRESETS.find(p => p.id === style.preset)?.manner ?? null;
  return sanitizeVoiceStyleText(style.text) || null;
}

/** The player-visible name of a style. */
export function voiceStyleLabel(style: VoiceStyle | null | undefined): string {
  if (!style) return VOICE_STYLE_PRESETS[0].label;
  if (style.preset === 'custom') return sanitizeVoiceStyleText(style.text) || VOICE_STYLE_PRESETS[0].label;
  return VOICE_STYLE_PRESETS.find(p => p.id === style.preset)?.label ?? VOICE_STYLE_PRESETS[0].label;
}

/** A cache key for a style: two styles that ask for the same manner share it. */
export function voiceStyleKey(style: VoiceStyle | null | undefined): string {
  return voiceStyleManner(style) ?? 'as-written';
}

/** Resolves a style id from the tuning runner's env: a preset id, or free text. */
export function voiceStyleFromSpec(spec: string | undefined): VoiceStyle | null {
  const trimmed = spec?.trim();
  if (!trimmed) return null;
  const preset = VOICE_STYLE_PRESETS.find(p => p.id === trimmed);
  return preset ? { preset: preset.id } : { preset: 'custom', text: sanitizeVoiceStyleText(trimmed) };
}
