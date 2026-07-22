/**
 * Pure unit tests for knowledge/dossierCost.ts + its integration with the
 * dossier read model (DESIGN_DECISIONS.md D27, refining D14): a held-dossier
 * refresh costs LESS than first acquisition, scaled by staleness. Pins the
 * decay curve's four contract points (floor at just-refreshed, full price
 * once cold, monotonic in staleness, exact boundary at the threshold) and the
 * end-to-end wiring the investigation-cost path uses (deriveDossier ->
 * computeRefreshCost), including the integer-currency rounding the live game
 * charges its whole-unit `investigations` resource with.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRefreshCost,
  DOSSIER_COLD_THRESHOLD,
  DOSSIER_REFRESH_FLOOR_FRACTION,
} from '../knowledge/dossierCost';
import { deriveDossier, ingestInvestigationReveal, KnowledgeClaim } from '../knowledge/store';

describe('knowledge/dossierCost - computeRefreshCost (D27 decay curve)', () => {
  const FULL = 100; // a graded (non-unit) price so the curve's shape is visible
  const T = DOSSIER_COLD_THRESHOLD;

  it('a just-refreshed dossier (staleness 0) costs the FLOOR - well under full price', () => {
    const cost = computeRefreshCost(FULL, 0, T);
    expect(cost).toBe(FULL * DOSSIER_REFRESH_FLOOR_FRACTION);
    expect(cost).toBeLessThan(FULL);
  });

  it('a dossier gone cold (staleness AT the threshold) costs full first-acquisition price', () => {
    expect(computeRefreshCost(FULL, T, T)).toBe(FULL);
  });

  it('stays at full price PAST the threshold (never exceeds first-acquisition price)', () => {
    expect(computeRefreshCost(FULL, T + 1, T)).toBe(FULL);
    expect(computeRefreshCost(FULL, T * 5, T)).toBe(FULL);
  });

  it('is monotonic non-decreasing in staleness across and beyond the window', () => {
    let prev = -Infinity;
    for (let t = 0; t <= T + 3; t++) {
      const cost = computeRefreshCost(FULL, t, T);
      expect(cost).toBeGreaterThanOrEqual(prev);
      expect(cost).toBeLessThanOrEqual(FULL);
      prev = cost;
    }
  });

  it('the boundary is exact: just below the threshold is still discounted, AT the threshold is full', () => {
    expect(computeRefreshCost(FULL, T - 1, T)).toBeLessThan(FULL);
    expect(computeRefreshCost(FULL, T, T)).toBe(FULL);
  });

  it('clamps negative staleness to a just-refreshed (floor) price', () => {
    expect(computeRefreshCost(FULL, -3, T)).toBe(FULL * DOSSIER_REFRESH_FLOOR_FRACTION);
  });

  it('a non-positive discount window means no discount - every refresh is full price', () => {
    expect(computeRefreshCost(FULL, 0, 0)).toBe(FULL);
    expect(computeRefreshCost(FULL, 2, -1)).toBe(FULL);
  });

  describe('integer currency (the live 1-investigation unit price the tab rounds)', () => {
    // The game's sole investigation currency is a whole `investigations` count
    // priced at 1; the tab rounds the curve to a whole unit. At unit price the
    // curve collapses to: a warm refresh rounds to a FREE top-up, a cold one to
    // full price (see dossierCost.ts's INTEGER CURRENCIES note).
    const round = (t: number) => Math.round(computeRefreshCost(1, t, DOSSIER_COLD_THRESHOLD));

    it('a warm (just-refreshed) dossier rounds to a free top-up, strictly cheaper than the full unit', () => {
      expect(round(0)).toBe(0);
      expect(round(0)).toBeLessThan(1);
    });

    it('a cold dossier rounds back to the full unit price', () => {
      expect(round(DOSSIER_COLD_THRESHOLD)).toBe(1);
      expect(round(DOSSIER_COLD_THRESHOLD + 4)).toBe(1);
    });
  });
});

describe('knowledge/dossierCost - end-to-end with deriveDossier (the cost path)', () => {
  // The investigation-cost path: derive the dossier held on a target, and if an
  // aspect is on file, price its refresh by staleness; otherwise it is a first
  // acquisition at full price. Mirrors DramatisPersonaeTab's priceInvestigation.
  const FULL = 1;
  function priceAspect(store: KnowledgeClaim[], subject: string, kind: 'beliefs' | 'secrets' | 'scheme', currentTurn: number) {
    const entry = deriveDossier(store, subject).entries.find(e => e.kind === kind);
    if (!entry) return { cost: FULL, held: false };
    const cost = Math.round(computeRefreshCost(FULL, currentTurn - entry.lastRefreshedTurn, DOSSIER_COLD_THRESHOLD));
    return { cost, held: true };
  }

  it('first acquisition of an unheld aspect is full price', () => {
    const priced = priceAspect([], 'maximinus_thrax', 'beliefs', 5);
    expect(priced).toEqual({ cost: FULL, held: false });
  });

  it('a held dossier refreshed this same turn is a discounted (free, at unit price) top-up', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
    });
    const priced = priceAspect(store, 'maximinus_thrax', 'beliefs', 4); // staleness 0
    expect(priced.held).toBe(true);
    expect(priced.cost).toBe(0);
    expect(priced.cost).toBeLessThan(FULL);
  });

  it('a held dossier gone cold pays full price again', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
    });
    const priced = priceAspect(store, 'maximinus_thrax', 'beliefs', 4 + DOSSIER_COLD_THRESHOLD);
    expect(priced).toEqual({ cost: FULL, held: true });
  });

  it('holding one aspect does not discount a DIFFERENT, unheld aspect of the same target', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
    });
    // secrets was never bought - still a full-price first acquisition.
    expect(priceAspect(store, 'maximinus_thrax', 'secrets', 4)).toEqual({ cost: FULL, held: false });
  });
});
