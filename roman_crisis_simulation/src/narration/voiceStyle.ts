/**
 * narration/voiceStyle.ts
 *
 * The narration voice's delivery style: an optional, natural-language
 * instruction set in front of the transcript on the text-to-speech input,
 * in the Gemini TTS convention of a short instruction ending in a colon -
 * `Say in a composed newsreader's voice: <transcript>`.
 *
 * CAVEAT (why "As written" is the default and every style is opt-in): PR #9
 * found that the TTS model can read instructions aloud instead of following
 * them. The prefix is therefore built in exactly one place
 * (`voiceStylePrefix`), kept to a single short clause, and never sent unless
 * the player chose a style. Audition any style with a real key before
 * relying on it:
 *
 *   GEMINI_API_KEY=... GOR_NARRATOR_AUDIO=1 GOR_NARRATOR_STYLE=newsreader npm run narrator:tune
 *
 * (`GOR_NARRATOR_STYLE` takes a preset id or free text, which is sanitized
 * exactly as a player's custom style is.) If the voice speaks the prefix,
 * the fix is here, not in a narrator.
 *
 * A custom style is player-typed text that reaches the TTS model, so it is
 * sanitized to delivery language only - letters, spaces and light
 * punctuation; no digits, quote marks, brackets or colons - and capped at
 * `MAX_CUSTOM_VOICE_STYLE_CHARS`. It carries no game content.
 */

import { z } from 'zod';

export const MAX_CUSTOM_VOICE_STYLE_CHARS = 80;

export type VoiceStylePresetId = 'as-written' | 'tragedian' | 'newsreader' | 'conspiratorial' | 'old-soldier';

/** A chosen delivery: a preset, or the player's own words. */
export type VoiceStyle =
  | { preset: VoiceStylePresetId }
  | { preset: 'custom'; text: string };

/** Player-visible labels are veto-queue copy (roadmaps/BACKLOG.md B13). */
export const VOICE_STYLE_PRESETS: readonly { id: VoiceStylePresetId; label: string; instruction: string | null }[] = [
  { id: 'as-written', label: 'As written', instruction: null },
  { id: 'tragedian', label: 'Epic stage tragedian', instruction: 'Say in the grand, resonant voice of an epic stage tragedian' },
  { id: 'newsreader', label: 'Composed newsreader', instruction: "Say in a composed newsreader's voice" },
  { id: 'conspiratorial', label: 'Hushed and conspiratorial', instruction: 'Say in a hushed, conspiratorial voice' },
  { id: 'old-soldier', label: 'Weary old soldier', instruction: 'Say in the weary voice of an old soldier' },
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

const INSTRUCTION_VERB = /^(?:say|read|speak|whisper|tell|narrate|recite|declaim|deliver)\b/i;
const MANNER_WORD = /^(?:in|like|as|with)\b/i;

/** The instruction a style sends, without its colon - or null for none. */
export function voiceStyleInstruction(style: VoiceStyle | null | undefined): string | null {
  if (!style) return null;
  if (style.preset !== 'custom') return VOICE_STYLE_PRESETS.find(p => p.id === style.preset)?.instruction ?? null;
  const text = sanitizeVoiceStyleText(style.text);
  if (!text) return null;
  if (INSTRUCTION_VERB.test(text)) return text.charAt(0).toUpperCase() + text.slice(1);
  if (MANNER_WORD.test(text)) return `Say ${text}`;
  return `Say, ${text}`;
}

/**
 * The one place the TTS style prefix is built: `"<instruction>: "`, or the
 * empty string for "As written" / no style. See the caveat above.
 */
export function voiceStylePrefix(style: VoiceStyle | null | undefined): string {
  const instruction = voiceStyleInstruction(style);
  return instruction ? `${instruction}: ` : '';
}

/** The player-visible name of a style. */
export function voiceStyleLabel(style: VoiceStyle | null | undefined): string {
  if (!style) return VOICE_STYLE_PRESETS[0].label;
  if (style.preset === 'custom') return sanitizeVoiceStyleText(style.text) || VOICE_STYLE_PRESETS[0].label;
  return VOICE_STYLE_PRESETS.find(p => p.id === style.preset)?.label ?? VOICE_STYLE_PRESETS[0].label;
}

/** A cache key for a style: two styles that send the same prefix share it. */
export function voiceStyleKey(style: VoiceStyle | null | undefined): string {
  return voiceStyleInstruction(style) ?? 'as-written';
}

/** Resolves a style id from the tuning runner's env: a preset id, or free text. */
export function voiceStyleFromSpec(spec: string | undefined): VoiceStyle | null {
  const trimmed = spec?.trim();
  if (!trimmed) return null;
  const preset = VOICE_STYLE_PRESETS.find(p => p.id === trimmed);
  return preset ? { preset: preset.id } : { preset: 'custom', text: sanitizeVoiceStyleText(trimmed) };
}
