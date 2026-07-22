import React, { useState } from 'react';
import { Entity, InvestigationResult } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getRawThoughts, getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import InfoTooltip from '../InfoTooltip';
import GlossaryTooltip from '../GlossaryTooltip';
import { Card, Button } from '../ui/Core';
import { TrustBar } from '../ui/Game';
import { toRoman } from '../ui/Brand';
import { deriveDossier, InvestigationKind, KnowledgeClaim, SchemeDiscovery, SCHEME_CLUES_TO_REVEAL } from '../../knowledge/store';

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
function priceInvestigation(
  knowledge: KnowledgeClaim[],
  targetId: string,
  kind: InvestigationKind
): { cost: number; held: boolean } {
  const held = deriveDossier(knowledge, targetId).entries.some(e => e.kind === kind);
  return { cost: FIRST_INVESTIGATION_COST, held };
}

/** The D28 scheme-discovery state the player has earned on a target, or undefined if nothing is known yet. Read model over the knowledge store, never live ground truth. */
function schemeDiscoveryFor(knowledge: KnowledgeClaim[], targetId: string): SchemeDiscovery | undefined {
  return deriveDossier(knowledge, targetId).entries.find(e => e.kind === 'scheme')?.schemeDiscovery;
}

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

/**
 * D28 scheme-discovery progress: filled/empty threads for PAID nature-clues
 * gathered vs. the reveal threshold. A discrete game-mechanic meter, NOT a
 * credibility number (D25/D26) - it counts investigations bought, not how
 * trustworthy anything is.
 */
const ThreadPips: React.FC<{ filled: number; total: number }> = ({ filled, total }) => (
    <span aria-label={`${filled} of ${total} threads uncovered`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        {Array.from({ length: total }, (_, i) => (
            <span
                key={i}
                aria-hidden="true"
                style={{
                    width: 9, height: 9, borderRadius: '50%', flex: 'none',
                    background: i < filled ? 'var(--tyrian-500)' : 'transparent',
                    border: '1px solid var(--tyrian-500)',
                }}
            />
        ))}
        <span style={{ ...quiet, fontSize: 12, marginLeft: 4 }}>threads</span>
    </span>
);

/**
 * The "Active Scheme" surface (D28). It renders the knowledge store's earned
 * DISCOVERY STATE - never the raw ground-truth Scheme (no title, no steps ever
 * reach the player):
 *   - nothing known        -> [ Unknown ], a first Investigate for a nature clue;
 *   - aware, not revealed   -> "something is afoot" + thread progress, buy more;
 *   - revealed              -> the earned nature (the agent's pieced-together
 *                              read, surfaced only once enough PAID clues cross
 *                              SCHEME_CLUES_TO_REVEAL).
 * Proximity awareness alone never advances the threads (D30) - only a paid
 * investigation does - so a scheme a mind re-evolves every turn cannot
 * passively reveal itself here.
 */
const SchemeIntelSection: React.FC<{
    discovery: SchemeDiscovery | undefined;
    threshold: number;
    cost: number;
    resourceCount: number;
    onInvestigate: () => void;
    isLoading: boolean;
    tooltip: string;
}> = ({ discovery, threshold, cost, resourceCount, onInvestigate, isLoading, tooltip }) => {
    const renderState = () => {
        if (isLoading) {
            return <span style={quiet}>Your asset works in the dark…</span>;
        }
        if (discovery?.revealed && discovery.nature) {
            return (
                <div style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    <p style={{ ...quiet, margin: 0, color: 'var(--text-body)' }}>“{discovery.nature}”</p>
                </div>
            );
        }
        const aware = !!discovery;
        const clues = discovery?.clues ?? 0;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={quiet}>{aware ? 'Something is afoot — your agents are still piecing it together.' : '[ Unknown ]'}</span>
                    <Button size="sm" variant="secondary" onClick={onInvestigate} disabled={resourceCount < cost || isLoading}>
                        {(aware ? 'Investigate further' : 'Investigate') + (cost <= 0 ? ' · Free' : ` · ${toRoman(cost)} Inv.`)}
                    </Button>
                </span>
                {aware && <ThreadPips filled={clues} total={threshold} />}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>Active Scheme<InfoTooltip text={tooltip} /></span>
            {renderState()}
        </div>
    );
};

const IntelSection: React.FC<{
    title: string;
    cost: number;
    resourceName: string;
    resourceCount: number;
    /** True once the player holds a persisted dossier on this aspect (D14): the button reads "Refresh", not "Reveal". Flat-priced (see priceInvestigation). */
    held: boolean;
    uncoveredData: string[] | undefined;
    onUncover: () => void;
    isLoading: boolean;
    tooltip: string;
    footnote?: React.ReactNode;
}> = ({ title, cost, resourceName, resourceCount, held, uncoveredData, onUncover, isLoading, tooltip, footnote }) => {

    const renderContent = () => {
        if (isLoading) {
            return <span style={quiet}>Your asset works in the dark…</span>;
        }
        if (uncoveredData) {
            return (
                <div style={{ animation: 'gorFadeIn .4s ease-out both' }}>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                        {uncoveredData.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                    {footnote}
                </div>
            );
        }
        // A held dossier is REFRESHED, not revealed afresh - at the same flat
        // price (D14; the D27 staleness discount stays dormant until B1's
        // graded currency). Only a spend AMOUNT is ever shown - never a
        // credibility number (D25).
        const verb = held ? 'Refresh' : 'Reveal';
        return (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={quiet}>{held ? '[ On file — may be stale ]' : '[ Unknown ]'}</span>
                <Button size="sm" variant="secondary" onClick={onUncover} disabled={resourceCount < cost || isLoading}>
                    {cost <= 0 ? `${verb} · Free` : `${verb} · ${toRoman(cost)} ${resourceName}`}
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
                    // Flat first-acquisition cost in the `investigations`
                    // resource (D14); priced at click from the current store so
                    // it matches the label the player saw.
                    const { cost } = price(type);
                    if ((playerEntity.resources.investigations as number) >= cost) {
                        const result = await getInvestigationResult(ai, target, playerEntity, true, isMockMode, type);
                        // A 'scheme' buy does NOT display its raw reportData
                        // (D28): the store commits it as ONE nature clue and the
                        // Active Scheme surface renders the earned discovery
                        // state. beliefs/secrets show their findings inline.
                        if (type !== 'scheme') {
                            setUncoveredIntel(prev => ({ ...prev, [type]: result.reportData as string[] }));
                        }
                        // One atomic callback: the spend, any blackmail filing,
                        // and the fallout append land in a single App-side
                        // state/save pass - sequential per-concern callbacks
                        // rebuilt the save from stale closures and lost fields.
                        onInvestigationOutcome(type, target.entity_id, result.reportData, cost, { target_id: target.entity_id, report: result.report, consequences: result.consequences });
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
