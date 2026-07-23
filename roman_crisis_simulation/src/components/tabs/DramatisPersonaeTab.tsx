import React, { useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from "@google/genai";
import InfoTooltip from '../InfoTooltip';
import GlossaryTooltip from '../GlossaryTooltip';
import { Card, Button } from '../ui/Core';
import { TrustBar } from '../ui/Game';
import { toRoman } from '../ui/Brand';
import { InvestigationKind, KnowledgeClaim, SCHEME_CLUES_TO_REVEAL } from '../../knowledge/store';
import { priceInvestigation, schemeDiscoveryFor, resolveIntelRequest, DEEP_ANALYSIS_COST } from './dramatisPersonaeIntel';
import { labelStyle, quiet, IntelSection, SchemeIntelSection, DeepAnalysisSection } from './dramatisPersonaeUi';

type UncoveredIntel = {
    secrets?: string[];
    beliefs?: string[];
    raw_thoughts?: string;
    /**
     * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the premium intel tier built
     * on `getDeepAnalysis` (ai/tools/intelligence.ts), previously fully
     * implemented, mocked, and never called from anywhere. Session-only
     * (component state, like the rest of `UncoveredIntel`) - it does not
     * need to survive a reload this phase.
     */
    deep_analysis?: string;
};

const glossaryTerms = {
    'Praetorian Guard': {
        description: "An elite unit of the Imperial Roman army whose members served as personal bodyguards and intelligence agents for the Roman emperors.",
        wikiLink: "https://en.wikipedia.org/wiki/Praetorian_Guard"
    }
};

const EntityDetails: React.FC<{
    entity: Entity;
    playerEntity: Entity;
    /** The player knowledge store - the held-dossier read model that prices refreshes by staleness (D14/D27). */
    knowledge: KnowledgeClaim[];
    /** The App's authoritative turn counter - retained for the DORMANT D27 refresh clock (reactivates under B1's graded currency); not read by the flat cost path. */
    turnNumber: number;
    onSpendDeepAnalysis: (cost: number) => void;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ entity, playerEntity, knowledge, onSpendDeepAnalysis, onInvestigationOutcome, ai, isMockMode }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [uncoveredIntel, setUncoveredIntel] = useState<UncoveredIntel>({});
    const [loadingState, setLoadingState] = useState<string | null>(null);

    const playerRelationship = playerEntity.relationships[entity.entity_id];

    // Flat pricing (D14): every aspect costs the full first-acquisition price
    // regardless of what's on file - the staleness discount stays dormant
    // until B1. Computed from the current store so display and spend agree
    // (the same price flows to onInvestigationOutcome). The scheme surface
    // reads its earned discovery STATE from the store, never a raw scheme.
    const price = (kind: InvestigationKind) => priceInvestigation(knowledge, entity.entity_id, kind);
    const schemeDiscovery = schemeDiscoveryFor(knowledge, entity.entity_id);

    const handleRequest = async (type: 'secrets' | 'beliefs' | 'scheme' | 'raw_thoughts' | 'deep_analysis', target: Entity) => {
        if (!playerEntity) return;
        setLoadingState(type);
        try {
            const outcome = await resolveIntelRequest({ type, target, playerEntity, knowledge, ai, isMockMode });
            switch (outcome.kind) {
                case 'raw_thoughts':
                    setUncoveredIntel(prev => ({ ...prev, raw_thoughts: outcome.text }));
                    break;
                case 'deep_analysis':
                    if (outcome.charged) {
                        setUncoveredIntel(prev => ({ ...prev, deep_analysis: outcome.analysis }));
                        onSpendDeepAnalysis(outcome.cost);
                    }
                    break;
                case 'investigation':
                    if (outcome.charged) {
                        // A 'scheme' buy does NOT display its raw reportData
                        // (D28): the store commits it as ONE nature clue and the
                        // Active Scheme surface renders the earned discovery
                        // state. beliefs/secrets show their findings inline.
                        if (outcome.investigationKind !== 'scheme') {
                            setUncoveredIntel(prev => ({ ...prev, [outcome.investigationKind]: outcome.display }));
                        }
                        // One atomic callback: the spend, any blackmail filing,
                        // and the fallout append land in a single App-side
                        // state/save pass - sequential per-concern callbacks
                        // rebuilt the save from stale closures and lost fields.
                        onInvestigationOutcome(outcome.investigationKind, target.entity_id, outcome.reportData, outcome.cost, outcome.outcome);
                    }
                    break;
            }
        } finally {
            setLoadingState(null);
        }
    };

    const investigations = (playerEntity.resources.investigations as number) || 0;
    const deepAnalyses = (playerEntity.resources.deep_analyses as number) || 0;

    const num = (k: string, v: number) => (
        <span key={k} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {k} <strong style={{ color: 'var(--text-heading)', fontVariantNumeric: 'tabular-nums' }}>{v}</strong>
        </span>
    );

    return (
        <Card
            title={entity.name}
            action={
                <Button size="sm" variant={isExpanded ? 'ghost' : 'secondary'} onClick={() => setIsExpanded(prev => !prev)}>
                    {isExpanded ? 'Collapse' : 'Intel'}
                </Button>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={quiet}>{entity.position || entity.entity_type}</span>
                {playerRelationship && (
                    <>
                        <TrustBar label="Trust" level={playerRelationship.trust_level} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                            {num('Respect', playerRelationship.respect_level ?? 0)}
                            {num('Threat', playerRelationship.perceived_threat ?? 0)}
                            {num('Alignment', playerRelationship.ideological_alignment ?? 0)}
                            {num('Dependency', playerRelationship.dependency_level ?? 0)}
                        </div>
                    </>
                )}

                {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-faint)', animation: 'gorFadeIn .35s ease-out both' }}>
                        <span style={{ fontSize: 15, fontStyle: 'italic' }}>“{entity.current_state_narrative}”</span>
                        <span style={{ fontSize: 14 }}><strong>Goals:</strong> {entity.short_term_goals.join(', ')}</span>
                        <button
                            type="button"
                            onClick={() => handleRequest('raw_thoughts', entity)}
                            disabled={!!loadingState}
                            style={{ all: 'unset', cursor: loadingState ? 'wait' : 'pointer', padding: '8px 10px', background: 'var(--surface-inset)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-sm)' }}
                        >
                            <span style={labelStyle}>Raw Thoughts · Free</span>
                            <div style={{ ...quiet, marginTop: 2 }}>
                                {loadingState === 'raw_thoughts'
                                    ? 'Gauging your read of them…'
                                    : uncoveredIntel.raw_thoughts
                                        ? <span style={{ color: 'var(--text-body)' }}>“{uncoveredIntel.raw_thoughts}”</span>
                                        : 'Press to gauge your immediate read of this person.'}
                            </div>
                        </button>

                        <span className="gor-label" style={{ color: 'var(--tyrian-500)' }}>Intelligence Briefing</span>
                        <IntelSection
                            title="Beliefs"
                            {...price('beliefs')}
                            resourceName="Inv."
                            resourceCount={investigations}
                            uncoveredData={uncoveredIntel.beliefs}
                            onUncover={() => handleRequest('beliefs', entity)}
                            isLoading={loadingState === 'beliefs'}
                            tooltip="Uncover the core ideologies and principles that drive this character's decisions."
                        />
                        <SchemeIntelSection
                            discovery={schemeDiscovery}
                            threshold={SCHEME_CLUES_TO_REVEAL}
                            cost={price('scheme').cost}
                            resourceCount={investigations}
                            onInvestigate={() => handleRequest('scheme', entity)}
                            isLoading={loadingState === 'scheme'}
                            tooltip="Piece together what this character is quietly plotting. Each investigation earns one clue toward its true nature - proximity alone only tells you something is afoot."
                        />
                        <IntelSection
                            title="Secrets"
                            {...price('secrets')}
                            resourceName="Inv."
                            resourceCount={investigations}
                            uncoveredData={uncoveredIntel.secrets}
                            onUncover={() => handleRequest('secrets', entity)}
                            isLoading={loadingState === 'secrets'}
                            tooltip="Use high-risk, high-reward investigation to uncover hidden fears, blackmail material, or secret plots."
                            footnote={<span style={{ fontSize: 13, color: 'var(--laurel-500)', fontStyle: 'italic' }}>❧ Leverage filed under Assets.</span>}
                        />
                        <DeepAnalysisSection
                            analysis={uncoveredIntel.deep_analysis}
                            cost={DEEP_ANALYSIS_COST}
                            resourceCount={deepAnalyses}
                            onCommission={() => handleRequest('deep_analysis', entity)}
                            isLoading={loadingState === 'deep_analysis'}
                        />
                    </div>
                )}
            </div>
        </Card>
    );
};

