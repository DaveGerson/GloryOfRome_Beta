/**
 * narration/performanceScript.ts
 *
 * The guard between a committed narration and the voice that performs it
 * (DESIGN_DECISIONS.md D4/D5: only text already committed to the player's
 * chat may be voiced).
 *
 * The narrator (ai/tools/narrationVoice.ts, prompts in
 * ai/prompts/narrationPerformance.ts, persona in narration/narrators.ts)
 * sees ONE committed player-visible GM narration and retells it for the
 * ear - reworded, heightened, addressed to the player, at most two
 * paragraphs. Rewording is the point; inventing is not. The prompt asks
 * for that; this module ENFORCES what can be enforced, deterministically,
 * before anything reaches the TTS call:
 *
 *  1. Not empty, and not a runaway (<= 400 words / 3000 characters).
 *  2. Any `<...>` direction must parse (closed, not nested, not empty), be
 *     short, carry no digits, quote marks or brackets, and name nobody the
 *     passage does not - the direction channel cannot smuggle content.
 *  3. FIDELITY: the retelling may not bring in a name or a figure the
 *     passage never mentioned. Every capitalized word mid-sentence (a
 *     proper-noun candidate: a person, place, title, numeral) must appear
 *     in the passage, in the listener's own name or position, or among a
 *     few forms of address every Roman narrator may use ("Dominus",
 *     "Caesar", "Rome", "the Senate"). Every number written in digits must
 *     appear in the passage. "The heir is hidden in Emesa" is refused when
 *     the passage never spoke of Emesa - the narrator can interpret the
 *     week, never manufacture intelligence about it.
 *  4. The whole transcript passes the same hidden-mechanics gate every
 *     player-visible text passes (ai/core/playerBoundary.ts).
 *
 * Known limit of 3: a new name that only ever opens a sentence reads like
 * any sentence-initial word and is not caught, and numbers spelled out in
 * words are not compared. The prompt's fidelity rule covers those; the
 * tuning harness (narration/tuning/) reports refusals verbatim so a
 * narrator can be tuned against them.
 *
 * Any failure falls back to the plain narration cleaned for speech
 * (`fallbackTranscript`) - the voice is a garnish, so a refused script
 * costs drama, never correctness.
 *
 * Angle brackets in the ORIGINAL text would be indistinguishable from
 * directions, so `speakableText` turns them into single guillemets first;
 * it also drops `**bold**` markers, which are formatting, not words. That
 * speakable form is what the narrator is shown and what it is checked
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
  | 'too_long'
  | 'introduces_new_name'
  | 'introduces_new_number';

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
 * Forms of address and institutions any narrator of this Rome may speak
 * without the passage naming them first. Deliberately short: every entry
 * is a word the fidelity check can no longer catch being invented.
 */
const ALWAYS_SPEAKABLE_WORDS = [
  'I', 'Rome', 'Roman', 'Romans', 'Senate', 'Senator', 'Senatorial', 'Emperor', 'Empire', 'Imperial',
  'Caesar', 'Dominus', 'Domine', 'Princeps', 'Augustus', 'Imperator', 'Gods', 'God', 'Fortune',
];

const WORD_PATTERN = /[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*/gu;
const NUMBER_PATTERN = /\p{N}(?:[\p{N},.]*\p{N})?/gu;

/** The comparison form of a word: lower-case, possessive and plural endings off ("Praetorians'" ~ "praetorian"). */
function nameKey(word: string): string {
  const lower = word.toLowerCase().replace(/'s$/, '').replace(/'$/, '');
  return lower.length > 3 && lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

/** The allowlist in comparison form (so "Dominus" and "Augustus" survive the plural rule). */
const ALWAYS_SPEAKABLE = new Set(ALWAYS_SPEAKABLE_WORDS.map(nameKey));

function numberKey(figure: string): string {
  return figure.replace(/,/g, '').replace(/\.$/, '');
}

/**
 * Whether the word at `index` opens a sentence (or a quotation): reading
 * backwards over spaces, opening quotes and brackets, the text starts, or a
 * line breaks, or sentence punctuation stands - or a quote or bracket was
 * crossed, since a word right after one opens quoted speech.
 */
function opensSentence(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '\n') return true;
    if (ch === '"' || ch === "'" || ch === '(' || ch === '[' || ch === '‹') return true;
    if (/\s/.test(ch)) continue;
    return '.!?:;…'.includes(ch);
  }
  return true;
}

/**
 * The fidelity check (rule 3 above): the first word or figure the retelling
 * introduces that the passage never mentioned, if any.
 */
export function findIntroducedContent(
  original: string,
  spoken: string,
  allowedNames: readonly string[] = [],
): { kind: 'name' | 'number'; value: string } | null {
  const source = normalizeQuotes(speakableText(original));
  const known = new Set<string>();
  for (const word of [source, ...allowedNames].join(' ').match(WORD_PATTERN) ?? []) known.add(nameKey(normalizeQuotes(word)));
  const knownNumbers = new Set((source.match(NUMBER_PATTERN) ?? []).map(numberKey));

  const text = normalizeQuotes(spoken);
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0];
    if (!/^\p{Lu}/u.test(word)) continue;
    if (opensSentence(text, match.index ?? 0)) continue;
    const key = nameKey(word);
    if (!known.has(key) && !ALWAYS_SPEAKABLE.has(key)) return { kind: 'name', value: word };
  }
  for (const figure of text.match(NUMBER_PATTERN) ?? []) {
    if (!knownNumbers.has(numberKey(figure))) return { kind: 'number', value: figure };
  }
  return null;
}

/**
 * Validates a narrator's retelling of `original` (rules 1-4 in the module
 * header). `allowedNames` is the listener's own name and position - words
 * the narrator may use to address them though the passage never does.
 * Word-for-word parity is NOT required: a retelling may reword freely.
 */
export function validatePerformance(
  original: string,
  transcript: string,
  allowedNames: readonly string[] = [],
): PerformanceValidation {
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

  const introduced = findIntroducedContent(original, spoken, allowedNames);
  if (introduced) return { ok: false, reason: introduced.kind === 'name' ? 'introduces_new_name' : 'introduces_new_number' };

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

/** The narrator's script if it validates, otherwise the fallback. */
export function performedTranscriptFor(
  original: string,
  directorOutput: string | null,
  allowedNames: readonly string[] = [],
): PerformedTranscript {
  if (directorOutput === null) {
    return { transcript: fallbackTranscript(original), usedFallback: true };
  }
  const candidate = unwrapDirectorOutput(directorOutput);
  const verdict = validatePerformance(original, candidate, allowedNames);
  if (verdict.ok) return { transcript: cleanSpokenTranscript(candidate), usedFallback: false };
  return { transcript: fallbackTranscript(original), usedFallback: true, rejection: verdict.reason };
}
