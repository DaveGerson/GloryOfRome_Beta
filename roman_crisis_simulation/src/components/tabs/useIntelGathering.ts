import { useEffect, useRef, useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from '@google/genai';
import { KnowledgeClaim } from '../../knowledge/store';
import { resolveIntelRequest } from './dramatisPersonaeIntel';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';

export type IntelRequestType = 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis';

export type IntelGatheringInput = {
  entity: Entity;
  playerEntity: Entity;
  knowledge: KnowledgeClaim[];
  ai: GoogleGenAI;
  isMockMode: boolean;
  interactionLocked?: boolean;
  runDomainMutation: RunDomainMutation;
  /** Commits the deep_analyses spend AND the assessment in one pass (hooks/useIntelCommits.ts). */
  onSpendDeepAnalysis: (targetId: string, cost: number, analysis: string, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  onInvestigationOutcome: (
    kind: 'beliefs' | 'scheme' | 'secrets',
    targetId: string,
    reportData: unknown,
    cost: number,
    result: InvestigationResult,
    request: DomainMutationContext,
  ) => boolean | void | Promise<boolean | void>;
};

export type IntelGatheringResult = {
  loadingState: IntelRequestType | null;
  requestError: string | null;
  handleRequest: (type: IntelRequestType) => Promise<void>;
  /**
   * The aspect whose paid finding last landed, with a sequence number that
   * changes on every landing - the card moves keyboard focus to that finding
   * once per landing (WCAG 2.4.3). Null until something lands.
   */
  landed: { type: IntelRequestType; seq: number } | null;
};

/**
 * Batch 3 (Q4) extraction: the async intel-request core lifted verbatim out
 * of `EntityDetails` in DramatisPersonaeTab.tsx. Pure derivations
 * (deriveDossier, heldReadingFor, pricing) stay in the component - this hook
 * owns only the request lifecycle: loadingState, requestError, the
 * mountedRef liveness guard, and handleRequest.
 *
 * It holds NO copy of what was bought. Every finding - the itemised
 * beliefs/secrets and the Spymaster's Assessment included - is committed to
 * the knowledge store and rendered from it (D14: the ephemeral
 * component-local intel state is retired), so a tab switch that unmounts
 * the card loses nothing that was paid for.
 */
export function useIntelGathering({
  entity,
  playerEntity,
  knowledge,
  ai,
  isMockMode,
  interactionLocked,
  runDomainMutation,
  onSpendDeepAnalysis,
  onInvestigationOutcome,
}: IntelGatheringInput): IntelGatheringResult {
  const [loadingState, setLoadingState] = useState<IntelRequestType | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [landed, setLanded] = useState<IntelGatheringResult['landed']>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleRequest = async (type: IntelRequestType) => {
    if (interactionLocked) return;
    try {
      await runDomainMutation(async transaction => {
        // The App lease outlives this details surface when the player changes
        // tabs. Every child state write and both paid commit callbacks need the
        // narrower lifetime, and App re-checks this guard at its save boundary.
        const request: DomainMutationContext = {
          isCurrent: () => mountedRef.current && transaction.isCurrent(),
        };
        if (!request.isCurrent()) return;
        setRequestError(null);
        setLoadingState(type);
        const land = (kind: IntelRequestType) => setLanded(previous => ({ type: kind, seq: (previous?.seq ?? 0) + 1 }));
        try {
          const outcome = await resolveIntelRequest({ type, target: entity, playerEntity, knowledge, ai, isMockMode });
          if (outcome.kind === 'deep_analysis') {
            if (outcome.charged) {
              const committed = await onSpendDeepAnalysis(entity.entity_id, outcome.cost, outcome.analysis, request);
              if (request.isCurrent() && committed !== false) land('deep_analysis');
            }
            return;
          }
          if (outcome.charged) {
            const committed = await onInvestigationOutcome(outcome.investigationKind, entity.entity_id, outcome.reportData, outcome.cost, outcome.outcome, request);
            if (request.isCurrent() && committed !== false) land(outcome.investigationKind);
          }
        } finally {
          if (request.isCurrent()) setLoadingState(null);
        }
      });
    } catch (error) {
      if (mountedRef.current) {
        console.error('Error resolving intelligence request:', error);
        setRequestError('The intelligence request could not be completed. Please try again.');
      }
    }
  };

  return { loadingState, requestError, handleRequest, landed };
}
