import React, { useEffect, useRef, useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from '@google/genai';
import InfoTooltip from '../InfoTooltip';
import { Card, Button } from '../ui/Core';
import { Alert } from '../ui/Alert';
import { toRoman } from '../ui/Brand';
import { InvestigationKind, KnowledgeClaim, SCHEME_CLUES_TO_REVEAL } from '../../knowledge/store';
import { isEntityKnownToPlayer, relationshipTimelineFor } from '../../knowledge/relationships';
import { priceInvestigation, schemeDiscoveryFor, resolveIntelRequest, DEEP_ANALYSIS_COST } from './dramatisPersonaeIntel';
import { quiet, IntelSection, SchemeIntelSection, DeepAnalysisSection } from './dramatisPersonaeUi';
import RelationshipObservations from './RelationshipObservations';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';

type UncoveredIntel = { secrets?: string[]; beliefs?: string[]; deep_analysis?: string };
type Wiring = {
  knowledge: KnowledgeClaim[];
  turnNumber: number;
  onSpendDeepAnalysis: (cost: number, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  runDomainMutation: RunDomainMutation;
  interactionLocked?: boolean;
  ai: GoogleGenAI;
  isMockMode: boolean;
};

const EntityDetails: React.FC<{ entity: Entity; playerEntity: Entity } & Wiring> = ({
  entity, playerEntity, knowledge, turnNumber, onSpendDeepAnalysis, onInvestigationOutcome, runDomainMutation, ai, isMockMode, interactionLocked,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [uncoveredIntel, setUncoveredIntel] = useState<UncoveredIntel>({});
  const [loadingState, setLoadingState] = useState<'secrets' | 'beliefs' | 'scheme' | 'deep_analysis' | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const price = (kind: InvestigationKind) => priceInvestigation(knowledge, entity.entity_id, kind);
  const schemeDiscovery = schemeDiscoveryFor(knowledge, entity.entity_id);
  const observations = relationshipTimelineFor(knowledge, entity.entity_id);

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

  const investigations = (playerEntity.resources.investigations as number) || 0;
  const deepAnalyses = (playerEntity.resources.deep_analyses as number) || 0;
  return (
    <Card title={entity.name} action={<Button size="sm" variant={isExpanded ? 'ghost' : 'secondary'} onClick={() => setIsExpanded(value => !value)}>{isExpanded ? 'Collapse' : 'Intel'}</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={quiet}>{entity.position || entity.entity_type}</span>
        <RelationshipObservations observations={observations} currentTurn={turnNumber} />
        {requestError && <Alert title="Your agents return empty-handed">{requestError}</Alert>}
        {isExpanded && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-faint)' }}>
          <span className="gor-label" style={{ color: 'var(--tyrian-500)' }}>Intelligence Briefing</span>
          <IntelSection title="Beliefs" {...price('beliefs')} resourceName="Inv." resourceCount={investigations} uncoveredData={uncoveredIntel.beliefs} onUncover={() => handleRequest('beliefs')} isLoading={loadingState === 'beliefs'} interactionLocked={interactionLocked} tooltip="Uncover the core ideologies and principles that drive this character's decisions." />
          <SchemeIntelSection discovery={schemeDiscovery} threshold={SCHEME_CLUES_TO_REVEAL} cost={price('scheme').cost} resourceCount={investigations} onInvestigate={() => handleRequest('scheme')} isLoading={loadingState === 'scheme'} interactionLocked={interactionLocked} tooltip="Piece together what this character is quietly plotting. Each investigation earns one clue toward its true nature." />
          <IntelSection title="Secrets" {...price('secrets')} resourceName="Inv." resourceCount={investigations} uncoveredData={uncoveredIntel.secrets} onUncover={() => handleRequest('secrets')} isLoading={loadingState === 'secrets'} interactionLocked={interactionLocked} tooltip="Use high-risk, high-reward investigation to uncover hidden fears, blackmail material, or secret plots." />
          <DeepAnalysisSection analysis={uncoveredIntel.deep_analysis} cost={DEEP_ANALYSIS_COST} resourceCount={deepAnalyses} onCommission={() => handleRequest('deep_analysis')} isLoading={loadingState === 'deep_analysis'} interactionLocked={interactionLocked} />
        </div>}
      </div>
    </Card>
  );
};

const FactionSection: React.FC<{ faction: Entity; members: Entity[]; playerEntity: Entity } & Wiring> = ({ faction, members, playerEntity, ...wiring }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ background: 'var(--metal-tyrian)', color: '#F2EBDC', padding: '9px 14px', boxShadow: 'var(--bevel)' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', color: '#F0D089' }}>{faction.name}</span>
    </div>
    {members.map(entity => <EntityDetails key={entity.entity_id} entity={entity} playerEntity={playerEntity} {...wiring} />)}
  </div>
);

const DramatisPersonaeTab: React.FC<{ playerEntity: Entity | null; entities: Entity[] } & Wiring> = ({ playerEntity, entities, ...wiring }) => {
  if (!playerEntity) return <p style={quiet}>Loading character…</p>;
  const known = entities.filter(entity => isEntityKnownToPlayer(playerEntity, entity, wiring.knowledge));
  // Knownness is deliberately evaluated before status and faction grouping:
  // an unseen death or affiliation must not establish a hidden identity.
  const knownLiving = known.filter(entity => entity.entity_id !== playerEntity.entity_id && entity.entity_type !== 'faction' && entity.status === 'alive');
  const knownFactions = known.filter(entity => entity.entity_type === 'faction' && entity.status === 'alive');
  const factionIds = new Set(knownFactions.map(faction => faction.entity_id));
  const neutral = knownLiving.filter(entity => !entity.faction_id || !factionIds.has(entity.faction_id));
  const investigations = (playerEntity.resources.investigations as number) || 0;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={quiet}>What is known — and what can be bought.</span>
      <span className="gor-label" style={{ color: investigations > 0 ? 'var(--gold-700)' : 'var(--crimson-500)', whiteSpace: 'nowrap' }}>Investigations: {investigations > 0 ? toRoman(investigations) : 'None'}<InfoTooltip text="Your capacity for espionage. Spend to reveal beliefs, schemes, or secrets." /></span>
    </span>
    {knownFactions.map(faction => <FactionSection key={faction.entity_id} faction={faction} members={knownLiving.filter(member => member.faction_id === faction.entity_id)} playerEntity={playerEntity} {...wiring} />)}
    {neutral.length > 0 && <><span className="gor-label">Other known figures</span>{neutral.map(entity => <EntityDetails key={entity.entity_id} entity={entity} playerEntity={playerEntity} {...wiring} />)}</>}
  </div>;
};

export default DramatisPersonaeTab;
