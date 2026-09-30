/**
 * ai/core/composure.ts
 *
 * Composure (DESIGN_DECISIONS.md D50): whether a character can keep an
 * INWARD mark (D48, ./conditions.ts) or a SECRET tie (D49, ./affiliations.ts)
 * from showing in one scene. "Roll, then model": a hidden composure roll
 * decides WHETHER a subject can show at all this scene - one of three tiers,
 * `ComposureTier` in types.ts - and the model decides how and when the tell
 * appears within that.
 *
 *  - holds:  it shows only if the bearer chooses to confide it;
 *  - frays:  a small tell escapes when the talk touches it, its cause unnamed;
 *  - breaks: it shows through plainly whatever is said, still without the
 *            full account.
 *
 * Outward marks and openly professed ties are not subjects: anyone can see
 * them already (D48/D49), so they may colour a scene and a voice freely.
 *
 * One home for the rules, as ./conditions.ts is for marks: the roll (pure
 * over an injected generator, in the style of ./resolution.ts), the fixed
 * instruction each tier gives a model, the lines CODE writes for what an NPC
 * sees of the player's own composure (never the model), the screen every
 * model-authored tell passes before a player surface takes it, and the
 * defensive readers of the persisted records. Pure and deterministic.
 *
 * THE ROLL. score = d20 + bearer modifier; margin = score - difficulty;
 * margin >= 0 holds, margin >= -5 frays, anything lower breaks
 * (`COMPOSURE_TIER_THRESHOLDS`). The frays band is five faces wide on
 * purpose: at every difficulty an average bearer frays one time in four, so
 * weight moves the odds between holding and breaking, and a tell that slips
 * without its cause stays the ordinary texture of a scene.
 *
 *  - A MARK's difficulty rises with its weight (`MARK_COMPOSURE_DIFFICULTY`):
 *    light 7, serious 10, grave 13.
 *  - A SECRET TIE's difficulty is fixed by its kind
 *    (`TIE_COMPOSURE_DIFFICULTY`): a faction or a cause 6, another tie 7, a
 *    cult or a faith 9. Why the split: a faction or a cause is an allegiance
 *    of interest, held with the head - it keeps behind the teeth unless
 *    someone presses on it. A cult or a faith is held with the heart and
 *    lived in habits - a prayer under the breath, a flinch at blasphemy, a
 *    rite's hour kept - so it slips more readily. 'other' sits between.
 *  - The BEARER's modifier (`deriveComposureModifier`): cunning helps hide
 *    either, (cunning - 5) / 2, as it fuels intrigue in
 *    ./resolution.ts::derivePersonalityModifier. PARANOIA also helps keep a
 *    SECRET TIE, (paranoia - 5) / 4 - a guarded mind watches who is
 *    listening, the reading ./resolution.ts::deriveInvestigationDifficulty
 *    already makes of a target that hides its affairs well. It does not
 *    help keep a mark: grief and nightmares are not kept by suspicion.
 *
 * Odds at an average bearer (every trait 5, so a modifier of 0):
 *
 *                       holds  frays  breaks
 *   mark, light           70%    25%     5%
 *   mark, serious         55%    25%    20%
 *   mark, grave           40%    25%    35%
 *   tie, faction/cause    75%    25%     0%
 *   tie, other            70%    25%     5%
 *   tie, cult/religion    60%    25%    15%
 *
 * WHO SEES WHAT (D4/D5/D25/D50): every roll is GM-private and recorded for
 * the GM console. An NPC's tiers reach only that NPC's own private-scene
 * prompt and - for a subject that frays or breaks - the turn narrator, who
 * is told a fraying mark's weight alone (its name is its cause), a breaking
 * mark's name only when that name carries nothing of the bearer's other
 * hidden subjects (`breakingMarkNameMayShow`), never an account, and a
 * tie's kind (never its name). A subject that holds reaches no
 * player-facing prompt at all, so no text and no voice can carry it. Every
 * model-authored tell passes one screen per bearer and scene or turn
 * (`buildTellScreen`) before a player surface takes it. The PLAYER's own
 * composure is the one exception D50 carves out of D4: they are told the
 * outcome in words and EXACTLY what the NPC was told
 * (`playerComposureTell`), never the die.
 */

import type {
  Affiliation,
  AffiliationKind,
  ComposureBearerRolls,
  ComposureRoll,
  ComposureSign,
  ComposureTier,
  Condition,
  ConditionSeverity,
  Entity,
  PersonalityTraits,
  TurnHistoryEntry,
} from '../../types';
import { AffiliationKindEnum, ComposureTierEnum, ConditionSeverityEnum } from '../../types';
import { conditionsOf } from './conditions';
import { secretAffiliationsOf } from './affiliations';
import { rollD20, traitDeviation, type Rng } from './resolution';
import { assertPlayerVisibleTextSafe } from './playerBoundary';
import { carriesTellMechanicsWord, validateDelivery } from '../../narration/performanceScript';

// --- The roll ---------------------------------------------------------------

