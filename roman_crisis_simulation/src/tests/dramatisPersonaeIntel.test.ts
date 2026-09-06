/**
 * Task 7 - characterizes the pure helpers and the async request resolver
 * extracted from components/tabs/DramatisPersonaeTab.tsx into
 * components/tabs/dramatisPersonaeIntel.ts. Pins the GRADED D27 pricing
 * (live since D46's exchequer gave an investigation a coin price -
 * BACKLOG B1), D28's scheme non-display rule, the two-currency
 * affordability gate, and the exact payload shape App.tsx's
 * handleInvestigationOutcome already expects.
 */
import { describe, it, expect } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import type { Entity } from '../types';
import { ingestInvestigationReveal, ingestSchemeClue, type KnowledgeClaim } from '../knowledge/store';
import {
  priceInvestigation,
  canAffordIntel,
  schemeDiscoveryFor,
  resolveIntelRequest,
  DEEP_ANALYSIS_COST,
} from '../components/tabs/dramatisPersonaeIntel';
import { computeRefreshCost, DOSSIER_COLD_THRESHOLD, DOSSIER_REFRESH_FLOOR_FRACTION } from '../knowledge/dossierCost';
import { INVESTIGATION_PRICE_DENARII } from '../ai/core/exchequer';
import { makeEntity as baseMakeEntity } from './factories';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return baseMakeEntity({ entity_id: 'e1', name: 'Test Entity', ...overrides });
}

const target = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });
const unusedAi = {} as GoogleGenAI; // mock mode never touches ai.models
const FULL = { investigations: 1, denarii: 0 };

const heldBeliefs = (turn: number) => ingestInvestigationReveal([], {
  targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn,
});

describe('components/tabs/dramatisPersonaeIntel - priceInvestigation (D14/D27 graded)', () => {
  it('an unheld aspect is a first acquisition at one investigation', () => {
    expect(priceInvestigation([], 'maximinus_thrax', 'beliefs', 9)).toEqual({ cost: FULL, held: false });
  });

  it('a HELD aspect refreshed the same week tops up for the curve floor in COIN - a fifth of the exchequer price, never free', () => {
    const priced = priceInvestigation(heldBeliefs(4), 'maximinus_thrax', 'beliefs', 4);
    expect(priced.held).toBe(true);
    expect(priced.cost.investigations).toBe(0);
    expect(priced.cost.denarii).toBe(INVESTIGATION_PRICE_DENARII * DOSSIER_REFRESH_FLOOR_FRACTION);
    expect(priced.cost.denarii).toBeGreaterThan(0);
  });

  it('the warm fee climbs a notch a week toward the exchequer price - the D27 curve, unchanged', () => {
    let previous = 0;
    for (let staleness = 0; staleness < DOSSIER_COLD_THRESHOLD; staleness++) {
      const { cost } = priceInvestigation(heldBeliefs(4), 'maximinus_thrax', 'beliefs', 4 + staleness);
      expect(cost.investigations).toBe(0);
      expect(cost.denarii).toBe(Math.round(computeRefreshCost(INVESTIGATION_PRICE_DENARII, staleness, DOSSIER_COLD_THRESHOLD)));
      expect(cost.denarii).toBeGreaterThanOrEqual(previous);
      expect(cost.denarii).toBeLessThan(INVESTIGATION_PRICE_DENARII);
      previous = cost.denarii;
    }
  });

  it('a COLD dossier is a fresh acquisition again - one investigation, no coin', () => {
    expect(priceInvestigation(heldBeliefs(4), 'maximinus_thrax', 'beliefs', 4 + DOSSIER_COLD_THRESHOLD)).toEqual({ cost: FULL, held: true });
    expect(priceInvestigation(heldBeliefs(4), 'maximinus_thrax', 'beliefs', 4 + DOSSIER_COLD_THRESHOLD + 5)).toEqual({ cost: FULL, held: true });
  });

  it('holding one aspect does not discount a different, unheld aspect of the same target', () => {
    expect(priceInvestigation(heldBeliefs(4), 'maximinus_thrax', 'secrets', 4)).toEqual({ cost: FULL, held: false });
  });

  it('a scheme is never a refresh: every clue is a full investigation (D28)', () => {
    const store = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax', turn: 3, source: 'spy', text: 'A clue.', natureHint: 'A hint.', advancesNature: true,
    });
    expect(priceInvestigation(store, 'maximinus_thrax', 'scheme', 3)).toEqual({ cost: FULL, held: true });
  });
});

describe('components/tabs/dramatisPersonaeIntel - canAffordIntel (the two-currency gate)', () => {
  it('gates a whole-investigation price on investigations and a coin price on denarii', () => {
    expect(canAffordIntel({ investigations: 1, denarii: 0 }, FULL)).toBe(true);
    expect(canAffordIntel({ investigations: 0, denarii: 5000 }, FULL)).toBe(false);
    expect(canAffordIntel({ investigations: 0, denarii: 300 }, { investigations: 0, denarii: 300 })).toBe(true);
    expect(canAffordIntel({ investigations: 5, denarii: 299 }, { investigations: 0, denarii: 300 })).toBe(false);
  });
});

