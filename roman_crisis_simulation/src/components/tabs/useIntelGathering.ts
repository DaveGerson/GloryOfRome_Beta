import { useEffect, useRef, useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from '@google/genai';
import { KnowledgeClaim } from '../../knowledge/store';
import { resolveIntelRequest } from './dramatisPersonaeIntel';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';

export type UncoveredIntel = { secrets?: string[]; beliefs?: string[]; deep_analysis?: string };

export type IntelGatheringInput = {
  entity: Entity;
  playerEntity: Entity;
  knowledge: KnowledgeClaim[];
  ai: GoogleGenAI;
  isMockMode: boolean;
  interactionLocked?: boolean;
  runDomainMutation: RunDomainMutation;
  onSpendDeepAnalysis: (cost: number, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
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
  uncoveredIntel: UncoveredIntel;
  loadingState: 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis' | null;
  requestError: string | null;
  handleRequest: (type: 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis') => Promise<void>;
};

/**
 * Batch 3 (Q4) extraction: the async intel-request core lifted verbatim out
 * of `EntityDetails` in DramatisPersonaeTab.tsx. Pure derivations
 * (deriveDossier, heldReadingFor, pricing) stay in the component - this hook
 * owns only the request lifecycle: uncoveredIntel, loadingState,
 * requestError, the mountedRef liveness guard, and handleRequest.
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
  const [uncoveredIntel, setUncoveredIntel] = useState<UncoveredIntel>({});
  const [loadingState, setLoadingState] = useState<'secrets' | 'beliefs' | 'scheme' | 'deep_analysis' | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleRequest = async (type: 'secrets' | 'beliefs' | 'scheme' | 'deep_analysis') => {
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
        try {
          const outcome = await resolveIntelRequest({ type, target: entity, playerEntity, knowledge, ai, isMockMode });
          if (outcome.kind === 'deep_analysis') {
            if (outcome.charged) {
              const committed = await onSpendDeepAnalysis(outcome.cost, request);
              if (request.isCurrent() && committed !== false) {
                setUncoveredIntel(previous => ({ ...previous, deep_analysis: outcome.analysis }));
              }
            }
            return;
          }
          if (outcome.charged) {
            if (outcome.investigationKind !== 'scheme') {
              const committed = await onInvestigationOutcome(outcome.investigationKind, entity.entity_id, outcome.reportData, outcome.cost, outcome.outcome, request);
              if (request.isCurrent() && committed !== false) {
                setUncoveredIntel(previous => ({ ...previous, [outcome.investigationKind]: outcome.display }));
              }
            } else {
              await onInvestigationOutcome(outcome.investigationKind, entity.entity_id, outcome.reportData, outcome.cost, outcome.outcome, request);
            }
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

  return { uncoveredIntel, loadingState, requestError, handleRequest };
}