/** Difficulty to keep an inward mark from showing, by its weight (see the module header). */
export const MARK_COMPOSURE_DIFFICULTY: Readonly<Record<ConditionSeverity, number>> = {
  light: 7,
  serious: 10,
  grave: 13,
};

/** Difficulty to keep a secret tie from showing, by its kind (see the module header for why). */
export const TIE_COMPOSURE_DIFFICULTY: Readonly<Record<AffiliationKind, number>> = {
  faction: 6,
  cause: 6,
  other: 7,
  cult: 9,
  religion: 9,
};

/**
 * Margin thresholds (score - difficulty) for each tier, named so tuning is a
 * one-line change. The FIRST band whose comparison holds wins:
 *  - margin >= HOLDS_MIN   -> 'holds'
 *  - margin >= FRAYS_MIN   -> 'frays'
 *  - otherwise             -> 'breaks'
 */
export const COMPOSURE_TIER_THRESHOLDS = {
  HOLDS_MIN: 0,
  FRAYS_MIN: -5,
} as const;

/** Divisor turning cunning's distance from average into a modifier of -2..+2.5 (every subject). */
const COMPOSURE_CUNNING_DIVISOR = 2;
/** Divisor turning paranoia's distance from average into a modifier of -1..+1.25 (secret ties only). */
const COMPOSURE_PARANOIA_DIVISOR = 4;

/** One subject of a bearer's composure: an inward mark or a secret tie. */
export type ComposureSubject =
  | { kind: 'mark'; id: string; name: string; severity: ConditionSeverity }
  | { kind: 'tie'; id: string; name: string; tieKind: AffiliationKind };

/**
 * The subjects one bearer must keep hidden, in a fixed order - inward marks
 * as borne, then secret ties as held - so a seeded generator replays the
 * same roll onto the same subject. Outward marks and open ties are not
 * subjects (anyone can see them).
 */
export function composureSubjectsOf(bearer: Pick<Entity, 'conditions' | 'affiliations'> | undefined): ComposureSubject[] {
  const marks: ComposureSubject[] = conditionsOf(bearer)
    .filter(mark => !mark.outward)
    .map(mark => ({ kind: 'mark', id: mark.id, name: mark.name, severity: mark.severity }));
  const ties: ComposureSubject[] = secretAffiliationsOf(bearer)
    .map(tie => ({ kind: 'tie', id: tie.id, name: tie.name, tieKind: tie.kind }));
  return [...marks, ...ties];
}

/** How hard one subject is to keep hidden (see the module header). */
export function composureDifficulty(subject: ComposureSubject): number {
  return subject.kind === 'mark' ? MARK_COMPOSURE_DIFFICULTY[subject.severity] : TIE_COMPOSURE_DIFFICULTY[subject.tieKind];
}

/**
 * The bearer's modifier for one kind of subject: cunning for either, and
 * paranoia too for a secret tie (see the module header). A bearer with no
 * personality (a faction, a legacy record) is average: 0. Each trait counts
 * only on its 1-10 scale (./resolution.ts::traitDeviation).
 */
export function deriveComposureModifier(personality: PersonalityTraits | undefined, subjectKind: ComposureSubject['kind']): number {
  if (!personality) return 0;
  const cunning = traitDeviation(personality.cunning) / COMPOSURE_CUNNING_DIVISOR;
  const paranoia = subjectKind === 'tie' ? traitDeviation(personality.paranoia) / COMPOSURE_PARANOIA_DIVISOR : 0;
  return cunning + paranoia;
}

/** The tier an already-rolled d20 lands in. Pure, so every band is testable without randomness. */
export function resolveComposure(input: { roll: number; modifier: number; difficulty: number }): { margin: number; tier: ComposureTier } {
  const { roll, modifier, difficulty } = input;
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new Error(`resolveComposure: roll must be an integer 1-20, got ${roll}`);
  const margin = roll + modifier - difficulty;
  const tier: ComposureTier = margin >= COMPOSURE_TIER_THRESHOLDS.HOLDS_MIN
    ? 'holds'
    : margin >= COMPOSURE_TIER_THRESHOLDS.FRAYS_MIN ? 'frays' : 'breaks';
  return { margin, tier };
}

/**
 * Rolls one bearer's composure: one d20 from `rng` per subject, in
 * `composureSubjectsOf` order. Deterministic given the generator; returns
 * the raw rolls for the GM record (D4 - never shown to the player). Empty
 * when the bearer keeps nothing hidden, and then draws nothing.
 */
export function rollComposure(bearer: Pick<Entity, 'conditions' | 'affiliations' | 'personality'>, rng: Rng): ComposureRoll[] {
  return composureSubjectsOf(bearer).map(subject => {
    const roll = rollD20(rng);
    const modifier = deriveComposureModifier(bearer.personality, subject.kind);
    const difficulty = composureDifficulty(subject);
    const { tier } = resolveComposure({ roll, modifier, difficulty });
    return {
      subjectKind: subject.kind,
      subjectId: subject.id,
      handle: composureHandle(subject.kind, subject.id),
      subjectName: subject.name,
      ...(subject.kind === 'mark' ? { severity: subject.severity } : { tieKind: subject.tieKind }),
      roll,
      modifier,
      difficulty,
      tier,
    };
  });
}

