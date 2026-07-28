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

type PlayerIdentity = Pick<Entity, 'entity_id' | 'name' | 'position'>;

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

function samePlayerIdentity(value: string | null | undefined, player: PlayerIdentity): boolean {
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
    if (!match || /\b(?:not|never|no)\b/u.test(normalized.slice(0, match.index))) continue;
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

function isAllowedNoAttemptPredicate(predicate: string): boolean {
  const withoutAdverbs = predicate.replace(LEADING_PREDICATE_ADVERBS, '');
  if (NEGATED_PLAYER_PREDICATE.test(withoutAdverbs)) return true;
  if (COPULAR_STATE_PREDICATE.test(withoutAdverbs)) return true;
  return CONTINUOUS_STATE_PREDICATE.test(withoutAdverbs)
    || NON_ACTION_PLAYER_PREDICATE.test(withoutAdverbs)
    || MODAL_NON_ACTION_PREDICATE.test(withoutAdverbs)
    || SAFE_CONTEMPLATIVE_IDIOM.test(withoutAdverbs);
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

function passiveAgentPattern(aliasPattern: string): RegExp {
  const participle = '(?:[\\p{L}]+(?:ed|en|wn)|sent|made|done|held|cast|put|set|built|brought|bought|caught|taught|taken|given|seen|known|shown|told|left|kept|met|read|said|paid|led|found|lost|won)';
  return new RegExp(`\\b${participle}\\s+by\\s+(?:the\\s+)?${aliasPattern}\\b`, 'u');
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
const PLAYER_OBJECT_PREDECESSORS = new Set([
  'to', 'for', 'from', 'of', 'by', 'with', 'without', 'near', 'beside', 'behind', 'before', 'after',
  'around', 'toward', 'towards', 'against', 'among', 'tells', 'told', 'shows', 'showed', 'gives', 'gave',
  'brings', 'brought', 'warns', 'warned', 'asks', 'asked', 'greets', 'greeted', 'addresses', 'addressed',
  'approaches', 'approached', 'follows', 'followed', 'watches', 'watched', 'sees', 'saw', 'finds', 'found',
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
      if (!earliest || index < earliest.index) earliest = { index, end };
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
      if (passiveMatch) {
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

function playerOwnsDelta(delta: EventDelta, player: PlayerIdentity): boolean {
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
 * A question/private-only submission is a hard semantic postcondition, not
 * merely prompt guidance. Any provider response that authors an avatar
 * action or a player-originated state change invalidates the entire response;
 * callers must reject the turn rather than sanitize and partially commit it.
 * NPC/world activity remains legal.
 */
export function assertNoInventedPlayerAction(
  adjudication: Adjudication,
  player: PlayerIdentity,
  hasObservableAttempt: boolean,
): void {
  if (hasObservableAttempt) return;

  const inventedAction = adjudication.entityActions.some(action =>
    samePlayerIdentity(action.id, player)
      || containsPlayerAttributedAction(action.notes, player));
  const playerOriginatedDelta = adjudication.deltas.some(delta => playerOwnsDelta(delta, player));
  const visibleDeltas = adjudication.deltas.map(delta => delta.type === 'scheme'
    ? { ...delta, reason: '[private scheme changed]' }
    : delta);
  const providerAuthoredVisibleAction = valueContainsPlayerAttributedAction({
    entityActions: adjudication.entityActions,
    deltas: visibleDeltas,
    headlines: adjudication.headlines,
    add_entities: adjudication.add_entities?.map(entity => {
      const { secret_truth, ...visible } = entity;
      return visible;
    }),
    remove_entities: adjudication.remove_entities,
  }, player);
  const removesPlayer = valueRemovesPlayer({ remove_entities: adjudication.remove_entities }, player);

  if (inventedAction || playerOriginatedDelta || providerAuthoredVisibleAction || removesPlayer) {
    throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  }
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
