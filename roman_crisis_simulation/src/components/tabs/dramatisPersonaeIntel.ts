import { GoogleGenAI } from "@google/genai";
import { Entity, InvestigationResult, InvestigationTruth } from '../../types';
import { getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import { deriveDossier, InvestigationKind, KnowledgeClaim, SchemeDiscovery } from '../../knowledge/store';
import { formatWarmRefreshCaption, priceIntelPurchase, type IntelPriceQuote, type PricedIntelKind } from '../../knowledge/pricing';

/**
 * DESIGN_DECISIONS.md D14 - the full first-acquisition price of one
 * investigation aspect, in the `investigations` resource.
 */
const FIRST_INVESTIGATION_COST = 1;

/**
 * Prices one investigation aspect (D14). FLAT: every aspect - and every
 * repeat of it - costs the full first-acquisition price, whether or not the
 * player already holds a dossier on it. Investigations stay a simple unit
 * price until the currency converter lands (BACKLOG.md B1); the staleness
 * decay curve (knowledge/dossierCost.ts::computeRefreshCost, D27) stays
 * DORMANT - not on this active cost path - until a graded (non-unit) price
 * gives it room to discount a warm refresh. `held` only labels Reveal-vs-
 * Refresh and never reads any credibility number (D25).
 */
export function priceInvestigation(
  knowledge: KnowledgeClaim[],
  targetId: string,
  kind: InvestigationKind
): { cost: number; held: boolean } {
  const held = deriveDossier(knowledge, targetId).entries.some(e => e.kind === kind);
  return { cost: FIRST_INVESTIGATION_COST, held };
}

/** Graded D27 warm/cold dossier pricing quote for UI and converter rails. */
export function priceInvestigationWithWarmth(
  knowledge: KnowledgeClaim[],
  targetId: string,
  kind: PricedIntelKind,
  turnNumber: number,
  playerResources?: Entity['resources'],
): IntelPriceQuote {
  return priceIntelPurchase({ knowledge, targetId, kind, turnNumber, playerResources });
}

export { formatWarmRefreshCaption };

/**
 * The week a dossier aspect was first opened, or null if nothing is on file.
 * Feeds the broken seal's "On file since Week IX — may be stale" caption
 * (audit item 26). Deliberately separate from `priceInvestigation`, whose
 * return shape is pinned by dramatisPersonaeIntel.test.ts.
 */
export function heldSinceTurn(
  knowledge: KnowledgeClaim[],
  targetId: string,
  kind: InvestigationKind
): number | null {
  const entry = deriveDossier(knowledge, targetId).entries.find(e => e.kind === kind);
  return entry ? entry.firstLearnedTurn : null;
}

/** The D28 scheme-discovery state the player has earned on a target, or undefined if nothing is known yet. Read model over the knowledge store, never live ground truth. */
export function schemeDiscoveryFor(knowledge: KnowledgeClaim[], targetId: string): SchemeDiscovery | undefined {
  return deriveDossier(knowledge, targetId).entries.find(e => e.kind === 'scheme')?.schemeDiscovery;
}

/** ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the cost, in the `deep_analyses` resource, of commissioning one Deep Analysis on a given NPC. */
export const DEEP_ANALYSIS_COST = 1;

/**
 * The pure data descriptor `resolveIntelRequest` returns: which intel
 * request was made, whether it was actually charged (the affordability
 * gate), and the exact data the component forwards, byte-identical, to the
 * commit (hooks/useIntelCommits.ts's `handleInvestigationOutcome` /
 * `handleDeepAnalysis`). Nothing in it is for the tab to show itself: what
 * the player holds renders from the knowledge store once committed (D14),
 * and a scheme buy's reportData becomes one nature clue there, never a list
 * (D28). No side effects beyond the underlying AI call - no React state, no
 * callback invocation.
 */
export type IntelRequestOutcome =
  | { kind: 'deep_analysis'; charged: false }
  | {
      kind: 'deep_analysis';
      charged: true;
      cost: number;
      denariiCost?: number;
      analysis: string;
      /** GM-PRIVATE (D11/D47) - forwarded, untouched and unrendered, to the commit that writes the truth ledger. */
      truth?: InvestigationTruth;
    }
  | { kind: 'investigation'; investigationKind: InvestigationKind; charged: false }
  | {
      kind: 'investigation';
      investigationKind: InvestigationKind;
      charged: true;
      cost: number;
      denariiCost?: number;
      reportData: unknown;
      outcome: InvestigationResult;
      /** GM-PRIVATE (D11/D47) - forwarded, untouched and unrendered, to the commit that writes the truth ledger. */
      truth?: InvestigationTruth;
    };

/**
 * The intelligence-request orchestration extracted from
 * DramatisPersonaeTab.tsx's `handleRequest`: which cost applies, whether the
 * affordability gate passes, and what payload the caller should apply. Pure
 * function of its explicit parameters - no component state is read or
 * written here.
 */
export async function resolveIntelRequest(params: {
  type: 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis';
  target: Entity;
  playerEntity: Entity;
  knowledge: KnowledgeClaim[];
  ai: GoogleGenAI;
  isMockMode: boolean;
  turnNumber?: number;
  paymentCurrency?: 'investigations' | 'denarii';
}): Promise<IntelRequestOutcome> {
  const { type, target, playerEntity, knowledge, ai, isMockMode, turnNumber, paymentCurrency } = params;
  switch (type) {
    case 'deep_analysis': {
      // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - wires the previously-dead
      // `getDeepAnalysis`/`deep_analyses` pairing as a premium intel tier,
      // separate from (and never wired through) `getInvestigationResult`'s
      // consequence pipeline - a deep analysis never returns a
      // `consequences` string, so it never touches the investigation-fallout
      // queue (components/investigationLoop.ts).
      if ((playerEntity.resources.deep_analyses as number) >= DEEP_ANALYSIS_COST) {
        const { analysis, truth } = await getDeepAnalysis(ai, target, playerEntity, isMockMode);
        return { kind: 'deep_analysis', charged: true, cost: DEEP_ANALYSIS_COST, analysis, truth };
      }
      return { kind: 'deep_analysis', charged: false };
    }
    case 'beliefs':
    case 'secrets':
    case 'scheme': {
      // Flat first-acquisition cost in the `investigations` resource (D14);
      // priced at click from the current store so it matches the label the
      // player saw. When turnNumber is provided and denarii is requested or
      // unit capacity is exhausted, falls back to the D27 warm/cold denarii rate.
      const { cost } = priceInvestigation(knowledge, target.entity_id, type);
      const unitBalance = (playerEntity.resources.investigations as number) || 0;
      if (paymentCurrency !== 'denarii' && unitBalance >= cost) {
        const result = await getInvestigationResult(ai, target, playerEntity, true, isMockMode, type);
        const outcome = { target_id: target.entity_id, report: result.report, consequences: result.consequences };
        return { kind: 'investigation', investigationKind: type, charged: true, cost, reportData: result.reportData, outcome, truth: result.truth };
      }
      if (turnNumber !== undefined) {
        const quote = priceIntelPurchase({
          knowledge,
          targetId: target.entity_id,
          kind: type,
          turnNumber,
          playerResources: playerEntity.resources,
        });
        if (quote.canPayWithDenarii) {
          const result = await getInvestigationResult(ai, target, playerEntity, true, isMockMode, type);
          const outcome = { target_id: target.entity_id, report: result.report, consequences: result.consequences };
          return {
            kind: 'investigation',
            investigationKind: type,
            charged: true,
            cost: 0,
            denariiCost: quote.denariiCost,
            reportData: result.reportData,
            outcome,
            truth: result.truth,
          };
        }
      }
      return { kind: 'investigation', investigationKind: type, charged: false };
    }
  }
}
