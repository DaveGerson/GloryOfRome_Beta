/**
 * narration/performanceScript.ts
 *
 * The privacy guard between a committed narration and the voice that
 * performs it (DESIGN_DECISIONS.md D4/D5: only text already committed to
 * the player's chat may be voiced).
 *
 * The "director" (ai/tools/narrationVoice.ts, prompt in
 * ai/prompts/narrationPerformance.ts) sees ONE committed player-visible GM
 * narration and may only insert `<...>` delivery directions into it - tone,
 * pacing, pauses, sighs, crowd murmurs, emphasis. It must never add,
 * remove or change a spoken word. The prompt asks for that; this module
 * ENFORCES it, deterministically, before anything reaches the TTS call:
 *
 *  1. The transcript must parse: every `<` closed by a `>`, no nesting, no
 *     stray `>`, no empty `<>`.
 *  2. With every direction removed, the spoken tokens (words and
 *     punctuation, after normalizing whitespace and quote styles) must
 *     equal the original's, in order. One inserted, dropped or altered
 *     word - or number - and the whole script is refused.
 *  3. Each direction must be short (<= MAX_DIRECTION_CHARS), carry no
 *     digits, no quote marks or brackets, and no capitalized word (a
 *     proper-noun candidate) that the original does not already contain.
 *     That shuts the direction channel as a way to smuggle in content: a
 *     name, a date, a sum, a line of dialogue.
 *  4. There may not be more directions than the passage can plausibly use.
 *  5. The whole transcript passes the same hidden-mechanics gate every
 *     player-visible text passes (ai/core/playerBoundary.ts).
 *
 * Any failure falls back to the plain narration under one generic
 * direction (`fallbackTranscript`) - the voice is a garnish, so a refused
 * script costs drama, never correctness.
 *
 * Angle brackets in the ORIGINAL text would be indistinguishable from
 * directions, so `speakableText` turns them into single guillemets first;
 * it also drops `**bold**` markers, which are formatting, not words. That
 * speakable form is what the director is shown and what it is checked
 * against.
 */

import { assertPlayerVisibleTextSafe } from '../ai/core/playerBoundary';

/** Longest single direction accepted, in characters (brackets excluded). */
export const MAX_DIRECTION_CHARS = 160;

/** The one direction label associated with default narrator styling. */
export const FALLBACK_DIRECTION = 'dramatic Roman storyteller';

export type PerformanceRejection =
  | 'empty'
  | 'unbalanced_brackets'
  | 'nested_brackets'
  | 'empty_direction'
  | 'direction_too_long'
  | 'direction_has_digits'
  | 'direction_has_forbidden_characters'
  | 'direction_has_proper_noun'
  | 'too_many_directions'
  | 'spoken_words_changed'
  | 'mechanics_leak'
  | 'too_long';

export type PerformanceValidation = { ok: true } | { ok: false; reason: PerformanceRejection };

/**
 * Strips code fences, markdown headings, speaker prefixes, delivery directions
 * in angle brackets or square brackets, bold markers, and excess whitespace,
 * returning pure natural spoken prose ready for TTS.
 */
export function cleanSpokenTranscript(transcript: string): string {
  return transcript
    .replace(/^```[a-z]*\s*\n?/gim, '')
    .replace(/\n?```\s*$/gim, '')
    .replace(/^#+\s*(?:Transcript:?|[^\n]*)\n+/gim, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^(?:Narrator|Storyteller|Bard|Speaker)\s*:\s*/gim, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The narration as the voice may speak it: `**bold**` markers dropped,
 * angle brackets turned into single guillemets so they can never read as
 * directions. Everything else is untouched.
 */
export function speakableText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/</g, '‹').replace(/>/g, '›').trim();
}

/** The plain narration cleaned for speech. Never validated - it is ours. */
export function fallbackTranscript(text: string): string {
  return cleanSpokenTranscript(speakableText(text));
}

/** Curly, low and prime quote marks fold to their straight forms. */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‘’‚‛′]/g, "'");
}

