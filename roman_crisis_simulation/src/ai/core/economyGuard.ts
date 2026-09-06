/**
 * ai/core/economyGuard.ts
 *
 * The CONSERVATION GUARD (DESIGN_DECISIONS.md D46; BACKLOG T1's guardrail):
 * engine-side sanity rules on the adjudicator's 'resource' deltas, run in
 * ai/core/turn.ts (and ai/mocks.ts, for parity) after the last no-attempt
 * boundary and BEFORE applyAdjudication.
 *
 * What it does, and only this:
 *   1. folds every resource delta's key onto its canonical spelling
 *      (ai/core/resourceRegistry.ts) - for every entity, so no quantity ever
 *      lives under two names on the roster;
 *   2. on the PLAYER's deltas - the systemic economy (D6) - caps what a
 *      single week may MINT out of nothing: an unsourced treasury windfall,
 *      free intel, a reputation that jumps by tens, men who appear unpaid.
 * Losses are never touched (the world may always take), NPC bags are never
 * clamped (they are narrative, D6, and unknowable, D5), and unknown minted
 * keys pass through untouched (D6). Every clamp is recorded as an
 * `[Economy]` gm_private note for the GM console - the same refuse-and-record
 * voice ai/core/engine.ts uses - and NEVER as player-facing prose.
 *
 * Why clamps, not rejections: a whole turn's worth of provider calls is
 * already spent by the time deltas exist, and a retry re-rolls the same
 * nondeterministic model (the lesson ai/core/playerBoundary.ts's prose
 * redaction records). Reducing an unsourced gain to what a week can honestly
 * yield keeps the narrative (the gain still happened, smaller) and the
 * books.
 *
 * TUNING RATIONALE:
 *   WINDFALL_FREE_ALLOWANCE / WINDFALL_HOLDINGS_FRACTION - an unexplained
 *   gain up to a couple of thousand, or half of what you already hold, is
 *   "a good week" (T1's stochastic soft resource); more than that must name
 *   a payer, a creditor, or a price in standing. Half of holdings scales the
 *   allowance to the destiny: a senator's good week is bigger than a
 *   broker's.
 *   SOURCE_FRACTION - a named source must explain at least half the gain,
 *   or it is a fig leaf.
 *   INTEL_GRANT_CAP - the engine regenerates investigations
 *   (ai/core/ledger.ts); the model may reward at most one a week, so intel
 *   stays a currency the exchequer prices rather than a thing narration
 *   gives away.
 *   STANDING_MAX_SWING - a 0-100 reputation moves by a few points a week;
 *   fifteen is already a coup or a triumph.
 *   RECRUIT_FREE_MEN / RECRUIT_FREE_FRACTION - volunteers rally in a good
 *   week (twenty men, or a tenth of the standing force); more than that is
 *   a levy someone paid for, and the exchequer is where levies are bought.
 */

import { Entity, EventDelta } from '../../types';
import { canonicalResourceKey, classifyResourceKey, formatArabic, numericResource } from './resourceRegistry';

export const WINDFALL_FREE_ALLOWANCE = 2_000;
export const WINDFALL_HOLDINGS_FRACTION = 0.5;
export const SOURCE_FRACTION = 0.5;
/** A standing debit at least this large counts as the price of a tax, extortion, or forced loan. */
export const WINDFALL_STANDING_PRICE = 3;
export const INTEL_GRANT_CAP = 1;
export const STANDING_MAX_SWING = 15;
export const RECRUIT_FREE_MEN = 20;
export const RECRUIT_FREE_FRACTION = 0.1;

const FORCE_KEYS: readonly string[] = ['troops', 'guards', 'agents', 'legions'];
const INTEL_KEYS: readonly string[] = ['investigations', 'deep_analyses'];

export interface EconomyGuardResult {
  /** The deltas to apply: keys folded, player windfalls clamped. Non-resource deltas pass by reference. */
  deltas: EventDelta[];
  /** `[Economy]` notes for gm_private (empty when nothing was folded or clamped). */
  notes: string[];
}

function splitResourceKey(key: string): { root: string; resource: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  return { root: key.slice(0, separator), resource: key.slice(separator + 1) };
}

/**
 * Scales the positive deltas in `group` so their sum becomes `target`
 * (rounded to whole units, the largest delta absorbing the rounding), in
 * place on the copies the caller already made.
 */
function scaleGroup(group: EventDelta[], target: number): void {
  const total = group.reduce((sum, delta) => sum + delta.delta, 0);
  if (total <= 0 || target >= total) return;
  let remaining = target;
  group.forEach((delta, i) => {
    if (i === group.length - 1) {
      delta.delta = Math.max(0, remaining);
      return;
    }
    const share = Math.round((delta.delta / total) * target);
    delta.delta = share;
    remaining -= share;
  });
}

/**
 * Applies the guard. Pure: returns new delta objects for every 'resource'
 * delta (other delta types are returned by reference); never mutates its
 * inputs. `entities` is the PRE-turn roster - allowances are measured
 * against what the player held before the week's events.
 */
