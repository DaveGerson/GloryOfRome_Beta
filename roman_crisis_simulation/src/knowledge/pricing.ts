/**
 * knowledge/pricing.ts
 *
 * B1/T1 currency converter and D27 warm dossier refresh pricing:
 *   - `priceIntelPurchase`: computes both the flat unit cost (`investigations` /
 *     `deep_analyses`) and the graded D27 denarii price scaled linearly from 20%
 *     floor (warm same-turn refresh) to 100% (cold threshold >= 6 turns),
 *     reading staleness solely from the player's `knowledge` store.
 *   - `convertResourceToInvestigations`: pure T1 resource converter applying
 *     `CONVERSION_FRICTION_FACTOR` (1.25x) so soft/surplus resources cannot
 *     trivially mint investigation capacity at zero friction.
 *   - Never touches React, AI, GM truth, or numeric credibility (D25).
 */
import type { Entity } from '../types';
import { computeRefreshCost, DOSSIER_COLD_THRESHOLD } from './dossierCost';
import { deriveDossier, type KnowledgeClaim } from './store';

type ResourceBag = Entity['resources'];

export type PricedIntelKind = 'beliefs' | 'secrets' | 'scheme' | 'deep_analysis';

export const INVESTIGATION_DENARII_BASE = 2500;
export const DEEP_ANALYSIS_DENARII_BASE = 6000;
export const CONVERSION_FRICTION_FACTOR = 1.25;

export const CONVERSION_RATES = {
  denarii: INVESTIGATION_DENARII_BASE,
  senatorial_support: 10,
  legion_support: 10,
} as const;

export type ConvertibleResource = keyof typeof CONVERSION_RATES;
type WarmthBand = 'unheld' | 'fresh' | 'warm' | 'cooling' | 'cold';

export interface IntelPriceQuote {
  kind: PricedIntelKind;
  unitResource: 'investigations' | 'deep_analyses';
  unitCost: number;
  denariiBase: number;
  denariiCost: number;
  held: boolean;
  lastRefreshedTurn: number | null;
  turnsSinceRefresh: number | null;
  isWarmRefresh: boolean;
  discountPct: number;
  warmthBand: WarmthBand;
  canPayWithUnit: boolean;
  canPayWithDenarii: boolean;
  recommendedRail: 'unit' | 'denarii' | 'none';
}

