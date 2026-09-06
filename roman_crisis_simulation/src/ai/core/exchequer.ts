/**
 * ai/core/exchequer.ts
 *
 * THE EXCHEQUER (BACKLOG.md B1, the owner-requested currency converter;
 * DESIGN_DECISIONS.md D46): a code-side exchange table that lets the player
 * trade a surplus of one holding for another - coin into informants, coin
 * into levies, favours into investigations, investigations into a deep
 * analysis, coin against debt or back pay, an estate sold under duress -
 * with EXPLICIT friction: a rate, a minimum lot, and for levies a week's
 * delay. No AI call: an exchange is a durable domain mutation committed
 * through App.tsx's `handleExchange` (the RESOURCE_SPENT commit path).
 *
 * This is the T1 interoperability bridge: soft resources the world
 * generated (favours, coin, holdings) become the hard gating currency
 * (investigations) at a stated price, so a soft resource is worth something
 * concrete and the hard mechanic is reachable from the lived narrative -
 * without letting narration mint hard currency directly (the guard,
 * ai/core/economyGuard.ts, caps that).
 *
 * Pure: `applyExchange` returns a new bag or a refusal; it never mutates.
 *
 * TUNING RATIONALE (per entry):
 *   hire_informants - 1,500 denarii for one investigation: roughly a season
 *     of an agent's wages plus the bribes an inquiry burns. Bounded by the
 *     investigations CEILING (ai/core/ledger.ts::investigationCap) so coin
 *     alone cannot stack a dozen inquiries; agents raise the ceiling.
 *   call_in_favors - one favour, one investigation. The cheapest road to
 *     intel is the one the story handed you.
 *   commission_deep_analysis - three investigations make one deep analysis:
 *     the premium tier stays premium.
 *   recruit_troops - 60 denarii a head (a signing bounty of ~7 weeks' pay),
 *     lots of ten, arriving NEXT week as `levy_pending`: raising men is not
 *     instant, and the week's delay is the friction that makes "hold the
 *     camp with what I have" a real choice.
 *   hire_guards - 90 a head, lots of five, at once: a bodyguard is bought
 *     off the street the same day, and paid more for it.
 *   hire_agents - 400 a head: an informant is expensive to place and
 *     expensive to keep (15 a week).
 *   repay_debt / pay_arrears - coin against what is owed at par; the
 *     friction is that the interest and the desertions already happened.
 *   sell_estates / sell_ships - a distress sale: 9,000 for an estate that
 *     yields 600 a week (fifteen weeks of income) and 4,000 for a ship
 *     (sixteen weeks). Selling is always worse than holding - by design.
 */

import { investigationCap } from './ledger';
import { formatArabic, numericResource, ResourceBag } from './resourceRegistry';

export const EXCHANGE_IDS = [
  'hire_informants',
  'call_in_favors',
  'commission_deep_analysis',
  'recruit_troops',
  'hire_guards',
  'hire_agents',
  'repay_debt',
  'pay_arrears',
  'sell_estates',
  'sell_ships',
] as const;
export type ExchangeId = typeof EXCHANGE_IDS[number];

export interface ExchangeEntry {
  id: ExchangeId;
  /** The verb the button carries. */
  label: string;
  /** Why the rate is what it is - the friction, stated. */
  gloss: string;
  /** What one lot costs. */
  spend: { key: string; perLot: number };
  /**
   * What one lot yields. A NEGATIVE `perLot` pays the key DOWN (debt, back
   * pay) rather than up; `pendingKey` credits a mustering key instead, and
   * the ledger converts it next week.
   */
  gain: { key: string; perLot: number; pendingKey?: string };
  minLot: number;
  /** Optional ceiling on lots derived from the bag (an investigations cap, an outstanding debt). */
  maxLots?: (resources: ResourceBag) => number;
}

/** Denarii one investigation costs at the exchequer - also the base the D27 refresh curve grades from (components/tabs/dramatisPersonaeIntel.ts). */
export const INVESTIGATION_PRICE_DENARII = 1_500;