export function guardEconomy(deltas: EventDelta[], entities: Entity[], playerId: string): EconomyGuardResult {
  const notes: string[] = [];
  const player = entities.find(entity => entity.entity_id === playerId);

  // 1. Fold keys (every entity).
  const out: EventDelta[] = deltas.map(delta => {
    if (delta.type !== 'resource') return delta;
    const parts = splitResourceKey(delta.key);
    if (!parts) return delta;
    const canonical = canonicalResourceKey(parts.resource);
    if (!canonical || canonical === parts.resource) return { ...delta };
    notes.push(`[Economy] Folded resource key '${delta.key}' onto '${parts.root}:${canonical}' - one quantity, one name.`);
    return { ...delta, key: `${parts.root}:${canonical}` };
  });

  if (!player) return { deltas: out, notes };

  const playerResourceDeltas = out.filter((delta): delta is EventDelta => {
    if (delta.type !== 'resource') return false;
    const parts = splitResourceKey(delta.key);
    return parts !== null && parts.root === playerId;
  });
  const resourceOf = (delta: EventDelta) => splitResourceKey(delta.key)?.resource ?? '';
  const holdings = player.resources;

  // 2a. Treasury windfalls must name a source.
  const gains = playerResourceDeltas.filter(delta => resourceOf(delta) === 'denarii' && delta.delta > 0);
  const gainTotal = gains.reduce((sum, delta) => sum + delta.delta, 0);
  if (gainTotal > 0) {
    const allowance = Math.max(WINDFALL_FREE_ALLOWANCE, Math.round(numericResource(holdings, 'denarii') * WINDFALL_HOLDINGS_FRACTION));
    if (gainTotal > allowance) {
      const needed = gainTotal * SOURCE_FRACTION;
      const payerLoss = out
        .filter(delta => delta.type === 'resource' && delta.delta < 0)
        .filter(delta => {
          const parts = splitResourceKey(delta.key);
          return parts !== null && parts.root !== playerId && classifyResourceKey(parts.resource).category === 'coin';
        })
        .reduce((sum, delta) => sum - delta.delta, 0);
      const loan = playerResourceDeltas
        .filter(delta => resourceOf(delta) === 'debt_denarii' && delta.delta > 0)
        .reduce((sum, delta) => sum + delta.delta, 0);
      const standingPrice = playerResourceDeltas
        .filter(delta => classifyResourceKey(resourceOf(delta)).category === 'standing' && delta.delta <= -WINDFALL_STANDING_PRICE)
        .length > 0;
      const sourced = payerLoss >= needed || loan >= needed || standingPrice;
      if (!sourced) {
        scaleGroup(gains, allowance);
        notes.push(`[Economy] Clamped an unsourced treasury gain of ${formatArabic(gainTotal)} denarii to ${formatArabic(allowance)} (${formatArabic(WINDFALL_FREE_ALLOWANCE)} or half the standing treasury, whichever is more): no payer lost it, no creditor lent it, no standing was spent for it. Gains must cite a source (RESOURCE ECONOMY).`);
      }
    }
  }

  // 2b. Intel is regenerated by the engine, not minted by narration.
  for (const key of INTEL_KEYS) {
    const grants = playerResourceDeltas.filter(delta => resourceOf(delta) === key && delta.delta > 0);
    const total = grants.reduce((sum, delta) => sum + delta.delta, 0);
    if (total > INTEL_GRANT_CAP) {
      scaleGroup(grants, INTEL_GRANT_CAP);
      notes.push(`[Economy] Clamped a grant of ${formatArabic(total)} ${key} to ${INTEL_GRANT_CAP}: the ledger regenerates intel and the exchequer prices it; narration may reward at most one a week.`);
    }
  }

  // 2c. A reputation moves by points, not by tens.
  const standingKeys = new Set(playerResourceDeltas
    .map(resourceOf)
    .filter(key => classifyResourceKey(key).category === 'standing'));
  for (const key of standingKeys) {
    const group = playerResourceDeltas.filter(delta => resourceOf(delta) === key);
    const total = group.reduce((sum, delta) => sum + delta.delta, 0);
    if (Math.abs(total) > STANDING_MAX_SWING) {
      const sign = total > 0 ? 1 : -1;
      // Scale the whole group (not just one sign) so mixed deltas keep their proportion.
      const factor = STANDING_MAX_SWING / Math.abs(total);
      let remaining = sign * STANDING_MAX_SWING;
      group.forEach((delta, i) => {
        if (i === group.length - 1) {
          delta.delta = remaining;
          return;
        }
        const scaled = Math.round(delta.delta * factor);
        delta.delta = scaled;
        remaining -= scaled;
      });
      notes.push(`[Economy] Clamped a ${total > 0 ? '+' : ''}${formatArabic(total)} swing in ${key} to ${sign > 0 ? '+' : '-'}${STANDING_MAX_SWING}: a 0-100 standing moves by a few points a week.`);
    }
  }

  // 2d. Men are paid for, or they are volunteers - and volunteers are few.
  const coinSpent = playerResourceDeltas
    .filter(delta => resourceOf(delta) === 'denarii' && delta.delta < 0)
    .reduce((sum, delta) => sum - delta.delta, 0);
  const borrowed = playerResourceDeltas
    .filter(delta => resourceOf(delta) === 'debt_denarii' && delta.delta > 0)
    .reduce((sum, delta) => sum + delta.delta, 0);
  if (coinSpent === 0 && borrowed === 0) {
    for (const key of FORCE_KEYS) {
      const recruits = playerResourceDeltas.filter(delta => resourceOf(delta) === key && delta.delta > 0);
      const total = recruits.reduce((sum, delta) => sum + delta.delta, 0);
      if (total <= 0) continue;
      const allowance = Math.max(RECRUIT_FREE_MEN, Math.round(numericResource(holdings, key) * RECRUIT_FREE_FRACTION));
      if (total > allowance) {
        scaleGroup(recruits, allowance);
        notes.push(`[Economy] Clamped ${formatArabic(total)} unpaid ${key} to ${formatArabic(allowance)} volunteers: no coin was spent and nothing borrowed this week, and a levy is bought at the exchequer, not narrated into being.`);
      }
    }
  }

  return { deltas: out, notes };
}
