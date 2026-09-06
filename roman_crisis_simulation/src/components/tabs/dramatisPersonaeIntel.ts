import { GoogleGenAI } from "@google/genai";
import { Entity, InvestigationResult } from '../../types';
import { getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import { deriveDossier, InvestigationKind, KnowledgeClaim, SchemeDiscovery } from '../../knowledge/store';
import { computeRefreshCost, DOSSIER_COLD_THRESHOLD } from '../../knowledge/dossierCost';
import { INVESTIGATION_PRICE_DENARII } from '../../ai/core/exchequer';
import { numericResource } from '../../ai/core/resourceRegistry';

/**
 * DESIGN_DECISIONS.md D14 - the full first-acquisition price of one
 * investigation aspect, in the `investigations` resource.
 */
const FIRST_INVESTIGATION_COST = 1;

/**
 * What an intel purchase costs (D27, graded): whole `investigations`, or
 * `denarii` for a warm refresh. Exactly one of the two is non-zero for any
 * price the game quotes today; both are always present so a charge site
 * debits both without branching on shape.
 */
export interface IntelPrice {
  investigations: number;
  denarii: number;
}

export const FREE_INTEL: IntelPrice = { investigations: 0, denarii: 0 };

/** True when the bag covers both halves of a price. */
export function canAffordIntel(resources: Entity['resources'], price: IntelPrice): boolean {
  return numericResource(resources, 'investigations') >= price.investigations
    && numericResource(resources, 'denarii') >= price.denarii;
}

/**
 * Prices one investigation aspect (D14/D27). GRADED since D46's exchequer
 * gave an investigation a coin price (ai/core/exchequer.ts's
 * INVESTIGATION_PRICE_DENARII), which is what BACKLOG B1 said the dormant
 * D27 curve was waiting for:
 *
 *  - a FIRST acquisition costs one investigation (D14, as before);
 *  - a COLD refresh (staleness at or past knowledge/dossierCost.ts's
 *    DOSSIER_COLD_THRESHOLD) is a fresh acquisition again - one
 *    investigation;
 *  - a WARM refresh is settled in COIN at the D27 curve run over the
 *    exchequer's price: `computeRefreshCost(1500, staleness)` - 300 denarii
 *    the same week, rising a notch a week toward 1,500 at the cold
 *    threshold. Never free (the curve's floor is a fifth of full price),
 *    never a whole investigation (that is what "costs less than first
 *    acquisition" means once the unit price has room to grade).
 *
 * D27 says "paid in the same resource the first investigation used"; the
 * coin settlement reads that resource as the currency investigations are
 * now bought WITH - the warm fee is the exchequer's own price for a fraction
 * of one. Flagged for the owner in D46. A 'scheme' aspect is never a
 * refresh: each buy earns a NEW clue toward the reveal (D28), so it always
 * pays full price. `held` only labels Reveal-vs-Refresh and never reads any
 * credibility number (D25).
 */
export function priceInvestigation(
  knowledge: KnowledgeClaim[],
  targetId: string,
  kind: InvestigationKind,
  currentTurn: number
): { cost: IntelPrice; held: boolean } {
  const entry = deriveDossier(knowledge, targetId).entries.find(e => e.kind === kind);
  const full: IntelPrice = { investigations: FIRST_INVESTIGATION_COST, denarii: 0 };
  if (!entry) return { cost: full, held: false };
  if (kind === 'scheme') return { cost: full, held: true };
  const staleness = currentTurn - entry.lastRefreshedTurn;
  if (staleness >= DOSSIER_COLD_THRESHOLD) return { cost: full, held: true };
  const fee = Math.round(computeRefreshCost(INVESTIGATION_PRICE_DENARII, staleness, DOSSIER_COLD_THRESHOLD));
  return { cost: { investigations: 0, denarii: fee }, held: true };
}

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
 * gate), and the exact data the component applies to its own display state
 * or forwards, byte-identical, to App.tsx's `onInvestigationOutcome`
 * (App.tsx:870's `handleInvestigationOutcome`). No side effects beyond the
 * underlying AI call - no React state, no callback invocation.
 */
export type IntelRequestOutcome =
  | { kind: 'deep_analysis'; charged: false }
  | { kind: 'deep_analysis'; charged: true; cost: number; analysis: string }
  | { kind: 'investigation'; investigationKind: InvestigationKind; charged: false }
  | {
      /** D28: a scheme buy never displays its raw reportData - only the Active Scheme discovery-state surface. This variant cannot carry `display`. */
      kind: 'investigation';
      investigationKind: 'scheme';
      charged: true;
      cost: IntelPrice;
      reportData: unknown;
      outcome: InvestigationResult;
    }
  | {
      /** beliefs/secrets show their findings inline - `display` is required, never optional. */
      kind: 'investigation';
      investigationKind: 'beliefs' | 'secrets';
      charged: true;
      cost: IntelPrice;
      display: string[];
      reportData: unknown;
      outcome: InvestigationResult;
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
  /** The App's authoritative turn counter - the staleness clock a refresh is priced against (D27). */
  turnNumber: number;
  ai: GoogleGenAI;
  isMockMode: boolean;
}): Promise<IntelRequestOutcome> {
  const { type, target, playerEntity, knowledge, turnNumber, ai, isMockMode } = params;
  switch (type) {
    case 'deep_analysis': {
      // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - wires the previously-dead
      // `getDeepAnalysis`/`deep_analyses` pairing as a premium intel tier,
      // separate from (and never wired through) `getInvestigationResult`'s
      // consequence pipeline - a deep analysis never returns a
      // `consequences` string, so it never touches the investigation-fallout
      // queue (components/investigationLoop.ts).
      if ((playerEntity.resources.deep_analyses as number) >= DEEP_ANALYSIS_COST) {
        const analysis = await getDeepAnalysis(ai, target, playerEntity, isMockMode);
        return { kind: 'deep_analysis', charged: true, cost: DEEP_ANALYSIS_COST, analysis };
      }
      return { kind: 'deep_analysis', charged: false };
    }
    case 'beliefs':
    case 'secrets':
    case 'scheme': {
      // Graded price (D14/D27); priced at click from the current store and
      // turn so it matches the label the player saw.
      const { cost } = priceInvestigation(knowledge, target.entity_id, type, turnNumber);
      if (canAffordIntel(playerEntity.resources, cost)) {
        const result = await getInvestigationResult(ai, target, playerEntity, true, isMockMode, type);
        const outcome = { target_id: target.entity_id, report: result.report, consequences: result.consequences };
        // A 'scheme' buy does NOT display its raw reportData (D28): the
        // store commits it as ONE nature clue and the Active Scheme surface
        // renders the earned discovery state. beliefs/secrets show their
        // findings inline.
        if (type === 'scheme') {
          return { kind: 'investigation', investigationKind: type, charged: true, cost, reportData: result.reportData, outcome };
        }
        return {
          kind: 'investigation',
          investigationKind: type,
          charged: true,
          cost,
          display: result.reportData as string[],
          reportData: result.reportData,
          outcome,
        };
      }
      return { kind: 'investigation', investigationKind: type, charged: false };
    }
  }
}
