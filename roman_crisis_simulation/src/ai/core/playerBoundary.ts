/**
 * ai/core/playerBoundary.ts
 *
 * Two independent code-side boundaries enforced on provider output before it
 * can reach or affect a player-visible surface:
 *  1. Hidden-mechanics leakage (`assertPlayerVisibleValueSafe` /
 *     `assertPlayerVisibleTextSafe` / `assertPlayerVisibleAdjudicationSafe`):
 *     raw resolution-tier/fate-band tokens, dice notation, and humanized
 *     mechanic labels must never surface in player-facing text.
 *  2. Invented player action (`assertNoInventedPlayerVisibleAction` /
 *     `assertNoInventedPlayerAction`): on a no-observable-attempt turn, no
 *     provider response may author an avatar action or a player-originated
 *     state change - a hard semantic postcondition, not merely prompt
 *     guidance.
 *
 * The invented-player-action classifier is deliberately NOT antecedent-aware
 * and does NOT catch every possessive-passive construction - both are
 * intentional, accepted gaps rather than oversights, to avoid over-rejecting
 * legitimate third-person prose about rivals on a surface validated every
 * turn. The gaps are enumerated with their exact rationale in
 * `tests/playerBoundary.test.ts` (search "DECLARED GAP" and "KNOWN, symmetric
 * gap") - a maintainer reading only this implementation cannot otherwise tell
 * they are intentional rather than bugs.
 */
import type { Adjudication, Entity, EventDelta } from '../../types';

const PLAYER_ACTION_BOUNDARY_ERROR = 'AI output violated the player action boundary.';
const PLAYER_MECHANICS_BOUNDARY_ERROR = 'AI output violated the player-visible mechanics boundary.';

/**
 * Plain `success`, `failure`, `dies`, and `survive` remain valid English
 * prose. The underscore-bearing values are the raw internal enum tokens
 * whose appearance proves that an AI response copied hidden mechanics onto
 * a player-adjacent surface.
 */
const HIDDEN_MECHANIC_TOKENS = [
  'critical_failure',
  'partial_success',
  'critical_success',
  'survive_with_loss',
  'survive_with_boon',
  'confirmed_dead',
  'gravely_wounded',
  'presumed_dead',
  'escapes_openly',
] as const;

const HIDDEN_MECHANIC_TOKEN_PATTERN = new RegExp(
  `\\b(?:${HIDDEN_MECHANIC_TOKENS.join('|')})\\b`,
  'i',
);

// Accept both the terse d20 form and conventional NdX notation (1d20,
// 2 d 6). This is deliberately bounded to the dice used by the simulation,
// rather than treating every prose word containing a letter d as mechanics.
const DICE_NOTATION_PATTERN = /\b(?:\d+\s*)?d\s*(?:100|20|12|10|8|6|4)\b/i;

// Mechanical contexts must name the roll/die result. A bare English verb
// such as "20 soldiers die" is ordinary casualty prose and is intentionally
// legal; likewise "roll the wagons 20 miles" is not a dice result.
const MECHANICAL_ROLL_PATTERNS = [
  /\broll(?:ed|ing|s)?\s+(?:(?:a|an)\s+)?(?:of\s+)?(?:natural\s+)?\d+\b/i,
  /\b(?:die|dice)\s+(?:roll(?:ed|s)?|show(?:ed|s)?|land(?:ed|s)?(?:\s+on)?|came\s+up|result(?:ed|s)?(?:\s+in)?|total(?:ed|s)?|was)\s+(?:(?:a|an)\s+)?(?:natural\s+)?\d+\b/i,
  /\bnatural\s+\d+\b/i,
  /\b\d+\s+(?:on|from)\s+(?:the\s+)?(?:die|dice|roll)\b/i,
  /\broll[\s-]+total\s*(?::|=|\b(?:was|is|of)\b)\s*[+-]?\d+\b/i,
  /\bcheck[\s-]+total\s*(?::|=|\b(?:was|is|of)\b)\s*[+-]?\d+\b/i,
  /\bmargin\s*(?::|=|\b(?:was|is|of)\b)\s*[+-]?\d+\b/i,
  /\baction[\s-]+modifier\s*(?::|=|\b(?:was|is|of)\b|[\u2013\u2014-])\s*[+-]?\d+\b/i,
] as const;

const HUMANIZED_MECHANIC_LABEL_PATTERNS = [
  /\b(?:outcome|resolution|check|result)[\s-]*tier\s*(?:[.:=\u2013\u2014-]\s*)*(?:critical[\s-]+failure|partial[\s-]+success|critical[\s-]+success|failure|success)\b/i,
  /\bfate[\s-]*band\s*(?:[.:=\u2013\u2014-]\s*)*(?:survives?[\s-]+with[\s-]+loss|survives?[\s-]+with[\s-]+boon|confirmed[\s-]+dead|gravely[\s-]+wounded|presumed[\s-]+dead|escapes[\s-]+openly|dies)\b/i,
] as const;

// A provider sometimes emits the hidden tier without its usual
// "outcome tier"/"fate band" label. Reject only when a whole sentence or line
// is the tier verdict (optionally wrapped in "It was ..."); the anchors preserve
// ordinary prose such as "the levy was a partial success because ...".
const STANDALONE_HUMANIZED_MECHANIC_LABEL_PATTERN = /^\s*(?:it\s+(?:was|is)\s+(?:a\s+)?)?(?:critical[\s-]+failure|partial[\s-]+success|critical[\s-]+success|survives?[\s-]+with[\s-]+loss|survives?[\s-]+with[\s-]+boon|confirmed[\s-]+dead|gravely[\s-]+wounded|presumed[\s-]+dead|escapes[\s-]+openly)\s*[.!?]?\s*$/i;

