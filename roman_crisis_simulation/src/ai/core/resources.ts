/**
 * ai/core/resources.ts
 *
 * The SYSTEMIC RESOURCE REGISTRY (DESIGN_DECISIONS.md D6, Phase 2 item 3).
 *
 * D6's ruling: most resources stay a freeform narrative bag (created ad hoc
 * by the model via 'resource' deltas, no engine opinion on their meaning).
 * A SMALL set of resources are instead systemic: the engine enforces real
 * rules on them (floors, thresholds, consequences), because they are
 * objectively knowable and mechanically load-bearing.
 *
 * Denarii is the first systemic resource: the player's own treasury is
 * knowable (unlike other entities' treasuries, which stay behind the
 * perception layer, D5). Per D6, going broke does NOT just floor at zero -
 * the shortfall becomes DEBT owed to a creditor, because "a creditor who
 * owns you feeds the relationship system" (a bare zero floor is a dead
 * end; debt is a hook). See ai/prompts/adjudication.ts's DEBT rule for how
 * the model is instructed to make that debt narratively felt (creditor
 * NPCs, rising `dependency_level`, social consequences for non-payment).
 *
 * This module is pure and deterministic - no I/O, no randomness - so
 * ai/core/engine.ts's 'resource' delta case (the only caller) stays a pure
 * state transition, consistent with the rest of applyDeltas.
 *
 * ADDING A NEW SYSTEMIC RESOURCE (e.g. grain, legitimacy): add an entry to
 * `SYSTEMIC_RESOURCES` below with whatever subset of `floor` /
 * `onOverdraft` / `warnBelow` / `buildWarning` applies. Everything NOT in
 * this registry keeps today's behavior (a bare running total, free to go
 * negative) - see engine.ts's 'resource' case.
 */

import { Entity, Report } from '../../types';

/**
 * The treasury warning threshold (denarii). Crossing from AT-OR-ABOVE this
 * value to BELOW it emits a one-time warning Report (see `warnBelow` below).
 * Tunable - not derived from anything else, so it's a named constant rather
 * than a magic number.
 */
export const LOW_TREASURY_THRESHOLD = 5000;

/**
 * Context passed to `onOverdraft` when a resource delta would push a
 * systemic resource's raw value below its `floor`.
 */
export interface OverdraftContext {
  /** The entity whose resource overdrew. Mutable - `onOverdraft` may add or
   * adjust OTHER resources on it directly (e.g. accumulating debt). */
  entity: Entity;
  /** The systemic resource's name, e.g. 'denarii'. */
  resourceName: string;
  /** How far below the floor the raw (pre-clamp) value fell. Always > 0. */
  shortfall: number;
  turnNumber: number;
}

/**
 * Context passed to `buildWarning` when a resource delta crosses the
 * `warnBelow` threshold from at-or-above to below.
 */
export interface WarnContext {
  entity: Entity;
  resourceName: string;
  /** The resource's final value (after any floor/overdraft clamping). */
  value: number;
  turnNumber: number;
}

/**
 * A rule governing one systemic resource. Every field is optional so a
 * future entry can adopt only the parts it needs (e.g. a resource that only
 * needs a floor with no debt conversion, or only a warning threshold with
 * no floor at all).
 */
export interface SystemicResourceRule {
  /** The hard floor the resource's value cannot go below. If a delta would
   * take it lower, the raw shortfall is handed to `onOverdraft` (if
   * present) and the resource is clamped to `floor`. */
  floor?: number;
  /** Called when a delta pushes the resource below `floor`. Returns any
   * Reports to surface to the player (e.g. a "coffers run dry" notice).
   * May mutate `entity` directly (e.g. accumulating `debt_denarii`) -
   * the caller has already cloned entity state, so this is safe. */
  onOverdraft?: (ctx: OverdraftContext) => Report[];
  /** If set, crossing this value from at-or-above to below emits a
   * one-time (per crossing) warning via `buildWarning`. Does NOT re-fire
   * on every subsequent delta that keeps the value below the threshold -
   * only the crossing itself. */
  warnBelow?: number;
  /** Builds the warning Report for a `warnBelow` crossing. Required if
   * `warnBelow` is set. */
  buildWarning?: (ctx: WarnContext) => Report;
}