/**
 * A subject's handle in every prompt, screen and sign: `mark:<id>` or
 * `tie:<id>`. One space for both kinds, so a mark and a tie that share an id
 * ("mithras" the dread, "mithras" the cult) never answer to one handle.
 */
export function composureHandle(kind: ComposureSubject['kind'], id: string): string {
  return `${kind}:${id}`;
}

// --- What a tier tells a model ----------------------------------------------

/**
 * The fixed instruction each tier gives a model that portrays or narrates the
 * bearer (model-facing; veto queue, roadmaps/BACKLOG.md B13). The private
 * scene's NPC and the turn narrator read the same three.
 */
export const COMPOSURE_TIER_INSTRUCTIONS: Readonly<Record<ComposureTier, string>> = {
  holds: 'It stays hidden this scene: it shows only if the bearer chooses to confide it. No tell escapes on its own.',
  frays: 'A small tell escapes when the talk touches it - a voice catching, a glance away, a hand gone still - with no cause named.',
  breaks: 'It shows through plainly whatever is said - in the face, the voice, the bearing - still without the full account of it.',
};

// --- Stems: how a hidden subject is recognised in free text ------------------
//
// One vocabulary for every check that asks "does this text carry something
// of a hidden subject?" - the screen a model-authored tell passes, and the
// overlap test that decides whether a breaking mark's NAME may be told.
//
//  - WORDS AND STEMS. A subject's words are reduced to a stem by stripping
//    common endings while at least MIN_STEM letters remain ("Christians" ->
//    "christ", "Bacchus" -> "bacch", "Mithras" -> "mithra"), and matched
//    case-insensitively at the START of a word, so "Christ", "Bacchic",
//    "Bacchant", "Mithraic" and "Origenist" are all caught. A word too short
//    to stem (under MIN_STEM letters) matches only as a whole word, so "War"
//    never drops "toward" and "Ill" never drops "will". Matching at a word's
//    start never looks inside a word; "Fear" dropping "fearful" is the
//    accepted cost.
//  - SHORT NAMES. A capitalized word of exactly four letters - a god's or a
//    place's name, "Isis", "Mars" - is matched by its first three letters at
//    a word's start too, so "Isiac" and "Martial" are caught; "market"
//    dropping under "Mars" is the accepted cost.
//  - FOLDING. Pattern and text are both folded first (`foldLetters`), so the
//    spellings a Latin or Greek name wanders between are one: "Iesus" meets
//    "Jesus", "Khristos" "Christ", "Bakchos" "Bacchus". A text that gives a
//    subject by another word altogether ("Chrestus", "the Nazarene",
//    "Dionysus", "Liber") is not caught: the accepted residual.
//  - A SECRET TIE is caught by every word of its name and id but articles
//    and "of" (`TIE_STOPWORDS`), so "the One" is caught by "One"; a tie whose
//    name leaves no such word is caught by its whole name, less a leading
//    article.
//  - An INWARD MARK is caught by every content word of its name and id, by
//    its account's proper nouns (`accountProperNounsOf`) and - unless it
//    broke - by the account's other words of MIN_ACCOUNT_WORD letters or
//    more; an account's word that is a word a tell is made of
//    (`TELL_VOCABULARY`) is never counted, so "Her voice catches" survives an
//    account that speaks of her voice.

/** Common words a mark's name or account carries that never point at it. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'nor', 'but', 'yet', 'so', 'as', 'than', 'then', 'in', 'on', 'at', 'to',
  'for', 'from', 'by', 'with', 'into', 'onto', 'over', 'under', 'upon', 'about', 'after', 'before', 'again',
  'against', 'between', 'through', 'during', 'above', 'below', 'out', 'off', 'up', 'down', 'his', 'her', 'hers',
  'their', 'theirs', 'its', 'our', 'ours', 'my', 'mine', 'your', 'yours', 'him', 'them', 'they', 'she', 'he', 'it',
  'we', 'you', 'that', 'this', 'these', 'those', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'while',
  'will', 'would', 'shall', 'should', 'could', 'can', 'may', 'might', 'must', 'not', 'no', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'has', 'have', 'had', 'does', 'did', 'done', 'all', 'any', 'some', 'each',
  'every', 'none', 'one', 'own', 'same', 'such', 'very', 'too', 'just', 'only', 'also', 'even', 'ever', 'never',
  'still', 'more', 'most', 'less', 'much', 'many', 'other', 'others', 'there', 'here', 'how', 'why', 'if', 'else',
]);

/** The only words a secret tie's name drops: a tie's name is all name ("the One", "the Other Shore"). */
const TIE_STOPWORDS = new Set(['a', 'an', 'the', 'of']);

/**
 * The words a tell is made of - the body and the moment it shows in. A
 * mark's ACCOUNT that uses one ("her voice still breaks") never bars it from
 * a tell; a mark's NAME that carries one still does.
 */
