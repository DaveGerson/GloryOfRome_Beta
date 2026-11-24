import React, { useId, useState } from 'react';
import { Entity, InvestigationResult, InvestigationTruth } from '../../types';
import { GoogleGenAI } from '@google/genai';
import InfoTooltip from '../InfoTooltip';
import { Card, Button } from '../ui/Core';
import { toRoman } from '../ui/Brand';
import { Alert } from '../ui/Alert';
import {
  InvestigationKind, KnowledgeClaim, SCHEME_CLUES_TO_REVEAL, deriveDossier,
  knownAffiliationsOf, perceivedConditionsOf, perceivedStatusOf, signsSeenOf,
} from '../../knowledge/store';
import { publicAffiliationsOf } from '../../ai/core/affiliations';
import { MARKS_COPY, MarkList, SignList, TieList, type TieView } from '../ui/Marks';
import { DOSSIER_COLD_THRESHOLD } from '../../knowledge/dossierCost';
import { knowledgeSourceLead } from '../../knowledge/credibilityFraming';
import { isEntityKnownToPlayer, relationshipTimelineFor } from '../../knowledge/relationships';
import { priceInvestigation, priceInvestigationWithWarmth, formatWarmRefreshCaption, heldSinceTurn, schemeDiscoveryFor, DEEP_ANALYSIS_COST } from './dramatisPersonaeIntel';
import { CONVERSION_FRICTION_FACTOR, CONVERSION_RATES, type ConvertibleResource } from '../../knowledge/pricing';
import { deriveSchemeBoard, evaluateDeductionHypothesis } from '../../knowledge/schemeDeduction';
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
  /** Commits the deep_analyses (or D27 coin) spend and the assessment together (hooks/useIntelCommits.ts). `truth` is GM-private (D11/D47): forwarded, never rendered. */
  onSpendDeepAnalysis: (targetId: string, cost: number, analysis: string, request: DomainMutationContext, truth?: InvestigationTruth, denariiCost?: number) => boolean | void | Promise<boolean | void>;
  onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult, request: DomainMutationContext, truth?: InvestigationTruth, denariiCost?: number) => boolean | void | Promise<boolean | void>;
  onConvertToInvestigation?: (source: ConvertibleResource, request: DomainMutationContext) => boolean | void | Promise<boolean | void>;
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
    entity, playerEntity, knowledge, turnNumber, ai, isMockMode, interactionLocked, runDomainMutation, onSpendDeepAnalysis, onInvestigationOutcome,
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
  // tab switch and a reload, which the transient reveal never did. `stale`
  // matches D27's cold threshold (computeRefreshCost: t >= threshold).
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
      stale: turnNumber - held.lastRefreshedTurn >= DOSSIER_COLD_THRESHOLD,
    };
  };
  const heldAssessment = dossier.entries.find(candidate => candidate.kind === 'deep_analysis');
  // D48: the marks the player has SEEN on this figure (outward ones, from
  // their perceived dispatches) - never read off the live entity, so a wound
  // taken out of sight is not here and one healed unseen still is.
  const seenMarks = perceivedConditionsOf(knowledge, entity.entity_id);
  // D49: the ties this figure openly professes are public knowledge, read
  // off the figure itself; a SECRET tie shows only once the player has
  // learned it (their knowledge store - witnessed, or found out), marked as
  // known to them. Never the live secret state.
  const openTies = publicAffiliationsOf(entity);
  const openTieIds = new Set(openTies.map(tie => tie.id));
  const learnedTies = knownAffiliationsOf(knowledge, entity.entity_id).filter(tie => !tie.public && !openTieIds.has(tie.id));
  const ties: TieView[] = [...openTies, ...learnedTies.map(tie => ({ ...tie, flag: MARKS_COPY.knownToYou }))];
  // D50: the tells the player caught on this figure - in a private scene or
  // the week's narration - as they saw or heard them. Read from their own
  // knowledge store, which keeps only the sentence: never the mark or tie a
  // sign betrayed.
  const signs = signsSeenOf(knowledge, entity.entity_id);

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
        {seenMarks.length > 0 && (
          <div className="gor-persona-marks">
            <span className="gor-label">{MARKS_COPY.seenLabel}</span>
            <MarkList marks={seenMarks} />
          </div>
        )}
        {ties.length > 0 && (
          <div className="gor-persona-marks">
            <span className="gor-label">{MARKS_COPY.tiesLabel}</span>
            <TieList ties={ties} />
          </div>
        )}
        {signs.length > 0 && (
          <div className="gor-persona-marks">
            <span className="gor-label">{MARKS_COPY.signsLabel}</span>
            <span className="gor-sign-gloss">{MARKS_COPY.signsGloss}</span>
            <SignList signs={signs} />
          </div>
        )}
        {personaeVoice &&<PersonaVoiceRow entityId={entity.entity_id} name={entity.name} voice={personaeVoice} paidNoteId={paidNoteId} />}
        <RelationshipObservations observations={observations} currentTurn={turnNumber} subjectName={entity.name} />
        {requestError && <Alert title="Your agents return empty-handed">{requestError}</Alert>}
        {isExpanded && (() => {
          const heldBeliefs = heldReadingFor('beliefs');
          const heldSecrets = heldReadingFor('secrets');
          const beliefsQuote = priceInvestigationWithWarmth(knowledge, entity.entity_id, 'beliefs', turnNumber, playerEntity.resources);
          const schemeQuote = priceInvestigationWithWarmth(knowledge, entity.entity_id, 'scheme', turnNumber, playerEntity.resources);
          const secretsQuote = priceInvestigationWithWarmth(knowledge, entity.entity_id, 'secrets', turnNumber, playerEntity.resources);
          const deepQuote = priceInvestigationWithWarmth(knowledge, entity.entity_id, 'deep_analysis', turnNumber, playerEntity.resources);
          return <div id={briefingId} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-faint)' }}>
            <span className="gor-label" style={{ color: 'var(--tyrian-500)' }}>Intelligence Briefing</span>
            <IntelSection title="Beliefs" {...price('beliefs')} heldSinceTurn={heldSinceTurn(knowledge, entity.entity_id, 'beliefs')} heldReading={heldBeliefs} denariiFallback={{ cost: beliefsQuote.denariiCost, canAfford: beliefsQuote.canPayWithDenarii }} warmthCaption={(heldBeliefs || !beliefsQuote.canPayWithUnit) ? formatWarmRefreshCaption(beliefsQuote) : undefined} resourceName="Inv." resourceCount={investigations} onUncover={() => handleRequest('beliefs')} isLoading={loadingState === 'beliefs'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('beliefs')} onLandingFocused={clearLanded} tooltip="Uncover the core ideologies and principles that drive this character's decisions." />
            <SchemeIntelSection discovery={schemeDiscovery} threshold={SCHEME_CLUES_TO_REVEAL} cost={price('scheme').cost} resourceCount={investigations} denariiFallback={{ cost: schemeQuote.denariiCost, canAfford: schemeQuote.canPayWithDenarii }} warmthCaption={((schemeDiscovery && schemeDiscovery.clues > 0) || !schemeQuote.canPayWithUnit) ? formatWarmRefreshCaption(schemeQuote) : undefined} onInvestigate={() => handleRequest('scheme')} isLoading={loadingState === 'scheme'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('scheme')} onLandingFocused={clearLanded} tooltip="Piece together what this character is quietly plotting. Each investigation earns one clue toward its true nature." />
            <IntelSection title="Secrets" {...price('secrets')} heldSinceTurn={heldSinceTurn(knowledge, entity.entity_id, 'secrets')} heldReading={heldSecrets} denariiFallback={{ cost: secretsQuote.denariiCost, canAfford: secretsQuote.canPayWithDenarii }} warmthCaption={(heldSecrets || !secretsQuote.canPayWithUnit) ? formatWarmRefreshCaption(secretsQuote) : undefined} resourceName="Inv." resourceCount={investigations} onUncover={() => handleRequest('secrets')} isLoading={loadingState === 'secrets'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('secrets')} onLandingFocused={clearLanded} tooltip="Use high-risk, high-reward investigation to uncover hidden fears, blackmail material, or secret plots." />
            <DeepAnalysisSection held={heldAssessment ? { analysis: heldAssessment.latestText, asOfTurn: heldAssessment.lastRefreshedTurn } : undefined} cost={DEEP_ANALYSIS_COST} resourceCount={deepAnalyses} denariiFallback={{ cost: deepQuote.denariiCost, canAfford: deepQuote.canPayWithDenarii }} warmthCaption={(heldAssessment || !deepQuote.canPayWithUnit) ? formatWarmRefreshCaption(deepQuote) : undefined} onCommission={() => handleRequest('deep_analysis')} isLoading={loadingState === 'deep_analysis'} interactionLocked={interactionLocked} showGloss={glossaryOpen} landedSeq={landedSeq('deep_analysis')} onLandingFocused={clearLanded} />
          </div>;
        })()}
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

