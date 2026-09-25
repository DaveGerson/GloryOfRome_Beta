/**
 * narration/performanceScript.ts
 *
 * The guard between a committed narration and the voice that performs it
 * (DESIGN_DECISIONS.md D4/D5: only text already committed to the player's
 * chat may be voiced).
 *
 * The narrator (ai/tools/narrationVoice.ts, prompts in
 * ai/prompts/narrationPerformance.ts, persona in narration/narrators.ts)
 * sees ONE committed player-visible GM narration and turns it into an
 * ACTED SCRIPT: a dramatically acted retelling, at most two paragraphs,
 * meant to be performed. A script is spoken words plus inline performance
 * cues in `<angle brackets>` - tone shifts, pace, pauses, breaths, sounds
 * (a cackle, a cough, a sigh, the crowd's roar), a quoted speaker's manner:
 *
 *   <a low, bitter laugh> "So the Senate waits..." <a long pause, then quietly> ...
 *
 * The TTS model ACTS the cues and speaks every word outside them, word for
 * word (the owner's reference: gemini-3.8-flash-tts performing a
 * `## Transcript:` with inline `<cues>`). So a cue is performance, never
 * text; and anything outside a cue - a heading, a label, a "Say it
 * gravely:" prefix - would be read aloud, which is why it is packaging to
 * strip (`cleanActedScript`) or a thing the prompt forbids. Square
 * brackets are not our cue syntax: a well-formed `[cue]` is converted to
 * `<cue>` BEFORE validation (`squareCuesToAngle`), so it is checked like
 * any other cue.
 *
 * Rewording is the point; inventing is not. The prompt asks for that; this
 * module ENFORCES what can be enforced, deterministically, before anything
 * reaches the TTS call:
 *
 *  1. Not empty, and not a runaway (<= 400 spoken words / 3000 characters).
 *  2. Every `<cue>` must parse (closed, not nested, not empty), be short
 *     (`MAX_DIRECTION_CHARS`), carry no digits, quote marks or brackets,
 *     and name nobody the passage does not (a capitalized word in a cue must
 *     be in the passage - except a common word opening the cue or one of its
 *     sentences, "<Gravely>", "<... last words. The last word fades>"), and
 *     there may be no wall of them (`maxDirectionsFor`). A cue says HOW,
 *     never WHAT: the cue channel cannot smuggle content - and cues are
 *     player-visible, in the narration log.
 *  3. FIDELITY: the retelling may not bring in a name or a figure the
 *     passage never mentioned (see "Patching" below for what happens when
 *     it does). Every capitalized word mid-sentence (a
 *     proper-noun candidate: a person, place, title, numeral) must appear
 *     in the passage, in the listener's own name or position, or among a
 *     few forms of address every Roman narrator may use ("Dominus",
 *     "Caesar", "Rome", "the Senate"). Every number written in digits must
 *     appear in the passage. "The heir is hidden in Emesa" is refused when
 *     the passage never spoke of Emesa - the narrator can interpret the
 *     week, never manufacture intelligence about it. Cue text is not
 *     spoken, so this rule reads the spoken words only (rule 2 covers cues).
 *  4. The whole script, and each cue on its own, passes the same
 *     hidden-mechanics gate every player-visible text passes
 *     (ai/core/playerBoundary.ts). Checked before 3, so a fidelity verdict
 *     means every other rule held.
 *
 * Known limit of 3: a new name that only ever opens a sentence reads like
 * any sentence-initial word and is not caught, and numbers spelled out in
 * words are not compared. The prompt's fidelity rule covers those; the
 * tuning harness (narration/tuning/) reports refusals verbatim so a
 * narrator can be tuned against them.
 *
 * Patching (rule 3 only, deterministic, zero tokens): a retelling that
 * breaks the fidelity rule is not refused wholesale. It is split into
 * sentences (`splitSpokenSentences`, which never splits inside a quotation
 * or inside a cue), every sentence that brings in a name or a figure is
 * cut, and the rest is voiced; `patchedOut` records each cut sentence
 * verbatim. A cue belongs to the sentence it opens or sits inside, so a cut
 * sentence takes its cues with it. Only when nothing
 * is left, or when more than half of the sentences - or of the words - had
 * to go, does the retelling fall back (`MAX_PATCHED_SHARE`). Rules 1, 2 and
 * 4 still refuse wholesale: a runaway, a smuggling direction or a mechanics
 * leak says the whole script is untrustworthy, not one sentence of it.
 *
 * Any refusal falls back to the plain narration cleaned for speech, opened
 * by one cue so even the fallback is performed (`fallbackTranscript`,
 * `FALLBACK_DIRECTION`) - the voice is a garnish, so a refused script
 * costs drama, never correctness.
 *
 * Angle brackets in the ORIGINAL text would be indistinguishable from
 * cues, so `speakableText` turns them into single guillemets first;
 * it also drops `**bold**` markers, which are formatting, not words. That
 * speakable form is what the narrator is shown and what it is checked
 * against.
 */