const TELL_VOCABULARY = new Set([
  'voice', 'eyes', 'hands', 'face', 'breath', 'look', 'looks', 'glance', 'glances', 'before', 'after', 'words',
  'silence', 'gaze', 'lips', 'throat', 'tears', 'pause', 'moment', 'answer', 'answers', 'door', 'away',
]);

/** Endings stripped to reach a word's stem, longest first. */
const STEM_ENDINGS = ['ians', 'ity', 'ism', 'ian', 'ist', 'ic', 'us', 'ae', 'es', 's'] as const;
/** The shortest stem an ending may be stripped down to - and the shortest word matched at a word's start rather than whole. */
const MIN_STEM = 4;
/** The shortest word counted at all. */
const MIN_TERM = 3;
/** A capitalized word of exactly this many letters is a short name, matched by its first SHORT_NAME_PREFIX letters too. */
const SHORT_NAME_LETTERS = 4;
const SHORT_NAME_PREFIX = 3;
/** The shortest of a held or fraying mark's account words counted beyond its proper nouns. */
const MIN_ACCOUNT_WORD = 5;

/** A word's stem: common endings stripped while at least MIN_STEM letters remain. */
export function stemOf(word: string): string {
  let stem = word.normalize('NFKC').toLowerCase();
  for (let changed = true; changed;) {
    changed = false;
    for (const ending of STEM_ENDINGS) {
      if (stem.endsWith(ending) && stem.length - ending.length >= MIN_STEM) {
        stem = stem.slice(0, -ending.length);
        changed = true;
        break;
      }
    }
  }
  return stem;
}

/**
 * A text as every match reads it: lower case, with the letters a Latin or
 * Greek name is spelled either way with folded to one - k to c, then ch to
 * c, ph to f, j to i, v to u, y to i. Folded the same on pattern and text.
 */
function foldLetters(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/k/g, 'c').replace(/ch/g, 'c').replace(/ph/g, 'f')
    .replace(/j/g, 'i').replace(/v/g, 'u').replace(/y/g, 'i');
}