const CONVERSION_LABELS: { source: ConvertibleResource; shortLabel: string; cost: number }[] = [
  { source: 'denarii', shortLabel: 'denarii', cost: Math.ceil(CONVERSION_RATES.denarii * CONVERSION_FRICTION_FACTOR) },
  { source: 'senatorial_support', shortLabel: 'Sen. support', cost: Math.ceil(CONVERSION_RATES.senatorial_support * CONVERSION_FRICTION_FACTOR) },
  { source: 'legion_support', shortLabel: 'Legion support', cost: Math.ceil(CONVERSION_RATES.legion_support * CONVERSION_FRICTION_FACTOR) },
];

const DramatisPersonaeTab: React.FC<{ playerEntity: Entity | null; entities: Entity[] } & Omit<Wiring, 'paidNoteId'>> = ({ playerEntity, entities, ...rest }) => {
  const [register, setRegister] = useState<PersonaeRegister>(() => getTabRegister('personae', PERSONAE_REGISTERS, 'figures'));
  const [selectedAssociates, setSelectedAssociates] = useState<Record<string, string>>({});
  const paidNoteId = useId();
  if (!playerEntity) return <p style={quiet}>Loading character…</p>;

  const selectRegister = (next: PersonaeRegister) => {
    setRegister(next);
    setTabRegister('personae', next);
  };

  const wiring: Wiring = { ...rest, paidNoteId };
  const entityById = new Map(entities.map(entity => [entity.entity_id, entity]));
  const known = entities.filter(entity => isEntityKnownToPlayer(playerEntity, entity, wiring.knowledge));
  // Knownness is deliberately evaluated before status and faction grouping:
  // an unseen death or affiliation must not establish a hidden identity.
  // Who is still about may not be READ off the roster (D5): it is what the
  // player last SAW (the structured status on their perceived digest lines),
  // never the live entity - a figure the player has seen no change in is
  // believed alive (a legacy save's status line is read by
  // perceivedStatusOf, never the live status). Whom a figure stands with IS
  // read off the roster: D49 rules a figure's openly professed faction
  // public knowledge, so grouping follows the live faction_id - a secret tie
  // never groups anyone (it lives in affiliations, shown only once learned).
  const believedStatus = (entity: Entity): Entity['status'] =>
    perceivedStatusOf(wiring.knowledge, entity.entity_id) ?? 'alive';
  const knownLiving = known.filter(entity => entity.entity_id !== playerEntity.entity_id && entity.entity_type !== 'faction' && believedStatus(entity) === 'alive');
  const knownFactions = known.filter(entity => entity.entity_type === 'faction' && believedStatus(entity) === 'alive');
  const factionIds = new Set(knownFactions.map(faction => faction.entity_id));
  const neutral = knownLiving.filter(entity => !entity.faction_id || !factionIds.has(entity.faction_id));
  const investigations = (playerEntity.resources.investigations as number) || 0;
  const observationCount = wiring.knowledge.filter(claim => claim.relationshipObservation).length;
  const schemeBoard = deriveSchemeBoard(wiring.knowledge, entities, playerEntity.entity_id);
  const handleFundAgents = (source: ConvertibleResource) => {
    if (wiring.interactionLocked || !wiring.onConvertToInvestigation) return;
    void wiring.runDomainMutation(request => wiring.onConvertToInvestigation?.(source, request));
  };

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
        {wiring.onConvertToInvestigation && (
          <details className="gor-card" style={{ padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--gold-700)' }}>
              Fund Agents — Convert Surplus to Investigations
            </summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {CONVERSION_LABELS.map(option => {
                const rawBal = playerEntity.resources?.[option.source];
                const available = typeof rawBal === 'number' && Number.isFinite(rawBal) ? rawBal : 0;
                const disabled = available < option.cost || Boolean(wiring.interactionLocked);
                return (
                  <Button
                    key={option.source}
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => handleFundAgents(option.source)}
                    title={`Convert ${option.cost.toLocaleString('en-US')} ${option.shortLabel} into 1 investigation (1.25× friction applied; holding ${available.toLocaleString('en-US')})`}
                  >
                    Fund 1 Inv. · {option.cost.toLocaleString('en-US')} {option.shortLabel}
                  </Button>
                );
              })}
            </div>
          </details>
        )}
        {wiring.personaeVoice && <p className="gor-config-note" id={paidNoteId} style={{ margin: 0 }}>{PERSONA_VOICE_COPY.paidNote}</p>}
        {schemeBoard.leads.length > 0 && (
          <details className="gor-card" style={{ padding: '10px 14px' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--crimson-500)' }}>
              Conspiracy &amp; Leads ({schemeBoard.leads.length})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {schemeBoard.leads.map(lead => {
                const subjectEntity = entityById.get(lead.subjectId);
                const subjectDead = subjectEntity ? believedStatus(subjectEntity) === 'dead' : false;
                const shownClues = Math.min(lead.clueCount, lead.cluesNeeded);
                const associateMap = new Map<string, string>();
                for (const linked of lead.linkedFigures) associateMap.set(linked.entityId, linked.name);
                for (const fig of knownLiving) {
                  if (fig.entity_id !== lead.subjectId && !associateMap.has(fig.entity_id)) {
                    associateMap.set(fig.entity_id, fig.name);
                  }
                }
                const associateOptions = [...associateMap.entries()].map(([id, name]) => ({ id, name }));
                const rawSelected = selectedAssociates[lead.leadId] ?? '';
                const selectedId = associateMap.has(rawSelected) ? rawSelected : '';
                const hypothesisCheck = evaluateDeductionHypothesis(schemeBoard, lead.subjectId, selectedId || undefined);
                const selectId = `scheme-crosscheck-${lead.leadId}`;

                return (
                  <div key={lead.leadId} style={{ borderLeft: '2px solid var(--gold-500)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {lead.subjectName}{subjectDead ? ' (believed dead)' : ''} — <span className="gor-label">{lead.stage} ({shownClues}/{lead.cluesNeeded})</span>
                    </span>
                    {lead.revealed && lead.nature && <span style={quiet}>“{lead.nature}”</span>}
                    {lead.linkedFigures.length > 0 && (
                      <span style={{ ...quiet, fontSize: 12 }}>
                        Observed alongside: {lead.linkedFigures.map(f => f.name).join(', ')}
                      </span>
                    )}
                    {(lead.corroborationCount > 0 || lead.contradictionCount > 0) && (
                      <span style={{ ...quiet, fontSize: 12 }}>
                        Cross-links: {lead.corroborationCount} corroborating · {lead.contradictionCount} conflicting
                      </span>
                    )}
                    {lead.evidenceTimeline.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                        {lead.evidenceTimeline.slice(-4).map((item, idx) => (
                          <li key={`${item.turn}-${idx}`}>
                            Turn {toRoman(item.turn)} ({item.sourceLead}): {item.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                      <label htmlFor={selectId} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Cross-check associate{' '}
                        <select
                          id={selectId}
                          aria-label={`Cross-check associate for ${lead.subjectName}`}
                          value={selectedId}
                          onChange={event => {
                            const val = event.target.value;
                            setSelectedAssociates(prev => ({ ...prev, [lead.leadId]: val }));
                          }}
                          style={{ fontSize: 12, marginLeft: 4 }}
                        >
                          <option value="">General dossier summary</option>
                          {associateOptions.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                          ))}
                        </select>
                      </label>
                      <span style={{ ...quiet, fontSize: 12 }}>
                        {hypothesisCheck.summary}
                        {hypothesisCheck.supportingTurns.length > 0
                          ? ` (Turns: ${hypothesisCheck.supportingTurns.map(toRoman).join(', ')})`
                          : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
        {knownFactions.map(faction => <FactionSection key={faction.entity_id} faction={faction} members={knownLiving.filter(member => member.faction_id === faction.entity_id)} playerEntity={playerEntity} {...wiring} />)}
        {neutral.length > 0 && <><span className="gor-label">Other known figures</span>{neutral.map(entity => <EntityDetails key={entity.entity_id} entity={entity} playerEntity={playerEntity} {...wiring} />)}</>}
      </>
    )}
  </div>;
};

export default DramatisPersonaeTab;
