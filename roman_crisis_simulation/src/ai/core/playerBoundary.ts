import type { Adjudication, EventDelta } from '../../types';

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

const DICE_NOTATION_PATTERN = /\bd(?:4|6|8|10|12|20|100)\b/i;
const MECHANICAL_ROLL_PATTERNS = [
  /\b(?:roll(?:ed|ing)?|die|dice)\b[^.!?\n]{0,32}\b(?:natural\s+)?\d+\b/i,
  /\b(?:natural\s+)?\d+\b[^.!?\n]{0,32}\b(?:roll(?:ed|ing)?|die|dice)\b/i,
] as const;

function containsHiddenMechanics(text: string): boolean {
  return HIDDEN_MECHANIC_TOKEN_PATTERN.test(text)
    || DICE_NOTATION_PATTERN.test(text)
    || MECHANICAL_ROLL_PATTERNS.some(pattern => pattern.test(text));
}

function assertValueContainsNoHiddenMechanics(value: unknown): void {
  if (typeof value === 'string') {
    if (containsHiddenMechanics(value)) throw new Error(PLAYER_MECHANICS_BOUNDARY_ERROR);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertValueContainsNoHiddenMechanics(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertValueContainsNoHiddenMechanics(item);
    }
  }
}

/**
 * Enforces the final code-side boundary on provider-authored prose that can
 * reach a player-facing surface. The thrown error is deliberately stable
 * and content-free: offending tokens must not be reflected into App error
 * UI or logs assembled from the error message.
 */
export function assertPlayerVisibleTextSafe(text: string): void {
  assertValueContainsNoHiddenMechanics(text);
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

  assertValueContainsNoHiddenMechanics({
    turn: adjudication.turn,
    entityActions: adjudication.entityActions,
    deltas: visibleDeltas,
    headlines: adjudication.headlines,
    add_entities: visibleAddedEntities,
    remove_entities: adjudication.remove_entities,
  });
}

function playerOwnsDelta(delta: EventDelta, playerId: string): boolean {
  if (delta.origin_id === playerId) return true;

  const [rootEntityId] = delta.key.split(':');
  if (rootEntityId !== playerId) return false;

  // Resource/faction/status keys identify the entity AFFECTED, not the
  // actor who caused the change. Rejecting those would also reject valid
  // independent taxation, theft, attack, or political movement that happens
  // to affect the avatar during a question-only turn. Relation keys are
  // directional (A's perception of B), while a scheme key identifies the
  // owner of the authored design, so those roots do express player origin.
  return delta.type === 'relation' || delta.type === 'scheme';
}

/**
 * A question/private-only submission is a hard semantic postcondition, not
 * merely prompt guidance. Any provider response that authors an avatar
 * action or a player-originated state change invalidates the entire response;
 * callers must reject the turn rather than sanitize and partially commit it.
 * NPC/world activity remains legal.
 */
export function assertNoInventedPlayerAction(
  adjudication: Pick<Adjudication, 'entityActions' | 'deltas'>,
  playerId: string,
  hasObservableAttempt: boolean,
): void {
  if (hasObservableAttempt) return;

  const inventedAction = adjudication.entityActions.some(action => action.id === playerId);
  const playerOriginatedDelta = adjudication.deltas.some(delta => playerOwnsDelta(delta, playerId));
  if (inventedAction || playerOriginatedDelta) {
    throw new Error(PLAYER_ACTION_BOUNDARY_ERROR);
  }
}