const FactionSection: React.FC<{
    faction: Entity,
    members: Entity[],
    playerEntity: Entity,
    /** Forwarded to EntityDetails - the held-dossier read model and the scheme discovery state (D14/D28). */
    knowledge: KnowledgeClaim[];
    /** Forwarded to EntityDetails - retained for the dormant D27 refresh clock (B1); not read by the flat cost path. */
    turnNumber: number;
    onSpendDeepAnalysis: (cost: number) => void;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ faction, members, playerEntity, ...wiring }) => {
    const glossaryEntry = glossaryTerms[faction.name as keyof typeof glossaryTerms];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--metal-tyrian)', color: '#F2EBDC', padding: '9px 14px', boxShadow: 'var(--bevel)', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', color: '#F0D089' }}>
                    {glossaryEntry ? (
                        <GlossaryTooltip description={glossaryEntry.description} wikiLink={glossaryEntry.wikiLink}>
                            {faction.name}
                        </GlossaryTooltip>
                    ) : faction.name}
                </span>
                <span style={{ fontSize: 13, fontStyle: 'italic', color: '#D8B98A' }}>“{faction.current_state_narrative}”</span>
            </div>
            {members.map(entity => (
                <EntityDetails
                    key={entity.entity_id}
                    entity={entity}
                    playerEntity={playerEntity}
                    {...wiring}
                />
            ))}
        </div>
    );
};

