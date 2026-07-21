import React, { useState } from 'react';
import { Entity, InvestigationResult, Scheme } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getRawThoughts, getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import InfoTooltip from '../InfoTooltip';
import GlossaryTooltip from '../GlossaryTooltip';
import { Card, Button } from '../ui/Core';
import { TrustBar } from '../ui/Game';
import { toRoman } from '../ui/Brand';

type UncoveredIntel = {
    secrets?: string[];
    beliefs?: string[];
    scheme?: Scheme;
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

/** ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - the cost, in the `deep_analyses` resource, of commissioning one Deep Analysis on a given NPC. */
const DEEP_ANALYSIS_COST = 1;

const glossaryTerms = {
    'Praetorian Guard': {
        description: "An elite unit of the Imperial Roman army whose members served as personal bodyguards and intelligence agents for the Roman emperors.",
        wikiLink: "https://en.wikipedia.org/wiki/Praetorian_Guard"
    }
};

const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-muted)' };
const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

const stepGlyph = (status: Scheme['steps'][number]['status']) => {
    if (status === 'completed') return { glyph: '✓', color: 'var(--laurel-500)' };
    if (status === 'in_progress') return { glyph: '›', color: 'var(--crimson-500)' };
    if (status === 'failed') return { glyph: '✕', color: 'var(--crimson-500)' };
    return { glyph: '·', color: 'var(--text-muted)' };
};

const SchemeIntelDisplay: React.FC<{ scheme: Scheme }> = ({ scheme }) => (
    <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span><strong>“{scheme.name}”</strong> — {scheme.overall_goal}</span>
        {scheme.steps.map((step, i) => {
            const { glyph, color } = stepGlyph(step.status);
            return (
                <span key={i} style={{ display: 'flex', gap: 8 }}>
                    <span aria-hidden="true" style={{ color, flex: 'none', width: 12, textAlign: 'center' }}>{glyph}</span>
                    <span style={{ color: step.status === 'pending' ? 'var(--text-muted)' : 'inherit' }}>{step.objective}</span>
                </span>
            );
        })}
    </div>
);