/** A word's stem as it is matched: stemmed, then folded. */
function foldedStemOf(word: string): string {
  return foldLetters(stemOf(word));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NO_LETTER_BEFORE = '(?<![\\p{L}\\p{M}])';
const NO_LETTER_AFTER = '(?![\\p{L}\\p{M}])';

/** The patterns one word is recognised by (see above): its stem at a word's start - or, too short to stem, the whole word - and a short name's first letters. */
function termPatterns(word: string): RegExp[] {
  const lower = word.normalize('NFKC').toLowerCase();
  if (lower.length < MIN_STEM) return [new RegExp(`${NO_LETTER_BEFORE}${escapeRegExp(foldLetters(lower))}${NO_LETTER_AFTER}`, 'u')];
  const patterns = [new RegExp(`${NO_LETTER_BEFORE}${escapeRegExp(foldedStemOf(lower))}`, 'u')];
  if (lower.length === SHORT_NAME_LETTERS && /^\p{Lu}/u.test(word.normalize('NFKC'))) {
    patterns.push(new RegExp(`${NO_LETTER_BEFORE}${escapeRegExp(foldLetters(lower).slice(0, SHORT_NAME_PREFIX))}`, 'u'));
  }
  return patterns;
}

function wordsOf(text: string): string[] {
  return text.normalize('NFKC').replace(/_/g, ' ').match(/[\p{L}\p{M}]+/gu) ?? [];
}

/** Every content word of these texts - a mark's name and id. */
function contentWordsOf(...texts: string[]): string[] {
  return texts.flatMap(wordsOf).filter(word => word.length >= MIN_TERM && !STOPWORDS.has(word.toLowerCase()));
}

/**
 * The distinctive words of a name - four letters or more, never a common
 * word ("Julia Mamaea" -> Julia, Mamaea; "the Thracian" -> Thracian). What
 * a player's attempt may name a figure by (./turn.ts::figuresPresentWith),
 * and what an account's words are known as names by (`TellWorld`).
 */
export function distinctiveWordsOf(...texts: string[]): string[] {
  return texts.flatMap(wordsOf).filter(word => word.length >= MIN_STEM && !STOPWORDS.has(word.toLowerCase()));
}

function patternsFor(words: readonly string[]): RegExp[] {
  const bySource = new Map<string, RegExp>();
  for (const word of new Set(words)) for (const pattern of termPatterns(word)) bySource.set(pattern.source, pattern);
  return [...bySource.values()];
}

function carriesAny(text: string, patterns: readonly RegExp[]): boolean {
  const folded = foldLetters(text);
  return patterns.some(pattern => pattern.test(folded));
}

/** A secret tie's patterns: every word of its name and id but articles and "of" - and, when its name leaves none, the whole name less a leading article. */
function tiePatternsOf(tie: Pick<Affiliation, 'id' | 'name'>): RegExp[] {
  const termsOf = (text: string) => wordsOf(text).filter(word => word.length >= MIN_TERM && !TIE_STOPWORDS.has(word.toLowerCase()));
  const nameTerms = termsOf(tie.name);
  const patterns = patternsFor([...nameTerms, ...termsOf(tie.id)]);
  if (nameTerms.length === 0) {
    const name = tie.name.normalize('NFKC').trim();
    const words = wordsOf(name.replace(/^(?:the|an|a)\s+/i, '')).map(word => escapeRegExp(foldLetters(word)));
    if (words.length > 0) patterns.push(new RegExp(`${NO_LETTER_BEFORE}${words.join('[^\\p{L}\\p{M}]+')}${NO_LETTER_AFTER}`, 'u'));
  }
  return patterns;
}

/** The known names' distinctive words, lower case to their own spelling (`TellWorld.knownNames`). */
function knownWordsOf(names: readonly string[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const word of distinctiveWordsOf(...names)) known.set(word.toLowerCase(), word);
  return known;
}

/**
 * An account's proper nouns: its capitalized words, and any word that is -
 * in any case - a distinctive word of a known figure's or place's name
 * ("her son marcus drowned off ostia" -> Marcus, Ostia); never a common
 * word nor a word a tell is made of.
 */
function accountProperNounsOf(account: string, known: ReadonlyMap<string, string>): string[] {
  return wordsOf(account).flatMap(word => {
    const lower = word.toLowerCase();
    if (word.length < MIN_TERM || STOPWORDS.has(lower) || TELL_VOCABULARY.has(lower)) return [];
    if (/^\p{Lu}/u.test(word)) return [word];
    const spelling = known.get(lower);
    return spelling ? [spelling] : [];
  });
}

/**
 * The words that give an inward mark away (see above): a mark that BROKE
 * only by its account's proper nouns its name does not carry; any other by
 * its name and id, its account's proper nouns, and its account's other
 * words of MIN_ACCOUNT_WORD letters or more but the tell vocabulary.
 */
function markWordsOf(mark: Condition, broke: boolean, known: ReadonlyMap<string, string>): string[] {
  const properNouns = accountProperNounsOf(mark.description, known);
  if (broke) {
    const named = new Set(contentWordsOf(mark.name).map(foldedStemOf));
    return properNouns.filter(word => !named.has(foldedStemOf(word)));
  }
  const longWords = wordsOf(mark.description).filter(word => word.length >= MIN_ACCOUNT_WORD
    && !STOPWORDS.has(word.toLowerCase()) && !TELL_VOCABULARY.has(word.toLowerCase()));
  return [...contentWordsOf(mark.name, mark.id), ...properNouns, ...longWords];
}

/** What of one bearer's hidden subjects gives each away, but the one `except` names: every secret tie, every inward mark as if it held. */
function hiddenPatternsOf(bearer: Pick<Entity, 'conditions' | 'affiliations'>, except?: { kind: ComposureSubject['kind']; id: string }): RegExp[] {
  const ties = secretAffiliationsOf(bearer).filter(tie => !(except?.kind === 'tie' && except.id === tie.id));
  const marks = conditionsOf(bearer).filter(mark => !mark.outward && !(except?.kind === 'mark' && except.id === mark.id));
  return [...ties.flatMap(tiePatternsOf), ...patternsFor(marks.flatMap(mark => markWordsOf(mark, false, new Map())))];
}

/**
 * Whether a mark that BROKE may be told by its NAME (D50) - to the turn
 * narrator, or to an NPC of the player's own mark. Only when the name
 * carries nothing of the bearer's OTHER hidden subjects, by the stems above:
 * a mark named "Terror that her rites to Bacchus will be found out" is never
 * named while "the cult of Bacchus" is kept, nor "Dread of being found out
 * as a Christian" while "the Christian faith" is, nor "Awe of the One" while
 * "the One" is. A mark that frayed or held is never named.
 */
export function breakingMarkNameMayShow(
  bearer: Pick<Entity, 'conditions' | 'affiliations'>,
  roll: Pick<ComposureRoll, 'subjectKind' | 'subjectId' | 'subjectName' | 'tier'>,
): boolean {
  if (roll.subjectKind !== 'mark' || roll.tier !== 'breaks') return false;
  return !carriesAny(roll.subjectName, hiddenPatternsOf(bearer, { kind: 'mark', id: roll.subjectId }));
}

// --- What an NPC is told of the player (CODE-authored, never the model) -----

/** How a secret tie's kind is named when it breaks: the kind, never the tie. The player's note says the same (components/ComposureNotes.tsx). */
export const TIE_KIND_WORD: Readonly<Record<AffiliationKind, string>> = {
  faction: 'faction',
  cause: 'cause',
  cult: 'cult',
  religion: 'faith',
  other: 'allegiance',
};

/**
 * The exact line an NPC is told of one of the PLAYER's own subjects this
 * scene (D50), or null when it held - the NPC is told nothing. Code writes
 * it, never a model, and the same line is shown to the player word for
 * word:
 *  - a mark that frays: that something weighs on them, cause unspoken;
 *  - a mark that breaks: its NAME only, never its account - unless the name
 *    carries something of the player's other hidden subjects
 *    (`breakingMarkNameMayShow`), when it shows plainly but unnamed;
 *  - a tie that frays: a hint of some private devotion or allegiance;
 *  - a tie that breaks: a plain sign of some secret faith, cult, faction...
 *    - its KIND, never its name: a tie is learned only by witness,
 *    investigation or exposure (D49), never from a slip.
 */
export function playerComposureTell(
  roll: Pick<ComposureRoll, 'subjectKind' | 'subjectId' | 'subjectName' | 'tieKind' | 'tier'>,
  player: Pick<Entity, 'name' | 'conditions' | 'affiliations'>,
): string | null {
  if (roll.tier === 'holds') return null;
  const who = player.name.trim() || 'them';
  if (roll.subjectKind === 'mark') {
    if (roll.tier === 'frays') return `Something weighs on ${who}: at moments it shows in the voice or the eyes, its cause unspoken.`;
    return breakingMarkNameMayShow(player, roll)
      ? `It shows plainly on ${who}: ${roll.subjectName.trim().replace(/[.!?;:,]+$/, '')}.`
      : `Something weighs plainly on ${who}, though it goes unnamed.`;
  }
  return roll.tier === 'frays'
    ? `${who} lets slip a hint of some private devotion or allegiance — a gesture, a word caught back.`
    : `${who} shows plain signs of some secret ${TIE_KIND_WORD[roll.tieKind ?? 'other']}, though it goes unnamed.`;
}

// --- The screen a model-authored tell passes --------------------------------

/** Longest sign kept, in characters: one short sentence of what was seen or heard. */
export const MAX_SIGN_CHARS = 160;
/** At most this many signs a private-scene reply may leave. */
export const MAX_SIGNS_PER_REPLY = 2;
/** At most this many signs one private scene keeps (bounded like every accreting slice). */
export const MAX_SIGNS_PER_SCENE = 12;
/** At most this many signs one turn's narration may leave. */
export const MAX_NARRATION_SIGNS = 4;

/**
 * The screen one bearer's model-authored tells pass in one scene or turn
 * (D50), built from their hidden subjects and this scene's or turn's tiers:
 *  - a SECRET TIE's name: never, whatever its tier;
 *  - a subject that HELD, mark or tie: nothing of its name, nor of its
 *    account's proper nouns and longer words;
 *  - a mark that FRAYED: the same - its name and account are its cause;
 *  - a mark that BROKE: its name may show, never its account's proper nouns;
 * every one by the stems above. Both a sign and a delivery must also hold at
 * least one word, carry no figure in digits, no game-mechanics word
 * (narration/performanceScript.ts::carriesTellMechanicsWord) and no hidden
 * mechanics; a delivery must pass the cue rules too, and name no individual
 * on the roster (`validateDelivery`). What fails is dropped whole, never
 * repaired.
 */
export interface TellScreen {
  /** A sign's sentence as a player surface may take it, or null. */
  sign(raw: unknown): string | null;
  /** A delivery as a player surface may take it, or null. */
  delivery(raw: unknown): string | null;
}

/** What a tell screen knows of the world beyond its bearer (`tellWorldOf`). */
export interface TellWorld {
  /** The display names of the roster's INDIVIDUALS: no delivery may carry a word of one (`validateDelivery`). */
  individualNames?: readonly string[];
  /** Every figure's display name and every known place: an account's word that is, in any case, a distinctive word of one is a proper noun. */
  knownNames?: readonly string[];
}

/** The `TellWorld` a roster gives - its individuals' names; every figure's name and place - with any other known places (the world's regions). */
export function tellWorldOf(
  roster: readonly Partial<Pick<Entity, 'name' | 'entity_type' | 'location'>>[],
  places: readonly string[] = [],
): TellWorld {
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  return {
    individualNames: roster.filter(entity => entity.entity_type === 'individual').map(entity => entity.name).filter(text),
    knownNames: [...roster.flatMap(entity => [entity.name, entity.location]), ...places].filter(text),
  };
}

/** Builds one bearer's `TellScreen` for one scene or turn, from their hidden subjects and these rolls' tiers (see above). */
export function buildTellScreen(
  bearer: Pick<Entity, 'conditions' | 'affiliations'>,
  rolls: readonly ComposureRoll[],
  world: TellWorld = {},
): TellScreen {
  // A subject without a roll here is read as held - the strictest.
  const tierOf = (kind: ComposureSubject['kind'], id: string): ComposureTier =>
    rolls.find(roll => roll.subjectKind === kind && roll.subjectId === id)?.tier ?? 'holds';
  const known = knownWordsOf(world.knownNames ?? []);
  const hidden = [
    ...secretAffiliationsOf(bearer).flatMap(tiePatternsOf),
    ...patternsFor(conditionsOf(bearer).filter(mark => !mark.outward)
      .flatMap(mark => markWordsOf(mark, tierOf('mark', mark.id) === 'breaks', known))),
  ];
  const passes = (text: string) => {
    if (!/\p{L}{2,}/u.test(text) || carriesTellMechanicsWord(text) || carriesAny(text, hidden)) return false;
    try {
      assertPlayerVisibleTextSafe(text);
    } catch {
      return false;
    }
    return true;
  };
  return {
    sign(raw) {
      if (typeof raw !== 'string') return null;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || text.length > MAX_SIGN_CHARS || /\p{N}/u.test(text)) return null;
      return passes(text) ? text : null;
    },
    delivery(raw) {
      const text = validateDelivery(raw, world.individualNames ?? []);
      return text && passes(text) ? text : null;
    },
  };
}