export const EXCHANGE_TABLE: readonly ExchangeEntry[] = [
  {
    id: 'hire_informants', label: 'Hire informants',
    gloss: 'Coin buys an inquiry, up to the ceiling your agents can run.',
    spend: { key: 'denarii', perLot: INVESTIGATION_PRICE_DENARII },
    gain: { key: 'investigations', perLot: 1 },
    minLot: 1,
    maxLots: resources => Math.max(0, investigationCap(resources) - numericResource(resources, 'investigations')),
  },
  {
    id: 'call_in_favors', label: 'Call in a favour',
    gloss: 'A favour owed becomes an inquiry answered.',
    spend: { key: 'favors', perLot: 1 },
    gain: { key: 'investigations', perLot: 1 },
    minLot: 1,
    maxLots: resources => Math.max(0, investigationCap(resources) - numericResource(resources, 'investigations')),
  },
  {
    id: 'commission_deep_analysis', label: 'Commission a deep analysis',
    gloss: 'Three inquiries, pooled, make one assessment worth the name.',
    spend: { key: 'investigations', perLot: 3 },
    gain: { key: 'deep_analyses', perLot: 1 },
    minLot: 1,
  },
  {
    id: 'recruit_troops', label: 'Raise a levy',
    gloss: 'Sixty denarii a head, in tens. They muster this week and arrive the next.',
    spend: { key: 'denarii', perLot: 60 },
    gain: { key: 'troops', perLot: 1, pendingKey: 'levy_pending' },
    minLot: 10,
  },
  {
    id: 'hire_guards', label: 'Hire guards',
    gloss: 'Ninety a head, in fives, at your door by nightfall - and twelve a week to keep.',
    spend: { key: 'denarii', perLot: 90 },
    gain: { key: 'guards', perLot: 1 },
    minLot: 5,
  },
  {
    id: 'hire_agents', label: 'Place an agent',
    gloss: 'Four hundred to place, fifteen a week to keep. Three agents keep an inquiry open every week.',
    spend: { key: 'denarii', perLot: 400 },
    gain: { key: 'agents', perLot: 1 },
    minLot: 1,
  },
  {
    id: 'repay_debt', label: 'Repay your creditors',
    gloss: 'Coin against the principal, at par. The interest already taken stays taken.',
    spend: { key: 'denarii', perLot: 1 },
    gain: { key: 'debt_denarii', perLot: -1 },
    minLot: 100,
    maxLots: resources => numericResource(resources, 'debt_denarii'),
  },
  {
    id: 'pay_arrears', label: 'Settle back pay',
    gloss: 'Coin to the men you owe. Desertions already taken do not return.',
    spend: { key: 'denarii', perLot: 1 },
    gain: { key: 'pay_arrears', perLot: -1 },
    minLot: 1,
    maxLots: resources => numericResource(resources, 'pay_arrears'),
  },
  {
    id: 'sell_estates', label: 'Sell an estate',
    gloss: 'A distress sale: nine thousand for land that returns six hundred a week.',
    spend: { key: 'estates', perLot: 1 },
    gain: { key: 'denarii', perLot: 9_000 },
    minLot: 1,
  },
  {
    id: 'sell_ships', label: 'Sell a ship',
    gloss: 'Four thousand for a hull that earns two hundred and fifty a week.',
    spend: { key: 'ships', perLot: 1 },
    gain: { key: 'denarii', perLot: 4_000 },
    minLot: 1,
  },
];

const BY_ID: ReadonlyMap<ExchangeId, ExchangeEntry> = new Map(EXCHANGE_TABLE.map(entry => [entry.id, entry]));

export function getExchangeEntry(id: ExchangeId): ExchangeEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`exchequer: unknown exchange '${id}'`);
  return entry;
}

export function isExchangeId(value: unknown): value is ExchangeId {
  return typeof value === 'string' && (EXCHANGE_IDS as readonly string[]).includes(value);
}

/** The most lots a bag can afford for an entry, honouring its ceiling; 0 when even one lot is out of reach. */
export function maxAffordableLots(entry: ExchangeEntry, resources: ResourceBag): number {
  const affordable = Math.floor(numericResource(resources, entry.spend.key) / entry.spend.perLot);
  const ceiling = entry.maxLots ? Math.floor(entry.maxLots(resources)) : Infinity;
  const lots = Math.min(affordable, ceiling);
  return lots >= entry.minLot ? lots : 0;
}

export interface ExchangeQuote {
  spendKey: string;
  spendAmount: number;
  gainKey: string;
  gainAmount: number;
  /** True when the gain lands next week (a levy). */
  delayed: boolean;
}

export function quoteExchange(entry: ExchangeEntry, lots: number): ExchangeQuote {
  return {
    spendKey: entry.spend.key,
    spendAmount: lots * entry.spend.perLot,
    gainKey: entry.gain.pendingKey ?? entry.gain.key,
    gainAmount: lots * Math.abs(entry.gain.perLot),
    delayed: entry.gain.pendingKey !== undefined,
  };
}

export type ExchangeRefusal =
  | 'lots_below_minimum'
  | 'lots_not_whole'
  | 'cannot_afford'
  | 'over_ceiling';

export type ExchangeResult =
  | { ok: true; resources: ResourceBag; quote: ExchangeQuote; receipt: string }
  | { ok: false; reason: ExchangeRefusal };

/**
 * Applies one exchange to a bag, or refuses. Pure: the input bag is never
 * mutated. A pay-down never drives its target below zero (the ceiling
 * already bounds it), and a delayed gain is credited to the mustering key.
 */
export function applyExchange(resources: ResourceBag, id: ExchangeId, lots: number): ExchangeResult {
  const entry = getExchangeEntry(id);
  if (!Number.isInteger(lots)) return { ok: false, reason: 'lots_not_whole' };
  if (lots < entry.minLot) return { ok: false, reason: 'lots_below_minimum' };
  const quote = quoteExchange(entry, lots);
  if (numericResource(resources, entry.spend.key) < quote.spendAmount) return { ok: false, reason: 'cannot_afford' };
  if (entry.maxLots && lots > Math.floor(entry.maxLots(resources))) return { ok: false, reason: 'over_ceiling' };

  const next: ResourceBag = { ...resources };
  next[entry.spend.key] = numericResource(next, entry.spend.key) - quote.spendAmount;
  const gainKey = quote.gainKey;
  const current = numericResource(next, gainKey);
  next[gainKey] = entry.gain.perLot < 0
    ? Math.max(0, current - quote.gainAmount)
    : current + quote.gainAmount;
  if (entry.gain.perLot < 0 && next[gainKey] === 0) delete next[gainKey];

  const receipt = entry.gain.perLot < 0
    ? `${formatArabic(quote.spendAmount)} ${entry.spend.key} paid against ${gainKey}.`
    : quote.delayed
      ? `${formatArabic(quote.spendAmount)} ${entry.spend.key} for ${formatArabic(quote.gainAmount)} ${entry.gain.key}, mustering until next week.`
      : `${formatArabic(quote.spendAmount)} ${entry.spend.key} for ${formatArabic(quote.gainAmount)} ${gainKey}.`;
  return { ok: true, resources: next, quote, receipt };
}