import { assertPlayerVisibleTextSafe } from '../ai/core/playerBoundary';

/** Longest single cue accepted, in characters (brackets excluded). */
export const MAX_DIRECTION_CHARS = 160;

/**
 * The one cue that opens a fallback transcript, so the plain narration is
 * still performed rather than read flat. Ours, never validated; shown in the
 * narration log (veto queue: roadmaps/BACKLOG.md B13).
 */
export const FALLBACK_DIRECTION = 'grave, measured, dramatic storyteller';

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

/** The packaging a model may wrap a script in: code fences, markdown headings ("## Transcript:"), speaker labels, bold markers. */
function stripPackaging(transcript: string): string {
  return transcript
    .replace(/^```[a-z]*\s*\n?/gim, '')
    .replace(/\n?```\s*$/gim, '')
    .replace(/^#+\s*(?:Transcript:?|[^\n]*)\n+/gim, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^(?:Narrator|Storyteller|Bard|Speaker)\s*:\s*/gim, '')
    .replace(/\*\*/g, '');
}

function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Square brackets are not our cue syntax. A well-formed `[cue]` (closed, on
 * one line, holding no other bracket) becomes `<cue>`, so the guard checks
 * it exactly like any cue; anything else is left for the guard to judge.
 */
export function squareCuesToAngle(transcript: string): string {
  return transcript.replace(/\[([^[\]<>\n]+)\]/g, '<$1>');
}

/**
 * The words alone: packaging stripped AND every `<...>` / `[...]` cue
 * removed. For text that is performed without cues - the Imperial
 * Dispatch's briefing - and for reading a script's spoken part.
 */
export function cleanSpokenTranscript(transcript: string): string {
  return tidyWhitespace(stripPackaging(transcript)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' '));
}

/**
 * The acted script as the TTS model performs it: packaging stripped (code
 * fences, markdown headings, speaker labels, bold markers), a `[cue]`
 * turned into a `<cue>`, any stray square bracket dropped, whitespace tidied
 * - and every `<cue>` KEPT, verbatim. Everything left outside a cue is
 * spoken.
 */
export function cleanActedScript(transcript: string): string {
  return tidyWhitespace(squareCuesToAngle(stripPackaging(transcript)).replace(/[[\]]/g, ' '));
}

/** A script's cues, in order (none for plain text). */
export function cuesIn(script: string): string[] {
  return [...script.matchAll(/<([^<>]*)>/g)].map(match => match[1].trim()).filter(Boolean);
}

/** A script's spoken part: every cue replaced by a space. */
export function spokenPartOf(script: string): string {
  return script.replace(/<[^<>]*>/g, ' ');
}

/**
 * The narration as the voice may speak it: `**bold**` markers dropped,
 * angle brackets turned into single guillemets so they can never read as
 * directions. Everything else is untouched.
 */
export function speakableText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/</g, '‹').replace(/>/g, '›').trim();
}

/**
 * The plain narration cleaned for speech, opened by the one fallback cue
 * (`FALLBACK_DIRECTION`) so it is still performed. Never validated - it is
 * ours.
 */