function makeReportId(turnNumber: number, suffix: string): string {
  return `report_${turnNumber}_${Date.now()}_${suffix}`;
}

/**
 * Denarii (D6, the first systemic resource): floors at 0. An overdraft does
 * not vanish - the shortfall is added to a `debt_denarii` resource on the
 * SAME entity (accumulating across repeated overdrafts), converting "you
 * went broke" into "you owe someone" so the relationship system has
 * something to grab onto (see ai/prompts/adjudication.ts's DEBT rule).
 */
const denariiRule: SystemicResourceRule = {
  floor: 0,
  onOverdraft: ({ entity, shortfall, turnNumber }) => {
    const currentDebt = (entity.resources['debt_denarii'] as number) || 0;
    entity.resources['debt_denarii'] = currentDebt + shortfall;

    const report: Report = {
      id: makeReportId(turnNumber, 'debt'),
      turn: turnNumber,
      source: 'merchant',
      about: entity.entity_id,
      claim: `Your coffers run dry — the shortfall of ${shortfall} denarii is owed to your creditors.`,
      credibility: 1.0, // the player's own treasury is objectively knowable (D6/D5)
    };
    return [report];
  },
  warnBelow: LOW_TREASURY_THRESHOLD,
  buildWarning: ({ entity, value, turnNumber }) => ({
    id: makeReportId(turnNumber, 'low_treasury'),
    turn: turnNumber,
    source: 'merchant',
    about: entity.entity_id,
    claim: `Your treasury has fallen below ${LOW_TREASURY_THRESHOLD} denarii (now ${value}) — creditors and courtiers alike take notice.`,
    credibility: 1.0,
  }),
};

/** The systemic resource registry. Keyed by resource name (matches the
 * `resource_name` half of a 'resource' delta's `key`). Anything not listed
 * here is freeform per D6 and behaves exactly as before this module
 * existed. */
export const SYSTEMIC_RESOURCES: Record<string, SystemicResourceRule> = {
  denarii: denariiRule,
};

/**
 * Applies a systemic resource's rule to one 'resource' delta application.
 * Pure: takes the pre- and post-delta raw values, returns the FINAL value
 * to store and any Reports the rule wants emitted. Mutates `entity` only
 * to the extent `onOverdraft` does (e.g. writing `debt_denarii`) - `entity`
 * is expected to already be a clone owned by the caller (applyDeltas
 * clones all state up front).
 *
 * Crossing detection for `warnBelow` is stateless by construction: it
 * compares `previousValue` (the resource's value BEFORE this delta, i.e.
 * the durable state carried in from prior turns) against `finalValue`
 * (after this delta and any floor clamp). A one-time warning naturally
 * falls out of this without any extra "have we warned before" flag to
 * persist - as long as the entity stays below the threshold, subsequent
 * calls have `previousValue` already below it too, so no re-fire.
 */
export function applySystemicResourceRule(
  rule: SystemicResourceRule,
  entity: Entity,
  resourceName: string,
  previousValue: number,
  rawNewValue: number,
  turnNumber: number
): { finalValue: number; reports: Report[] } {
  const reports: Report[] = [];
  let finalValue = rawNewValue;

  if (rule.floor !== undefined && rawNewValue < rule.floor) {
    const shortfall = rule.floor - rawNewValue;
    finalValue = rule.floor;
    if (rule.onOverdraft) {
      reports.push(...rule.onOverdraft({ entity, resourceName, shortfall, turnNumber }));
    }
  }

  if (rule.warnBelow !== undefined && rule.buildWarning) {
    const wasAtOrAbove = previousValue >= rule.warnBelow;
    const isNowBelow = finalValue < rule.warnBelow;
    if (wasAtOrAbove && isNowBelow) {
      reports.push(rule.buildWarning({ entity, resourceName, value: finalValue, turnNumber }));
    }
  }

  return { finalValue, reports };
}