describe('components/tabs/dramatisPersonaeIntel - schemeDiscoveryFor (D28, moved verbatim)', () => {
  it('is undefined when nothing is known yet', () => {
    expect(schemeDiscoveryFor([], 'maximinus_thrax')).toBeUndefined();
  });

  it('reflects the earned discovery state (aware, not yet revealed) once a clue is on file', () => {
    const store: KnowledgeClaim[] = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax', turn: 3, source: 'spy', text: 'A clue.', natureHint: 'A hint.', advancesNature: true,
    });
    expect(schemeDiscoveryFor(store, 'maximinus_thrax')).toEqual({ clues: 1, revealed: false });
  });
});

describe('components/tabs/dramatisPersonaeIntel - resolveIntelRequest (mock mode)', () => {
  it('deep_analysis: charged=false and no AI call implied when deep_analyses is below cost', async () => {
    const player = makeEntity({ resources: { deep_analyses: 0 } });
    const outcome = await resolveIntelRequest({
      type: 'deep_analysis', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome).toEqual({ kind: 'deep_analysis', charged: false });
  });

  it('deep_analysis: charged=true with the analysis text and cost when affordable', async () => {
    const player = makeEntity({ resources: { deep_analyses: DEEP_ANALYSIS_COST } });
    const outcome = await resolveIntelRequest({
      type: 'deep_analysis', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('deep_analysis');
    if (outcome.kind === 'deep_analysis' && outcome.charged) {
      expect(outcome.cost).toBe(DEEP_ANALYSIS_COST);
      expect(typeof outcome.analysis).toBe('string');
      expect(outcome.analysis.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected charged deep_analysis outcome');
    }
  });

  it('beliefs: charged=false when investigations is below the first-acquisition price (the affordability gate)', async () => {
    const player = makeEntity({ resources: { investigations: 0, denarii: 100000 } });
    const outcome = await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome).toEqual({ kind: 'investigation', investigationKind: 'beliefs', charged: false });
  });

  it('beliefs: a warm refresh is charged in coin, and refused when the treasury cannot pay it', async () => {
    const store = heldBeliefs(4);
    const poor = makeEntity({ resources: { investigations: 5, denarii: 10 } });
    expect(await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: poor, knowledge: store, turnNumber: 4, ai: unusedAi, isMockMode: true,
    })).toEqual({ kind: 'investigation', investigationKind: 'beliefs', charged: false });

    const solvent = makeEntity({ resources: { investigations: 0, denarii: 1000 } });
    const outcome = await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: solvent, knowledge: store, turnNumber: 4, ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged) {
      expect(outcome.cost).toEqual({ investigations: 0, denarii: INVESTIGATION_PRICE_DENARII * DOSSIER_REFRESH_FLOOR_FRACTION });
    } else {
      throw new Error('expected a coin-charged warm refresh');
    }
  });

  it('beliefs: charged=true carries the priced cost, display data, and a call-ready outcome payload', async () => {
    const player = makeEntity({ resources: { investigations: 1 } });
    const outcome = await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged && outcome.investigationKind === 'beliefs') {
      expect(outcome.cost).toEqual(FULL);
      expect(outcome.display).toEqual(outcome.reportData);
      // Byte-identical to what App.tsx's handleInvestigationOutcome destructures.
      // handleRequest always calls getInvestigationResult with isRisky=true (unchanged),
      // so the mock's risky consequence string is expected here, not null.
      expect(outcome.outcome).toEqual({
        target_id: target.entity_id,
        report: expect.any(String),
        consequences: expect.any(String),
      });
    } else {
      throw new Error('expected charged investigation outcome');
    }
  });

  it('secrets: charged=true carries the priced cost, display data, and a call-ready outcome payload', async () => {
    const player = makeEntity({ resources: { investigations: 1 } });
    const outcome = await resolveIntelRequest({
      type: 'secrets', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged && outcome.investigationKind === 'secrets') {
      expect(outcome.cost).toEqual(FULL);
      expect(outcome.display).toEqual(outcome.reportData);
      expect(outcome.outcome).toEqual({
        target_id: target.entity_id,
        report: expect.any(String),
        consequences: expect.any(String),
      });
    } else {
      throw new Error('expected charged secrets investigation outcome');
    }
  });

  it("scheme: charged=true never puts reportData into the descriptor's display field (D28 non-display)", async () => {
    const player = makeEntity({ resources: { investigations: 1 } });
    const outcome = await resolveIntelRequest({
      type: 'scheme', target, playerEntity: player, knowledge: [], turnNumber: 1, ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged && outcome.investigationKind === 'scheme') {
      // The 'scheme' variant of the discriminated union has no `display` field at all -
      // the type system, not a runtime undefined check, enforces D28 non-display.
      expect('display' in outcome).toBe(false);
      // The callback payload (App.tsx's knowledge-store commit) still gets the full reportData -
      // only the tab's OWN inline display is suppressed.
      expect(outcome.reportData).toBeDefined();
      expect(Array.isArray(outcome.reportData)).toBe(true);
      expect((outcome.reportData as string[]).length).toBeGreaterThan(0);
    } else {
      throw new Error('expected charged investigation outcome');
    }
  });
});
