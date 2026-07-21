import React, { useState } from 'react';
import { Entity, InvestigationResult, Scheme } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { getRawThoughts, getInvestigationResult, getDeepAnalysis } from '../../ai/tools/intelligence';
import InfoTooltip from '../InfoTooltip';
import GlossaryTooltip from '../GlossaryTooltip';

type UncoveredIntel = {
    secrets?: string[];
    beliefs?: string[];
    active_scheme?: Scheme;
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

const TrustBar: React.FC<{ level: number }> = ({ level }) => {
    const percentage = ((level + 10) / 20) * 100;
    const color = level > 3 ? 'bg-green-700' : level < -3 ? 'bg-red-900' : 'bg-stone-500';

    return (
        <div className="w-full bg-stone-300 rounded-sm h-2.5 my-1 shadow-inner border border-stone-400" title={`Trust Level: ${level}`}>
            <div className={`${color} h-full rounded-sm`} style={{ width: `${percentage}%` }}></div>
        </div>
    );
};

const SchemeIntelDisplay: React.FC<{ scheme: Scheme }> = ({ scheme }) => (
    <div className="text-xs text-stone-600 space-y-1">
        <p><span className="font-bold text-stone-700">Name:</span> <span className="italic">"{scheme.name}"</span></p>
        <p><span className="font-bold text-stone-700">Goal:</span> {scheme.overall_goal}</p>
        <div>
            <span className="font-bold text-stone-700">Steps:</span>
            <ul className="list-disc list-inside ml-2">
                {scheme.steps.map((step, i) => (
                    <li key={i}><span className="capitalize">{step.status}:</span> {step.objective}</li>
                ))}
            </ul>
        </div>
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
}> = ({ title, cost, resourceName, resourceCount, uncoveredData, onUncover, isLoading, tooltip }) => {
    
    const renderContent = () => {
        if (uncoveredData) {
            if (Array.isArray(uncoveredData)) {
                return (
                     <ul className="text-xs text-stone-600 list-disc list-inside">
                        {uncoveredData.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                );
            }
            // Check if it's a scheme object
            if (typeof uncoveredData === 'object' && uncoveredData !== null && 'overall_goal' in uncoveredData) {
                return <SchemeIntelDisplay scheme={uncoveredData as Scheme} />;
            }
            // Fallback for string
            return <p className="text-xs text-stone-600 italic">"{String(uncoveredData)}"</p>;
        }
        return (
            <div className="flex justify-between items-center">
                <p className="text-xs text-stone-500 italic">[Unknown]</p>
                <button 
                    onClick={onUncover}
                    disabled={resourceCount < cost || isLoading}
                    className="bg-stone-600 text-white text-xs px-2 py-1 rounded-sm shadow-md border border-stone-700 hover:bg-stone-500 disabled:bg-stone-400 btn-animate"
                >
                    {isLoading ? '...' : `Reveal (${cost} ${resourceName})`}
                </button>
            </div>
        );
    };

    return (
        <div className="mt-2">
            <h5 className="text-xs font-bold text-stone-700 flex items-center">
                {title}
                <InfoTooltip text={tooltip} />
            </h5>
            {renderContent()}
        </div>
    );
};

/**
 * ROADMAP_0_MASTER_PLAN.md Phase 3 item 5 - "Deep Analysis" is a premium
 * intel tier, distinct from the `IntelSection` cards above: it's a single
 * synthesized spymaster's assessment rather than a raw uncovered fact, so it
 * gets its own visual treatment (an illuminated, parchment-gold card) to
 * read as qualitatively different from the grey "Reveal" panels.
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
        <div className="mt-3 pt-3 border-t-2 border-dashed border-amber-700">
            <h5 className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center">
                Spymaster's Assessment
                <InfoTooltip text="Commission a premium, synthesized strategic judgment on this individual - a higher-tier read than a raw investigation report, spent from your rare Deep Analyses." />
            </h5>
            {analysis ? (
                <div className="mt-1 bg-amber-50 border-l-4 border-amber-700 rounded-sm p-2 shadow-inner">
                    <p className="text-xs text-amber-900 italic whitespace-pre-wrap">"{analysis}"</p>
                </div>
            ) : (
                <div className="flex justify-between items-center mt-1 gap-2">
                    <p className="text-xs text-stone-500 italic">[No deep analysis commissioned]</p>
                    <button
                        onClick={onCommission}
                        disabled={!canAfford || isLoading}
                        title={!canAfford ? `Requires ${cost} Deep Analyses (you have ${resourceCount})` : undefined}
                        className="flex-shrink-0 bg-amber-800 text-white text-xs px-2 py-1 rounded-sm shadow-md border border-amber-950 hover:bg-amber-700 disabled:bg-stone-400 btn-animate"
                    >
                        {isLoading ? '...' : `Commission Deep Analysis (${cost} Deep Analyses)`}
                    </button>
                </div>
            )}
        </div>
    );
};


const EntityDetails: React.FC<{
    entity: Entity;
    playerEntity: Entity;
    isMember?: boolean;
    onSpendInvestigation: (cost: number) => void;
    onSpendDeepAnalysis: (cost: number) => void;
    onNewInvestigationResult: (result: InvestigationResult) => void;
    onAddSecretAsResource: (targetId: string, secrets: string[]) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ entity, playerEntity, isMember, onSpendInvestigation, onSpendDeepAnalysis, onNewInvestigationResult, onAddSecretAsResource, ai, isMockMode }) => {
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
                         onSpendInvestigation(1);
                         onNewInvestigationResult({ target_id: target.entity_id, report: result.report, consequences: result.consequences });
                         if (type === 'secrets' && result.reportData && Array.isArray(result.reportData)) {
                            onAddSecretAsResource(target.entity_id, result.reportData as string[]);
                         }
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

    return (
        <div className={`p-3 ${isMember ? 'border-t border-stone-300 bg-stone-50' : 'roman-stone-panel rounded-sm'}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h4 className="font-bold text-stone-800">{entity.name}</h4>
                    <p className="text-sm text-stone-600 -mt-1">{entity.position || entity.entity_type}</p>
                </div>
                 <button onClick={() => setIsExpanded(prev => !prev)} className="bg-red-800 text-white text-xs px-3 py-1 rounded-sm shadow-md border border-red-900 hover:bg-red-700 btn-animate">
                    {isExpanded ? 'Collapse' : 'Intel'}
                </button>
            </div>
             {playerRelationship && (
                <>
                    <TrustBar level={playerRelationship.trust_level} />
                    <div className="text-xs text-stone-600 flex justify-between">
                        <span className="italic" title={`Trust: ${playerRelationship.trust_level}/10`}>Trust: <strong className="text-stone-800">{playerRelationship.trust_level}</strong></span>
                        <span className="italic" title={`Respect: ${playerRelationship.respect_level ?? 0}/10`}>Respect: <strong className="text-stone-800">{playerRelationship.respect_level ?? 0}</strong></span>
                    </div>
                    <div className="text-xs text-stone-600 grid grid-cols-3 gap-x-2 text-center mt-1">
                        <span title={`Perceived Threat: ${playerRelationship.perceived_threat ?? 0}/10`}>
                            Threat: <strong className="text-stone-800">{playerRelationship.perceived_threat ?? 0}</strong>
                        </span>
                        <span title={`Ideological Alignment: ${playerRelationship.ideological_alignment ?? 0}/10`}>
                            Alignment: <strong className="text-stone-800">{playerRelationship.ideological_alignment ?? 0}</strong>
                        </span>
                        <span title={`Your Dependency: ${playerRelationship.dependency_level ?? 0}/10`}>
                            Dependency: <strong className="text-stone-800">{playerRelationship.dependency_level ?? 0}</strong>
                        </span>
                    </div>
                </>
            )}

            {isExpanded && (
                <div className="mt-3 pt-3 border-t border-stone-300 space-y-2 animate-fade-in">
                    <p className="text-sm text-stone-700 italic">"{entity.current_state_narrative}"</p>
                    <p className="text-sm text-stone-600 mt-1"><strong>Goals:</strong> {entity.short_term_goals.join(', ')}</p>
                    <button
                        onClick={() => handleRequest('raw_thoughts', entity)}
                        disabled={!!loadingState}
                        className="text-left w-full text-sm mt-2 p-2 bg-stone-200 hover:bg-stone-300 rounded"
                    >
                         <h5 className="font-bold text-stone-700 text-xs">RAW THOUGHTS (Free)</h5>
                         {loadingState === 'raw_thoughts' 
                            ? <p className="text-xs text-stone-500 italic">Thinking...</p>
                            : <p className="text-xs text-stone-600 italic">"{uncoveredIntel.raw_thoughts || 'Click to gauge your immediate feelings about this person.'}"</p>
                         }
                    </button>

                    <div className="mt-2 space-y-2 pt-2 border-t border-dashed border-stone-300">
                        <p className="text-sm font-bold text-stone-800">Intelligence Briefing</p>
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
                            uncoveredData={uncoveredIntel.active_scheme}
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
                        />
                        <DeepAnalysisSection
                            analysis={uncoveredIntel.deep_analysis}
                            cost={DEEP_ANALYSIS_COST}
                            resourceCount={deepAnalyses}
                            onCommission={() => handleRequest('deep_analysis', entity)}
                            isLoading={loadingState === 'deep_analysis'}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};


const FactionSection: React.FC<{
    faction: Entity,
    members: Entity[],
    playerEntity: Entity,
    onSpendInvestigation: (cost: number) => void;
    onSpendDeepAnalysis: (cost: number) => void;
    onNewInvestigationResult: (result: InvestigationResult) => void;
    onAddSecretAsResource: (targetId: string, secrets: string[]) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ faction, members, playerEntity, onSpendInvestigation, onSpendDeepAnalysis, onNewInvestigationResult, onAddSecretAsResource, ai, isMockMode }) => {
    const glossaryEntry = glossaryTerms[faction.name as keyof typeof glossaryTerms];
    return (
        <div className="mb-4">
            <div className="bg-red-900 text-white p-2 rounded-t-sm">
                <h4 className="font-bold">
                     {glossaryEntry ? (
                        <GlossaryTooltip description={glossaryEntry.description} wikiLink={glossaryEntry.wikiLink}>
                            {faction.name}
                        </GlossaryTooltip>
                    ) : faction.name}
                </h4>
                <p className="text-xs italic">"{faction.current_state_narrative}"</p>
            </div>
            <div className="border border-t-0 border-stone-300 rounded-b-sm roman-stone-panel">
                {members.map(entity => (
                    <EntityDetails
                        key={entity.entity_id}
                        entity={entity}
                        playerEntity={playerEntity}
                        isMember={true}
                        onSpendInvestigation={onSpendInvestigation}
                        onSpendDeepAnalysis={onSpendDeepAnalysis}
                        onNewInvestigationResult={onNewInvestigationResult}
                        onAddSecretAsResource={onAddSecretAsResource}
                        ai={ai}
                        isMockMode={isMockMode}
                    />
                ))}
            </div>
        </div>
    );
};

const DramatisPersonaeTab: React.FC<{
    playerEntity: Entity | null;
    entities: Entity[];
    onSpendInvestigation: (cost: number) => void;
    onSpendDeepAnalysis: (cost: number) => void;
    onNewInvestigationResult: (result: InvestigationResult) => void;
    onAddSecretAsResource: (targetId: string, secrets: string[]) => void;
    ai: GoogleGenAI;
    isMockMode: boolean;
}> = ({ playerEntity, entities, onSpendInvestigation, onSpendDeepAnalysis, onNewInvestigationResult, onAddSecretAsResource, ai, isMockMode }) => {

    if (!playerEntity) return <div className="p-4"><p>Loading character...</p></div>;

    const factions = entities.filter(e => e.entity_type === 'faction' && e.status === 'alive');
    const allAliveButPlayer = entities.filter(e => e.entity_id !== playerEntity.entity_id && e.status === 'alive');
    const factionMembers = allAliveButPlayer.filter(e => e.faction_id && e.entity_type !== 'faction');
    const unaligned = allAliveButPlayer.filter(e => !e.faction_id && e.entity_type !== 'faction');

    return (
        <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Dramatis Personae</h3>
            {factions.map(faction => (
                <FactionSection
                    key={faction.entity_id}
                    faction={faction}
                    members={factionMembers.filter(m => m.faction_id === faction.entity_id)}
                    playerEntity={playerEntity}
                    onSpendInvestigation={onSpendInvestigation}
                    onSpendDeepAnalysis={onSpendDeepAnalysis}
                    onNewInvestigationResult={onNewInvestigationResult}
                    onAddSecretAsResource={onAddSecretAsResource}
                    ai={ai}
                    isMockMode={isMockMode}
                />
            ))}
            {unaligned.length > 0 && (
                <div>
                    <h4 className="text-md font-bold text-stone-800 mt-6 mb-2">Unaligned</h4>
                    <div className="space-y-3">
                        {unaligned.map(entity => (
                           <EntityDetails
                                key={entity.entity_id}
                                entity={entity}
                                playerEntity={playerEntity}
                                onSpendInvestigation={onSpendInvestigation}
                                onSpendDeepAnalysis={onSpendDeepAnalysis}
                                onNewInvestigationResult={onNewInvestigationResult}
                                onAddSecretAsResource={onAddSecretAsResource}
                                ai={ai}
                                isMockMode={isMockMode}
                           />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DramatisPersonaeTab;