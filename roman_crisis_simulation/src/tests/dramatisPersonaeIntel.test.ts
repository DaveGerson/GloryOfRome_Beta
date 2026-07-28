/**
 * Task 7 - characterizes the pure helpers and the async request resolver
 * extracted from components/tabs/DramatisPersonaeTab.tsx into
 * components/tabs/dramatisPersonaeIntel.ts. Pins CURRENT behavior only: flat
 * D14 pricing (D27's computeRefreshCost stays DORMANT/untouched), D28's
 * scheme non-display rule, the affordability gates, and the exact payload
 * shape App.tsx's handleInvestigationOutcome (App.tsx:870) already expects.
 */
import { describe, it, expect } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import type { Entity } from '../types';
import { ingestInvestigationReveal, ingestSchemeClue, type KnowledgeClaim } from '../knowledge/store';
import {
  priceInvestigation,
  schemeDiscoveryFor,
  resolveIntelRequest,
  DEEP_ANALYSIS_COST,
} from '../components/tabs/dramatisPersonaeIntel';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'e1',
    name: 'Test Entity',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

const target = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });
const unusedAi = {} as GoogleGenAI; // mock mode never touches ai.models

describe('components/tabs/dramatisPersonaeIntel - priceInvestigation (D14, moved verbatim)', () => {
  it('an unheld aspect is a first acquisition at the flat cost', () => {
    expect(priceInvestigation([], 'maximinus_thrax', 'beliefs')).toEqual({ cost: 1, held: false });
  });

  it('a HELD aspect still costs the same flat price - D27 staleness discount stays dormant', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
    });
    // Even refreshed on the very same turn (staleness 0, where D27 would floor-discount if wired in),
    // the flat active-path price stays full - this pins the CURRENT (not D27) behavior.
    expect(priceInvestigation(store, 'maximinus_thrax', 'beliefs')).toEqual({ cost: 1, held: true });
  });

  it('holding one aspect does not discount a different, unheld aspect of the same target', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax', kind: 'beliefs', text: 'He believes strength confers legitimacy.', turn: 4,
    });
    expect(priceInvestigation(store, 'maximinus_thrax', 'secrets')).toEqual({ cost: 1, held: false });
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
      type: 'deep_analysis', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
    });
    expect(outcome).toEqual({ kind: 'deep_analysis', charged: false });
  });

  it('deep_analysis: charged=true with the analysis text and cost when affordable', async () => {
    const player = makeEntity({ resources: { deep_analyses: DEEP_ANALYSIS_COST } });
    const outcome = await resolveIntelRequest({
      type: 'deep_analysis', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
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

  it('beliefs: charged=false when investigations is below the flat cost (the affordability gate)', async () => {
    const player = makeEntity({ resources: { investigations: 0 } });
    const outcome = await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
    });
    expect(outcome).toEqual({ kind: 'investigation', investigationKind: 'beliefs', charged: false });
  });

  it('beliefs: charged=true carries the priced cost, display data, and a call-ready outcome payload', async () => {
    const player = makeEntity({ resources: { investigations: 1 } });
    const outcome = await resolveIntelRequest({
      type: 'beliefs', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged && outcome.investigationKind === 'beliefs') {
      expect(outcome.cost).toBe(1);
      expect(outcome.display).toEqual(outcome.reportData);
      // Byte-identical to what App.tsx:870's handleInvestigationOutcome destructures.
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
      type: 'secrets', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
    });
    expect(outcome.kind).toBe('investigation');
    if (outcome.kind === 'investigation' && outcome.charged && outcome.investigationKind === 'secrets') {
      expect(outcome.cost).toBe(1);
      expect(outcome.display).toEqual(outcome.reportData);
      // Byte-identical to what App.tsx:870's handleInvestigationOutcome destructures.
      // handleRequest always calls getInvestigationResult with isRisky=true (unchanged),
      // so the mock's risky consequence string is expected here, not null.
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
      type: 'scheme', target, playerEntity: player, knowledge: [], ai: unusedAi, isMockMode: true,
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