function stripBoundedPresentationWrappers(segment: string): string {
  return segment
    .trim()
    .replace(/^(?:>\s*)+/u, '')
    .replace(/^(?:(?:[-+*]|\d+[.)])\s+)+/u, '')
    .replace(/^[*_`"'“”‘’([{\s]+/u, '')
    .replace(/[*_`"'“”‘’)}\]\s]+$/u, '')
    .trim();
}

function containsStandaloneHumanizedMechanicLabel(text: string): boolean {
  return text
    .split(/(?:[.!?](?:[*_`"'”’)}\]]*)(?:\s+|$)|[\r\n]+)/u)
    .map(stripBoundedPresentationWrappers)
    .some(segment => STANDALONE_HUMANIZED_MECHANIC_LABEL_PATTERN.test(segment));
}

/** Canonicalizes visually equivalent or invisibly separated provider text. */
function normalizeBoundaryText(text: string): string {
  return text.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}

function containsHiddenMechanics(text: string): boolean {
  const normalized = normalizeBoundaryText(text);
  return HIDDEN_MECHANIC_TOKEN_PATTERN.test(normalized)
    || DICE_NOTATION_PATTERN.test(normalized)
    || MECHANICAL_ROLL_PATTERNS.some(pattern => pattern.test(normalized))
    || HUMANIZED_MECHANIC_LABEL_PATTERNS.some(pattern => pattern.test(normalized))
    || containsStandaloneHumanizedMechanicLabel(normalized);
}

function valueContainsHiddenMechanics(value: unknown): boolean {
  if (typeof value === 'string') return containsHiddenMechanics(value);
  if (Array.isArray(value)) return value.some(valueContainsHiddenMechanics);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(valueContainsHiddenMechanics);
  }
  return false;
}

/**
 * Enforces the final code-side boundary on any value that can reach a
 * player-facing surface. The thrown error is deliberately stable and
 * content-free: offending tokens must not be reflected into App error UI or
 * logs assembled from the error message.
 */
export function assertPlayerVisibleValueSafe(value: unknown): void {
  if (valueContainsHiddenMechanics(value)) throw new Error(PLAYER_MECHANICS_BOUNDARY_ERROR);
}

export function assertPlayerVisibleTextSafe(text: string): void {
  assertPlayerVisibleValueSafe(text);
}

/**
 * Validates only the player-adjacent projection of an adjudication.
 * GM-private traces and truth-ledger fields remain available to the GM and
 * are intentionally excluded. Scheme reasons are excluded as well because
 * they are private active-scheme JSON and every player-facing prompt replaces
 * them with an opaque marker.
 */
export function assertPlayerVisibleAdjudicationSafe(adjudication: Adjudication): void {
  const visibleDeltas = adjudication.deltas.map(delta => {
    const { secret_truth, is_true, origin_id, ...visible } = delta;
    return delta.type === 'scheme'
      ? { ...visible, reason: '[private scheme changed]' }
      : visible;
  });
  const visibleAddedEntities = adjudication.add_entities?.map(entity => {
    const { secret_truth, ...visible } = entity;
    return visible;
  });

  assertPlayerVisibleValueSafe({
    turn: adjudication.turn,
    entityActions: adjudication.entityActions,
    deltas: visibleDeltas,
    headlines: adjudication.headlines,
    add_entities: visibleAddedEntities,
    remove_entities: adjudication.remove_entities,
  });
}

export type PlayerIdentity = Pick<Entity, 'entity_id' | 'name' | 'position'>;

function compactIdentity(value: string): string {
  return normalizeBoundaryText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function wordNormalized(value: string): string {
  return normalizeBoundaryText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Ranks held by many officeholders at once. In free prose such a title can
 * name ANY holder - "The Senator Gaius Pontius withdraws" styles a third
 * party, not the player - so a shared title cannot by itself attribute
 * conduct to the player; singular offices (e.g. 'Emperor') keep matching.
 * Compared via compactIdentity. A campaign-authored shared title missing
 * from this set merely over-rejects (fail closed) - it can never leak.
 */
const SHARED_TITLE_POSITIONS = new Set([
  'senator', 'consul', 'proconsul', 'tribune', 'legate', 'general',
  'governor', 'prefect', 'praetor', 'quaestor', 'aedile', 'censor',
  'centurion', 'magistrate', 'priest', 'augur', 'patrician', 'commander',
  'officer',
]);

/**
 * Aliases for IDENTITY SLOTS: delta key roots, origin ids, entityAction
 * ids, and remove_entities entries. These fields hold exactly one identity,
 * so even a shared title written there denotes the player and fails closed;
 * prose subjecthood uses the narrower proseSubjectAliases below.
 */
function identityAliases(player: PlayerIdentity): string[] {
  return [...new Set([
    player.entity_id,
    player.name,
    player.position,
    'player',
    'avatar',
    'you',
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

/**
 * Aliases eligible to act as a PROSE SUBJECT. Shared titles are excluded:
 * in narrative text they name an officeholder class that may be a third
 * party, and third-party prose must never read as the player acting.
 */
function proseSubjectAliases(player: PlayerIdentity): string[] {
  return identityAliases(player).filter(alias => !SHARED_TITLE_POSITIONS.has(compactIdentity(alias)));
}

/**
 * Exact identity comparison over an IDENTITY SLOT (an entityAction id, a
 * delta key root, an origin_id, a remove_entities entry). Exported so
 * ai/mocks.ts's boundary-compliant projection uses the SAME definition the
 * structural gates enforce - a second, driftable copy there is exactly how
 * three canned surfaces came to be missed.
 */
export function samePlayerIdentity(value: string | null | undefined, player: PlayerIdentity): boolean {
  if (!value) return false;
  const normalized = wordNormalized(value);
  const candidates = [normalized, normalized.replace(/^the\s+/u, '')]
    .map(compactIdentity)
    .filter(candidate => candidate.length > 0);
  return identityAliases(player).some(alias => candidates.includes(compactIdentity(alias)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NON_ACTION_PLAYER_PREDICATE = new RegExp(`^(?:${[
  // Perception and received information.
  '(?:see|sees|saw|seen|hear|hears|heard|notice|notices|noticed|observe|observes|observed|perceive|perceives|perceived|witness|witnesses|witnessed|learn|learns|learned|learnt)',
  // Cognition, uncertainty, and internal questions.
  '(?:know|knows|knew|known|think|thinks|thought|believe|believes|believed|suspect|suspects|suspected|wonder|wonders|wondered|understand|understands|understood|remember|remembers|remembered|recognize|recognizes|recognized|realize|realizes|realized|infer|infers|inferred|weigh|weighs|weighed)',
  // Feelings and stable internal conditions.
  '(?:feel|feels|felt|fear|fears|feared|dread|dreads|dreaded|regret|regrets|regretted|seem|seems|seemed|remain|remains|remained)',
  // Explicit intentions are not accomplished acts. Bare future/modal verbs
  // are excluded: "you will dispatch" still authors player conduct.
  '(?:intend|intends|intended|plan|plans|planned|hope|hopes|hoped|want|wants|wanted|wish|wishes|wished|consider|considers|considered|contemplate|contemplates|contemplated|expect|expects|expected|need|needs|needed)',
].join('|')})\\b`, 'u');

/**
 * Verbs whose subject UNDERGOES rather than acts: waiting, forbearing,
 * receiving, owing, lacking. These are the register a no-attempt turn is
 * actually written in - "you wait", "you receive a letter", "your household
 * lacks the coin" - and none of them heads an act the player performed.
 *
 * Deliberately ABSENT: every verb that also reads as conduct in the same
 * surface form. 'suffer' stays out (it lives in POSSESSED_CONDITION_PREDICATE
 * below, which demands an adverbial tail, so "your guards suffer heavy
 * casualties" keeps failing closed); 'withdraw', 'hold', 'bear', 'keep',
 * 'delay', and 'pause' stay out for the same reason.
 */
const RECEPTIVE_PLAYER_PREDICATE = new RegExp(`^(?:${[
  // Waiting and forbearance.
  '(?:wait|waits|waited|waiting|await|awaits|awaited|awaiting)',
  '(?:linger|lingers|lingered|tarry|tarries|tarried|abide|abides|abided)',
  '(?:hesitate|hesitates|hesitated|refrain|refrains|refrained|abstain|abstains|abstained)',
  // Receiving, holding, owing - the subject is the endpoint, not the agent.
  '(?:receive|receives|received|receiving|inherit|inherits|inherited)',
  '(?:owe|owes|owed|owing|lack|lacks|lacked|lacking)',
  '(?:possess|possesses|possessed|own|owns|owned|face|faces|faced|facing)',
  '(?:undergo|undergoes|underwent|undergone)',
  // Standing relations, not events.
  '(?:depend|depends|depended|belong|belongs|belonged|exist|exists|existed|matter|matters|mattered)',
].join('|')})\\b`, 'u');

/**
 * An act explicitly emptied of content - "you do nothing this week", "you
 * take no action", "the Emperor offers no reply". The negated object is what
 * makes it a non-attempt; NEGATED_PLAYER_PREDICATE below only covers the
 * auxiliary form ("do not sign").
 */
const EMPTY_ACT_PREDICATE = new RegExp(`^(?:${[
  'do', 'does', 'did', 'doing', 'make', 'makes', 'made', 'making',
  'take', 'takes', 'took', 'taking', 'say', 'says', 'said', 'speak', 'speaks', 'spoke',
  'offer', 'offers', 'offered', 'give', 'gives', 'gave', 'send', 'sends', 'sent',
  'act', 'acts', 'acted', 'move', 'moves', 'moved', 'lift', 'lifts', 'lifted',
  'raise', 'raises', 'raised', 'stir', 'stirs', 'stirred',
  'attempt', 'attempts', 'attempted', 'answer', 'answers', 'answered',
  'reply', 'replies', 'replied', 'respond', 'responds', 'responded',
  'issue', 'issues', 'issued', 'write', 'writes', 'wrote',
  'utter', 'utters', 'uttered', 'seek', 'seeks', 'sought',
].join('|')})\\s+(?:no|not|none|nothing|neither|nobody)\\b`, 'u');

/**
 * Words that can head a subject COMPLEMENT but can never head a finite verb
 * phrase in English. A player subject whose predicate is one of these states a
 * CONDITION the player is in - "beholden to Titus Vinius", "unable to attend"
 * - which no-attempt prose reaches through an elided copula ("the Emperor is
 * ill and unable to attend") or a causative object ("mounting arrears leave
 * the Emperor beholden to ..."). Because an adjective cannot head a verb
 * phrase, whatever follows it is that adjective's own complement, so the tail
 * is free.
 *
 * Every entry is an adjective ONLY. Words that double as verbs - 'ready',
 * 'secure', 'still', 'quiet', 'present', 'absent', 'idle', 'bankrupt',
 * 'weary', 'content', 'exposed', 'isolated', 'close', 'near', 'steady',
 * 'better' - are deliberately excluded: in the same surface position they
 * would be ordinary transitive conduct.
 */
const STATE_ADJECTIVES = [
  'ill', 'sick', 'unwell', 'unfit', 'weak', 'weaker', 'weakest', 'frail', 'infirm',
  'lame', 'blind', 'deaf', 'mute', 'silent', 'sullen', 'grim', 'grave', 'stern',
  'alone', 'adrift', 'aloof', 'apart', 'aware', 'unaware', 'awake', 'asleep', 'alive', 'dead',
  'unable', 'unwilling', 'uncertain', 'unsure', 'unmoved', 'unarmed',
  'popular', 'unpopular', 'happy', 'unhappy', 'angry', 'angrier', 'bitter', 'furious',
  'glad', 'sad', 'afraid', 'uneasy', 'wary', 'warier', 'restive',
  'impatient', 'patient', 'reluctant', 'hesitant',
  'beholden', 'indebted', 'dependent', 'independent', 'vulnerable',
  'poor', 'poorer', 'rich', 'richer', 'strong', 'stronger', 'strongest',
  'safe', 'safer', 'unsafe', 'loyal', 'disloyal', 'hostile', 'friendly', 'distant',
  'old', 'older', 'young', 'younger', 'tired',
  'ascendant', 'dominant', 'supreme', 'paramount',
  'bold', 'bolder', 'brash', 'brave', 'braver', 'timid',
  'stable', 'unstable', 'mortal', 'fatal', 'guilty', 'innocent',
  'unopposed', 'unchallenged', 'unchecked', 'unpaid', 'unheard', 'unseen',
  'unknown', 'unmarried', 'unvisited', 'unanswered',
  'short', 'shorter', 'thin', 'thinner', 'deep', 'deeper', 'low', 'lower',
  'great', 'greater', 'small', 'smaller', 'heavy', 'heavier', 'light', 'lighter',
  'worse', 'worst', 'best',
] as const;

/**
 * Adjective-shaped by morphology. Only the three suffixes that no English
 * finite verb carries: '-less', '-ous', '-ful'. '-ive', '-ent', '-ant',
 * '-ish', and a bare comparative '-er' are excluded because each also ends
 * common verbs ('give', 'present', 'punish', 'murder').
 */
const STATE_ADJECTIVE = `(?:[\\p{L}]+(?:less|ous|ful)|${STATE_ADJECTIVES.join('|')})`;

/**
 * What may follow the adjective. An adjective's own complement is a
 * preposition phrase, an infinitive, or a comparative tail - never a bare
 * noun phrase. The bound matters because possessedHeadPredicate scans EVERY
 * suffix of a possessed phrase looking for an allowed predicate: with a free
 * tail, any adjective anywhere would launder the action behind it ("your
 * although-loyal guards murder the consul" -> "loyal guards murder the
 * consul").
 */
const ADJECTIVE_COMPLEMENT_HEADS = [
  'to', 'of', 'on', 'upon', 'in', 'into', 'at', 'by', 'for', 'from', 'with',
  'within', 'without', 'toward', 'towards', 'before', 'behind', 'beneath',
  'under', 'over', 'among', 'amongst', 'amid', 'amidst', 'against', 'about',
  'around', 'beyond', 'through', 'throughout', 'near', 'beside', 'despite',
  'than', 'as', 'that',
] as const;

const ADJECTIVAL_STATE_PREDICATE = new RegExp(
  `^(?:(?:more|less|far|very|ever|so|too|quite|rather|somewhat|no)\\s+)*${STATE_ADJECTIVE}`
  + `(?:\\s+(?:${ADJECTIVE_COMPLEMENT_HEADS.join('|')})\\b.*)?$`,
  'u',
);

/**
 * Determiners that mark whatever follows a copular/inchoative verb as a
 * DIRECT OBJECT rather than a subject complement: "grow restless" is a
 * condition, "grow the treasury" is conduct. Only the complement's FIRST word
 * is inspected - which is where English puts the determiner.
 */
const OBJECT_DETERMINERS = [
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'his', 'her', 'its', 'their', 'our', 'my', 'your',
  'every', 'each', 'all', 'both', 'another', 'any', 'some',
] as const;

/**
 * Copular and inchoative verbs: they link their subject to a CONDITION rather
 * than take an object. With a complement that is not determiner-headed, the
 * clause says what the player (or a possessed noun) HAS BECOME - the world's
 * doing, legal on a no-attempt turn. A determiner-headed complement is a
 * direct object and still fails closed.
 */
const INCHOATIVE_STATE_VERBS = [
  'grow', 'grows', 'grew', 'grown',
  'become', 'becomes', 'became',
  'turn', 'turns', 'turned',
  'fall', 'falls', 'fell', 'fallen',
  'go', 'goes', 'went', 'gone',
  'wax', 'waxes', 'waxed',
  'stay', 'stays', 'stayed',
  'remain', 'remains', 'remained',
  'keep', 'keeps', 'kept',
  'seem', 'seems', 'seemed',
  'appear', 'appears', 'appeared',
  'look', 'looks', 'looked',
  'sound', 'sounds', 'sounded',
  'prove', 'proves', 'proved',
  'stand', 'stands', 'stood',
  'sit', 'sits', 'sat',
  'lie', 'lies', 'lay',
  'rest', 'rests', 'rested',
  'live', 'lives', 'lived',
] as const;

const INCHOATIVE_STATE_PREDICATE = new RegExp(
  `^(?:${INCHOATIVE_STATE_VERBS.join('|')})\\b`
  + `(?:\\s+(?!(?:${OBJECT_DETERMINERS.join('|')})\\b)[\\p{L}\\p{N}'-]+(?:\\s.*)?)?$`,
  'u',
);

/**
 * Perfect and progressive auxiliaries. Stripping one and reclassifying the
 * remainder keeps "you have grown poorer" / "you are waiting" legal while
 * leaving "you have seized the treasury" / "you are signing the decree" to
 * fail closed on their own participle - the auxiliary carries no agency of
 * its own, so nothing is discarded by removing it.
 */
const PERFECT_OR_PROGRESSIVE_AUXILIARY = /^(?:have|has|had|having|am|are|is|was|were|be|been|being)\s+/u;
const MAX_AUXILIARY_STRIPS = 2;

const NEGATED_PLAYER_PREDICATE = /^(?:never\b|no\s+longer\b|(?:do|does|did|am|are|is|was|were|have|has|had|can|could|will|would|should|must|may|might)\s+not\b|cannot\b)/u;
const COPULAR_STATE_PREDICATE = /^(?:am|are|is|was|were)\b(?!\s+[\p{L}\p{N}_-]+ing\b)/u;
const CONTINUOUS_STATE_PREDICATE = /^(?:am|are|is|was|were)\s+(?:gaining|losing)\s+(?:favor|ground|influence|standing|support|the\s+senate)\b/u;
const MODAL_NON_ACTION_PREDICATE = new RegExp(
  `^(?:can|could|may|might|must|should|will|would)\\s+(?:${[
    '(?:see|hear|notice|observe|perceive|witness|learn)',
    '(?:know|think|believe|suspect|wonder|understand|remember|recognize|realize|infer|weigh)',
    '(?:feel|fear|dread|regret|seem|remain)',
    '(?:intend|plan|hope|want|wish|consider|contemplate|expect|need)',
    '(?:be\\b(?!\\s+[\\p{L}\\p{N}_-]+ing\\b))',
  ].join('|')})\\b`,
  'u',
);
const SAFE_CONTEMPLATIVE_IDIOM = /^(?:must|should)\s+tread\s+carefully\b/u;
const LEADING_PREDICATE_ADVERBS = /^(?:(?:also|already|clearly|currently|deeply|dimly|fully|inwardly|merely|now|perhaps|personally|plainly|privately|probably|publicly|quietly|secretly|still|then|truly|visibly|[\p{L}]+ly)\s+)*/u;

/**
 * A possessed noun phrase whose head undergoes an INTRANSITIVE change of
 * condition ("The Emperor's grip weakens", "Your influence wanes") is the
 * world pressing on the player - a circumstance, not an act. The condition
 * verb must end its clause or be followed only by an adverbial or
 * prepositional tail: a direct object ("weakens the walls") means the
 * possessed instrument is ACTING, which stays player conduct and fails
 * closed.
 */
const POSSESSED_CONDITION_PREDICATE = new RegExp(`^(?:${[
  'weakens?', 'weakened', 'wanes?', 'waned', 'erodes?', 'eroded',
  'falters?', 'faltered', 'slips?', 'slipped', 'fades?', 'faded',
  'crumbles?', 'crumbled', 'loosens?', 'loosened', 'slackens?', 'slackened',
  'tightens?', 'tightened', 'strengthens?', 'strengthened',
  'hardens?', 'hardened', 'deepens?', 'deepened', 'sours?', 'soured',
  'worsens?', 'worsened', 'improves?', 'improved', 'grows?', 'grew',
  'withers?', 'withered', 'dwindles?', 'dwindled', 'wavers?', 'wavered',
  'falls?', 'fell', 'rises?', 'rose', 'endures?', 'endured',
  'persists?', 'persisted', 'holds?', 'held',
  'fails?', 'failed', 'collapses?', 'collapsed', 'declines?', 'declined',
  'suffers?', 'suffered', 'shatters?', 'shattered',
].join('|')})(?:\\s+(?:[\\p{L}]+ly|further|still|apace|again|anew|by|with|within|under|in|on|over|amid|among|across|despite|after|before|as|while|through|toward|towards|at)\\b[\\p{L}\\p{N}\\s]*)?$`, 'u');

/**
 * "'s" also contracts "is"/"has": a single-word possessed phrase that is a
 * gerund or participle ("The Emperor's marching", "The Emperor's fled")
 * conceals a player action and fails closed; a bare possessed noun
 * ("the Emperor's grip") is inert. Shares the irregular-participle
 * inventory with passiveAgentPattern below.
 */
const POSSESSED_VERBAL_REMNANT = /^(?:[\p{L}]+(?:ing|ed|en|wn)|sent|made|done|held|cast|put|set|built|brought|bought|caught|taught|taken|given|seen|known|shown|told|left|kept|met|read|said|paid|led|found|lost|won|gone|come|run)$/u;

/**
 * Classifies the remainder of a possessive player reference ("your X ...",
 * "<player>'s X ..."). Returns '' when the possessed phrase is inert - a
 * bare non-verbal noun, an allowed no-attempt predicate at some suffix, or
 * an intransitive condition of the possessed noun. Otherwise returns the
 * offending predicate: a possessive player agent with an unknown predicate
 * fails closed.
 */
/**
 * Subordinate-clause markers. A possessed phrase is SPLIT at these words and
 * EVERY resulting clause is classified: the head clause by the possessed-
 * phrase rules, each subordinate clause by the same subject/predicate check
 * containsPlayerAttributedAction's part split already applies to a
 * comma-separated clause.
 *
 * Earlier designs truncated at the first subordinator and scanned only the
 * head. Discarding a span you have not classified is inherently fail-OPEN:
 * the discarded tail can carry the action outright ("your grip weakens
 * because you burned the granary") and, symmetrically, a tail ending in an
 * intransitive condition verb launders a head that really is an action
 * ("your agents burn the granary as the resistance weakens"). Because
 * nothing is discarded any more, the set is safe to widen past the six
 * markers it originally held.
 */
const POSSESSED_PHRASE_SUBORDINATORS = new Set([
  'as', 'while', 'when', 'because', 'though', 'although',
  'since', 'after', 'before', 'if', 'unless', 'whereas', 'once', 'until',
]);

/**
 * Third-person forms that a subordinate clause can use to point back at a
 * THIRD-PERSON possessor ("Gaius Testus's grip weakens because HE burned the
 * granary" - the possessor is the only established referent). They bind to
 * the player only inside such a phrase: a second-person possessive ("your
 * grip ...") cannot take a third-person pronoun as its own antecedent, so
 * binding them there would merely over-reject ordinary prose about rivals.
 */
const ANAPHORIC_SUBJECT_PRONOUNS = ['he', 'she', 'they'];
const ANAPHORIC_POSSESSIVE_DETERMINERS = ['his', 'her', 'their'];
const ANAPHORIC_PASSIVE_AGENTS = ['him', 'her', 'them'];

/**
 * Which surface forms count as the player within the span being classified.
 * Carried explicitly so a third-person possessive can widen the set for its
 * OWN subordinate clauses without widening it for unrelated prose.
 */
interface ClauseScope {
  subjectAliases: string[];
  possessiveDeterminers: string[];
  /**
   * Passive AGENTS ("... because the granary was burned by him") bound to the
   * player inside this span. Empty at the top level, where
   * containsPlayerAttributedAction already scans the whole clause for every
   * alias; only the anaphoric third-person forms need adding.
   */
  passiveAgents: string[];
}

function baseClauseScope(aliases: string[]): ClauseScope {
  return { subjectAliases: aliases, possessiveDeterminers: ['your'], passiveAgents: [] };
}

function anaphoricClauseScope(scope: ClauseScope): ClauseScope {
  return {
    subjectAliases: [...new Set([...scope.subjectAliases, ...ANAPHORIC_SUBJECT_PRONOUNS])],
    possessiveDeterminers: [
      ...new Set([...scope.possessiveDeterminers, ...ANAPHORIC_POSSESSIVE_DETERMINERS]),
    ],
    passiveAgents: [...new Set([...scope.passiveAgents, ...ANAPHORIC_PASSIVE_AGENTS])],
  };
}

/**
 * Possessive openers that cannot END a clause: each demands a head noun after
 * it. A subordinator sitting immediately behind one has SEVERED a possessive
 * from its possession rather than opened a clause ("... because your |
 * as-yet-unnamed agents burned the granary"), and once severed the possessor
 * can never be matched to what it possesses. Plain articles are excluded:
 * losing "the" loses no player link, and treating them as severing would
 * reject ordinary prose ("you see the as-yet-unnamed courier").
 */
const DANGLING_POSSESSIVE_OPENERS = new Set([
  'your', 'my', 'our', 'his', 'her', 'its', 'their',
  // wordNormalized reduces "<name>'s" to "<name> s".
  's',
]);

/**
 * Splits normalized text into [headClause, ...subordinateClauses], or null
 * when a subordinator severs a possessive - an unclassifiable span, which
 * every caller must fail closed on.
 *
 * A subordinator whose preceding span is EMPTY is not a clause boundary: it
 * is a fragment of the head noun phrase, reached because wordNormalized turns
 * hyphens into spaces ("your as-yet-unnamed heir" -> "as yet unnamed heir").
 * Absorbing it keeps that noun phrase classifiable instead of erasing it,
 * while a genuine later subordinator still opens its own clause.
 */
function splitSubordinateClauses(text: string): string[] | null {
  const clauses: string[][] = [[]];
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const current = clauses[clauses.length - 1];
    if (current.length > 0 && POSSESSED_PHRASE_SUBORDINATORS.has(word)) {
      if (DANGLING_POSSESSIVE_OPENERS.has(current[current.length - 1])) return null;
      clauses.push([]);
      continue;
    }
    current.push(word);
  }
  return clauses.map(words => words.join(' '));
}

/**
 * Classifies a possessed phrase's HEAD clause. Returns '' when inert - a bare
 * non-verbal noun, an allowed no-attempt predicate at some suffix, or an
 * intransitive condition of the possessed noun - otherwise the offending
 * predicate. The suffix scan exists because the noun/verb split is unknown
 * ("grip on the senate | weakens"); bounding it to the head clause is exactly
 * what stops a LATER clause's condition verb from laundering the head.
 */
function possessedHeadPredicate(clause: string): string {
  const words = clause.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return POSSESSED_VERBAL_REMNANT.test(words[0]) ? words[0] : '';
  for (let index = 1; index < words.length; index += 1) {
    const candidate = words.slice(index).join(' ');
    if (isAllowedNoAttemptPredicate(candidate) || POSSESSED_CONDITION_PREDICATE.test(candidate)) return '';
  }
  return words.slice(1).join(' ');
}

/**
 * Classifies the remainder of a possessive player reference ("your X ...",
 * "<player>'s X ..."). Returns '' only when EVERY clause is inert; otherwise
 * the offending predicate, so a possessive player agent with an unknown
 * predicate - in ANY of its clauses - fails closed.
 */
function possessedPhrasePredicate(phrase: string, scope: ClauseScope): string {
  const clauses = splitSubordinateClauses(phrase);
  if (!clauses) return phrase;
  const [head, ...subordinates] = clauses;
  const headPredicate = possessedHeadPredicate(head);
  if (headPredicate) return headPredicate;
  for (const subordinate of subordinates) {
    const offense = subordinateClauseOffense(subordinate, scope);
    if (offense) return offense;
  }
  return '';
}

/**
 * Classifies a subordinate clause exactly as the comma path classifies a
 * part: no player subject at all, or a player subject whose predicate is
 * allowed, means the clause attributes nothing.
 */
function subordinateClauseOffense(clause: string, scope: ClauseScope): string {
  const passiveOffense = anaphoricPassiveAgentOffense(clause, scope);
  if (passiveOffense) return passiveOffense;
  const predicate = playerClausePredicate(clause, scope);
  if (!predicate) return '';
  return predicateOffense(predicate, scope);
}

/**
 * A subordinate clause naming the enclosing possessor as its passive AGENT
 * ("... because the granary was burned by him") attributes the act just as
 * surely as an active subject would.
 */
function anaphoricPassiveAgentOffense(clause: string, scope: ClauseScope): string {
  if (scope.passiveAgents.length === 0) return '';
  const normalized = wordNormalized(clause);
  for (const agent of scope.passiveAgents) {
    const match = passiveAgentPattern(escapeRegExp(agent)).exec(normalized);
    if (!match || !passiveAgentAttributesAction(match)) continue;
    if (/\b(?:not|never|no)\b/u.test(normalized.slice(0, match.index))) continue;
    const offense = predicateOffense(match[0], scope);
    if (offense) return offense;
  }
  return '';
}

/**
 * Returns the innermost predicate that attributes an action, or ''. A player
 * predicate is inert only when EVERY one of its own clauses is inert:
 * isAllowedNoAttemptPredicate anchors at the head, so without this an allowed
 * head would swallow an unexamined tail ("you see the courier because you
 * burned the granary").
 *
 * Returning the INNERMOST offender keeps the result scope-independent: it
 * contains no subordinator and is not an allowed predicate, so a caller
 * re-checking it under a narrower ClauseScope reaches the same verdict.
 */
function predicateOffense(predicate: string, scope: ClauseScope): string {
  const clauses = splitSubordinateClauses(predicate);
  if (!clauses) return predicate;
  const [head, ...subordinates] = clauses;
  if (head && !isAllowedNoAttemptPredicate(head)) return head;
  for (const subordinate of subordinates) {
    const offense = subordinateClauseOffense(subordinate, scope);
    if (offense) return offense;
  }
  return '';
}

function playerPredicateAttributesAction(predicate: string, scope: ClauseScope): boolean {
  return predicateOffense(predicate, scope) !== '';
}

/**
 * The single part-level classifier shared by the comma path and by every
 * subordinate clause. Returns null when the part names no player at all,
 * '' when every role it names is inert, otherwise the offending predicate.
 *
 * One clause can name the player in BOTH roles at once - as a possessive
 * determiner and as an explicit subject - and playerPossessivePredicate binds
 * the first determiner ANYWHERE in the clause, including one sitting in OBJECT
 * position. Deciding the clause on the possessive alone is therefore fail-OPEN
 * in both directions:
 *
 *   - an object-position possessive ends classification before the subject is
 *     examined, because its possessed phrase is an inert bare noun ("you
 *     burned YOUR granary" -> "granary"), and
 *   - a trailing possessive CONDITION launders a real head action ("you seize
 *     the treasury though YOUR standing declines").
 *
 * So both roles are classified and EITHER may fail the clause. Each candidate
 * is reduced through predicateOffense here rather than by the caller, so the
 * value returned is the INNERMOST offender in exactly the sense predicateOffense
 * documents: it carries no subordinator and is not an allowed predicate, so a
 * caller re-checking it under a narrower ClauseScope reaches the same verdict.
 * The possessive is examined first, keeping the reported offender stable for
 * clauses that were already failing on that branch alone.
 */
function playerClausePredicate(part: string, scope: ClauseScope): string | null {
  const candidates = [
    playerPossessivePredicate(part, scope),
    earliestPlayerSubject(part, scope)?.predicate ?? null,
  ];
  if (candidates.every(candidate => candidate === null)) return null;
  for (const candidate of candidates) {
    const offense = candidate ? predicateOffense(candidate, scope) : '';
    if (offense) return offense;
  }
  return '';
}

function isAllowedNoAttemptPredicate(predicate: string, auxiliaryStrips = 0): boolean {
  const withoutAdverbs = predicate.replace(LEADING_PREDICATE_ADVERBS, '');
  if (NEGATED_PLAYER_PREDICATE.test(withoutAdverbs)) return true;
  if (COPULAR_STATE_PREDICATE.test(withoutAdverbs)) return true;
  if (CONTINUOUS_STATE_PREDICATE.test(withoutAdverbs)
    || NON_ACTION_PLAYER_PREDICATE.test(withoutAdverbs)
    || MODAL_NON_ACTION_PREDICATE.test(withoutAdverbs)
    || SAFE_CONTEMPLATIVE_IDIOM.test(withoutAdverbs)
    || RECEPTIVE_PLAYER_PREDICATE.test(withoutAdverbs)
    || EMPTY_ACT_PREDICATE.test(withoutAdverbs)
    || ADJECTIVAL_STATE_PREDICATE.test(withoutAdverbs)
    || INCHOATIVE_STATE_PREDICATE.test(withoutAdverbs)) return true;
  if (auxiliaryStrips >= MAX_AUXILIARY_STRIPS) return false;
  const stripped = withoutAdverbs.replace(PERFECT_OR_PROGRESSIVE_AUXILIARY, '');
  return stripped !== withoutAdverbs && isAllowedNoAttemptPredicate(stripped, auxiliaryStrips + 1);
}

/**
 * Oblique first-person forms. English never lets these head a clause, so they
 * widen the PASSIVE-agent scan only: 'i' already covers the subject position,
 * while "the granary was burned by me" names the player as the agent just as
 * surely. Deliberately excluded from subjectAliases, where they would misread
 * every ordinary object ("the Senate warned me") as the player acting.
 *
 * The possessive 'my' is deliberately NOT here. The passive scan rejects on a
 * bare alias match with no predicate classification, so "by my <noun>" would
 * reject every third party merely related to the player ("sealed by my
 * predecessor"). That lands hardest on the monologue, whose prompt mandates
 * first-person prose about rivals - and it buys little, because the dominant
 * second-person register of the same hole ("burned by your agents") is not
 * caught either. Closing that passive gap for ALL possessives is the coherent
 * fix; a first-person-only half of it is pure false-positive cost.
 */
const OBLIQUE_FIRST_PERSON_PASSIVE_AGENTS = ['me'];

/**
 * Passive participles naming a STANDING RELATION to their agent - ownership,
 * control, knowledge, regard - rather than an act the agent performed. "The
 * villa owned by <player>" ascribes possession; "the granary burned by
 * <player>" ascribes conduct. The passive scan rejects on a bare alias match
 * with no predicate classification, so without this list every possessive
 * relative clause naming the player read as the player acting.
 */
const STATIVE_PASSIVE_PARTICIPLES = new Set([
  'owned', 'possessed', 'held', 'controlled', 'governed', 'ruled', 'occupied', 'inhabited',
  'known', 'unknown', 'remembered', 'forgotten', 'feared', 'loved', 'hated', 'admired',
  'despised', 'respected', 'trusted', 'distrusted', 'mistrusted', 'wanted', 'needed',
  'desired', 'expected', 'seen', 'heard', 'witnessed', 'noticed', 'observed',
  'understood', 'believed', 'considered', 'deemed', 'presumed', 'supposed',
  'favored', 'favoured', 'resented', 'envied', 'pitied', 'missed', 'owed', 'shared',
]);

/** Group 1 is the participle, so callers can classify it before rejecting. */
function passiveAgentPattern(aliasPattern: string): RegExp {
  const participle = '(?:[\\p{L}]+(?:ed|en|wn)|sent|made|done|held|cast|put|set|built|brought|bought|caught|taught|taken|given|seen|known|shown|told|left|kept|met|read|said|paid|led|found|lost|won)';
  return new RegExp(`\\b(${participle})\\s+by\\s+(?:the\\s+)?${aliasPattern}\\b`, 'u');
}

function passiveAgentAttributesAction(match: RegExpExecArray): boolean {
  return !STATIVE_PASSIVE_PARTICIPLES.has(match[1]);
}

/** Expands only grammatical contractions needed to classify a predicate. */
function normalizePlayerContractions(text: string): string {
  const negativeContractions: Record<string, string> = {
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
    "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
    "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
    "can't": 'can not', "couldn't": 'could not', "won't": 'will not', "wouldn't": 'would not',
    "shouldn't": 'should not', "mustn't": 'must not', "mightn't": 'might not', "needn't": 'need not',
  };
  return text
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/\b(?:don't|doesn't|didn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|can't|couldn't|won't|wouldn't|shouldn't|mustn't|mightn't|needn't)\b/gu,
      match => negativeContractions[match])
    .replace(/\b(you|i)'ll\b/gu, '$1 will')
    .replace(/\bi'm\b/gu, 'i am')
    .replace(/\byou're\b/gu, 'you are')
    .replace(/\b(you|i)'ve\b/gu, '$1 have');
}

// These words establish that a following player alias is an object or the
// complement of a preposition, rather than a grammatical subject. This is a
// role classifier, not an action denylist: an unknown predicate attached to
// an actual player subject still fails closed.
//
// The transitive/causative verbs below matter for no-attempt prose in
// particular: a causative reading puts the player in OBJECT position with an
// adjectival complement ("mounting arrears LEAVE <player> beholden to ..."),
// which read as a bare player subject with an unknown predicate before they
// were listed. Reporting verbs that introduce a clause ('cried', 'reports')
// are deliberately absent - they take a whole clause, not the player, as
// their object, so the player inside that clause is still its subject.
const PLAYER_OBJECT_PREDECESSORS = new Set([
  'to', 'for', 'from', 'of', 'by', 'with', 'without', 'near', 'beside', 'behind', 'before', 'after',
  'around', 'toward', 'towards', 'against', 'among', 'tells', 'told', 'shows', 'showed', 'gives', 'gave',
  'brings', 'brought', 'warns', 'warned', 'asks', 'asked', 'greets', 'greeted', 'addresses', 'addressed',
  'approaches', 'approached', 'follows', 'followed', 'watches', 'watched', 'sees', 'saw', 'finds', 'found',
  'leave', 'leaves', 'left', 'make', 'makes', 'render', 'renders', 'rendered',
  'keep', 'keeps', 'kept', 'name', 'names', 'named', 'call', 'calls', 'called',
  'consider', 'considers', 'considered', 'deem', 'deems', 'deemed',
  'reach', 'reaches', 'reached', 'send', 'sends', 'sent',
  'summon', 'summons', 'summoned', 'invite', 'invites', 'invited',
  'offer', 'offers', 'offered', 'promise', 'promises', 'promised',
  'deny', 'denies', 'denied', 'grant', 'grants', 'granted',
  'urge', 'urges', 'urged', 'press', 'presses', 'pressed',
  'court', 'courts', 'courted', 'accuse', 'accuses', 'accused',
  'praise', 'praises', 'praised', 'blame', 'blames', 'blamed',
  'denounce', 'denounces', 'denounced', 'petition', 'petitions', 'petitioned',
  'visit', 'visits', 'visited', 'oppose', 'opposes', 'opposed',
  'support', 'supports', 'supported', 'betray', 'betrays', 'betrayed',
  'spare', 'spares', 'spared', 'threaten', 'threatens', 'threatened',
  'owe', 'owes', 'owed', 'pay', 'pays', 'paid', 'serve', 'serves', 'served',
  'obey', 'obeys', 'obeyed', 'defy', 'defies', 'defied',
  'trust', 'trusts', 'trusted', 'distrust', 'distrusts', 'distrusted',
  'fear', 'fears', 'feared', 'envy', 'envies', 'envied', 'join', 'joins', 'joined',
]);

function aliasIsObject(prefix: string): boolean {
  const words = wordNormalized(prefix).split(/\s+/u).filter(Boolean);
  while (['the', 'a', 'an'].includes(words.at(-1) ?? '')) words.pop();
  return PLAYER_OBJECT_PREDECESSORS.has(words.at(-1) ?? '');
}

function earliestPlayerSubject(segment: string, scope: ClauseScope): { predicate: string } | null {
  const normalizedSegment = wordNormalized(segment);
  let earliest: { index: number; end: number } | null = null;
  for (const alias of scope.subjectAliases) {
    const normalizedAlias = wordNormalized(alias);
    if (!normalizedAlias) continue;
    const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, '\\s+');
    const pattern = new RegExp(`\\b(?:the\\s+)?${aliasPattern}\\b`, 'gu');
    for (const match of normalizedSegment.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (aliasIsObject(normalizedSegment.slice(0, index))) continue;
      const end = index + match[0].length;
      // Ties on start position are broken by LENGTH. A player's entity_id is
      // routinely a prefix of their display name ('gaius_valerius' inside
      // 'Gaius Valerius Maximus'), and taking the shorter match left the rest
      // of the name inside the predicate - "maximus is unable to attend" -
      // which no allowed-predicate rule can ever classify, so every sentence
      // naming such a player by name failed closed.
      if (!earliest || index < earliest.index || (index === earliest.index && end > earliest.end)) {
        earliest = { index, end };
      }
    }
  }
  if (!earliest) return null;
  const predicate = wordNormalized(normalizedSegment.slice(earliest.end));
  // wordNormalized reduces "<alias>'s" to "<alias> s": a leading bare "s"
  // marks the alias as a POSSESSOR, not the clause's acting subject, so the
  // possessed phrase is classified exactly like a "your ..." possessive.
  // That possessor is also a THIRD-PERSON antecedent, so the phrase's
  // subordinate clauses may refer back to the player pronominally.
  const possessive = /^s(?:\s+|$)/u.exec(predicate);
  if (possessive) {
    return {
      predicate: possessedPhrasePredicate(
        predicate.slice(possessive[0].length),
        anaphoricClauseScope(scope),
      ),
    };
  }
  return { predicate };
}

function playerPossessivePredicate(segment: string, scope: ClauseScope): string | null {
  const determiners = scope.possessiveDeterminers.map(escapeRegExp).join('|');
  const match = new RegExp(`\\b(?:${determiners})\\s+(.+)$`, 'u').exec(wordNormalized(segment));
  if (!match) return null;
  return possessedPhrasePredicate(match[1], scope);
}

function containsPlayerAttributedAction(text: string, player: PlayerIdentity): boolean {
  const normalized = normalizePlayerContractions(normalizeBoundaryText(text).toLocaleLowerCase());
  if (!wordNormalized(normalized)) return false;
  const scope = baseClauseScope([...proseSubjectAliases(player), 'i']);

  for (const clause of normalized.split(/[.!?;\n]+/u)) {
    const wordClause = clause
      .replace(/[^\p{L}\p{N},:'_-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!wordClause) continue;

    const passiveClause = wordNormalized(wordClause);
    for (const alias of [...scope.subjectAliases, ...OBLIQUE_FIRST_PERSON_PASSIVE_AGENTS]) {
      const normalizedAlias = wordNormalized(alias);
      if (!normalizedAlias) continue;
      const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, '\\s+');
      const passiveMatch = passiveAgentPattern(aliasPattern).exec(passiveClause);
      if (passiveMatch && passiveAgentAttributesAction(passiveMatch)) {
        const passivePrefix = passiveClause.slice(0, passiveMatch.index);
        if (!/\b(?:not|never|no)\b/u.test(passivePrefix)) return true;
      }
    }

    const parts = wordClause.split(/(,|:|\b(?:and|but|that)\b)/u);
    let inheritedPlayerSubject = false;
    let precedingDelimiter = '';
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (!part) continue;
      if (/^(?:,|:|and|but|that)$/u.test(part)) {
        precedingDelimiter = part;
        if (part !== 'and' && part !== 'but') inheritedPlayerSubject = false;
        continue;
      }

      const partPredicate = playerClausePredicate(part, scope);
      if (partPredicate !== null) {
        inheritedPlayerSubject = true;
        precedingDelimiter = '';
        if (partPredicate && playerPredicateAttributesAction(partPredicate, scope)) return true;
        continue;
      }

      if (inheritedPlayerSubject && (precedingDelimiter === 'and' || precedingDelimiter === 'but')) {
        const predicate = wordNormalized(part);
        if (predicate && playerPredicateAttributesAction(predicate, scope)) return true;
      } else {
        inheritedPlayerSubject = false;
      }
      precedingDelimiter = '';
    }
  }
  return false;
}

function valueContainsPlayerAttributedAction(value: unknown, player: PlayerIdentity): boolean {
  if (typeof value === 'string') return containsPlayerAttributedAction(value, player);
  if (Array.isArray(value)) return value.some(item => valueContainsPlayerAttributedAction(item, player));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .some(item => valueContainsPlayerAttributedAction(item, player));
  }
  return false;
}

/**
 * Relation attributes that measure external LEVERAGE over their key's root
 * rather than the root's own stance. DEBT HAS TEETH
 * (ai/prompts/adjudication.ts) explicitly directs the adjudicator to raise
 * an indebted player's 'dependency_level' toward a creditor via a
 * 'relation' delta keyed under the player - the world acting ON the
 * player, legal on a no-attempt turn. Every other relation attribute
 * (trust/respect/perceived_threat/ideological_alignment) is the player's
 * own interior stance and stays player-owned.
 */
const WORLD_DRIVEN_RELATION_ATTRIBUTES = new Set(['dependency_level']);

export function playerOwnsDelta(delta: EventDelta, player: PlayerIdentity): boolean {
  // A rumor's key is its subject, not its author. Only a player origin (or
  // player-attributed prose, checked separately) makes it player-authored.
  if (delta.type === 'rumor') return samePlayerIdentity(delta.origin_id, player);
  // A world-leverage relation delta's key likewise names whose ledger
  // moves, not who acted: ownership follows origin, so a player origin
  // still claims player authorship and fails closed. The attribute index
  // mirrors ai/core/engine.ts's 'relation' key parsing exactly.
  if (delta.type === 'relation' && WORLD_DRIVEN_RELATION_ATTRIBUTES.has(delta.key.split(':')[2] ?? '')) {
    return samePlayerIdentity(delta.origin_id, player);
  }
  if (samePlayerIdentity(delta.origin_id, player)) return true;
  const [rootEntityId] = delta.key.split(':');
  return samePlayerIdentity(rootEntityId, player);
}

function valueRemovesPlayer(value: unknown, player: PlayerIdentity): boolean {
  if (Array.isArray(value)) return value.some(item => valueRemovesPlayer(item, player));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (key === 'remove_entities' && Array.isArray(item)) {
      return item.some(removed => typeof removed === 'string' && samePlayerIdentity(removed, player));
    }
    return valueRemovesPlayer(item, player);
  });
}

/**
 * Rejects player-attributed action prose on any separately player-visible
 * provider result, such as narration or the empire-level simulation state.
 *
 * FAIL-CLOSED TEXT VALIDATION. Kept for callers that genuinely cannot
 * sanitize - notably anything validating text that has already been, or is
 * about to be, released irrevocably. Callers that CAN rewrite the surface
 * should instead pair `assertNoPlayerRemoval` (structural, throws) with
 * `redactInventedPlayerProseFromValue` (prose, redacts): killing a turn over
 * a narrative blemish costs the player the whole turn and every provider call
 * behind it, and a retry re-rolls the same nondeterministic model against the
 * same prompt.
 */
export function assertNoInventedPlayerVisibleAction(
  value: unknown,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): void {
  if (!hasObservableAttempt && (
    valueContainsPlayerAttributedAction(value, player)
    || valueRemovesPlayer(value, player)
  )) {
    throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  }
}

/**
 * The STRUCTURAL half of the no-attempt postcondition, on any value that can
 * carry a `remove_entities` list. Removing the player is a mechanical
 * violation (their dossier would blank with no game-over or epilogue), so it
 * fails the whole response closed - it cannot be sanitized into something
 * harmless.
 */
export function assertNoPlayerRemoval(
  value: unknown,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): void {
  if (!hasObservableAttempt && valueRemovesPlayer(value, player)) {
    throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  }
}

/**
 * A question/private-only submission is a hard semantic postcondition on
 * MECHANICS. Any provider response that claims the player's own entityAction
 * slot, owns a delta under them, or removes them invalidates the entire
 * response; callers must reject the turn rather than sanitize and partially
 * commit it. NPC/world activity remains legal.
 *
 * PROSE IS NOT CHECKED HERE. The prose classifier is a regex-clause heuristic
 * over headlines, delta `reason`, and entityAction `notes`; a false positive
 * there used to kill the turn after 4-8 provider calls even though nothing
 * mechanical had been violated - including on the DEBT HAS TEETH prose
 * ai/prompts/adjudication.ts itself solicits. Prose now goes through
 * `redactInventedPlayerProse`: a prose leak is a narrative blemish, a delta
 * leak is a mechanical violation, and they must not share a failure mode.
 */
export function assertNoInventedPlayerAction(
  adjudication: Adjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): void {
  if (hasObservableAttempt) return;

  const inventedAction = adjudication.entityActions.some(action => samePlayerIdentity(action.id, player));
  const playerOriginatedDelta = adjudication.deltas.some(delta => playerOwnsDelta(delta, player));
  const removesPlayer = valueRemovesPlayer({ remove_entities: adjudication.remove_entities }, player);

  if (inventedAction || playerOriginatedDelta || removesPlayer) {
    throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  }
}

// --- Prose redaction ----------------------------------------------------

/** One removed span of player-visible prose. GM-private: carries the original. */
export interface PlayerProseRedaction {
  /** Dotted/indexed path of the surface it came from, e.g. 'headlines[1]'. */
  readonly surface: string;
  /** The removed text, verbatim. Only ever recorded on a GM-only channel. */
  readonly original: string;
}

export interface PlayerProseRedactionResult<T> {
  readonly value: T;
  readonly redactions: readonly PlayerProseRedaction[];
}

/**
 * Replaces a prose slot that redacts to nothing. Matches the hedged register
 * perception/visibility.ts::describeDelta already falls back to, so a
 * redacted `reason` reads as ordinary quiet-week prose rather than as an
 * error marker.
 */
const REDACTED_PLAYER_PROSE_PLACEHOLDER = 'Something shifts, unremarked.';

/** The GM-console tag. Matches the '[Engine]'/'[Mind]'/'[Pacing]' convention. */
const PLAYER_PROSE_REDACTION_TAG = '[Boundary]';

/** The prose predicate, exported so no caller writes a second copy of it. */
export function containsInventedPlayerProse(value: unknown, player: PlayerIdentity): boolean {
  return valueContainsPlayerAttributedAction(value, player);
}

/**
 * Splits text into spans on the SAME terminators containsPlayerAttributedAction
 * splits clauses on, keeping each terminator with its span, so a span that
 * survives reclassification is byte-identical to what the classifier cleared.
 */
function splitProseSpans(text: string): string[] {
  const spans: string[] = [];
  let current = '';
  for (const token of text.split(/([.!?;\n]+\s*)/u)) {
    if (!token) continue;
    if (/^[.!?;\n]/u.test(token)) {
      spans.push(current + token);
      current = '';
      continue;
    }
    current += token;
  }
  if (current) spans.push(current);
  return spans;
}

/**
 * Returns null when the text is already clean, otherwise the text with every
 * offending sentence removed - '' when nothing survives. Sentence-level so a
 * headline or reason that merely trails an invented clause keeps its
 * legitimate content.
 */
function redactProseString(text: string, player: PlayerIdentity): string | null {
  if (!containsPlayerAttributedAction(text, player)) return null;
  return splitProseSpans(text)
    .filter(span => !containsPlayerAttributedAction(span, player))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Identity/structured slots that are never prose. Rewriting one would corrupt
 * the mechanical change it encodes (or the entity it names), and the
 * structural gates already own every one of them.
 */
const NON_PROSE_FIELD_KEYS = new Set([
  'entity_id', 'name', 'entity_type', 'status', 'position', 'location',
  'faction_id', 'faction_members', 'visibility_network', 'relationships',
  'resources', 'skills', 'size', 'id', 'key', 'origin_id', 'target', 'type',
  'new_status', 'new_location', 'topic', 'is_true', 'controlling_faction',
]);

function redactValueProse(
  value: unknown,
  player: PlayerIdentity,
  surface: string,
  redactions: PlayerProseRedaction[],
): unknown {
  if (typeof value === 'string') {
    const redacted = redactProseString(value, player);
    if (redacted === null) return value;
    redactions.push({ surface, original: value });
    return redacted;
  }
  if (Array.isArray(value)) {
    // An entry redacted to nothing is DROPPED rather than left as an empty
    // string, so a scrubbed headline or region event never renders as a blank.
    return value
      .map((item, index) => redactValueProse(item, player, `${surface}[${index}]`, redactions))
      .filter(item => item !== '');
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      NON_PROSE_FIELD_KEYS.has(key) ? item : redactValueProse(item, player, `${surface}.${key}`, redactions),
    ]));
  }
  return value;
}

/**
 * Redacts invented player-action prose from any player-visible value, without
 * mutating the input. Returns the input unchanged (and no redactions) when an
 * observable attempt exists - the player's own conduct is theirs to author.
 */
export function redactInventedPlayerProseFromValue<T>(
  value: T,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
  surface: string,
): PlayerProseRedactionResult<T> {
  if (hasObservableAttempt) return { value, redactions: [] };
  const redactions: PlayerProseRedaction[] = [];
  const redacted = redactValueProse(value, player, surface, redactions) as T;
  return { value: redactions.length > 0 ? redacted : value, redactions };
}

/**
 * Delta types whose `reason` is NOT prose:
 *  - 'scheme' holds the private active_scheme JSON (D28) and never reaches
 *    the player at all - every player-facing surface already replaces it with
 *    an opaque marker;
 *  - 'faction' holds an entity id, an identity slot the structural gates own.
 * Rewriting either would corrupt what ai/core/engine.ts parses out of it.
 */
const NON_PROSE_REASON_DELTA_TYPES = new Set(['scheme', 'faction']);

/**
 * Delta types whose `reason` is a serialized payload the engine parses. The
 * prose INSIDE it is still player-visible (it becomes region stability and
 * current_events), so it is redacted field-by-field and re-serialized rather
 * than replaced wholesale.
 */
const JSON_PAYLOAD_REASON_DELTA_TYPES = new Set(['add_region']);

function redactDeltaReason(
  delta: EventDelta,
  index: number,
  player: PlayerIdentity,
  redactions: PlayerProseRedaction[],
): void {
  if (NON_PROSE_REASON_DELTA_TYPES.has(delta.type)) return;
  const surface = `deltas[${index}].reason`;

  if (JSON_PAYLOAD_REASON_DELTA_TYPES.has(delta.type)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(delta.reason);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
      const nested: PlayerProseRedaction[] = [];
      const redacted = redactValueProse(parsed, player, surface, nested);
      if (nested.length > 0) {
        redactions.push(...nested);
        delta.reason = JSON.stringify(redacted);
      }
      return;
    }
  }

  const redacted = redactProseString(delta.reason, player);
  if (redacted === null) return;
  redactions.push({ surface, original: delta.reason });
  delta.reason = redacted || REDACTED_PLAYER_PROSE_PLACEHOLDER;
}

/**
 * Removes invented player-action prose from an adjudication IN PLACE and
 * returns what was removed, so the turn commits with a clean player-visible
 * surface instead of failing. In place because ai/core/turn.ts threads one
 * adjudication object through mortality, engine application, and the history
 * entry; returning a copy would silently strand the redaction on whichever
 * reference a later step happened to hold.
 *
 * Surface policy:
 *  - `headlines[]`   - offending sentences removed; an emptied headline is
 *                      dropped, since a blank headline renders as a gap.
 *  - `deltas[].reason` / `entityActions[].notes` - offending sentences
 *                      removed, neutral placeholder when nothing survives.
 *                      The delta/action itself is KEPT: its mechanical
 *                      content was never the violation.
 *  - `add_entities[]` - prose fields only; identity slots are untouched.
 * `remove_entities` and every identity slot are structural and are handled by
 * assertNoInventedPlayerAction, which still throws.
 */
export function redactInventedPlayerProse(
  adjudication: Adjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): PlayerProseRedaction[] {
  if (hasObservableAttempt) return [];
  const redactions: PlayerProseRedaction[] = [];

  const keptHeadlines: string[] = [];
  adjudication.headlines.forEach((headline, index) => {
    const redacted = redactProseString(headline, player);
    if (redacted === null) {
      keptHeadlines.push(headline);
      return;
    }
    redactions.push({ surface: `headlines[${index}]`, original: headline });
    if (redacted) keptHeadlines.push(redacted);
  });
  adjudication.headlines = keptHeadlines;

  adjudication.entityActions.forEach((action, index) => {
    const redacted = redactProseString(action.notes, player);
    if (redacted === null) return;
    redactions.push({ surface: `entityActions[${index}].notes`, original: action.notes });
    action.notes = redacted || REDACTED_PLAYER_PROSE_PLACEHOLDER;
  });

  adjudication.deltas.forEach((delta, index) => redactDeltaReason(delta, index, player, redactions));

  if (adjudication.add_entities) {
    const nested: PlayerProseRedaction[] = [];
    const redacted = redactValueProse(adjudication.add_entities, player, 'add_entities', nested);
    if (nested.length > 0) {
      redactions.push(...nested);
      adjudication.add_entities = redacted as Adjudication['add_entities'];
    }
  }

  return redactions;
}

/**
 * Renders redactions as GM-console notes. The original text is included
 * verbatim: `gm_private` is rendered ONLY by components/GameMasterScreen.tsx
 * and is stripped from every player-bound prompt
 * (ai/prompts/narration.ts::sanitizeAdjudicationForNarration; the
 * simulation-state and monologue prompts read headlines/deltas, never
 * gm_private), so the GM can see exactly what was removed without any risk of
 * it reaching the player. Without this record a redaction would be a silent
 * outage.
 */
export function playerProseRedactionNotes(
  redactions: readonly PlayerProseRedaction[],
): string[] {
  return redactions.map(({ surface, original }) =>
    `${PLAYER_PROSE_REDACTION_TAG} Redacted invented player-action prose from ${surface} - the player never saw it, and the turn committed without it. Removed text: "${original}"`);
}

export interface PlayerVisibleStreamGate {
  /** Returns a newly safe cumulative prefix, or null when more text is needed. */
  push(cumulativeText: string): string | null;
  /** Validates and releases the complete player-visible text at stream end. */
  finish(completeText: string): string | null;
}

/**
 * Buffers the stream's incomplete final sentence. A prefix such as
 * "The die rolled " or "critical_" is harmless in isolation but can become
 * forbidden when the next provider chunk arrives; only a complete segment
 * is eligible for the UI callback, and the complete text is revalidated at
 * stream end.
 */
export function createPlayerVisibleStreamGate(): PlayerVisibleStreamGate {
  let lastReleased = '';

  return {
    push(cumulativeText: string): string | null {
      let completedEnd = 0;
      for (const match of cumulativeText.matchAll(/[.!?]/g)) {
        completedEnd = (match.index ?? 0) + match[0].length;
      }
      if (completedEnd === 0) return null;

      const completed = cumulativeText.slice(0, completedEnd).trimEnd();
      if (!completed || completed === lastReleased) return null;
      assertPlayerVisibleTextSafe(completed);
      lastReleased = completed;
      return completed;
    },
    finish(completeText: string): string | null {
      const complete = completeText.trim();
      assertPlayerVisibleTextSafe(complete);
      if (!complete || complete === lastReleased) return null;
      lastReleased = complete;
      return complete;
    },
  };
}