/** A private-scene reply's tells once screened: what the record may keep. */
export interface ScreenedNpcTells {
  /** The line's delivery, valid and free of the bearer's hidden subjects - or absent. */
  delivery?: string;
  /** Each surviving sign, with its subject's handle (GM-side, `mark:<id>` or `tie:<id>`). */
  signs: Array<{ subject: string; sign: string }>;
}

/**
 * Screens a private-scene NPC's model-authored tells (D50) before its record
 * - and so any player surface - takes them, through the NPC's `TellScreen`
 * for this scene:
 *  - `delivery`: the stage direction for the line; dropped when it fails
 *    the screen, and the line still stands.
 *  - `signs`: each must name, by handle, one of THIS NPC's inward or secret
 *    subjects that did NOT hold this scene (`rolls`), once, and its sentence
 *    must pass the screen; the rest are dropped, and at most
 *    `MAX_SIGNS_PER_REPLY` survive.
 * Pure; the model's raw fields are read as `unknown`.
 */
export function screenNpcTells(
  raw: { delivery?: unknown; signs?: unknown },
  bearer: Pick<Entity, 'conditions' | 'affiliations'>,
  rolls: readonly ComposureRoll[],
  world: TellWorld = {},
): ScreenedNpcTells {
  const screen = buildTellScreen(bearer, rolls, world);
  const delivery = screen.delivery(raw.delivery) ?? undefined;
  const open = new Set(rolls.filter(roll => roll.tier !== 'holds').map(roll => roll.handle));
  const signs: ScreenedNpcTells['signs'] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.signs) ? raw.signs : []) {
    if (signs.length >= MAX_SIGNS_PER_REPLY) break;
    if (!item || typeof item !== 'object') continue;
    const { subject, sign } = item as Record<string, unknown>;
    if (typeof subject !== 'string' || !open.has(subject) || seen.has(subject)) continue;
    const text = screen.sign(sign);
    if (!text) continue;
    seen.add(subject);
    signs.push({ subject, sign: text });
  }
  return { ...(delivery ? { delivery } : {}), signs };
}

