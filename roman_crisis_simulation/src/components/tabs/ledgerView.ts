/**
 * components/tabs/ledgerView.ts — the pure derivations behind the Assets
 * tab's ledger (D46). No React: numbers, keys and history in, view rows out,
 * so the tab renders what these return and tests pin the arithmetic here.
 *
 * Everything the player is shown is the player's OWN (D5/D6): the bag on
 * their entity, the ledger lines the engine wrote for them, and their own
 * adjudicated dealings (resource deltas keyed on their id). Nothing here
 * reads another entity's resources or any GM-private field.
 */

import type { Entity, EventDelta, LedgerLine, TurnHistoryEntry } from '../../types';
import { classifyResourceKey, HOLDING_PREFIX, numericResource, ResourceBag } from '../../ai/core/resourceRegistry';
import { projectWeeklyCoinFlow, runwayWeeks, WeeklyCoinFlow, weeklyInterest } from '../../ai/core/ledger';

/** One of this week's adjudicated dealings on the player's own holdings. */
export interface DealingRow {
  key: string;
  label: string;
  amount: number;
  reason: string;
}

export interface WeekLedgerView {
  /** The engine's lines for the week (wages, yields, interest, ...), in booking order. */
  lines: LedgerLine[];
  /** The week's adjudicated resource deltas on the player - bribes paid, gifts received - with their reasons. */
  dealings: DealingRow[];
  /** Net movement of denarii across lines AND dealings. */
  netDenarii: number;
}

function playerResourceDeltas(deltas: EventDelta[], playerId: string): Array<{ delta: EventDelta; key: string }> {
  const rows: Array<{ delta: EventDelta; key: string }> = [];
  for (const delta of deltas) {
    if (delta.type !== 'resource') continue;
    const separator = delta.key.indexOf(':');
    if (separator <= 0) continue;
    if (delta.key.slice(0, separator) !== playerId) continue;
    rows.push({ delta, key: delta.key.slice(separator + 1) });
  }
  return rows;
}

/**
 * What the most recent committed week did to the player's books: the
 * engine's ledger lines plus the adjudicator's own resource deltas keyed on
 * the player. `null` when no week has been committed yet.
 */
export function weekLedgerView(entry: TurnHistoryEntry | null | undefined, playerId: string): WeekLedgerView | null {
  if (!entry) return null;
  const lines = entry.ledger ?? [];
  const dealings: DealingRow[] = playerResourceDeltas(entry.adjudication.deltas, playerId)
    .filter(({ delta }) => typeof delta.delta === 'number' && delta.delta !== 0)
    .map(({ delta, key }) => ({ key, label: classifyResourceKey(key).label, amount: delta.delta, reason: delta.reason }));
  const netDenarii = lines.filter(line => line.key === 'denarii').reduce((sum, line) => sum + line.amount, 0)
    + dealings.filter(row => row.key === 'denarii').reduce((sum, row) => sum + row.amount, 0);
  return { lines, dealings, netDenarii };
}

export interface TreasuryProjection {
  flow: WeeklyCoinFlow;
  treasury: number;
  debt: number;
  arrears: number;
  /** Interest the coming week will charge (0 without debt). */
  interest: number;
  /** treasury + net, floored at zero (the shortfall becomes debt). */
  projectedTreasury: number;
  /** The overdraft the coming week would push into debt, if any. */
  projectedShortfall: number;
  /** Whole weeks the treasury lasts at this flow; Infinity when level or growing. */
  runway: number;
}

/** Next week's coin flow against the bag as it stands, and the runway it implies. */
export function projectTreasury(resources: ResourceBag): TreasuryProjection {
  const flow = projectWeeklyCoinFlow(resources);
  const treasury = numericResource(resources, 'denarii');
  const debt = numericResource(resources, 'debt_denarii');
  const arrears = numericResource(resources, 'pay_arrears');
  const projected = treasury + flow.net;
  return {
    flow,
    treasury,
    debt,
    arrears,
    interest: weeklyInterest(debt),
    projectedTreasury: Math.max(0, projected),
    projectedShortfall: projected < 0 ? -projected : 0,
    runway: runwayWeeks(treasury, flow.net),
  };
}

/** One row of the holdings inventory. */
export interface HoldingRow {
  key: string;
  label: string;
  count: number;
  /** 'forces' for men who draw wages, 'holdings' for property and discrete items. */
  category: 'forces' | 'holdings';
  /** Denarii per unit per week the engine credits (yield) or debits (wages); 0 for a discrete item. */
  yieldPerWeek: number;
  upkeepPerWeek: number;
  /** The turn the player first acquired it, from the campaign's own record; undefined when held since the reign began (or older than the record). */
  sinceTurn?: number;
  /** For a model-minted `holding_<slug>`: the reason the minting delta gave, i.e. what the thing is. */
  description?: string;
  /** True for a `holding_<slug>` item or an undeclared key - written exactly as stored, no engine rules. */
  discrete: boolean;
}

/**
 * The inventory register: every forces/holdings key the player holds, with
 * the registry's yield/upkeep and, where the campaign's own history records
 * it, when and how it was acquired. Provenance is read from the FIRST
 * positive resource delta on that key in `turnHistory` - the adjudication
 * record persists for every turn (only entity snapshots are trimmed), so
 * "since Week VII" survives a reload. A holding with no such delta was held
 * from the start.
 */
export function holdingsInventory(player: Entity, turnHistory: readonly TurnHistoryEntry[]): HoldingRow[] {
  const bag = player.resources;
  const rows: HoldingRow[] = [];
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value !== 'number') continue;
    const kind = classifyResourceKey(key);
    if (kind.category !== 'forces' && kind.category !== 'holdings') continue;
    if (value <= 0) continue;
    const provenance = firstAcquisition(key, player.entity_id, turnHistory);
    rows.push({
      key,
      label: kind.label,
      count: value,
      category: kind.category,
      yieldPerWeek: kind.weekly?.income ?? 0,
      upkeepPerWeek: kind.weekly?.upkeep ?? 0,
      ...(provenance ? { sinceTurn: provenance.turnNumber } : {}),
      ...(provenance && key.startsWith(HOLDING_PREFIX) && provenance.reason ? { description: provenance.reason } : {}),
      discrete: kind.inferred === true,
    });
  }
  // Forces first, then property, then discrete items; steady within a group.
  const rank = (row: HoldingRow) => (row.category === 'forces' ? 0 : row.discrete ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b));
}

function firstAcquisition(key: string, playerId: string, turnHistory: readonly TurnHistoryEntry[]): { turnNumber: number; reason: string } | null {
  for (const entry of turnHistory) {
    for (const { delta, key: deltaKey } of playerResourceDeltas(entry.adjudication.deltas, playerId)) {
      if (classifyResourceKey(deltaKey).id === key && delta.delta > 0) {
        return { turnNumber: entry.turnNumber, reason: delta.reason };
      }
    }
    for (const line of entry.ledger ?? []) {
      if (line.key === key && line.kind === 'levy') return { turnNumber: entry.turnNumber, reason: line.text };
    }
  }
  return null;
}
