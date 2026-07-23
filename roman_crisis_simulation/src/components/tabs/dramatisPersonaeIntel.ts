import { GoogleGenAI } from "@google/genai";
import { Entity, InvestigationResult } from '../../types';
import { getRawThoughts, getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import { deriveDossier, InvestigationKind, KnowledgeClaim, SchemeDiscovery } from '../../knowledge/store';

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
  | { kind: 'raw_thoughts'; text: string }
  | { kind: 'deep_analysis'; charged: false }
  | { kind: 'deep_analysis'; charged: true; cost: number; analysis: string }
  | { kind: 'investigation'; investigationKind: InvestigationKind; charged: false }
  | {
      /** D28: a scheme buy never displays its raw reportData - only the Active Scheme discovery-state surface. This variant cannot carry `display`. */
      kind: 'investigation';
      investigationKind: 'scheme';
      charged: true;
      cost: number;
      reportData: unknown;
      outcome: InvestigationResult;
    }
  | {
      /** beliefs/secrets show their findings inline - `display` is required, never optional. */
      kind: 'investigation';
      investigationKind: 'beliefs' | 'secrets';
      charged: true;
      cost: number;
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
  type: 'secrets' | 'beliefs' | 'scheme' | 'raw_thoughts' | 'deep_analysis';
  target: Entity;
  playerEntity: Entity;
  knowledge: KnowledgeClaim[];
  ai: GoogleGenAI;
  isMockMode: boolean;
}): Promise<IntelRequestOutcome> {
  const { type, target, playerEntity, knowledge, ai, isMockMode } = params;
  switch (type) {
    case 'raw_thoughts': {
      const text = await getRawThoughts(ai, target, playerEntity, isMockMode);
      return { kind: 'raw_thoughts', text };
    }
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
      // Flat first-acquisition cost in the `investigations` resource (D14);
      // priced at click from the current store so it matches the label the
      // player saw.
      const { cost } = priceInvestigation(knowledge, target.entity_id, type);
      if ((playerEntity.resources.investigations as number) >= cost) {
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
