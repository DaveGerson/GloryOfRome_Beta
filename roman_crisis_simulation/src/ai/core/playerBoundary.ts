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
 *     `assertNoInventedPlayerAction` / `redactInventedPlayerProse*`): on a
 *     no-observable-attempt turn, no provider response may author an avatar
 *     action or a player-originated state change - a hard semantic
 *     postcondition, not merely prompt guidance.
 *
 * CONTRACT-PRIMARY GATE (Task 2 of the actors-attribution refactor; spec:
 * docs/superpowers/specs/2026-07-28-schema-declared-attribution-design.md).
 * Every interchange prose field arrives with a declared `actors: string[]` -
 * the entity ids whose ACTIONS the text narrates (ai/core/actorsBoundary.ts,
 * D42; mention != actor, empty = pure description). On a no-attempt turn
 * the gate decides per FIELD:
 *
 *   1. DECLARED  - `actors` includes the player (`actorsIncludePlayer`, via
 *                  `samePlayerIdentity`) -> the WHOLE field is redacted/
 *                  rejected. Pure data; the prose itself is never parsed.
 *   2. TRIPWIRE  - `actors` does NOT include the player, but a sentence
 *                  OPENS with a player subject (proseSubjectAliases + 'i')
 *                  whose head predicate is not cleared by the curated
 *                  non-action allowlists (`tripwireFlagsPlayerConduct`) - the
 *                  declaration lied or erred, so just that sentence redacts/
 *                  rejects.
 *   3. MECHANICS - `playerOwnsDelta` / `assertNoPlayerRemoval` / the
 *                  hidden-mechanics half are UNTOUCHED by this refactor.
 *
 * The tripwire is a FLAT scan: no subordinate-clause splitting, no
 * possessive-phrase classification, no anaphora scopes, no passive-agent
 * scanning - all of that clause-grammar machinery is deleted (see
 * tests/playerBoundaryContract.test.ts and
 * docs/superpowers/plans/task-2-disposition-map.md for exactly what replaced
 * it and why).
 *
 * RESIDUAL-RISK ACCEPTANCE: a rival-declared field whose prose narrates the
 * player through a register the flat tripwire cannot reach (a possessive
 * agent, a passive-voice clause, a mid-sentence subject) costs at most ONE
 * contradictory sentence on the player-visible surface - an immersion
 * blemish, never a mechanical one. The mechanics gates above still block
 * every player-owned state effect regardless of what the prose says.
 */
import type { Adjudication, Entity, EntityAction, EventDelta } from '../../types';
import type { AdjudicationInterchange } from './actorsBoundary';

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
  /\baction[\s-]+modifier\s*(?::|=|\b(?:was|is|of)\b|[–—-])\s*[+-]?\d+\b/i,
] as const;