// --- The turn narrator's cues ------------------------------------------------

/**
 * One subject the turn narrator is told of (D50): a figure present with the
 * player whose inward mark or secret tie frayed or broke this turn, under an
 * opaque `handle` ("c1", "c2" ...) - never the subject's own handle, which
 * carries its id, its name in snake case, and would carry a secret tie's
 * name into a player-facing prompt. A subject that held is never a cue.
 * `named` says whether a mark may be told by its name: only one that BROKE
 * and whose name carries nothing of the bearer's other hidden subjects
 * (`breakingMarkNameMayShow`) - a fraying mark's name is its cause, so the
 * narrator is told its weight alone. A tie is never named.
 */
export interface ComposureCue {
  handle: string;
  entityId: string;
  entityName: string;
  roll: ComposureRoll;
  named: boolean;
}

/** The narrator's cues from one turn's rolls: every subject that did not hold, handled in order. */
export function composureCuesFrom(
  bearers: readonly ComposureBearerRolls[],
  roster: readonly Pick<Entity, 'entity_id' | 'conditions' | 'affiliations'>[],
): ComposureCue[] {
  const cues: ComposureCue[] = [];
  for (const bearer of bearers) {
    const entity = roster.find(candidate => candidate.entity_id === bearer.entityId);
    for (const roll of bearer.rolls) {
      if (roll.tier === 'holds') continue;
      const named = entity !== undefined && breakingMarkNameMayShow(entity, roll);
      cues.push({ handle: `c${cues.length + 1}`, entityId: bearer.entityId, entityName: bearer.entityName, roll, named });
    }
  }
  return cues;
}

/**
 * Screens the narration payload's optional `signs` (D50) against the turn's
 * cues: a sign must name a cue's handle (and, when it names a figure, that
 * cue's figure), once, and its sentence must pass its bearer's `TellScreen`
 * for this turn - one that knows the roster's names and places, and any
 * other known `places`. At most `MAX_NARRATION_SIGNS` survive, each with its
 * GM-side subject handle.
 */
