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
  /\bmargin\s*(?::|=|\b(?:was|is|of)\b)\s*[+-]?\d+\b/i,
] as const;

const HUMANIZED_MECHANIC_LABEL_PATTERNS = [
  /\boutcome[\s-]*tier\s*(?::|=|-)?\s*(?:critical[\s-]+failure|partial[\s-]+success|critical[\s-]+success|failure|success)\b/i,
  /\bfate[\s-]*band\s*(?::|=|-)?\s*(?:survive[\s-]+with[\s-]+loss|survive[\s-]+with[\s-]+boon|confirmed[\s-]+dead|gravely[\s-]+wounded|presumed[\s-]+dead|escapes[\s-]+openly|dies)\b/i,
] as const;

/** Canonicalizes visually equivalent or invisibly separated provider text. */
function normalizeBoundaryText(text: string): string {
  return text.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}

function containsHiddenMechanics(text: string): boolean {
  const normalized = normalizeBoundaryText(text);
  return HIDDEN_MECHANIC_TOKEN_PATTERN.test(normalized)
    || DICE_NOTATION_PATTERN.test(normalized)
    || MECHANICAL_ROLL_PATTERNS.some(pattern => pattern.test(normalized))
    || HUMANIZED_MECHANIC_LABEL_PATTERNS.some(pattern => pattern.test(normalized));
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

function samePlayerIdentity(value: string | null | undefined, player: PlayerIdentity): boolean {
  if (!value) return false;
  const candidate = compactIdentity(value);
  return candidate.length > 0 && identityAliases(player).some(alias => compactIdentity(alias) === candidate);
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
  // Intentions and modal/future contemplation are not accomplished acts.
  '(?:intend|intends|intended|plan|plans|planned|hope|hopes|hoped|want|wants|wanted|wish|wishes|wished|consider|considers|considered|contemplate|contemplates|contemplated|expect|expects|expected|need|needs|needed|must|should|may|might|could|can|would|will)',
].join('|')})\\b`, 'u');

const NEGATED_PLAYER_PREDICATE = /^(?:never\b|no\s+longer\b|(?:do|does|did|am|are|is|was|were|have|has|had|can|could|will|would|should|must|may|might)\s+not\b|cannot\b)/u;
const COPULAR_STATE_PREDICATE = /^(?:am|are|is|was|were)\b(?!\s+[\p{L}\p{N}_-]+ing\b)/u;
const LEADING_PREDICATE_ADVERBS = /^(?:(?:also|already|clearly|currently|deeply|dimly|fully|inwardly|merely|now|perhaps|personally|plainly|privately|probably|publicly|quietly|secretly|still|then|truly|visibly|[\p{L}]+ly)\s+)*/u;

function isAllowedNoAttemptPredicate(predicate: string): boolean {
  const withoutAdverbs = predicate.replace(LEADING_PREDICATE_ADVERBS, '');
  if (NEGATED_PLAYER_PREDICATE.test(withoutAdverbs)) return true;
  if (COPULAR_STATE_PREDICATE.test(withoutAdverbs)) return true;
  return NON_ACTION_PLAYER_PREDICATE.test(withoutAdverbs);
}

function passiveAgentPattern(aliasPattern: string): RegExp {
  const participle = '(?:[\\p{L}]+(?:ed|en|wn)|sent|made|done|held|cast|put|set|built|brought|bought|caught|taught|taken|given|seen|known|shown|told|left|kept|met|read|said|paid|led|found|lost|won)';
  return new RegExp(`\\b${participle}\\s+by\\s+(?:the\\s+)?${aliasPattern}\\b`, 'u');
}

function containsPlayerAttributedAction(text: string, player: PlayerIdentity): boolean {
  const normalized = normalizeBoundaryText(text).toLocaleLowerCase();
  if (!wordNormalized(normalized)) return false;
  const aliases = [...identityAliases(player), 'i'];

  return aliases.some(alias => {
    const normalizedAlias = wordNormalized(alias);
    if (!normalizedAlias) return false;
    const aliasPattern = escapeRegExp(normalizedAlias).replace(/\s+/g, '\\s+');
    for (const clause of normalized.split(/[.!?;\n]+/u)) {
      const wordClause = clause
        .replace(/[^\p{L}\p{N},:'_-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!wordClause) continue;

      const passivePattern = passiveAgentPattern(aliasPattern);
      const passiveMatch = passivePattern.exec(wordClause);
      if (passiveMatch) {
        const passivePrefix = wordClause.slice(0, passiveMatch.index);
        if (!/\b(?:not|never|no)\b/u.test(passivePrefix)) return true;
      }

      // Treat aliases as grammatical subjects only at the start of a clause
      // or after a clear discourse/clause boundary. This avoids mistaking
      // ordinary object phrases such as "a messenger tells you the news" for
      // player-authored acts while still failing closed on the predicate once
      // the provider makes the player the subject.
      const subjectPattern = new RegExp(
        `(?:^|,\\s*|:\\s*|\\b(?:and|as|because|before|but|later|meanwhile|now|so|then|when|while)\\s+)(?:the\\s+)?${aliasPattern}\\s+(.+)$`,
        'u',
      );
      const subjectMatch = subjectPattern.exec(wordClause);
      if (!subjectMatch) continue;
      const predicate = wordNormalized(subjectMatch[1]);
      if (predicate && !isAllowedNoAttemptPredicate(predicate)) return true;
    }
    return false;
  });
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

function playerOwnsDelta(delta: EventDelta, player: PlayerIdentity): boolean {
  if (samePlayerIdentity(delta.origin_id, player)) return true;
  const [rootEntityId] = delta.key.split(':');
  return samePlayerIdentity(rootEntityId, player);
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
  if (!hasObservableAttempt && valueContainsPlayerAttributedAction(value, player)) {
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

  if (inventedAction || playerOriginatedDelta || providerAuthoredVisibleAction) {
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