const IntelSection: React.FC<{
    title: string;
    cost: number;
    resourceName: string;
    resourceCount: number;
    uncoveredData: string[] | Scheme | undefined;
    onUncover: () => void;
    isLoading: boolean;
    tooltip: string;
    footnote?: React.ReactNode;
}> = ({ title, cost, resourceName, resourceCount, uncoveredData, onUncover, isLoading, tooltip, footnote }) => {

    const renderContent = () => {
        if (isLoading) {
            return <span style={quiet}>Your asset works in the dark…</span>;
        }
        if (uncoveredData) {
            const revealed = Array.isArray(uncoveredData) ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                    {uncoveredData.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
            ) : (typeof uncoveredData === 'object' && uncoveredData !== null && 'overall_goal' in uncoveredData) ? (
                <SchemeIntelDisplay scheme={uncoveredData as Scheme} />
            ) : (
                <p style={{ ...quiet, margin: 0 }}>“{String(uncoveredData)}”</p>
            );
            return (
                <div style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    {revealed}
                    {footnote}
                </div>
            );
        }
        return (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={quiet}>[ Unknown ]</span>
                <Button size="sm" variant="secondary" onClick={onUncover} disabled={resourceCount < cost || isLoading}>
                    Reveal · {toRoman(cost)} {resourceName}
                </Button>
            </span>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>{title}<InfoTooltip text={tooltip} /></span>
            {renderContent()}
        </div>
    );
};

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "Deep Analysis" is a premium
 * intel tier, distinct from the `IntelSection` cards above: it's a single
 * synthesized spymaster's assessment rather than a raw uncovered fact, so it
 * gets its own visual treatment (a gilt, illuminated card) to read as
 * qualitatively different from the standard "Reveal" panels.
 */
const DeepAnalysisSection: React.FC<{
    analysis: string | undefined;
    cost: number;
    resourceCount: number;
    onCommission: () => void;
    isLoading: boolean;
}> = ({ analysis, cost, resourceCount, onCommission, isLoading }) => {
    const canAfford = resourceCount >= cost;

    return (
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '2px dashed var(--border-strong)' }}>
            <span style={{ ...labelStyle, color: 'var(--gold-700)', display: 'inline-flex', alignItems: 'center' }}>
                Spymaster's Assessment
                <InfoTooltip text="Commission a premium, synthesized strategic judgment on this individual - a higher-tier read than a raw investigation report, spent from your rare Deep Analyses." />
            </span>
            {isLoading ? (
                <p style={{ ...quiet, margin: '4px 0 0' }}>The assessment is being drawn up…</p>
            ) : analysis ? (
                <div className="gor-card gor-card-gilt" style={{ marginTop: 5, padding: '10px 12px', animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ margin: 0, fontSize: 14, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>“{analysis}”</p>
                </div>
            ) : (
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={quiet}>[ No deep analysis commissioned ]</span>
                    <Button
                        size="sm"
                        onClick={onCommission}
                        disabled={!canAfford || isLoading}
                        title={!canAfford ? `Requires ${cost} Deep Analyses (you have ${resourceCount})` : undefined}
                    >
                        Commission · {toRoman(cost)} Deep
                    </Button>
                </span>
            )}
        </div>
    );
};

const EntityDetails: React.FC<{
    entity: Entity;
    playerEntity: Entity;
    onSpendDeepAnalysis: (cost: number) => void;
    /** One atomic callback per investigation reveal - spend + blackmail + fallout in a single state/save pass (see App.tsx's handleInvestigationOutcome). */
    onInvestigationOutcome: (kind: 'beliefs' | 'scheme' | 'secrets', targetId: string, reportData: unknown, cost: number, result: InvestigationResult) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ entity, playerEntity, onSpendDeepAnalysis, onInvestigationOutcome, ai, isMockMode }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [uncoveredIntel, setUncoveredIntel] = useState<UncoveredIntel>({});
    const [loadingState, setLoadingState] = useState<string | null>(null);

    const playerRelationship = playerEntity.relationships[entity.entity_id];

    const handleRequest = async (type: 'secrets' | 'beliefs' | 'scheme' | 'raw_thoughts' | 'deep_analysis', target: Entity) => {
        if (!playerEntity) return;
        setLoadingState(type);
        try {
            switch (type) {
                case 'raw_thoughts': {
                    const thoughts = await getRawThoughts(ai, target, playerEntity, isMockMode);
                    setUncoveredIntel(prev => ({ ...prev, raw_thoughts: thoughts }));
                    break;
                }
                case 'deep_analysis': {
                    // ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - wires the
                    // previously-dead `getDeepAnalysis`/`deep_analyses`
                    // pairing as a premium intel tier, separate from (and
                    // never wired through) `getInvestigationResult`'s
                    // consequence pipeline - a deep analysis never returns
                    // a `consequences` string, so it never touches the
                    // investigation-fallout queue (components/investigationLoop.ts).
                    if ((playerEntity.resources.deep_analyses as number) >= DEEP_ANALYSIS_COST) {
                        const analysis = await getDeepAnalysis(ai, target, playerEntity, isMockMode);
                        setUncoveredIntel(prev => ({ ...prev, deep_analysis: analysis }));
                        onSpendDeepAnalysis(DEEP_ANALYSIS_COST);
                    }
                    break;
                }
                case 'beliefs':
                case 'secrets':
                case 'scheme': {
                    if ((playerEntity.resources.investigations as number) >= 1) {
                        const result = await getInvestigationResult(ai, target, playerEntity, true, isMockMode, type);
                        setUncoveredIntel(prev => ({ ...prev, [type]: result.reportData }));
                        // One atomic callback: the spend, any blackmail filing,
                        // and the fallout append land in a single App-side
                        // state/save pass - sequential per-concern callbacks
                        // rebuilt the save from stale closures and lost fields.
                        onInvestigationOutcome(type, target.entity_id, result.reportData, 1, { target_id: target.entity_id, report: result.report, consequences: result.consequences });
                    }
                    break;
                }
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
                            cost={1}
                            resourceName="Inv."
                            resourceCount={investigations}
                            uncoveredData={uncoveredIntel.beliefs}
                            onUncover={() => handleRequest('beliefs', entity)}
                            isLoading={loadingState === 'beliefs'}
                            tooltip="Uncover the core ideologies and principles that drive this character's decisions."
                        />
                        <IntelSection
                            title="Active Scheme"
                            cost={1}
                            resourceName="Inv."
                            resourceCount={investigations}
                            uncoveredData={uncoveredIntel.scheme}
                            onUncover={() => handleRequest('scheme', entity)}
                            isLoading={loadingState === 'scheme'}
                            tooltip="Discover the character's primary, overarching plan or strategy."
                        />
                        <IntelSection
                            title="Secrets"
                            cost={1}
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