export function screenNarrationSigns(
  raw: unknown,
  cues: readonly ComposureCue[],
  roster: readonly (Pick<Entity, 'entity_id' | 'conditions' | 'affiliations'> & Partial<Pick<Entity, 'name' | 'entity_type' | 'location'>>)[],
  bearers: readonly ComposureBearerRolls[],
  places: readonly string[] = [],
): ComposureSign[] {
  if (!Array.isArray(raw) || cues.length === 0) return [];
  const byHandle = new Map(cues.map(cue => [cue.handle, cue]));
  const world = tellWorldOf(roster, places);
  const screens = new Map<string, TellScreen>();
  const screenFor = (entityId: string): TellScreen | undefined => {
    if (!screens.has(entityId)) {
      const bearer = roster.find(candidate => candidate.entity_id === entityId);
      if (!bearer) return undefined;
      screens.set(entityId, buildTellScreen(bearer, bearers.find(b => b.entityId === entityId)?.rolls ?? [], world));
    }
    return screens.get(entityId);
  };
  const signs: ComposureSign[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (signs.length >= MAX_NARRATION_SIGNS) break;
    if (!item || typeof item !== 'object') continue;
    const { entity, handle, sign } = item as Record<string, unknown>;
    const cue = typeof handle === 'string' ? byHandle.get(handle.trim()) : undefined;
    if (!cue || used.has(cue.handle)) continue;
    if (entity !== undefined && entity !== cue.entityId) continue;
    const text = screenFor(cue.entityId)?.sign(sign);
    if (!text) continue;
    used.add(cue.handle);
    signs.push({ entityId: cue.entityId, subject: cue.roll.handle, sign: text });
  }
  return signs;
}

// --- Reading the persisted records -------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One persisted composure roll rebuilt field by field, or null when it is
 * not one - a save written by hand, or damaged, never crashes a reader. Its
 * `handle` is always rebuilt from its kind and id, so a roll saved before
 * handles carried the kind reads the same as a new one.
 */
export function normalizeComposureRoll(value: unknown): ComposureRoll | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.subjectKind !== 'mark' && r.subjectKind !== 'tie') return null;
  if (typeof r.subjectId !== 'string' || !r.subjectId || typeof r.subjectName !== 'string') return null;
  if (!isFiniteNumber(r.roll) || !Number.isInteger(r.roll) || r.roll < 1 || r.roll > 20) return null;
  if (!isFiniteNumber(r.modifier) || !isFiniteNumber(r.difficulty)) return null;
  if (!(ComposureTierEnum as readonly unknown[]).includes(r.tier)) return null;
  const severity = (ConditionSeverityEnum as readonly unknown[]).includes(r.severity) ? r.severity as ConditionSeverity : undefined;
  const tieKind = (AffiliationKindEnum as readonly unknown[]).includes(r.tieKind) ? r.tieKind as AffiliationKind : undefined;
  return {
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    handle: composureHandle(r.subjectKind, r.subjectId),
    subjectName: r.subjectName,
    ...(severity ? { severity } : {}),
    ...(tieKind ? { tieKind } : {}),
    roll: r.roll,
    modifier: r.modifier,
    difficulty: r.difficulty,
    tier: r.tier as ComposureTier,
  };
}

/** A persisted list of composure rolls, malformed entries dropped; [] for anything that is not a list. */
export function normalizeComposureRolls(value: unknown): ComposureRoll[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeComposureRoll).filter((roll): roll is ComposureRoll => roll !== null);
}

/** A turn's composure rolls (TurnHistoryEntry.composureRolls), tolerating an absent or malformed record. */
export function composureRollsOf(entry: Pick<TurnHistoryEntry, 'composureRolls'>): ComposureBearerRolls[] {
  const list = entry.composureRolls;
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.entityId !== 'string') return [];
    const rolls = normalizeComposureRolls(item.rolls);
    return rolls.length > 0 ? [{ entityId: item.entityId, entityName: typeof item.entityName === 'string' ? item.entityName : item.entityId, rolls }] : [];
  });
}

/**
 * A persisted sign's subject as a handle (`mark:<id>` or `tie:<id>`), or
 * null. A sign saved before handles carried the kind names a bare id: it is
 * read as the handle of the ONE subject among `rolls` with that id, and
 * dropped when none has it or a mark and a tie both do.
 */
export function composureSubjectHandle(subject: unknown, rolls: readonly ComposureRoll[]): string | null {
  if (typeof subject !== 'string' || !subject) return null;
  if (/^(?:mark|tie):./.test(subject)) return subject;
  const matches = rolls.filter(roll => roll.subjectId === subject);
  return matches.length === 1 ? matches[0].handle : null;
}

/** One persisted sign rebuilt, its subject read as a handle against its bearer's rolls, or null. */
function normalizeComposureSign(value: unknown, bearers: readonly ComposureBearerRolls[]): ComposureSign | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (typeof s.entityId !== 'string' || typeof s.sign !== 'string' || !s.sign.trim()) return null;
  const entityId = s.entityId;
  const subject = composureSubjectHandle(s.subject, bearers.find(bearer => bearer.entityId === entityId)?.rolls ?? []);
  return subject ? { entityId, subject, sign: s.sign } : null;
}

/** A turn's narration signs (TurnHistoryEntry.composureSigns), tolerating an absent or malformed record. */
export function composureSignsOf(entry: Pick<TurnHistoryEntry, 'composureSigns' | 'composureRolls'>): ComposureSign[] {
  const list = entry.composureSigns;
  if (!Array.isArray(list)) return [];
  const bearers = composureRollsOf(entry);
  return list.map(sign => normalizeComposureSign(sign, bearers)).filter((sign): sign is ComposureSign => sign !== null);
}
