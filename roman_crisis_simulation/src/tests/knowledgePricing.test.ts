import { describe, expect, it } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import {
  CONVERSION_FRICTION_FACTOR,
  CONVERSION_RATES,
  convertResourceToInvestigations,
  formatWarmRefreshCaption,
  INVESTIGATION_DENARII_BASE,
  priceIntelPurchase,
} from '../knowledge/pricing';
import { ingestInvestigationReveal, type KnowledgeClaim } from '../knowledge/store';
import { priceInvestigationWithWarmth, resolveIntelRequest } from '../components/tabs/dramatisPersonaeIntel';
import { makeEntity } from './factories';

const unusedAi = {} as GoogleGenAI;

describe('3A: Currency Converter (B1/T1) + D27 Warm Dossier Refresh Pricing', () => {
  it('scales held dossier denarii cost linearly from 20% warm floor to 100% cold threshold', () => {
    const store: KnowledgeClaim[] = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      text: 'Strength is the sole measure of rule.',
      turn: 4,
    });

    const unheld = priceIntelPurchase({
      knowledge: [],
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      turnNumber: 4,
      playerResources: { investigations: 0, denarii: 5000 },
    });
    expect(unheld.held).toBe(false);
    expect(unheld.denariiCost).toBe(INVESTIGATION_DENARII_BASE);
    expect(unheld.warmthBand).toBe('unheld');
    expect(unheld.discountPct).toBe(0);

    // Same-turn warm refresh (t = 0): 20% floor = 500 denarii (80% discount).
    const fresh = priceIntelPurchase({
      knowledge: store,
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      turnNumber: 4,
      playerResources: { investigations: 0, denarii: 5000 },
    });
    expect(fresh.held).toBe(true);
    expect(fresh.isWarmRefresh).toBe(true);
    expect(fresh.denariiCost).toBe(500);
    expect(fresh.discountPct).toBe(80);
    expect(fresh.warmthBand).toBe('fresh');
    expect(fresh.recommendedRail).toBe('denarii');

    // Halfway to cold threshold (t = 3 of 6): 0.2 + 0.8 * 0.5 = 0.6 => 1500 denarii.
    const midpoint = priceIntelPurchase({
      knowledge: store,
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      turnNumber: 7,
    });
    expect(midpoint.denariiCost).toBe(1500);
    expect(midpoint.warmthBand).toBe('warm');
    expect(formatWarmRefreshCaption(midpoint)).toContain('40% courier discount');

    // Past cold threshold (t >= 6): back to full 2500 denarii.
    const cold = priceInvestigationWithWarmth(store, 'maximinus_thrax', 'beliefs', 10, { denarii: 3000 });
    expect(cold.isWarmRefresh).toBe(false);
    expect(cold.denariiCost).toBe(2500);
    expect(cold.warmthBand).toBe('cold');
    expect(formatWarmRefreshCaption(cold)).toContain('File grown cold');
  });

  it('applies explicit T1 conversion friction and refuses insufficient balances without mutating inputs', () => {
    const startResources = { denarii: 10000, senatorial_support: 7, investigations: 1 };
    const denariiResult = convertResourceToInvestigations(startResources, 'denarii', 2);
    const expectedSpend = Math.ceil(CONVERSION_RATES.denarii * 2 * CONVERSION_FRICTION_FACTOR);
    expect(denariiResult.ok).toBe(true);
    expect(denariiResult.spent).toBe(expectedSpend);
    expect(denariiResult.gainedInvestigations).toBe(2);
    expect(denariiResult.updatedResources.denarii).toBe(10000 - expectedSpend);
    expect(denariiResult.updatedResources.investigations).toBe(3);
    // Non-mutating guarantee
    expect(startResources.denarii).toBe(10000);

    const senateResult = convertResourceToInvestigations(startResources, 'senatorial_support', 1);
    expect(senateResult.ok).toBe(true);
    expect(senateResult.spent).toBe(4); // ceil(3 * 1.25)

    const tooPoor = convertResourceToInvestigations({ denarii: 1000, investigations: 0 }, 'denarii', 1);
    expect(tooPoor.ok).toBe(false);
    expect(tooPoor.reason).toContain('Requires');
  });

  it('resolveIntelRequest falls back to D27 warm denarii pricing when unit investigations are depleted', async () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      text: 'Force settles disputes.',
      turn: 5,
    });
    const player = makeEntity({ entity_id: 'player_1', resources: { investigations: 0, denarii: 1000 } });
    const target = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });

    const outcome = await resolveIntelRequest({
      type: 'beliefs',
      target,
      playerEntity: player,
      knowledge: store,
      ai: unusedAi,
      isMockMode: true,
      turnNumber: 5,
    });

    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged) {
      expect(outcome.cost).toBe(0);
      expect(outcome.denariiCost).toBe(500);
    } else {
      throw new Error('expected denarii-backed warm refresh outcome');
    }
  });
});
