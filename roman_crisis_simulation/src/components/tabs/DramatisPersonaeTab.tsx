import React, { useId, useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from '@google/genai';
import InfoTooltip from '../InfoTooltip';
import { Card, Button } from '../ui/Core';
import { Alert } from '../ui/Alert';
import {
  InvestigationKind, KnowledgeClaim, SCHEME_CLUES_TO_REVEAL, deriveDossier,
  perceivedFactionOf, perceivedStatusOf,
} from '../../knowledge/store';
import { DOSSIER_COLD_THRESHOLD } from '../../knowledge/dossierCost';
import { knowledgeSourceLead } from '../../knowledge/credibilityFraming';
import { isEntityKnownToPlayer, relationshipTimelineFor } from '../../knowledge/relationships';
import { priceInvestigation, heldSinceTurn, schemeDiscoveryFor, DEEP_ANALYSIS_COST } from './dramatisPersonaeIntel';
import { useIntelGathering } from './useIntelGathering';
import { quiet, IntelSection, SchemeIntelSection, DeepAnalysisSection, type HeldDossierReading } from './dramatisPersonaeUi';
import RelationshipObservations from './RelationshipObservations';
import RelationshipsTab from './RelationshipsTab';
import { SubRail } from '../ui/SubRail';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';
import type { DomainMutationContext, RunDomainMutation } from '../../state/domainMutation';
import type { PersonaeVoice } from '../../hooks/usePersonaeVoice';
import { PersonaVoiceRow, PERSONA_VOICE_COPY } from './PersonaVoiceRow';

type Wiring = {
  knowledge: KnowledgeClaim[];
  turnNumber: number;
  /** Commits the deep_analyses spend and the assessment together (hooks/useIntelCommits.ts). */
  onSpendDeepAnalysis: (targetId: string, cost: number, analysis: string, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
  runDomainMutation: RunDomainMutation;
  interactionLocked?: boolean;
  ai: GoogleGenAI;
  isMockMode: boolean;
  /** The voice row on each known character's card (hooks/usePersonaeVoice.ts); omitted, no row. */
  personaeVoice?: PersonaeVoice;
  /** The id of the tab's "paid call" note, which describes each Hear button. */
  paidNoteId?: string;
};

const EntityDetails: React.FC<{ entity: Entity; playerEntity: Entity } & Wiring> = ({
  entity, playerEntity, knowledge, turnNumber, onSpendDeepAnalysis, onInvestigationOutcome, runDomainMutation, ai, isMockMode, interactionLocked,
  personaeVoice, paidNoteId,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const briefingId = useId();
  // One ❧ Glossary control per dossier instead of five † daggers (audit item
  // 25) - open it and every gloss in this card appears inline as marginalia.
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const { loadingState, requestError, handleRequest, landed, clearLanded } = useIntelGathering({
    entity, playerEntity, knowledge, ai, isMockMode, interactionLocked, runDomainMutation, onSpendDeepAnalysis, onInvestigationOutcome,
  });
  // A landing is one-shot: the section clears it once focus has moved, and
  // the disclosure clears one that came back while the briefing was shut, so
  // opening the briefing never pulls focus off the Intel toggle.
  const landedSeq = (type: NonNullable<typeof landed>['type']) => landed?.type === type ? landed.seq : undefined;
  const price = (kind: InvestigationKind) => priceInvestigation(knowledge, entity.entity_id, kind);
  const schemeDiscovery = schemeDiscoveryFor(knowledge, entity.entity_id);
  const observations = relationshipTimelineFor(knowledge, entity.entity_id);
  // B2: the durable dossier reading (D14). What the player HOLDS renders
  // from the store's read model, not from session state - so it survives a
  // tab switch and a reload, which the transient reveal never did. The
  // staleness clause reuses D27's cold threshold as WORDING only while the
  // graded pricing stays dormant (see BACKLOG B1).
  const dossier = deriveDossier(knowledge, entity.entity_id);
  const heldReadingFor = (kind: 'beliefs' | 'secrets'): HeldDossierReading | undefined => {
    const held = dossier.entries.find(candidate => candidate.kind === kind);
    if (!held) return undefined;
    return {
      latestText: held.latestText,
      ...(held.latestItems ? { items: held.latestItems } : {}),
      firstLearnedTurn: held.firstLearnedTurn,
      lastRefreshedTurn: held.lastRefreshedTurn,
      sourceLead: knowledgeSourceLead(held.source),
      stale: turnNumber - held.lastRefreshedTurn > DOSSIER_COLD_THRESHOLD,
    };
  };
  const heldAssessment = dossier.entries.find(candidate => candidate.kind === 'deep_analysis');

  const investigations = (playerEntity.resources.investigations as number) || 0;
  const deepAnalyses = (playerEntity.resources.deep_analyses as number) || 0;
  return (
    <Card
      title={entity.name}
      // The Intel/Collapse control stays first in the header, and so first in
      // the card's DOM order.
      action={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {/* A disclosure (APG): it says whether the briefing is open, which
            briefing it controls, and - repeated on every card - whose. */}
        <Button
          size="sm"
          variant={isExpanded ? 'ghost' : 'secondary'}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? briefingId : undefined}
          aria-label={`${isExpanded ? 'Collapse' : 'Intel'} (${entity.name})`}
          onClick={() => { clearLanded(); setIsExpanded(value => !value); }}
        >{isExpanded ? 'Collapse' : 'Intel'}</Button>
        {isExpanded && (
          <button
            type="button"
            className="gor-glossary-toggle"
            aria-expanded={glossaryOpen}
            aria-label={`${glossaryOpen ? 'Hide' : 'Show'} glossary for ${entity.name}`}
            onClick={() => setGlossaryOpen(open => !open)}
          >❧ Glossary</button>
        )}
      </span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={quiet}>{entity.position || entity.entity_type}</span>
        {personaeVoice && <PersonaVoiceRow entityId={entity.entity_id} name={entity.name} voice={personaeVoice} paidNoteId={paidNoteId} />}
        <RelationshipObservations observations={observations} currentTurn={turnNumber} subjectName={entity.name} />
        {requestError && <Alert title="Your agents return empty-handed">{requestError}</Alert>}
        {isExpanded && <div id={briefingId} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-faint)' }}>
          <span className="gor-label" style={{ color: 'var(--tyrian-500)' }}>Intelligence Briefing</span>
          <IntelSection title="Beliefs" {...price('beliefs')} heldSinceTurn={heldSinceTurn(knowledge, entity.entity_id, 'beliefs')} heldReading={heldReadingFor('beliefs')} resourceName="Inv." resourceCount={investigations} onUncover={() => handleRequest('beliefs')} isLoading={loadingState === 'beliefs'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('beliefs')} onLandingFocused={clearLanded} tooltip="Uncover the core ideologies and principles that drive this character's decisions." />
          <SchemeIntelSection discovery={schemeDiscovery} threshold={SCHEME_CLUES_TO_REVEAL} cost={price('scheme').cost} resourceCount={investigations} onInvestigate={() => handleRequest('scheme')} isLoading={loadingState === 'scheme'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('scheme')} onLandingFocused={clearLanded} tooltip="Piece together what this character is quietly plotting. Each investigation earns one clue toward its true nature." />
          <IntelSection title="Secrets" {...price('secrets')} heldSinceTurn={heldSinceTurn(knowledge, entity.entity_id, 'secrets')} heldReading={heldReadingFor('secrets')} resourceName="Inv." resourceCount={investigations} onUncover={() => handleRequest('secrets')} isLoading={loadingState === 'secrets'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('secrets')} onLandingFocused={clearLanded} tooltip="Use high-risk, high-reward investigation to uncover hidden fears, blackmail material, or secret plots." />
          <DeepAnalysisSection held={heldAssessment ? { analysis: heldAssessment.latestText, asOfTurn: heldAssessment.lastRefreshedTurn } : undefined} cost={DEEP_ANALYSIS_COST} resourceCount={deepAnalyses} onCommission={() => handleRequest('deep_analysis')} isLoading={loadingState === 'deep_analysis'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('deep_analysis')} onLandingFocused={clearLanded} />
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

/**
 * B2: the Personae tab carries two registers - the per-figure cards this tab
 * has always been, and the D13 relationship map (RelationshipsTab), which is
 * a sibling view of the same domain: pair-wise where the cards are
 * per-figure. Same SubRail + tabRegister idiom as Reports; 'figures' is the
 * default so the resting view is byte-identical to what shipped before.
 */
const PERSONAE_REGISTERS = ['figures', 'relationships'] as const;
type PersonaeRegister = typeof PERSONAE_REGISTERS[number];

const DramatisPersonaeTab: React.FC<{ playerEntity: Entity | null; entities: Entity[] } & Omit<Wiring, 'paidNoteId'>> = ({ playerEntity, entities, ...rest }) => {
  const [register, setRegister] = useState<PersonaeRegister>(() => getTabRegister('personae', PERSONAE_REGISTERS, 'figures'));
  const paidNoteId = useId();
  if (!playerEntity) return <p style={quiet}>Loading character…</p>;

  const selectRegister = (next: PersonaeRegister) => {
    setRegister(next);
    setTabRegister('personae', next);
  };

  const wiring: Wiring = { ...rest, paidNoteId };
  const known = entities.filter(entity => isEntityKnownToPlayer(playerEntity, entity, wiring.knowledge));
  // Knownness is deliberately evaluated before status and faction grouping:
  // an unseen death or affiliation must not establish a hidden identity.
  // Nor may either be READ off the roster (D5): who is still about, and whom
  // they stand with, is what the player last SAW (the structured status /
  // allegiance on their perceived digest lines), never the live entity. A
  // figure the player has seen no change in is believed alive (a legacy
  // save's status line is read by perceivedStatusOf, never the live status).
  const believedStatus = (entity: Entity): Entity['status'] =>
    perceivedStatusOf(wiring.knowledge, entity.entity_id) ?? 'alive';
  const believedFaction = (entity: Entity): string | null | undefined => {
    const perceived = perceivedFactionOf(wiring.knowledge, entity.entity_id);
    return perceived === undefined ? entity.faction_id : perceived;
  };
  const knownLiving = known.filter(entity => entity.entity_id !== playerEntity.entity_id && entity.entity_type !== 'faction' && believedStatus(entity) === 'alive');
  const knownFactions = known.filter(entity => entity.entity_type === 'faction' && believedStatus(entity) === 'alive');
  const factionIds = new Set(knownFactions.map(faction => faction.entity_id));
  const neutral = knownLiving.filter(entity => {
    const faction = believedFaction(entity);
    return !faction || !factionIds.has(faction);
  });
  const investigations = (playerEntity.resources.investigations as number) || 0;
  const observationCount = wiring.knowledge.filter(claim => claim.relationshipObservation).length;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <SubRail
      ariaLabel="Personae register"
      value={register}
      onChange={selectRegister}
      options={[
        { value: 'figures', label: 'Figures', count: knownLiving.length },
        { value: 'relationships', label: 'Relationships', count: observationCount },
      ]}
    />
    {register === 'relationships' ? (
      // The map resolves names from the FULL entity list deliberately: a
      // marker's participants were validated as player-known at commit time
      // (D42), and a name must not vanish off old edges if knownness later
      // shifts. It renders nothing the marker does not already carry.
      <RelationshipsTab knowledge={wiring.knowledge} entities={entities} currentTurn={wiring.turnNumber} />
    ) : (
      <>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={quiet}>What is known — and what can be bought.</span>
          {/* The balance is money, so it is Arabic and tabular (audit item 24) —
              Roman numerals stay on the week ribbon, the turn count and the
              epilogue. The one † left in this view is on the term itself. */}
          <span className="gor-label" style={{ color: investigations > 0 ? 'var(--gold-700)' : 'var(--crimson-500)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>Investigations: {investigations}<InfoTooltip text="Your capacity for espionage. Spend to reveal beliefs, schemes, or secrets." /></span>
        </span>
        {wiring.personaeVoice && <p className="gor-config-note" id={paidNoteId} style={{ margin: 0 }}>{PERSONA_VOICE_COPY.paidNote}</p>}
        {knownFactions.map(faction => <FactionSection key={faction.entity_id} faction={faction} members={knownLiving.filter(member => believedFaction(member) === faction.entity_id)} playerEntity={playerEntity} {...wiring} />)}
        {neutral.length > 0 && <><span className="gor-label">Other known figures</span>{neutral.map(entity => <EntityDetails key={entity.entity_id} entity={entity} playerEntity={playerEntity} {...wiring} />)}</>}
      </>
    )}
  </div>;
};

export default DramatisPersonaeTab;