const HUMANIZED_MECHANIC_LABEL_PATTERNS = [
  /\b(?:outcome|resolution|check|result)[\s-]*tier\s*(?:[.:=–—-]\s*)*(?:critical[\s-]+failure|partial[\s-]+success|critical[\s-]+success|failure|success)\b/i,
  /\bfate[\s-]*band\s*(?:[.:=–—-]\s*)*(?:survives?[\s-]+with[\s-]+loss|survives?[\s-]+with[\s-]+boon|confirmed[\s-]+dead|gravely[\s-]+wounded|presumed[\s-]+dead|escapes[\s-]+openly|dies)\b/i,
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
 *
 * Accepts EITHER the committed `Adjudication` or the attributed
 * `AdjudicationInterchange` (D42) - both shapes carry the same fields this
 * function reads, so no reshaping cast is needed either way (mirrors
 * `redactInventedPlayerProse`'s precedent below).
 */
export function assertPlayerVisibleAdjudicationSafe(adjudication: AdjudicationInterchange | Adjudication): void {
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

/**
 * The declared-actors check: does a field's `actors` declaration name the
 * player? Pure data, no prose involved. Compared via `samePlayerIdentity`,
 * NOT `proseSubjectAliases`: an `actors` entry is an IDENTITY SLOT (it names
 * exactly one entity), so even a SHARED title written there denotes the
 * player and fails closed - unlike a prose subject, which a shared title can
 * legitimately style a third party through.
 */
export function actorsIncludePlayer(actors: readonly string[], player: PlayerIdentity): boolean {
  return actors.some(actor => samePlayerIdentity(actor, player));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verb groups whose subject relates a perception, cognition, feeling, or
 * unaccomplished intention rather than performing an act. Shared with the
 * will/would future-tense allowlist below: a FUTURE perception, cognition,
 * feeling, or intention is still not an act either.
 */
const NON_ACTION_VERB_GROUPS = [
  // Perception and received information.
  '(?:see|sees|saw|seen|hear|hears|heard|notice|notices|noticed|observe|observes|observed|perceive|perceives|perceived|witness|witnesses|witnessed|learn|learns|learned|learnt)',
  // Cognition, uncertainty, and internal questions.
  '(?:know|knows|knew|known|think|thinks|thought|believe|believes|believed|suspect|suspects|suspected|wonder|wonders|wondered|understand|understands|understood|remember|remembers|remembered|recognize|recognizes|recognized|realize|realizes|realized|infer|infers|inferred|weigh|weighs|weighed)',
  // Feelings and stable internal conditions.
  '(?:feel|feels|felt|fear|fears|feared|dread|dreads|dreaded|regret|regrets|regretted|seem|seems|seemed|remain|remains|remained)',
  // Explicit intentions are not accomplished acts. Bare future/modal verbs
  // are excluded: "you will dispatch" still authors player conduct.
  '(?:intend|intends|intended|plan|plans|planned|hope|hopes|hoped|want|wants|wanted|wish|wishes|wished|consider|considers|considered|contemplate|contemplates|contemplated|expect|expects|expected|need|needs|needed)',
] as const;

const NON_ACTION_PLAYER_PREDICATE = new RegExp(`^(?:${NON_ACTION_VERB_GROUPS.join('|')})\\b`, 'u');

/**
 * Verbs whose subject UNDERGOES rather than acts: waiting, forbearing,
 * receiving, owing, lacking. These are the register a no-attempt turn is
 * actually written in - "you wait", "you receive a letter", "you lack the
 * coin" - and none of them heads an act the player performed.
 *
 * Deliberately ABSENT: every verb that also reads as conduct in the same
 * surface form. 'suffer' stays out (a possessive-instrument condition
 * register the flat tripwire never reaches in the first place, since "Your
 * guards suffer ..." never opens on a player subject); 'withdraw', 'hold',
 * 'bear', 'keep', 'delay', and 'pause' stay out for the same reason.
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
 * noun phrase. The bound matters even for a single predicate check: without
 * it, an object-taking tail after an adjective-shaped word would read as
 * that adjective's own complement and clear a predicate that actually names
 * a real object of conduct.
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
 * clause says what the player HAS BECOME - the world's doing, legal on a
 * no-attempt turn. A determiner-headed complement is a direct object and
 * still fails closed.
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

/**
 * MODAL handling (controller ruling, Task 2 IMPLEMENTER NOTES). can/could/
 * may/might/must/should mark a hypothetical or a bare capacity, not an
 * accomplished act - 'You could seize the granary.' is a suggestion, not
 * conduct - so they clear ANY verb that follows.
 *
 * will/would are deliberately NOT widened: they preserve the old grammar's
 * documented intent that a bare future verb still authors player conduct
 * ('You will dispatch spies.' / "You'll dispatch spies." both still trip),
 * clearing only the SAME curated non-action verb groups the present tense
 * clears - a future perception, cognition, feeling, or intention is still
 * not an act, but a future CONDUCT verb is still conduct.
 */
const HYPOTHETICAL_MODAL_PREDICATE = /^(?:can|could|may|might|must|should)\s+\p{L}+\b/u;
const FUTURE_MODAL_NON_ACTION_PREDICATE = new RegExp(
  `^(?:will|would)\\s+(?:${NON_ACTION_VERB_GROUPS.join('|')}|(?:be\\b(?!\\s+[\\p{L}\\p{N}_-]+ing\\b)))\\b`,
  'u',
);

const LEADING_PREDICATE_ADVERBS = /^(?:(?:also|already|clearly|currently|deeply|dimly|fully|inwardly|merely|now|perhaps|personally|plainly|privately|probably|publicly|quietly|secretly|still|then|truly|visibly|[\p{L}]+ly)\s+)*/u;

/**
 * Classifies a predicate (the text immediately after a sentence-initial
 * player subject) as an allowed no-attempt register. This is the tripwire's
 * entire precision: everything else in the file is either mechanics
 * (untouched) or plumbing around this one check.
 */
function isAllowedNoAttemptPredicate(predicate: string, auxiliaryStrips = 0): boolean {
  const withoutAdverbs = predicate.replace(LEADING_PREDICATE_ADVERBS, '');
  if (NEGATED_PLAYER_PREDICATE.test(withoutAdverbs)) return true;
  if (COPULAR_STATE_PREDICATE.test(withoutAdverbs)) return true;
  if (CONTINUOUS_STATE_PREDICATE.test(withoutAdverbs)
    || NON_ACTION_PLAYER_PREDICATE.test(withoutAdverbs)
    || HYPOTHETICAL_MODAL_PREDICATE.test(withoutAdverbs)
    || FUTURE_MODAL_NON_ACTION_PREDICATE.test(withoutAdverbs)
    || RECEPTIVE_PLAYER_PREDICATE.test(withoutAdverbs)
    || EMPTY_ACT_PREDICATE.test(withoutAdverbs)
    || ADJECTIVAL_STATE_PREDICATE.test(withoutAdverbs)
    || INCHOATIVE_STATE_PREDICATE.test(withoutAdverbs)) return true;
  if (auxiliaryStrips >= MAX_AUXILIARY_STRIPS) return false;
  const stripped = withoutAdverbs.replace(PERFECT_OR_PROGRESSIVE_AUXILIARY, '');
  return stripped !== withoutAdverbs && isAllowedNoAttemptPredicate(stripped, auxiliaryStrips + 1);
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
    .replace(/[‘’]/gu, "'")
    .replace(/\b(?:don't|doesn't|didn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|can't|couldn't|won't|wouldn't|shouldn't|mustn't|mightn't|needn't)\b/gu,
      match => negativeContractions[match])
    .replace(/\b(you|i)'ll\b/gu, '$1 will')
    .replace(/\bi'm\b/gu, 'i am')
    .replace(/\byou're\b/gu, 'you are')
    .replace(/\b(you|i)'ve\b/gu, '$1 have');
}

/**
 * The sentence terminators shared by `tripwireFlagsPlayerConduct`'s sentence
 * split and `splitProseSpans`' span split (below) - ONE source rather than a
 * keep-in-sync comment, so the two can never silently drift apart into
 * classifying and redacting different sentence boundaries.
 */
const SENTENCE_TERMINATOR_CHARACTER_CLASS = '.!?;\\n';
const SENTENCE_SPLIT_PATTERN = new RegExp(`[${SENTENCE_TERMINATOR_CHARACTER_CLASS}]+`, 'u');

/**
 * Finds a sentence-initial player subject (an optional leading "the" plus a
 * proseSubjectAlias) and returns the predicate text that follows it, or null
 * when the sentence does not open on one. FLAT: only the sentence's leading
 * words are examined - no clause splitting, no possessive-phrase descent, no
 * anaphora, no passive scan.
 *
 * Presentation wrappers (blockquote markers, list bullets, Markdown
 * emphasis, straight/curly quotes) are stripped before the anchor match via
 * `stripBoundedPresentationWrappers` - the SAME helper the hidden-mechanics
 * half above already relies on to treat them as transparent (pinned there by
 * '> Critical success.' and its siblings). Without this, a provider could
 * bypass the gate on invented conduct by formatting alone ('- You seize the
 * treasury.', '"You seize the treasury."'): the wrapper is presentation, not
 * part of the sentence being classified.
 *
 * `aliases` arrives PRE-SORTED by descending length (tripwireFlagsPlayerConduct
 * sorts once per call, not once per sentence): a longer alias must be tried
 * before a shorter one that happens to be its prefix (e.g. a multi-word name
 * before a single-word title).
 *
 * An alias immediately followed by "'s" is a POSSESSIVE determiner, not this
 * sentence's subject ("The Emperor's guards arrest the envoy." names the
 * guards, not the Emperor, as the clause's subject) - the negative lookahead
 * excludes it rather than misreading "Emperor" as the acting subject with an
 * unparseable predicate.
 *
 * The alias match itself is a LITERAL lowercase comparison, not
 * `wordNormalized`: a hyphen/underscore prose variant of a name or id alias
 * ("Gaius-Testus", "gaius_testus") will not match here - the generic
 * 'player'/'you'/'avatar' aliases are the safety net for that register,
 * exactly as before the rewrite.
 */
function sentenceInitialPlayerPredicate(
  sentence: string,
  aliasesByDescendingLength: readonly string[],
): string | null {
  const stripped = stripBoundedPresentationWrappers(sentence);
  if (!stripped) return null;
  for (const alias of aliasesByDescendingLength) {
    const normalizedAlias = alias.trim().toLocaleLowerCase();
    if (!normalizedAlias) continue;
    const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, '\\s+');
    const match = new RegExp(`^(?:the\\s+)?${aliasPattern}\\b(?!'s)`, 'u').exec(stripped);
    if (match) return stripped.slice(match[0].length).trim();
  }
  return null;
}

/**
 * The flat tripwire: TRUE when some sentence OPENS with a player subject
 * (proseSubjectAliases + 'i') whose head predicate is not cleared by the
 * allowlists above. This is the only prose-side player-conduct classifier
 * left in the module - see the file header for the contract this implements
 * and the residual risk it accepts.
 */
export function tripwireFlagsPlayerConduct(text: string, player: PlayerIdentity): boolean {
  const normalized = normalizePlayerContractions(normalizeBoundaryText(text).toLocaleLowerCase());
  const aliases = [...proseSubjectAliases(player), 'i'].sort((a, b) => b.length - a.length);
  return normalized.split(SENTENCE_SPLIT_PATTERN).some(sentence => {
    const predicate = sentenceInitialPlayerPredicate(sentence, aliases);
    return predicate !== null && !isAllowedNoAttemptPredicate(predicate);
  });
}

function valueFlagsPlayerConduct(value: unknown, player: PlayerIdentity): boolean {
  if (typeof value === 'string') return tripwireFlagsPlayerConduct(value, player);
  if (Array.isArray(value)) return value.some(item => valueFlagsPlayerConduct(item, player));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .some(item => valueFlagsPlayerConduct(item, player));
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
 * Rejects invented player-action prose (and structural player removal) on
 * any separately player-visible provider result, such as narration or the
 * empire-level simulation state.
 *
 * DECLARATION-AWARE: pass the field's declared `actors` (per
 * actorsBoundary.ts, D42) when it is available for the SINGLE prose field
 * being validated. A player declaration throws unconditionally - pure data,
 * the prose is never parsed; an undeclared or rival-declared field falls
 * through to `tripwireFlagsPlayerConduct`. Omitting `actors` (existing 3-arg
 * calls) means "no declaration available" and runs the tripwire alone,
 * exactly as before.
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
  actors?: readonly string[],
): void {
  if (hasObservableAttempt) return;
  if (valueRemovesPlayer(value, player)) throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  const declaredPlayer = actors !== undefined && actorsIncludePlayer(actors, player);
  if (declaredPlayer || valueFlagsPlayerConduct(value, player)) {
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
 * PROSE IS NOT CHECKED HERE. The prose classifier is a heuristic over
 * headlines, delta `reason`, and entityAction `notes`; a false positive
 * there used to kill the turn after 4-8 provider calls even though nothing
 * mechanical had been violated - including on the DEBT HAS TEETH prose
 * ai/prompts/adjudication.ts itself solicits. Prose now goes through
 * `redactInventedPlayerProse`: a prose leak is a narrative blemish, a delta
 * leak is a mechanical violation, and they must not share a failure mode.
 *
 * Accepts EITHER the committed `Adjudication` or the attributed
 * `AdjudicationInterchange` (D42): the fields read here (entityAction ids,
 * delta identity, remove_entities) are identical across both shapes.
 */
export function assertNoInventedPlayerAction(
  adjudication: AdjudicationInterchange | Adjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): void {
  if (hasObservableAttempt) return;

  const inventedAction = adjudication.entityActions.some(action => samePlayerIdentity(action.id, player));
  // Cast: zEventDelta's nullable fields infer `| null` while types.ts's
  // EventDelta declares them optional-only (`| undefined`) - the same
  // documented nullable-vs-optional gap actorsBoundary.ts's
  // stripActorsFromEventDelta already casts around; playerOwnsDelta never
  // reads a field where the gap matters.
  const playerOriginatedDelta = adjudication.deltas.some(delta => playerOwnsDelta(delta as EventDelta, player));
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
  return valueFlagsPlayerConduct(value, player);
}

/**
 * Splits text into spans on the SAME terminators `tripwireFlagsPlayerConduct`
 * splits sentences on, keeping each terminator with its span, so a span that
 * survives reclassification is byte-identical to what the classifier cleared.
 */
const PROSE_SPAN_SPLIT_PATTERN = new RegExp(`([${SENTENCE_TERMINATOR_CHARACTER_CLASS}]+\\s*)`, 'u');
const PROSE_SPAN_TERMINATOR_PATTERN = new RegExp(`^[${SENTENCE_TERMINATOR_CHARACTER_CLASS}]`, 'u');

function splitProseSpans(text: string): string[] {
  const spans: string[] = [];
  let current = '';
  for (const token of text.split(PROSE_SPAN_SPLIT_PATTERN)) {
    if (!token) continue;
    if (PROSE_SPAN_TERMINATOR_PATTERN.test(token)) {
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
 * tripwire-flagged sentence removed - '' when nothing survives. Sentence-level
 * so a headline or reason that merely trails an invented clause keeps its
 * legitimate content.
 */
function redactProseString(text: string, player: PlayerIdentity): string | null {
  if (!tripwireFlagsPlayerConduct(text, player)) return null;
  return splitProseSpans(text)
    .filter(span => !tripwireFlagsPlayerConduct(span, player))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Declaration-aware field redaction, shared by the value shell and the
 * adjudication shell: a player declaration redacts the WHOLE field as pure
 * data (the prose is never parsed); otherwise the flat tripwire audits it
 * sentence-by-sentence, the same plumbing an undeclared field always used.
 * Returns null when the field is untouched.
 */
function redactDeclarationAwareText(
  text: string,
  actors: readonly string[] | undefined,
  player: PlayerIdentity,
): string | null {
  if (actors !== undefined && actorsIncludePlayer(actors, player)) return '';
  return redactProseString(text, player);
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
 *
 * DECLARATION-AWARE: pass the ONE prose field's declared `actors` (per
 * actorsBoundary.ts) as the trailing argument - `value` must then be that
 * field's text, never a whole structured object. A player declaration
 * redacts the whole field to '' regardless of what the prose says (pure
 * data); an undeclared or rival-declared field falls through to the
 * sentence-level tripwire, exactly as an omitted `actors` (existing 4-arg
 * calls) already does for structured values via the legacy traversal below.
 */
export function redactInventedPlayerProseFromValue<T>(
  value: T,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
  surface: string,
  actors?: readonly string[],
): PlayerProseRedactionResult<T> {
  if (hasObservableAttempt) return { value, redactions: [] };

  if (actors !== undefined && typeof value === 'string') {
    const redacted = redactDeclarationAwareText(value, actors, player);
    if (redacted !== null) {
      return { value: redacted as unknown as T, redactions: [{ surface, original: value }] };
    }
    return { value, redactions: [] };
  }

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
  delta: EventDelta & { actors?: readonly string[] },
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

  const redacted = redactDeclarationAwareText(delta.reason, delta.actors, player);
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
 * Accepts EITHER the committed `Adjudication` (bare headline strings, no
 * `actors` siblings - tripwire-only) OR the attributed `AdjudicationInterchange`
 * (actorsBoundary.ts's {text, actors} headline items, `actors` siblings on
 * entityActions/deltas - declaration-aware) BEFORE D42's commit-boundary
 * strip: the gate must see the declarations to close the B7 gaps by
 * declaration, so the strip happens after this call, not before it.
 *
 * Surface policy:
 *  - `headlines[]`   - a declared-player headline is DROPPED outright; an
 *                      undeclared/rival-declared headline has only its
 *                      tripwire-flagged sentences removed, dropped entirely
 *                      when nothing survives.
 *  - `deltas[].reason` / `entityActions[].notes` - same redaction, but the
 *                      delta/action itself is KEPT (its mechanical content
 *                      was never the violation) with a neutral placeholder
 *                      when nothing survives.
 *  - `add_entities[]` - prose fields only, tripwire-only (no per-field
 *                      declaration exists on this shape); identity slots are
 *                      untouched.
 * `remove_entities` and every identity slot are structural and are handled by
 * `assertNoInventedPlayerAction`, which still throws.
 */
export function redactInventedPlayerProse(
  adjudication: AdjudicationInterchange | Adjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): PlayerProseRedaction[] {
  if (hasObservableAttempt) return [];
  const redactions: PlayerProseRedaction[] = [];

  // Both accepted shapes are handled structurally rather than by re-deriving
  // TypeScript's discriminated union: a headline is either a bare string (the
  // committed Adjudication) or a {text, actors} item (the attributed
  // interchange); entityActions/deltas optionally carry an `actors` sibling
  // the same way. One cast lets a single implementation walk both shapes.
  const adj = adjudication as unknown as {
    headlines: Array<string | { text: string; actors?: readonly string[] }>;
    entityActions: Array<EntityAction & { actors?: readonly string[] }>;
    deltas: Array<EventDelta & { actors?: readonly string[] }>;
    add_entities?: Adjudication['add_entities'];
  };

  const keptHeadlines: typeof adj.headlines = [];
  adj.headlines.forEach((headline, index) => {
    const text = typeof headline === 'string' ? headline : headline.text;
    const actors = typeof headline === 'string' ? undefined : headline.actors;
    const redacted = redactDeclarationAwareText(text, actors, player);
    if (redacted === null) {
      keptHeadlines.push(headline);
      return;
    }
    redactions.push({ surface: `headlines[${index}]`, original: text });
    if (redacted) keptHeadlines.push(typeof headline === 'string' ? redacted : { ...headline, text: redacted });
  });
  adj.headlines = keptHeadlines;

  adj.entityActions.forEach((action, index) => {
    const redacted = redactDeclarationAwareText(action.notes, action.actors, player);
    if (redacted === null) return;
    redactions.push({ surface: `entityActions[${index}].notes`, original: action.notes });
    action.notes = redacted || REDACTED_PLAYER_PROSE_PLACEHOLDER;
  });

  adj.deltas.forEach((delta, index) => redactDeltaReason(delta, index, player, redactions));

  if (adj.add_entities) {
    const nested: PlayerProseRedaction[] = [];
    const redacted = redactValueProse(adj.add_entities, player, 'add_entities', nested);
    if (nested.length > 0) {
      redactions.push(...nested);
      adj.add_entities = redacted as Adjudication['add_entities'];
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
