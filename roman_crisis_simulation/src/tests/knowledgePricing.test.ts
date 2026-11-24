/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import type { GoogleGenAI } from '@google/genai';
import {
  CONVERSION_FRICTION_FACTOR,
  CONVERSION_RATES,
  convertResourceToInvestigations,
  DEEP_ANALYSIS_DENARII_BASE,
  formatWarmRefreshCaption,
  INVESTIGATION_DENARII_BASE,
  priceIntelPurchase,
} from '../knowledge/pricing';
import { ingestInvestigationReveal, ingestSchemeClue, type KnowledgeClaim } from '../knowledge/store';
import { priceInvestigationWithWarmth, resolveIntelRequest } from '../components/tabs/dramatisPersonaeIntel';
import { useIntelCommits, type IntelCommitsDeps } from '../hooks/useIntelCommits';
import { renderHook } from './renderHook';
import { makeEntity } from './factories';
import type { DomainCommit } from '../app/transactions';
import type { DomainMutationContext } from '../state/domainMutation';
import type { SaveGameState } from '../persistence/saveGame';
import type { Entity, InvestigationResult, Report } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unusedAi = {} as GoogleGenAI;

describe('3A: Currency Converter (B1/T1) + D27 Warm Dossier Refresh Pricing', () => {
  it('scales held dossier denarii cost linearly from 20% warm floor to 100% cold threshold and applies friction to unheld coin buys', () => {
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
    expect(unheld.denariiCost).toBe(3150);
    expect(unheld.warmthBand).toBe('unheld');
    expect(unheld.discountPct).toBe(0);

    const unheldDeep = priceIntelPurchase({
      knowledge: [],
      targetId: 'maximinus_thrax',
      kind: 'deep_analysis',
      turnNumber: 4,
      playerResources: { deep_analyses: 0, denarii: 8000 },
    });
    expect(unheldDeep.denariiCost).toBe(7500);
    expect(unheldDeep.canPayWithDenarii).toBe(true);

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
    expect(formatWarmRefreshCaption(midpoint)).toContain('40% denarii discount');

    // Past cold threshold (t >= 6): back to full 2500 denarii.
    const cold = priceInvestigationWithWarmth(store, 'maximinus_thrax', 'beliefs', 10, { denarii: 3000 });
    expect(cold.isWarmRefresh).toBe(false);
    expect(cold.denariiCost).toBe(2500);
    expect(cold.warmthBand).toBe('cold');
    expect(formatWarmRefreshCaption(cold)).toContain('File grown cold');
  });

  it('excludes passive scheme awareness (0 clues) from warm discount and anchors scheme warmth to paid spy updates', () => {
    const passiveOnly = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax',
      turn: 3,
      source: 'witnessed',
      text: 'Thrax meets armed riders by night.',
      advancesNature: false,
    });
    const passiveQuote = priceIntelPurchase({
      knowledge: passiveOnly,
      targetId: 'maximinus_thrax',
      kind: 'scheme',
      turnNumber: 3,
      playerResources: { investigations: 0, denarii: 5000 },
    });
    expect(passiveQuote.held).toBe(false);
    expect(passiveQuote.isWarmRefresh).toBe(false);
    expect(passiveQuote.denariiCost).toBe(3150);

    // One paid clue at turn 2, followed by a passive witnessed whisper at turn 8:
    // warmth must still measure from turn 2 (cold at turn 8).
    let mixed = ingestSchemeClue([], {
      schemerId: 'maximinus_thrax',
      turn: 2,
      source: 'spy',
      text: 'Unrecorded paymasters in Mogontiacum.',
      natureHint: 'Bribery.',
      advancesNature: true,
    });
    mixed = ingestSchemeClue(mixed, {
      schemerId: 'maximinus_thrax',
      turn: 8,
      source: 'witnessed',
      text: 'Quiet couriers arrived again.',
      advancesNature: false,
    });
    const mixedQuote = priceIntelPurchase({
      knowledge: mixed,
      targetId: 'maximinus_thrax',
      kind: 'scheme',
      turnNumber: 8,
    });
    expect(mixedQuote.held).toBe(true);
    expect(mixedQuote.lastRefreshedTurn).toBe(2);
    expect(mixedQuote.turnsSinceRefresh).toBe(6);
    expect(mixedQuote.isWarmRefresh).toBe(false);
    expect(mixedQuote.denariiCost).toBe(INVESTIGATION_DENARII_BASE);
  });

  it('handles non-finite turnNumber gracefully without NaN prices or false warm discounts', () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      text: 'Force settles disputes.',
      turn: 4,
    });
    const quote = priceIntelPurchase({
      knowledge: store,
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      turnNumber: Number.NaN,
      playerResources: { investigations: 0, denarii: 3000 },
    });
    expect(quote.held).toBe(true);
    expect(quote.turnsSinceRefresh).toBeNull();
    expect(quote.isWarmRefresh).toBe(false);
    expect(quote.discountPct).toBe(0);
    expect(quote.warmthBand).toBe('cold');
    expect(quote.denariiCost).toBe(INVESTIGATION_DENARII_BASE);
  });

  it('applies explicit T1 conversion friction and refuses insufficient balances without mutating inputs', () => {
    expect(CONVERSION_RATES.senatorial_support).toBe(10);
    expect(CONVERSION_RATES.legion_support).toBe(10);

    const startResources = { denarii: 10000, senatorial_support: 15, legion_support: 14, investigations: 1 };
    const denariiResult = convertResourceToInvestigations(startResources, 'denarii', 2);
    const expectedSpend = Math.ceil(CONVERSION_RATES.denarii * 2 * CONVERSION_FRICTION_FACTOR);
    expect(denariiResult.ok).toBe(true);
    expect(denariiResult.spent).toBe(expectedSpend);
    expect(denariiResult.gainedInvestigations).toBe(2);
    expect(denariiResult.updatedResources.denarii).toBe(10000 - expectedSpend);
    expect(denariiResult.updatedResources.investigations).toBe(3);
    expect(startResources.denarii).toBe(10000);

    const senateResult = convertResourceToInvestigations(startResources, 'senatorial_support', 1);
    expect(senateResult.ok).toBe(true);
    expect(senateResult.spent).toBe(13); // ceil(10 * 1.25)

    const legionResult = convertResourceToInvestigations(startResources, 'legion_support', 1);
    expect(legionResult.ok).toBe(true);
    expect(legionResult.spent).toBe(13);

    const tooPoor = convertResourceToInvestigations({ denarii: 1000, investigations: 0 }, 'denarii', 1);
    expect(tooPoor.ok).toBe(false);
    expect(tooPoor.reason).toContain('Requires');
  });

  it('resolveIntelRequest falls back to D27 denarii pricing on both regular investigations and deep_analysis', async () => {
    const store = ingestInvestigationReveal([], {
      targetId: 'maximinus_thrax',
      kind: 'beliefs',
      text: 'Force settles disputes.',
      turn: 5,
    });
    const player = makeEntity({ entity_id: 'player_1', resources: { investigations: 0, deep_analyses: 0, denarii: 8000 } });
    const target = makeEntity({ entity_id: 'maximinus_thrax', name: 'Maximinus Thrax' });

    const invOutcome = await resolveIntelRequest({
      type: 'beliefs',
      target,
      playerEntity: player,
      knowledge: store,
      ai: unusedAi,
      isMockMode: true,
      turnNumber: 5,
    });

    expect(invOutcome.kind).toBe('investigation');
    if (invOutcome.kind === 'investigation' && invOutcome.charged) {
      expect(invOutcome.cost).toBe(0);
      expect(invOutcome.denariiCost).toBe(500);
    } else {
      throw new Error('expected denarii-backed warm refresh outcome');
    }

    const deepOutcome = await resolveIntelRequest({
      type: 'deep_analysis',
      target,
      playerEntity: player,
      knowledge: [],
      ai: unusedAi,
      isMockMode: true,
      turnNumber: 5,
    });
    expect(deepOutcome.kind).toBe('deep_analysis');
    if (deepOutcome.kind === 'deep_analysis' && deepOutcome.charged) {
      expect(deepOutcome.cost).toBe(0);
      expect(deepOutcome.denariiCost).toBe(Math.round((DEEP_ANALYSIS_DENARII_BASE * CONVERSION_FRICTION_FACTOR) / 50) * 50);
    } else {
      throw new Error('expected denarii-backed deep analysis outcome');
    }
  });

  it('useIntelCommits deducts denarii, emits D6 low-treasury warnings, and commits Fund Agents conversions atomically', async () => {
    const live: DomainMutationContext = { isCurrent: () => true };
    const commits: DomainCommit[] = [];
    const notes: unknown[] = [];
    const player = makeEntity({
      entity_id: 'player',
      name: 'Severus Alexander',
      resources: { investigations: 0, deep_analyses: 0, denarii: 5200, senatorial_support: 20 },
    });
    const target = makeEntity({ entity_id: 'thrax', name: 'Maximinus Thrax' });

    const deps: IntelCommitsDeps = {
      ai: unusedAi,
      isMockMode: true,
      entities: [player, target],
      playerCharacterId: 'player',
      knowledge: [],
      reports: [],
      truthLedger: [],
      pendingIntelligenceFallout: [],
      messages: [],
      turnNumber: 6,
      buildSaveState: overrides => ({ ...overrides } as SaveGameState),
      commitDomainMutation: commit => { commits.push(commit); return true; },
      setTransactionNote: note => { notes.push(note); },
    };

    const hook = renderHook(useIntelCommits, deps);

    // 1. Spend denarii via investigation fallback, crossing below LOW_TREASURY_THRESHOLD (5000).
    const invResult: InvestigationResult = { target_id: 'thrax', report: 'He eyes the frontier chest.', consequences: null };
    await act(async () => {
      const ok = await hook.current.handleInvestigationOutcome('beliefs', 'thrax', ['Believes gold buys peace.'], 0, invResult, live, undefined, 3150);
      expect(ok).toBe(true);
    });
    const action1 = commits[0].action as { entities: Entity[]; reports?: Report[] };
    expect(action1.entities.find(e => e.entity_id === 'player')!.resources.denarii).toBe(2050);
    expect(action1.reports?.some(r => r.claim.includes('below 5000 denarii'))).toBe(true);

    // 2. Fund Agents conversion from denarii on sufficient balance emits low-treasury warning too.
    expect(hook.current.handleConvertResourceToInvestigations('denarii', live)).toBe(true);
    const action2 = commits[1].action as { entities: Entity[]; reports?: Report[] };
    const p2 = action2.entities.find(e => e.entity_id === 'player')!;
    expect(p2.resources.investigations).toBe(1);
    expect(p2.resources.denarii).toBe(5200 - 3125);
    expect(action2.reports?.some(r => r.claim.includes('below 5000 denarii'))).toBe(true);

    // 3. Refusal when live denarii balance is below requested coin spend (never emits a 'save' error).
    let refused = true;
    await act(async () => {
      refused = await hook.current.handleInvestigationOutcome('beliefs', 'thrax', ['Too expensive.'], 0, invResult, live, undefined, 9000);
    });
    expect(refused).toBe(false);
    expect(commits).toHaveLength(2);
    expect(notes).toContainEqual({
      kind: 'plain',
      title: 'The treasury cannot meet it',
      message: 'Not enough funds in the treasury to complete this order.',
    });
    expect(notes.some(n => n && typeof n === 'object' && 'kind' in n && (n as { kind: string }).kind === 'save')).toBe(false);

    // 4. Rejects negative / non-finite costs cleanly too.
    expect(hook.current.handleDeepAnalysis('thrax', Number.NaN, 'Ignored.', live)).toBe(false);
    expect(hook.current.handleDeepAnalysis('thrax', -1, 'Ignored.', live)).toBe(false);
    expect(commits).toHaveLength(2);

    hook.unmount();
  });
});