const DramatisPersonaeTab: React.FC<{
    playerEntity: Entity | null;
    entities: Entity[];
    /** The player knowledge store - the held-dossier read model and scheme discovery state (D14/D28); forwarded down to each EntityDetails. */
    knowledge: KnowledgeClaim[];
    /** The App's authoritative turn counter - retained for the dormant D27 refresh clock (B1); not read by the flat cost path. */
    turnNumber: number;
    onSpendDeepAnalysis: (cost: number) => void;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ playerEntity, entities, ...wiring }) => {

    if (!playerEntity) return <p style={quiet}>Loading character…</p>;

    const investigations = (playerEntity.resources.investigations as number) || 0;
    const factions = entities.filter(e => e.entity_type === 'faction' && e.status === 'alive');
    const allAliveButPlayer = entities.filter(e => e.entity_id !== playerEntity.entity_id && e.status === 'alive');
    const factionMembers = allAliveButPlayer.filter(e => e.faction_id && e.entity_type !== 'faction');
    const unaligned = allAliveButPlayer.filter(e => !e.faction_id && e.entity_type !== 'faction');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={quiet}>What is known — and what can be bought.</span>
                <span className="gor-label" style={{ color: investigations > 0 ? 'var(--gold-700)' : 'var(--crimson-500)', whiteSpace: 'nowrap' }}>
                    Investigations: {investigations > 0 ? toRoman(investigations) : 'None'}
                    <InfoTooltip text="Your capacity for espionage. Spend to reveal beliefs, schemes, or secrets." />
                </span>
            </span>
            {factions.map(faction => (
                <FactionSection
                    key={faction.entity_id}
                    faction={faction}
                    members={factionMembers.filter(m => m.faction_id === faction.entity_id)}
                    playerEntity={playerEntity}
                    {...wiring}
                />
            ))}
            {unaligned.length > 0 && (
                <>
                    <span style={{ ...labelStyle, marginTop: 2 }}>Unaligned</span>
                    {unaligned.map(entity => (
                        <EntityDetails
                            key={entity.entity_id}
                            entity={entity}
                            playerEntity={playerEntity}
                            {...wiring}
                        />
                    ))}
                </>
            )}
        </div>
    );
};

export default DramatisPersonaeTab;