export function fallbackTranscript(text: string): string {
  const words = cleanSpokenTranscript(speakableText(text));
  return words ? `<${FALLBACK_DIRECTION}> ${words}` : '';
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
 * order. Cues are not spoken, so they are ignored; whitespace (including
 * the gap a removed cue leaves) and quote style are normalized away; word
 * boundaries are not - "an other" is not "another".
 */
export function spokenTokens(text: string): string[] {
  return normalizeQuotes(spokenPartOf(text)).match(TOKEN_PATTERN) ?? [];
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

/**
 * Common words a cue may open with (or open one of its sentences with)
 * capitalized, though the passage never has them: "<The last word fades>",
 * "<Then, quietly>". A name is never on this list.
 */
const COMMON_CUE_OPENERS = new Set([
  'a', 'an', 'the', 'then', 'with', 'as', 'and', 'but', 'now', 'still', 'almost', 'very', 'in', 'on', 'at',
  'after', 'before', 'while', 'his', 'her', 'their', 'they', 'he', 'she', 'it', 'this', 'that', 'said',
  'spoken', 'slow', 'low', 'long', 'soft', 'hushed', 'quiet', 'grave', 'cold', 'dry', 'pause',
  'beat', 'breath', 'silence', 'laughing', 'sighing', 'coughing', 'whispering', 'whispered', 'barely',
]);

/**
 * Words in a cue that carry a capital letter - the proper-noun candidates.
 * A word that opens the cue, or one of its sentences, is exempt when it is
 * a common word: on `COMMON_CUE_OPENERS`, an "-ly" adverb ("Gravely",
 * "Bitterly"), or a word the script itself uses in lower case. "<Philip
 * whispers>" is still caught: "philip" is none of those.
 */
function capitalizedWords(direction: string, lowerCaseWords: ReadonlySet<string>): string[] {
  const text = normalizeQuotes(direction);
  const found: string[] = [];
  for (const match of text.matchAll(/[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*/gu)) {
    const word = match[0];
    if (!/\p{Lu}/u.test(word)) continue;
    const before = text.slice(0, match.index ?? 0).trimEnd();
    const opens = before === '' || /[.!?;:…]$/.test(before);
    const lower = word.toLowerCase();
    const common = COMMON_CUE_OPENERS.has(lower) || (lower.length >= 6 && lower.endsWith('ly')) || lowerCaseWords.has(lower);
    if (opens && common && /^\p{Lu}\p{Ll}*$/u.test(word)) continue;
    found.push(word);
  }
  return found;
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
 * introduces that the passage never mentioned, if any. Reads the spoken
 * words only: cues are ignored here (rule 2 checks them).
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

  const text = normalizeQuotes(spokenPartOf(spoken));
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
    // Words the script and the passage use in lower case: a cue may open with one capitalized.
    const lowerCaseWords = new Set(
      [speakableText(original), transcript].join(' ').match(/(?<![\p{L}\p{M}'])\p{Ll}[\p{Ll}\p{M}]*/gu) ?? [],
    );
    for (const direction of directions) {
      if (direction.length > MAX_DIRECTION_CHARS) return { ok: false, reason: 'direction_too_long' };
      if (/\p{N}/u.test(direction)) return { ok: false, reason: 'direction_has_digits' };
      if (!DIRECTION_CHARACTERS.test(direction)) return { ok: false, reason: 'direction_has_forbidden_characters' };
      const smuggled = capitalizedWords(direction, lowerCaseWords).some(word =>
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

  // Fidelity last, so an `introduces_*` verdict means every other rule held -
  // which is what lets `performedTranscriptFor` patch instead of refuse.
  const introduced = findIntroducedContent(original, spoken, allowedNames);
  if (introduced) return { ok: false, reason: introduced.kind === 'name' ? 'introduces_new_name' : 'introduces_new_number' };
  return { ok: true };
}

/**
 * The most of a retelling the fidelity patch may cut, as a share of its
 * sentences and, separately, of its words. Cutting more than this leaves a
 * retelling that is mostly holes: the plain narration is the better reading.
 */
export const MAX_PATCHED_SHARE = 0.5;

const SENTENCE_END = '.!?…';
const CLOSERS = '"\'”’)]›»';

/**
 * Splits spoken text into sentences, each keeping the whitespace that
 * follows it, so joining the pieces gives the text back exactly. A sentence
 * ends at `.`, `!`, `?` or `…` (plus any closing quotes or brackets) before
 * whitespace and a word that is not lower-case, and at every line break - but never inside a quotation: a
 * quoted speech that holds several sentences stays with the sentence that
 * quotes it. Straight double quotes toggle; curly ones open and close.
 * Apostrophes are not quotes. A `<cue>` is opaque: its full stops end
 * nothing, and a cue after a sentence's end opens the next sentence (so a
 * cue belongs to the sentence it opens or sits inside). A trailing piece
 * that holds only cues joins the sentence before it.
 */
export function splitSpokenSentences(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let inQuote = false;
  let i = 0;
  const hasSpoken = (piece: string) => spokenPartOf(piece).trim() !== '';
  const cut = (end: number) => {
    let next = end;
    while (next < text.length && /\s/.test(text[next])) next++;
    if (hasSpoken(text.slice(start, end))) pieces.push(text.slice(start, next));
    else if (pieces.length > 0) pieces[pieces.length - 1] += text.slice(start, next);
    start = next;
    return next;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '<') {
      const close = text.indexOf('>', i + 1);
      if (close !== -1 && !text.slice(i + 1, close).includes('\n')) {
        i = close + 1;
        continue;
      }
    }
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === '“') {
      inQuote = true;
    } else if (ch === '”') {
      inQuote = false;
    }
    if (ch === '\n') {
      inQuote = false;
      i = cut(i);
      continue;
    }
    if (!inQuote && SENTENCE_END.includes(ch)) {
      let end = i + 1;
      while (end < text.length && (SENTENCE_END.includes(text[end]) || CLOSERS.includes(text[end]))) {
        if (text[end] === '"' || text[end] === '”') break;
        end++;
      }
      // "Nothing stirs… yet." - a lower-case word after the stop carries on the sentence.
      let after = end;
      while (after < text.length && text[after] !== '\n' && /\s/.test(text[after])) after++;
      if (end >= text.length || (/\s/.test(text[end]) && !/\p{Ll}/u.test(text[after] ?? ''))) {
        i = cut(end);
        continue;
      }
    }
    // A closing quote after sentence punctuation ends the sentence when the
    // next word opens a new one ('..."To the legions!" The Senate waits.').
    if ((ch === '"' || ch === '”') && !inQuote && i > 0 && SENTENCE_END.includes(text[i - 1])) {
      let next = i + 1;
      while (next < text.length && text[next] !== '\n' && /\s/.test(text[next])) next++;
      if (next >= text.length || (next > i + 1 && /\p{Lu}/u.test(text[next]))) {
        i = cut(i + 1);
        continue;
      }
    }
    i++;
  }
  if (start < text.length) {
    if (hasSpoken(text.slice(start)) || pieces.length === 0) pieces.push(text.slice(start));
    else if (pieces.length > 0) pieces[pieces.length - 1] += text.slice(start);
  }
  return pieces;
}

/** Spoken words in a text (cues ignored: `spokenTokens` skips them). */
function wordsIn(text: string): number {
  return spokenTokens(text).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

export interface FidelityPatch {
  /** The script with every unsupported sentence (and its cues) cut. */
  kept: string;
  /** Each cut sentence, trimmed, in order, verbatim (its cues included). */
  patchedOut: string[];
  /** The first name or figure that forced a cut, when any did. */
  firstIntroduced: { kind: 'name' | 'number'; value: string } | null;
  /** Whether the cut went too deep to voice what is left (see `MAX_PATCHED_SHARE`). */
  tooMuchCut: boolean;
}

/**
 * The fidelity patch (see the module header): cuts every sentence of
 * `spoken` - a script, cues and all - that brings in a name or a figure
 * `original` never mentioned, checking each sentence's spoken words exactly
 * as `findIntroducedContent` checks a whole retelling. A cut sentence takes
 * its cues with it; the kept ones keep theirs. Allowed names (the listener,
 * forms of address) are never cut.
 */
export function patchIntroducedContent(
  original: string,
  spoken: string,
  allowedNames: readonly string[] = [],
): FidelityPatch {
  const sentences = splitSpokenSentences(spoken);
  const keptPieces: string[] = [];
  const patchedOut: string[] = [];
  let firstIntroduced: FidelityPatch['firstIntroduced'] = null;
  let cutWords = 0;
  for (const sentence of sentences) {
    const introduced = findIntroducedContent(original, sentence, allowedNames);
    if (!introduced) {
      keptPieces.push(sentence);
      continue;
    }
    firstIntroduced ??= introduced;
    patchedOut.push(sentence.trim());
    cutWords += wordsIn(sentence);
    // A cut sentence that closed a paragraph hands its break to the one before.
    const gap = sentence.slice(sentence.trimEnd().length);
    if (gap.includes('\n') && keptPieces.length > 0) {
      const last = keptPieces[keptPieces.length - 1];
      keptPieces[keptPieces.length - 1] = last.trimEnd() + gap;
    }
  }
  const kept = keptPieces.join('').trim();
  const totalWords = wordsIn(spoken);
  const tooMuchCut = patchedOut.length > 0 && (
    !spokenPartOf(kept).trim()
    || patchedOut.length > sentences.length * MAX_PATCHED_SHARE
    || cutWords > totalWords * MAX_PATCHED_SHARE
  );
  return { kept, patchedOut, firstIntroduced, tooMuchCut };
}

export interface PerformedTranscript {
  transcript: string;
  usedFallback: boolean;
  /** Why the director's script was refused, when it was. */
  rejection?: PerformanceRejection;
  /**
   * Sentences of the retelling the fidelity patch cut before voicing it, one
   * entry each, verbatim. Empty when nothing was cut - and when the whole
   * retelling fell back, since then none of it is voiced.
   */
  patchedOut: string[];
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

/**
 * The narrator's acted script if it validates - patched when it brought in
 * a name or a figure, as long as the patch leaves most of it standing -
 * otherwise the fallback. An accepted script keeps its `<cues>`: the
 * transcript is exactly what the voice performs (`cleanActedScript`). A
 * `[cue]` is turned into a `<cue>` before validation, so it is checked like
 * any other.
 */
export function performedTranscriptFor(
  original: string,
  directorOutput: string | null,
  allowedNames: readonly string[] = [],
): PerformedTranscript {
  const fallback = (rejection?: PerformanceRejection): PerformedTranscript => ({
    transcript: fallbackTranscript(original),
    usedFallback: true,
    ...(rejection ? { rejection } : {}),
    patchedOut: [],
  });
  if (directorOutput === null) return fallback();
  const candidate = squareCuesToAngle(unwrapDirectorOutput(directorOutput));
  const verdict = validatePerformance(original, candidate, allowedNames);
  if (verdict.ok) return { transcript: cleanActedScript(candidate), usedFallback: false, patchedOut: [] };
  if (verdict.reason !== 'introduces_new_name' && verdict.reason !== 'introduces_new_number') return fallback(verdict.reason);

  // Only fidelity failed (every other rule is checked first, so the script
  // parses and every cue passed): patch it, cues travelling with their sentences.
  const patch = patchIntroducedContent(original, candidate, allowedNames);
  if (patch.tooMuchCut || !patch.kept || !spokenPartOf(patch.kept).trim()) return fallback(verdict.reason);
  // The mechanics gate already passed on the whole script; the patched text
  // is a subset of it, so it passes too.
  return { transcript: cleanActedScript(patch.kept), usedFallback: false, patchedOut: patch.patchedOut };
}