// A word (letters/digits/marks, with inner apostrophes: "Rome's", "don't"),
// or any single non-space character standing alone (punctuation).
const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+(?:'[\p{L}\p{N}\p{M}]+)*|\S/gu;

/**
 * The comparison form of spoken text: its word and punctuation tokens in
 * order. Whitespace (including the gap a removed direction leaves) and
 * quote style are normalized away; word boundaries are not - "an other"
 * is not "another".
 */
export function spokenTokens(text: string): string[] {
  return normalizeQuotes(text).match(TOKEN_PATTERN) ?? [];
}

interface ParsedTranscript {
  spoken: string;
  directions: string[];
}

/** Splits a transcript into its spoken text and its directions, or says why it cannot. */
export function parseTranscript(transcript: string): { ok: true; value: ParsedTranscript } | { ok: false; reason: PerformanceRejection } {
  let spoken = '';
  const directions: string[] = [];
  let open: number | null = null;
  for (let i = 0; i < transcript.length; i++) {
    const ch = transcript[i];
    if (ch === '<') {
      if (open !== null) return { ok: false, reason: 'nested_brackets' };
      open = i;
    } else if (ch === '>') {
      if (open === null) return { ok: false, reason: 'unbalanced_brackets' };
      const direction = transcript.slice(open + 1, i).trim();
      if (!direction) return { ok: false, reason: 'empty_direction' };
      directions.push(direction);
      spoken += ' ';
      open = null;
    } else if (open === null) {
      spoken += ch;
    }
  }
  if (open !== null) return { ok: false, reason: 'unbalanced_brackets' };
  return { ok: true, value: { spoken, directions } };
}

// Delivery language only: letters, spaces and light punctuation. No digits
// (checked first, for a clearer reason), no quote marks, no brackets.
const DIRECTION_CHARACTERS = /^[\p{L}\p{M}\s,.;:!?'’\-–—…]+$/u;

/** Words in a direction that carry a capital letter - the proper-noun candidates. */
function capitalizedWords(direction: string): string[] {
  return (normalizeQuotes(direction).match(/[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*/gu) ?? [])
    .filter(word => /\p{Lu}/u.test(word));
}

/** Plenty for a performed reading (about one per sentence); a wall of them is not a performance. */
function maxDirectionsFor(wordCount: number): number {
  return 2 + Math.floor(wordCount / 5);
}

/**
 * Validates a dramatic narrator's transcript. Ensures non-empty content,
 * safe player boundaries (no hidden mechanics leaked), balanced brackets,
 * no smuggled proper nouns/digits in directions, and reasonable length.
 * Does not require word-for-word parity with original, allowing dramatic
 * adaptation in 1-2 powerful paragraphs.
 */
export function validatePerformance(original: string, transcript: string): PerformanceValidation {
  if (!transcript.trim()) return { ok: false, reason: 'empty' };
  const parsed = parseTranscript(transcript);
  if (!parsed.ok) return parsed;
  const { spoken, directions } = parsed.value;

  if (!spoken.trim()) return { ok: false, reason: 'empty' };

  const wordCount = spokenTokens(spoken).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
  // Maximum length for 1-2 paragraphs of dramatic audio (~400 words / 3000 chars)
  if (wordCount > 400 || spoken.length > 3000) {
    return { ok: false, reason: 'too_long' };
  }

  if (directions.length > 0) {
    if (directions.length > maxDirectionsFor(wordCount)) return { ok: false, reason: 'too_many_directions' };

    const originalWords = new Set(spokenTokens(speakableText(original)));
    for (const direction of directions) {
      if (direction.length > MAX_DIRECTION_CHARS) return { ok: false, reason: 'direction_too_long' };
      if (/\p{N}/u.test(direction)) return { ok: false, reason: 'direction_has_digits' };
      if (!DIRECTION_CHARACTERS.test(direction)) return { ok: false, reason: 'direction_has_forbidden_characters' };
      const smuggled = capitalizedWords(direction).some(word =>
        !originalWords.has(word) && !originalWords.has(word.replace(/'s$/, ''))
      );
      if (smuggled) return { ok: false, reason: 'direction_has_proper_noun' };
    }
  }

  // The whole transcript, and each direction on its own (a bare "partial
  // success" is only a standalone verdict when read by itself).
  try {
    assertPlayerVisibleTextSafe(transcript);
    directions.forEach(assertPlayerVisibleTextSafe);
  } catch {
    return { ok: false, reason: 'mechanics_leak' };
  }
  return { ok: true };
}

export interface PerformedTranscript {
  transcript: string;
  usedFallback: boolean;
  /** Why the director's script was refused, when it was. */
  rejection?: PerformanceRejection;
}

/**
 * The narrator's raw output, lightly unwrapped (stripping code fences,
 * markdown headings, or speaker prefixes).
 */
export function unwrapDirectorOutput(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^#+\s*(?:Transcript:?|[^\n]*)\n+/i, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^(?:Narrator|Storyteller|Bard|Speaker)\s*:\s*/i, '')
    .trim();
}

/** The dramatic narrator's script if it validates, otherwise the fallback. */
export function performedTranscriptFor(original: string, directorOutput: string | null): PerformedTranscript {
  if (directorOutput === null) {
    return { transcript: fallbackTranscript(original), usedFallback: true };
  }
  const candidate = unwrapDirectorOutput(directorOutput);
  const verdict = validatePerformance(original, candidate);
  if (verdict.ok) return { transcript: cleanSpokenTranscript(candidate), usedFallback: false };
  return { transcript: fallbackTranscript(original), usedFallback: true, rejection: verdict.reason };
}