function numericBalance(resources: ResourceBag | undefined, key: string): number {
  const val = resources?.[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function warmthBandFor(held: boolean, turnsSinceRefresh: number | null): WarmthBand {
  if (!held) return 'unheld';
  if (turnsSinceRefresh === null) return 'cold';
  if (turnsSinceRefresh <= 1) return 'fresh';
  if (turnsSinceRefresh <= 3) return 'warm';
  if (turnsSinceRefresh < DOSSIER_COLD_THRESHOLD) return 'cooling';
  return 'cold';
}

function roundToDenariiStep(raw: number, floorMin: number): number {
  const rounded = Math.round(raw / 50) * 50;
  return Math.max(floorMin, rounded);
}

/**
 * Computes unit + graded D27 denarii pricing for any dossier aspect or deep
 * analysis on `targetId` as of `turnNumber`.
 */
export function priceIntelPurchase(params: {
  knowledge: KnowledgeClaim[];
  targetId: string;
  kind: PricedIntelKind;
  turnNumber: number;
  playerResources?: ResourceBag;
}): IntelPriceQuote {
  const { knowledge, targetId, kind, turnNumber, playerResources } = params;
  const dossier = deriveDossier(knowledge, targetId);
  const existing = dossier.entries.find(entry => entry.kind === kind);
  // D28: passive awareness (`clues === 0`) is NOT a paid held scheme dossier
  // and receives no warm refresh discount.
  const held = kind === 'scheme'
    ? Boolean(existing?.schemeDiscovery && existing.schemeDiscovery.clues > 0)
    : Boolean(existing);
  const unitResource = kind === 'deep_analysis' ? 'deep_analyses' : 'investigations';
  const unitCost = 1;
  const denariiBase = kind === 'deep_analysis' ? DEEP_ANALYSIS_DENARII_BASE : INVESTIGATION_DENARII_BASE;

  let lastRefreshedTurn: number | null = null;
  if (held && existing) {
    if (kind === 'scheme') {
      const rawSchemeClaim = knowledge.find(c => c.claimKey === `scheme:${targetId}`);
      const latestSpyTurn = rawSchemeClaim
        ? [...rawSchemeClaim.updates].reverse().find(u => u.source === 'spy')?.turn
        : undefined;
      lastRefreshedTurn = latestSpyTurn ?? existing.lastRefreshedTurn;
    } else {
      lastRefreshedTurn = existing.lastRefreshedTurn;
    }
  }

  const validTurn = Number.isFinite(turnNumber);
  let turnsSinceRefresh: number | null = null;
  let denariiCost = held
    ? denariiBase
    : roundToDenariiStep(denariiBase * CONVERSION_FRICTION_FACTOR, 50);

  if (held && validTurn && lastRefreshedTurn !== null) {
    turnsSinceRefresh = Math.max(0, turnNumber - lastRefreshedTurn);
    const floorDenarii = roundToDenariiStep(denariiBase * 0.2, 50);
    denariiCost = roundToDenariiStep(
      computeRefreshCost(denariiBase, turnsSinceRefresh, DOSSIER_COLD_THRESHOLD),
      floorDenarii,
    );
  }

  const isWarmRefresh = held && turnsSinceRefresh !== null && turnsSinceRefresh < DOSSIER_COLD_THRESHOLD;
  const discountPct = isWarmRefresh ? Math.max(0, Math.round((1 - denariiCost / denariiBase) * 100)) : 0;
  const warmthBand = warmthBandFor(held, turnsSinceRefresh);

  const unitBalance = numericBalance(playerResources, unitResource);
  const denariiBalance = numericBalance(playerResources, 'denarii');
  const canPayWithUnit = unitBalance >= unitCost;
  const canPayWithDenarii = denariiBalance >= denariiCost;
  const recommendedRail = canPayWithUnit ? 'unit' : canPayWithDenarii ? 'denarii' : 'none';

  return {
    kind,
    unitResource,
    unitCost,
    denariiBase,
    denariiCost,
    held,
    lastRefreshedTurn,
    turnsSinceRefresh,
    isWarmRefresh,
    discountPct,
    warmthBand,
    canPayWithUnit,
    canPayWithDenarii,
    recommendedRail,
  };
}

export interface ResourceConversionResult {
  ok: boolean;
  reason?: string;
  spent: number;
  gainedInvestigations: number;
  updatedResources: ResourceBag;
}

/**
 * Pure T1 resource converter: converts surplus denarii, senatorial_support, or
 * legion_support into `investigations` capacity with explicit friction
 * (`CONVERSION_FRICTION_FACTOR`) so surplus soft resources cannot bypass scarcity
 * cleanly. Never mutates `playerResources`.
 */
export function convertResourceToInvestigations(
  playerResources: ResourceBag,
  sourceResource: ConvertibleResource,
  unitsToBuy: number,
): ResourceConversionResult {
  const cleanUnits = Math.trunc(unitsToBuy);
  if (!Number.isFinite(unitsToBuy) || cleanUnits <= 0) {
    return {
      ok: false,
      reason: 'Choose at least one investigation unit to fund.',
      spent: 0,
      gainedInvestigations: 0,
      updatedResources: { ...playerResources },
    };
  }

  const baseRate = CONVERSION_RATES[sourceResource];
  const spent = Math.ceil(baseRate * cleanUnits * CONVERSION_FRICTION_FACTOR);
  const available = numericBalance(playerResources, sourceResource);
  if (available < spent) {
    return {
      ok: false,
      reason: `Requires ${spent.toLocaleString('en-US')} ${sourceResource.replace(/_/g, ' ')} (holding ${available.toLocaleString('en-US')}).`,
      spent: 0,
      gainedInvestigations: 0,
      updatedResources: { ...playerResources },
    };
  }

  const currentInv = numericBalance(playerResources, 'investigations');
  const updatedResources: ResourceBag = {
    ...playerResources,
    [sourceResource]: available - spent,
    investigations: currentInv + cleanUnits,
  };

  return {
    ok: true,
    spent,
    gainedInvestigations: cleanUnits,
    updatedResources,
  };
}

/** Concise player-safe label describing warm refresh pricing and fallback denarii cost. */
export function formatWarmRefreshCaption(quote: IntelPriceQuote): string {
  const denariiStr = `${quote.denariiCost.toLocaleString('en-US')} denarii`;
  if (!quote.held) {
    return `Or fund directly for ${denariiStr}`;
  }
  if (quote.isWarmRefresh && quote.discountPct > 0) {
    return `Warm file (${quote.discountPct}% denarii discount: ${denariiStr} when funding with coin)`;
  }
  return `File grown cold (full denarii refresh: ${denariiStr})`;
}
